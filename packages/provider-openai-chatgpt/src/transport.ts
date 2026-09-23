// Adapted protocol shape and SSE routing from OpenClaw 0e79899fedc26ae9a90a196a8bc41b97fd39d7e5,
// packages/ai/src/providers/openai-chatgpt-responses{,-protocol,-events}.ts (MIT).
import type { CredentialStore } from '@vian/core';
import type { LanguageModelV4, LanguageModelV4CallOptions, LanguageModelV4FinishReason, LanguageModelV4StreamPart, LanguageModelV4Usage } from '@ai-sdk/provider';
import { activeSubscriptionTokens, SubscriptionAuthError } from './oauth.ts';

const CODEX_URL = 'https://chatgpt.com/backend-api/codex/responses';
const MAX_STREAM_BYTES = 16 * 1024 * 1024;
const EMPTY_USAGE: LanguageModelV4Usage = { inputTokens: { total: undefined, noCache: undefined, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: undefined, text: undefined, reasoning: undefined } };
type CodexInput = Record<string, unknown>;

function toolOutput(output: { type: string; value?: unknown; reason?: string }): string {
  if (output.type === 'text' || output.type === 'error-text') return String(output.value ?? '');
  if (output.type === 'execution-denied') return output.reason ?? 'Tool execution denied';
  if (output.type === 'content' && Array.isArray(output.value)) return output.value.filter(x => x && typeof x === 'object' && x.type === 'text').map(x => x.text).join('\n');
  return JSON.stringify(output.value ?? null);
}

function convertPrompt(options: LanguageModelV4CallOptions): { instructions: string; input: CodexInput[] } {
  const instructions: string[] = [];
  const input: CodexInput[] = [];
  for (const message of options.prompt) {
    if (message.role === 'system') { instructions.push(message.content); continue; }
    if (message.role === 'tool') {
      for (const part of message.content) {
        if (part.type !== 'tool-result') throw new Error('Unsupported Codex tool approval input');
        input.push({ type: 'function_call_output', call_id: part.toolCallId, output: toolOutput(part.output) });
      }
      continue;
    }
    const content: CodexInput[] = [];
    for (const part of message.content) {
      if (part.type === 'text') content.push({ type: message.role === 'assistant' ? 'output_text' : 'input_text', text: part.text });
      else if (part.type === 'tool-call' && message.role === 'assistant') {
        input.push({ type: 'function_call', call_id: part.toolCallId, name: part.toolName, arguments: JSON.stringify(part.input) });
      } else if (part.type === 'tool-result' && message.role === 'assistant') {
        input.push({ type: 'function_call_output', call_id: part.toolCallId, output: toolOutput(part.output) });
      } else if (part.type === 'file' && message.role === 'user' && part.mediaType.startsWith('image/') && part.data.type === 'data') {
        const bytes = typeof part.data.data === 'string' ? part.data.data : Buffer.from(part.data.data).toString('base64');
        content.push({ type: 'input_image', image_url: `data:${part.mediaType};base64,${bytes}` });
      } else if (part.type === 'reasoning') {
        // No hidden reasoning is sent to the backend or persisted as Vian input.
      } else throw new Error('Codex subscription model does not support this media input');
    }
    if (content.length) input.push({ role: message.role, content });
  }
  return { instructions: instructions.join('\n\n') || 'You are a helpful assistant.', input };
}

function convertTools(options: LanguageModelV4CallOptions): CodexInput[] | undefined {
  const tools = options.tools?.map(tool => {
    if (tool.type !== 'function') throw new Error('Codex subscription supports function tools only');
    return { type: 'function', name: tool.name, description: tool.description, strict: false, parameters: tool.inputSchema };
  });
  return tools?.length ? tools : undefined;
}

