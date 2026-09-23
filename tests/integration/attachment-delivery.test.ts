import { expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MockLanguageModelV4 } from 'ai/test';
import { parseManifest, type BotId, type ConversationId, type PrincipalId, type ProviderAdapter } from '../../packages/core/src/index.ts';
import { SqliteBotStore } from '../../packages/storage/src/index.ts';
import { AttachmentRegistry } from '../../packages/tools/src/index.ts';
import { FakeGate } from '../../packages/testing/src/index.ts';
import { BotRuntime } from '../../packages/runtime/src/index.ts';

test('generated attachment request becomes canonical file and ordered outbox part', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vian-file-run-'));
  const botId = randomUUID() as BotId;
  const store = new SqliteBotStore(botId, join(root, '.vian/state.sqlite'));
  const attachments = new AttachmentRegistry(id => id === botId ? { root, store } : undefined, 1000);
  attachments.trackBot(botId);
  const actor = { gate: 'telegram' as const, externalId: '42' };
  const principal = randomUUID() as PrincipalId;
  await store.bindActor(actor, principal);
  await store.bindDestination(actor, randomUUID() as ConversationId, principal);
  await writeFile(join(root, 'VIAN.md'), 'Send the requested file.');
  const file = await attachments.ingest(botId, { name: 'note.txt', mimeType: 'text/plain', size: 4, bytes: new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('note')); controller.close(); } }) });
  let step = 0;
  const usage = { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } };
  const model = new MockLanguageModelV4({ doStream: async () => ({ stream: new ReadableStream({ start(controller) {
    if (++step === 1) controller.enqueue({ type: 'tool-call', toolCallId: 'send-1', toolName: 'send_attachment', input: JSON.stringify({ id: file.id }) });
    else { controller.enqueue({ type: 'text-start', id: 'text' }); controller.enqueue({ type: 'text-delta', id: 'text', delta: 'Here is the file.' }); controller.enqueue({ type: 'text-end', id: 'text' }); }
    controller.enqueue({ type: 'finish', finishReason: { unified: step === 1 ? 'tool-calls' : 'stop', raw: undefined }, usage }); controller.close();
  } }) }) });
  const provider: ProviderAdapter = { id: 'fake', async resolveModel() { return model; } };
  const manifest = parseManifest({ schemaVersion: 1, id: botId, name: 'Files', model: { provider: 'google', id: 'fake' }, gate: { type: 'telegram', credential: 'env:FAKE' } }, root);
  const gate = new FakeGate();
  const runtime = new BotRuntime({ botId, botRoot: root, manifest, store, gate, provider, attachments });
  try {
    await runtime.start();
    await gate.emit({ gate: 'telegram', externalEventId: 'one', actor, destination: actor, receivedAt: new Date().toISOString(), kind: 'message', parts: [{ type: 'attachment', attachmentId: file.id, name: file.name, mimeType: file.mimeType }] });
    for (let i = 0; i < 100 && gate.deliveries.length < 2; i++) await Bun.sleep(10);
    expect(gate.deliveries.map(item => item.part.kind)).toEqual(['text', 'file']);
    const assistant = [];
    for await (const event of store.history({ limit: 100 })) if (event.kind === 'assistant_message') assistant.push(event);
    expect((assistant[0]?.payload.message as { parts: unknown[] }).parts).toHaveLength(2);
  } finally { await runtime.stop(); store.close(); await rm(root, { recursive: true, force: true }); }
});
