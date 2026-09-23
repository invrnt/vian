import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { stepCountIs, streamText, tool } from 'ai';
import { z } from 'zod';
import { FileCredentialStore } from '@vian/credentials';
import type { BotId } from '@vian/core';
import type { LanguageModelV4 } from '@ai-sdk/provider';
import { chatgptSubscriptionAdapter } from './index.ts';
import { saveSubscriptionTokens } from './oauth.ts';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(x => rm(x, { recursive: true, force: true }))); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'vian-codex-')); roots.push(root);
  const store = new FileCredentialStore(join(root, 'credentials'));
  await saveSubscriptionTokens(store, 'default', { access: 'canary-access', refresh: 'canary-refresh', expires: Date.now() + 3600_000, accountId: 'acct-fixture' });
  return store;
}
const botId = '00000000-0000-4000-8000-000000000001' as BotId;
const frame = (event: Record<string, unknown>) => `data: ${JSON.stringify(event)}\n\n`;
const response = (events: Array<Record<string, unknown>>) => new Response(events.map(frame).join(''), { headers: { 'content-type': 'text/event-stream' } });
const input = { botId, botRoot: '/tmp/isolated-bot', modelId: 'configured-codex-model', credential: 'oauth:openai-chatgpt:default' as const };

test('Codex SSE sends dedicated backend protocol and streams text without reasoning', async () => {
  const store = await fixture();
  let seenUrl = '', seenBody: Record<string, unknown> = {}, seenHeaders = new Headers();
  const fetcher = (async (url: RequestInfo | URL, init?: RequestInit) => {
    seenUrl = String(url); seenBody = JSON.parse(String(init?.body)); seenHeaders = new Headers(init?.headers);
    return response([
      { type: 'response.output_text.delta', item_id: 'item-1', delta: 'hello' },
      { type: 'response.reasoning_summary_text.delta', delta: 'private thoughts' },
      { type: 'response.completed', response: { status: 'completed', usage: { input_tokens: 5, output_tokens: 2 } } },
    ]);
  }) as typeof fetch;
  const model = await chatgptSubscriptionAdapter(store, fetcher).resolveModel(input);
  const result = streamText({ model, instructions: 'system instruction', prompt: 'hi' });
  expect(await result.text).toBe('hello');
  expect(seenUrl).toBe('https://chatgpt.com/backend-api/codex/responses');
  expect(seenHeaders.get('authorization')).toBe('Bearer canary-access');
  expect(seenHeaders.get('chatgpt-account-id')).toBe('acct-fixture');
  expect(seenBody).toMatchObject({ model: 'configured-codex-model', store: false, stream: true, instructions: 'system instruction' });
  expect(JSON.stringify(await result.steps)).not.toContain('private thoughts');
});

test('Codex function call is normalized for the Vian AI SDK tool loop', async () => {
  const store = await fixture();
  let posted: Record<string, unknown> = {};
  const fetcher = (async (_url: RequestInfo | URL, init?: RequestInit) => {
    posted = JSON.parse(String(init?.body));
    return response([
      { type: 'response.output_item.added', output_index: 0, item: { type: 'function_call', call_id: 'call-1', name: 'lookup', arguments: '' } },
      { type: 'response.function_call_arguments.delta', output_index: 0, delta: '{"query":"x"}' },
      { type: 'response.completed', response: { status: 'completed' } },
    ]);
  }) as typeof fetch;
  const model = await chatgptSubscriptionAdapter(store, fetcher).resolveModel(input);
  if (typeof model === 'string' || !('doStream' in model)) throw new Error('Expected model object');
  const result = await (model as LanguageModelV4).doStream({ prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }], tools: [{ type: 'function', name: 'lookup', description: 'Find item', inputSchema: { type: 'object', properties: { query: { type: 'string' } } } }] });
  const parts = await Array.fromAsync(result.stream);
  expect(parts.find(x => x.type === 'tool-call')).toMatchObject({ toolCallId: 'call-1', toolName: 'lookup', input: '{"query":"x"}' });
  expect(posted.tools).toMatchObject([{ type: 'function', name: 'lookup', strict: false }]);
  expect(posted.tool_choice).toBe('auto');
});