function usageOf(value: unknown): LanguageModelV4Usage {
  if (!value || typeof value !== 'object') return EMPTY_USAGE;
  const usage = value as Record<string, unknown>;
  const input = typeof usage.input_tokens === 'number' ? usage.input_tokens : undefined;
  const output = typeof usage.output_tokens === 'number' ? usage.output_tokens : undefined;
  const details = usage.input_tokens_details && typeof usage.input_tokens_details === 'object' ? usage.input_tokens_details as Record<string, unknown> : {};
  const outDetails = usage.output_tokens_details && typeof usage.output_tokens_details === 'object' ? usage.output_tokens_details as Record<string, unknown> : {};
  const cached = typeof details.cached_tokens === 'number' ? details.cached_tokens : undefined;
  return { inputTokens: { total: input, noCache: input === undefined || cached === undefined ? undefined : input - cached, cacheRead: cached, cacheWrite: typeof details.cache_write_tokens === 'number' ? details.cache_write_tokens : undefined }, outputTokens: { total: output, text: undefined, reasoning: typeof outDetails.reasoning_tokens === 'number' ? outDetails.reasoning_tokens : undefined } };
}

async function* events(response: Response, signal?: AbortSignal): AsyncGenerator<Record<string, unknown>> {
  if (!response.body) throw new Error('Codex response had no stream');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '', total = 0;
  try {
    while (true) {
      if (signal?.aborted) throw new SubscriptionAuthError('cancelled', 'Generation cancelled.');
      const { value, done } = await reader.read();
      if (value) { total += value.byteLength; if (total > MAX_STREAM_BYTES) throw new Error('Codex response exceeded size limit'); buffer += decoder.decode(value, { stream: true }); }
      if (done) buffer += decoder.decode();
      while (true) {
        const boundary = /\r?\n\r?\n/.exec(buffer);
        if (!boundary && !done) break;
        const frame = boundary ? buffer.slice(0, boundary.index) : buffer;
        buffer = boundary ? buffer.slice(boundary.index + boundary[0].length) : '';
        if (!frame) break;
        const data = frame.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trim()).join('\n');
        if (data && data !== '[DONE]') {
          let event: unknown;
          try { event = JSON.parse(data); } catch { throw new Error('Codex stream contained invalid JSON'); }
          if (event && typeof event === 'object') yield event as Record<string, unknown>;
        }
        if (!boundary) break;
      }
      if (done) break;
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

export function subscriptionModel(store: CredentialStore, profile: string, modelId: string, fetcher: typeof fetch = fetch): LanguageModelV4 {
  return {
    specificationVersion: 'v4', provider: 'openai-chatgpt', modelId, supportedUrls: {},
    async doStream(options) {
      const tokens = await activeSubscriptionTokens(store, profile, fetcher);
      const { instructions, input } = convertPrompt(options);
      const tools = convertTools(options);
      const body: Record<string, unknown> = { model: modelId, store: false, stream: true, instructions, input, text: { verbosity: 'low' }, include: ['reasoning.encrypted_content'] };
      if (tools) { body.tools = tools; body.tool_choice = 'auto'; body.parallel_tool_calls = true; }
      if (options.reasoning && options.reasoning !== 'provider-default') body.reasoning = { effort: options.reasoning, summary: 'auto' };
      const headers = new Headers({ authorization: `Bearer ${tokens.access}`, 'chatgpt-account-id': tokens.accountId, originator: 'vian', 'OpenAI-Beta': 'responses=experimental', accept: 'text/event-stream', 'content-type': 'application/json' });
      let response: Response;
      try { response = await fetcher(CODEX_URL, { method: 'POST', headers, body: JSON.stringify(body), signal: options.abortSignal }); }
      catch {
        if (options.abortSignal?.aborted) throw new SubscriptionAuthError('cancelled', 'Generation cancelled.');
        throw new Error('Codex transport unavailable');
      }
      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        if (response.status === 401 || response.status === 403) { await store.markReauthRequired(profile); throw new SubscriptionAuthError('reauth-required', 'Codex sign-in is required.'); }
        throw new Error(response.status === 429 ? 'Codex rate limit reached' : response.status >= 500 ? 'Codex service unavailable' : 'Codex request failed');
      }
      const stream = new ReadableStream<LanguageModelV4StreamPart>({
        async start(controller) {
          const textIds = new Set<string>();
          const pendingCalls = new Map<string, { callId: string; name: string; args: string }>();
          let terminal = false, sawTool = false;
          try {
            for await (const event of events(response, options.abortSignal)) {
              const type = event.type;
              if (type === 'response.output_text.delta' && typeof event.delta === 'string') {
                const id = String(event.item_id ?? event.output_index ?? 'text');
                if (!textIds.has(id)) { controller.enqueue({ type: 'text-start', id }); textIds.add(id); }
                controller.enqueue({ type: 'text-delta', id, delta: event.delta });
              } else if (type === 'response.output_item.added' && event.item && typeof event.item === 'object') {
                const item = event.item as Record<string, unknown>;
                if (item.type === 'function_call') pendingCalls.set(String(event.output_index ?? item.id ?? item.call_id), { callId: String(item.call_id ?? item.id ?? crypto.randomUUID()), name: String(item.name ?? ''), args: String(item.arguments ?? '') });
              } else if (type === 'response.function_call_arguments.delta' && typeof event.delta === 'string') {
                const key = String(event.output_index ?? event.item_id);
                const call = pendingCalls.get(key);
                if (call) call.args += event.delta;
              } else if (type === 'response.output_item.done' && event.item && typeof event.item === 'object') {
                const item = event.item as Record<string, unknown>;
                if (item.type === 'function_call') pendingCalls.set(String(event.output_index ?? item.id ?? item.call_id), { callId: String(item.call_id ?? item.id ?? crypto.randomUUID()), name: String(item.name ?? ''), args: String(item.arguments ?? '') });
              } else if (type === 'response.completed' || type === 'response.done' || type === 'response.incomplete') {
                const result = event.response && typeof event.response === 'object' ? event.response as Record<string, unknown> : {};
                if (type === 'response.incomplete' || result.status === 'failed' || result.status === 'cancelled') throw new Error('Codex generation did not complete');
                if (Array.isArray(result.output)) for (const entry of result.output) {
                  if (!entry || typeof entry !== 'object') continue;
                  const item = entry as Record<string, unknown>;
                  if (item.type === 'function_call') {
                    const key = String(item.id ?? item.call_id);
                    if (![...pendingCalls.values()].some(call => call.callId === item.call_id)) pendingCalls.set(key, { callId: String(item.call_id ?? item.id ?? crypto.randomUUID()), name: String(item.name ?? ''), args: String(item.arguments ?? '') });
                  } else if (item.type === 'message' && Array.isArray(item.content)) {
                    const id = String(item.id ?? 'text');
                    if (!textIds.has(id)) for (const content of item.content) {
                      if (content && typeof content === 'object' && content.type === 'output_text' && typeof content.text === 'string') {
                        controller.enqueue({ type: 'text-start', id }); textIds.add(id);
                        controller.enqueue({ type: 'text-delta', id, delta: content.text });
                      }
                    }
                  }
                }
                for (const id of textIds) controller.enqueue({ type: 'text-end', id });
                for (const call of pendingCalls.values()) {
                  if (!call.name) continue;
                  try { JSON.parse(call.args); } catch { throw new Error('Codex tool arguments were invalid'); }
                  controller.enqueue({ type: 'tool-call', toolCallId: call.callId, toolName: call.name, input: call.args }); sawTool = true;
                }
                controller.enqueue({ type: 'finish', finishReason: { unified: sawTool ? 'tool-calls' : 'stop', raw: String(result.status ?? 'completed') }, usage: usageOf(result.usage) });
                terminal = true; break;
              } else if (type === 'error' || type === 'response.failed') throw new Error('Codex generation failed');
            }
            if (!terminal) throw new Error('Codex stream ended before completion');
            controller.close();
          } catch (error) { controller.error(error instanceof SubscriptionAuthError ? error : new Error('Codex stream failed')); }
        },
      });
      return { stream };
    },
    async doGenerate(options) {
      const { stream } = await this.doStream(options);
      const content: Array<{ type: 'text'; text: string } | { type: 'tool-call'; toolCallId: string; toolName: string; input: string }> = [];
      let text = '', finishReason: LanguageModelV4FinishReason = { unified: 'other', raw: undefined }, usage = EMPTY_USAGE;
      for await (const part of stream) {
        if (part.type === 'text-delta') text += part.delta;
        if (part.type === 'tool-call') content.push(part);
        if (part.type === 'finish') { finishReason = part.finishReason; usage = part.usage; }
      }
      if (text) content.unshift({ type: 'text', text });
      return { content, finishReason, usage, warnings: [] };
    },
  };
}
