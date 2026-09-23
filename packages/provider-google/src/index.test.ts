import { expect, test } from 'bun:test';
import type { BotId, SecretResolver } from '@vian/core';
import { googleAdapter } from './index.ts';
import { streamText } from 'ai';

const botId = '00000000-0000-4000-8000-000000000001' as BotId;
test('Google adapter uses explicit bot credential and preserves configured model ID', async () => {
  const calls: string[] = [];
  const resolver: SecretResolver = { async resolve(_, root, reference) { calls.push(`${root}:${reference}`); return 'canary-google'; } };
  const model = await googleAdapter(resolver).resolveModel({ botId, botRoot: '/tmp/bot-a', modelId: 'custom-model-id', credential: 'env:GEMINI_API_KEY' });
  expect(typeof model === 'string' ? model : model.modelId).toBe('custom-model-id');
  expect(calls).toEqual(['/tmp/bot-a:env:GEMINI_API_KEY']);
  await expect(googleAdapter(resolver).resolveModel({ botId, botRoot: '/tmp/bot-a', modelId: 'other' })).rejects.toThrow('credential reference');
});

test('Google stream uses bot key, delivers text, and tolerates missing usage', async () => {
  const observed: { url?: string; key?: string } = {};
  const fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    observed.url = String(input);
    observed.key = new Headers(init?.headers).get('x-goog-api-key') ?? undefined;
    return new Response('data: {"candidates":[{"content":{"role":"model","parts":[{"text":"hello"}]},"finishReason":"STOP"}]}\n\n', { headers: { 'content-type': 'text/event-stream' } });
  };
  const resolver: SecretResolver = { async resolve() { return 'canary-google'; } };
  const model = await googleAdapter(resolver, { fetch: fetch as typeof globalThis.fetch }).resolveModel({ botId, botRoot: '/tmp/bot', modelId: 'fixture-model', credential: 'env:GEMINI_API_KEY' });
  const result = streamText({ model, prompt: 'hi' });
  expect(await result.text).toBe('hello');
  expect(observed.key).toBe('canary-google');
  expect(observed.url).toContain('fixture-model');
});