test('partial stream failure rejects without treating output as a final success', async () => {
  const store = await fixture();
  const fetcher = (async () => response([{ type: 'response.output_text.delta', delta: 'partial' }, { type: 'error', error: { message: 'canary-access' } }])) as unknown as typeof fetch;
  const model = await chatgptSubscriptionAdapter(store, fetcher).resolveModel(input);
  if (typeof model === 'string' || !('doStream' in model)) throw new Error('Expected model object');
  const { stream } = await (model as LanguageModelV4).doStream({ prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }] });
  const emitted: string[] = [];
  try { for await (const part of stream) emitted.push(part.type); throw new Error('Expected stream error'); }
  catch (error) { expect((error as Error).message).toBe('Codex stream failed'); }
  expect(emitted).toContain('text-delta');
  expect(emitted).not.toContain('finish');
});

test('abort is passed to Codex fetch and errors contain no credential', async () => {
  const store = await fixture();
  const abort = new AbortController();
  const fetcher = (async (_url: RequestInfo | URL, init?: RequestInit) => { abort.abort(); expect(init?.signal?.aborted).toBe(true); throw new Error('canary-access'); }) as unknown as typeof fetch;
  const model = await chatgptSubscriptionAdapter(store, fetcher).resolveModel(input);
  if (typeof model === 'string' || !('doStream' in model)) throw new Error('Expected model object');
  await expect((model as LanguageModelV4).doStream({ prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }], abortSignal: abort.signal })).rejects.toThrow('Generation cancelled');
});

test('settled tool result is sent as a Codex function output and final text survives without deltas', async () => {
  const store = await fixture();
  let posted: Record<string, unknown> = {};
  const fetcher = (async (_url: RequestInfo | URL, init?: RequestInit) => {
    posted = JSON.parse(String(init?.body));
    return response([{ type: 'response.completed', response: { status: 'completed', output: [{ type: 'message', id: 'msg-1', content: [{ type: 'output_text', text: 'done' }] }] } }]);
  }) as typeof fetch;
  const model = await chatgptSubscriptionAdapter(store, fetcher).resolveModel(input) as LanguageModelV4;
  const { stream } = await model.doStream({ prompt: [
    { role: 'assistant', content: [{ type: 'tool-call', toolCallId: 'call-1', toolName: 'lookup', input: { query: 'x' } }] },
    { role: 'tool', content: [{ type: 'tool-result', toolCallId: 'call-1', toolName: 'lookup', output: { type: 'json', value: { found: true } } }] },
  ] });
  const parts = await Array.fromAsync(stream);
  expect(parts.filter(x => x.type === 'text-delta')).toMatchObject([{ delta: 'done' }]);
  expect(posted.input).toMatchObject([
    { type: 'function_call', call_id: 'call-1', name: 'lookup' },
    { type: 'function_call_output', call_id: 'call-1', output: '{"found":true}' },
  ]);
});

test('AI SDK executes a Vian tool once and continues with its result', async () => {
  const store = await fixture();
  const requests: Record<string, unknown>[] = [];
  const fetcher = (async (_url: RequestInfo | URL, init?: RequestInit) => {
    requests.push(JSON.parse(String(init?.body)));
    if (requests.length === 1) return response([{ type: 'response.completed', response: { status: 'completed', output: [{ type: 'function_call', call_id: 'call-1', name: 'lookup', arguments: '{"query":"x"}' }] } }]);
    return response([{ type: 'response.completed', response: { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'found it' }] }] } }]);
  }) as typeof fetch;
  const model = await chatgptSubscriptionAdapter(store, fetcher).resolveModel(input);
  let executions = 0;
  const result = streamText({ model, prompt: 'Find x', tools: { lookup: tool({ inputSchema: z.object({ query: z.string() }), execute: async () => { executions++; return { found: true }; } }) }, stopWhen: stepCountIs(2) });
  expect(await result.text).toBe('found it');
  expect(executions).toBe(1);
  expect(requests).toHaveLength(2);
  expect(JSON.stringify(requests[1]?.input)).toContain('function_call_output');
});

test('Codex 401 marks the shared profile for reauthentication without exposing response text', async () => {
  const store = await fixture();
  let calls = 0;
  const fetcher = (async () => { calls++; return new Response('canary-access', { status: 401 }); }) as unknown as typeof fetch;
  const model = await chatgptSubscriptionAdapter(store, fetcher).resolveModel(input) as LanguageModelV4;
  await expect(model.doStream({ prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }] })).rejects.toThrow('sign-in is required');
  expect((await store.list())[0]?.status).toBe('reauth-required');
  expect(await store.read('default')).toBeUndefined();
  await expect(model.doStream({ prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }] })).rejects.toThrow('sign-in is required');
  expect(calls).toBe(1);
});
