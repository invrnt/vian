/** Opt-in live assembly checks: VIAN_LIVE=1 bun test tests/e2e/live-chatgpt.test.ts */
import { test, expect } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseManifest, type AttachmentPort, type BotId, type ConversationId, type InboundEvent, type PrincipalId, type RunId } from '../../packages/core/src/index.ts';
import { SqliteBotStore } from '../../packages/storage/src/index.ts';
import { FakeGate } from '../../packages/testing/src/index.ts';
import { BotRuntime } from '../../packages/runtime/src/index.ts';
import { FileCredentialStore } from '../../packages/credentials/src/index.ts';
import { chatgptSubscriptionAdapter } from '../../packages/provider-openai-chatgpt/src/index.ts';

async function setup(gate = new FakeGate(), tools = {} as BotRuntime['deps']['tools']) {
  const root = await mkdtemp(join(tmpdir(), 'vian-live-runtime-'));
  const botId = randomUUID() as BotId;
  await writeFile(join(root, 'VIAN.md'), 'Follow the user request. Call tools explicitly when asked.');
  const store = new SqliteBotStore(botId, join(root, 'state.sqlite'));
  const actor = { gate: 'telegram' as const, externalId: '42' };
  const principal = randomUUID() as PrincipalId;
  await store.bindActor(actor, principal);
  await store.bindDestination(actor, randomUUID() as ConversationId, principal);
  const manifest = parseManifest({ schemaVersion: 1, id: botId, name: 'Live', model: { provider: 'openai-chatgpt', id: 'gpt-5.5', credential: 'oauth:openai-chatgpt:default' }, gate: { type: 'telegram', credential: 'env:FAKE' }, runtime: { maxSteps: 4, runTimeoutSeconds: 90, sameSessionPolicy: 'steer' } }, root);
  const attachments = { async register() { throw new Error('unused'); }, async ingest() { throw new Error('unused'); }, async open() { throw new Error('unused'); }, async list() { return []; }, async expire() { return 0; } } as AttachmentPort;
  const runtime = new BotRuntime({ botId, botRoot: root, manifest, store, gate, provider: chatgptSubscriptionAdapter(new FileCredentialStore()), attachments, tools });
  const event = (id: string, text: string): InboundEvent => ({ gate: 'telegram', externalEventId: id, actor, destination: actor, receivedAt: new Date().toISOString(), kind: 'message', parts: [{ type: 'text', text }] });
  return { root, store, gate, runtime, event, async close() { await runtime.stop(); store.close(); await rm(root, { recursive: true, force: true }); } };
}

async function waitFor(predicate: () => boolean, ms = 30_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!predicate()) { if (Date.now() > deadline) throw new Error('Live provider fixture timed out'); await Bun.sleep(20); }
}

if (process.env.VIAN_LIVE === '1') {
  test('two Vian bot roots share one subscription profile without history crossing', async () => {
    const first = await setup(), second = await setup();
    try {
      await Promise.all([first.runtime.start(), second.runtime.start()]);
      await Promise.all([
        first.gate.emit(first.event('a', 'Reply with exactly ALPHA.')),
        second.gate.emit(second.event('b', 'Reply with exactly BETA.')),
      ]);
      await waitFor(() => first.gate.deliveries.length > 0 && second.gate.deliveries.length > 0);
      expect(first.gate.deliveries[0]?.part.text).toContain('ALPHA');
      expect(second.gate.deliveries[0]?.part.text).toContain('BETA');
      const firstHistory: string[] = [], secondHistory: string[] = [];
      for await (const event of first.store.history({ limit: 100 })) firstHistory.push(JSON.stringify(event.payload));
      for await (const event of second.store.history({ limit: 100 })) secondHistory.push(JSON.stringify(event.payload));
      expect(firstHistory.join('')).not.toContain('BETA');
      expect(secondHistory.join('')).not.toContain('ALPHA');
    } finally { await Promise.all([first.close(), second.close()]); }
  }, 100_000);

  test('ChatGPT live tool batch consumes a same-session steering message once', async () => {
    let release!: () => void, started!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    const began = new Promise<void>(resolve => { started = resolve; });
    let calls = 0;
    const f = await setup(new FakeGate(), { hold_and_echo: { description: 'Required when the user asks to use hold_and_echo. Echo the supplied text.', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false }, async execute(input) { calls++; started(); await held; return input; } } });
    try {
      await f.runtime.start();
      await f.gate.emit(f.event('first', 'Call hold_and_echo with text FIRST. Then answer briefly.'));
      await Promise.race([began, Bun.sleep(30_000).then(() => { throw new Error('Tool was not called'); })]);
      await f.gate.emit(f.event('second', 'Also include the exact word ORCHID in your final answer.'));
      release();
      await waitFor(() => f.gate.deliveries.length > 0);
      expect(calls).toBe(1);
      expect(f.gate.deliveries[0]?.part.text).toContain('ORCHID');
    } finally { release(); await f.close(); }
  }, 100_000);

  test('ChatGPT live stream stops on authorized control before final delivery', async () => {
    let streamed!: () => void;
    const firstChunk = new Promise<void>(resolve => { streamed = resolve; });
    class StreamGate extends FakeGate {
      async draft(_runId: RunId, _destination: unknown, _text: string): Promise<string | undefined> { streamed(); return undefined; }
    }
    const f = await setup(new StreamGate());
    try {
      await f.runtime.start();
      await f.gate.emit(f.event('essay', 'Write a detailed 1000-word essay about lunar geology.'));
      await Promise.race([firstChunk, Bun.sleep(30_000).then(() => { throw new Error('No streaming text arrived'); })]);
      await f.gate.emit({ ...f.event('stop', ''), kind: 'control', control: 'stop', parts: [] });
      for (let i = 0; i < 100; i++) { const events = []; for await (const event of f.store.history({ limit: 100 })) events.push(event.kind); if (events.includes('run_cancelled')) break; await Bun.sleep(20); }
      const kinds: string[] = [];
      for await (const event of f.store.history({ limit: 100 })) kinds.push(event.kind);
      expect(kinds).toContain('run_cancelled');
      expect(f.gate.deliveries).toHaveLength(0);
    } finally { await f.close(); }
  }, 100_000);
}
