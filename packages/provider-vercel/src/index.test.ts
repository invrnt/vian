import { expect, test } from 'bun:test';
import type { BotId, SecretResolver } from '@vian/core';
import { gatewayAdapter } from './index.ts';
import { streamText } from 'ai';

const botId = '00000000-0000-4000-8000-000000000001' as BotId;
test('Gateway adapter uses explicit bot credential and preserves configured model ID', async () => {
  const calls: string[] = [];
  const resolver: SecretResolver = { async resolve(_, root, reference) { calls.push(`${root}:${reference}`); return 'canary-gateway'; } };
  const model = await gatewayAdapter(resolver).resolveModel({ botId, botRoot: '/tmp/bot-b', modelId: 'vendor/custom', credential: 'env:AI_GATEWAY_API_KEY' });
  expect(typeof model === 'string' ? model : model.modelId).toBe('vendor/custom');
  expect(calls).toEqual(['/tmp/bot-b:env:AI_GATEWAY_API_KEY']);
  await expect(gatewayAdapter(resolver).resolveModel({ botId, botRoot: '/tmp/bot-b', modelId: 'other' })).rejects.toThrow('credential reference');
});

test('Gateway stream uses bot key, delivers text, and preserves configured ID', async () => {
  const observed: { auth?: string; model?: string } = {};
  const fetch = async (_input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    observed.auth = headers.get('authorization') ?? undefined;
    observed.model = headers.get('ai-language-model-id') ?? undefined;
    const frames = [
      { type: 'text-start', id: 'a' },
      { type: 'text-delta', id: 'a', delta: 'hello' },
      { type: 'text-end', id: 'a' },
      { type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage: { inputTokens: {}, outputTokens: {} } },
    ];
    return new Response(frames.map(x => `data: ${JSON.stringify(x)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } });
  };
  const resolver: SecretResolver = { async resolve() { return 'canary-gateway'; } };
  const model = await gatewayAdapter(resolver, { fetch: fetch as typeof globalThis.fetch }).resolveModel({ botId, botRoot: '/tmp/bot', modelId: 'vendor/fixture', credential: 'env:AI_GATEWAY_API_KEY' });
  const result = streamText({ model, prompt: 'hi' });
  expect(await result.text).toBe('hello');
  expect(observed.auth).toBe('Bearer canary-gateway');
  expect(observed.model).toBe('vendor/fixture');
});
