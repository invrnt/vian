import { expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MockLanguageModelV4 } from 'ai/test';
import type { BotId, ConversationId, PrincipalId, ProviderAdapter } from '@vian/core';
import { run } from '../../packages/cli/src/local/index.ts';
import { manifestAt, withRegistry } from '../../packages/cli/src/local/common.ts';
import { SqliteBotStore } from '../../packages/storage/src/index.ts';
import { FakeGate } from '../../packages/testing/src/index.ts';
import { loadNativeTools } from '../../packages/tools/src/index.ts';
import { BotRuntime } from '../../packages/runtime/src/index.ts';

test('§67: init through real storage and native tool to durable history', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vian-vertical-'));
  const prior = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = join(root, 'global');
  const output: string[] = [];
  const context = { cwd: root, stdout: (text: string) => output.push(text), stderr: (text: string) => output.push(text) };
  let store: SqliteBotStore | undefined;
  let runtime: BotRuntime | undefined;
  let native: Awaited<ReturnType<typeof loadNativeTools>> | undefined;
  try {
    expect(await run(['init', 'bot', '--provider', 'google', '--model', 'fake'], context)).toBe(0);
    const botRoot = join(root, 'bot');
    const manifest = manifestAt(botRoot);
    expect((await withRegistry(registry => registry.get(manifest.id)))?.path).toBe(botRoot);
    await writeFile(join(botRoot, 'vian.tools.ts'), `export default { answer: { description: 'Answer', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, execute: async () => ({ value: 42 }) } };\n`);
    native = await loadNativeTools(botRoot, manifest.tools);
    store = new SqliteBotStore(manifest.id as BotId, join(botRoot, '.vian/state.sqlite'));
    const actor = { gate: 'telegram' as const, externalId: '42' };
    const principal = randomUUID() as PrincipalId;
    await store.bindActor(actor, principal);
    await store.bindDestination(actor, randomUUID() as ConversationId, principal);
    const gate = new FakeGate();
    let steps = 0;
    const usage = { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } };
    const model = new MockLanguageModelV4({ doStream: async () => ({ stream: new ReadableStream({ start(controller) {
      if (++steps === 1) controller.enqueue({ type: 'tool-call', toolCallId: 'call-1', toolName: 'answer', input: '{}' });
      else { controller.enqueue({ type: 'text-start', id: 'text-1' }); controller.enqueue({ type: 'text-delta', id: 'text-1', delta: 'The answer is 42.' }); controller.enqueue({ type: 'text-end', id: 'text-1' }); }
      controller.enqueue({ type: 'finish', finishReason: { unified: steps === 1 ? 'tool-calls' : 'stop', raw: undefined }, usage }); controller.close();
    } }) }) });
    const provider: ProviderAdapter = { id: 'fake', async resolveModel() { return model; } };
    const attachments = { async register() { throw new Error('unused'); }, async ingest() { throw new Error('unused'); }, async open() { throw new Error('unused'); }, async list() { return []; }, async expire() { return 0; } } as BotRuntime['deps']['attachments'];
    runtime = new BotRuntime({ botId: manifest.id as BotId, botRoot, manifest, store, gate, provider, attachments, tools: native.tools });
    await runtime.start();
    await gate.emit({ gate: 'telegram', externalEventId: 'first', actor, destination: actor, receivedAt: new Date().toISOString(), kind: 'message', parts: [{ type: 'text', text: 'What is the answer?' }] });
    for (let i = 0; i < 100 && gate.deliveries.length === 0; i++) await Bun.sleep(10);
    expect(gate.deliveries[0]?.part.text).toBe('The answer is 42.');
    const kinds: string[] = [];
    for await (const event of store.history({ limit: 100 })) kinds.push(event.kind);
    expect(kinds).toContain('tool_call_succeeded');
    expect(kinds).toContain('assistant_message');
    expect(kinds).toContain('delivery_succeeded');
    expect(await run(['history', manifest.name, '--jsonl'], context)).toBe(0);
    expect(output.join('')).toContain('assistant_message');
  } finally {
    await runtime?.stop(); store?.close(); await native?.dispose();
    if (prior === undefined) delete process.env.XDG_DATA_HOME; else process.env.XDG_DATA_HOME = prior;
    await rm(root, { recursive: true, force: true });
  }
});
