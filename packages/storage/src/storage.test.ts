import { test, expect } from 'bun:test';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Database } from 'bun:sqlite';
import type { BotId, PrincipalId, ConversationId, RunId, ToolCallId, EventId, MessageId, AttachmentId, InboundEvent, CanonicalMessage, OutboxPart } from '@vian/core';
import { SqliteRegistry, SqliteBotStore, inspectBotSchema } from './index.ts';

const botId = '00000000-0000-4000-8000-000000000001' as BotId;
const principalId = 'alice' as PrincipalId;
const conversationId = 'conversation-1' as ConversationId;
const actor = { gate: 'telegram' as const, externalId: '123' };
const destination = { gate: 'telegram' as const, externalId: '456' };
const event = (id: string): InboundEvent => ({ gate: 'telegram', externalEventId: id, actor, destination, receivedAt: new Date().toISOString(), kind: 'message', parts: [{ type: 'text', text: id }] });
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'vian-storage-'));
  const path = join(dir, 'state.sqlite');
  const store = new SqliteBotStore(botId, path);
  return { dir, path, store, cleanup: () => { store.close(); rmSync(dir, { recursive: true, force: true }); } };
}
async function ready(store: SqliteBotStore) {
  await store.bindActor(actor, principalId);
  const sessionId = await store.bindDestination(destination, conversationId, principalId);
  return sessionId;
}

test('registry move, clone identity, duplicate and unregister preserve files', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'vian-registry-'));
  const first = join(dir, 'first'), second = join(dir, 'second');
  mkdirSync(first); mkdirSync(second);
  const registry = new SqliteRegistry(join(dir, 'registry.sqlite'));
  try {
    const record = { id: botId, alias: 'alpha', path: first, registeredAt: new Date().toISOString(), enabled: true };
    expect((await registry.register(record)).kind).toBe('ok');
    expect((await registry.register({ ...record, path: second })).kind).toBe('duplicate');
    expect((await registry.register({ ...record, path: second }, 'move')).kind).toBe('ok');
    expect((await registry.register({ ...record, id: 'different' as BotId, alias: 'beta', path: first }, 'clone')).kind).toBe('ok');
    await registry.unregister(botId);
    expect(await registry.get(botId)).toBeUndefined();
    expect((await registry.list()).length).toBe(1);
  } finally { registry.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('WAL, foreign keys, duplicate input, FIFO lease, tool crash and online backup', async () => {
  const f = fixture();
  try {
    const db = new Database(f.path);
    expect((db.query('PRAGMA journal_mode').get() as any).journal_mode).toBe('wal');
    db.close();
    const sessionId = await ready(f.store);
    for (let i = 0; i < 5; i++) expect((await f.store.acceptInbound(event(String(i)))).kind).toBe('ok');
    expect((await f.store.acceptInbound(event('0'))).kind).toBe('duplicate');
    expect((await f.store.readPendingInbound(sessionId)).map(r => r.event.externalEventId)).toEqual(['0','1','2','3','4']);
    const leaseUntil = new Date(Date.now() + 60000).toISOString();
    const claimed = await f.store.claimNext(sessionId, 'owner', leaseUntil);
    expect(claimed.kind).toBe('ok');
    if (claimed.kind !== 'ok' || !claimed.value) throw new Error('missing claim');
    expect(claimed.value.event.externalEventId).toBe('0');
    expect((await f.store.claimNext(sessionId, 'other', leaseUntil)).kind).toBe('lease-busy');
    const runId = 'run-1' as RunId;
    expect((await f.store.beginRun(runId, claimed.value, principalId)).kind).toBe('ok');
    const callId = 'call-1' as ToolCallId;
    expect((await f.store.transitionTool(callId, runId, 'pending', {})).kind).toBe('ok');
    expect((await f.store.transitionTool(callId, runId, 'started', { name: 'mutate' })).kind).toBe('ok');
    const backup = join(f.dir, 'snapshot.sqlite');
    await f.store.backup(backup);
    const restored = new Database(backup, { readonly: true });
    expect((restored.query('SELECT count(*) n FROM inbox').get() as any).n).toBe(5);
    restored.close();
    f.store.close();
    const reopened = new SqliteBotStore(botId, f.path);
    expect(await reopened.recoverInterrupted()).toBe(1);
    expect(await reopened.recoverInterrupted()).toBe(0);
    const events = [];
    for await (const e of reopened.history({ limit: 100 })) events.push(e);
    expect(events.some(e => e.kind === 'tool_call_interrupted')).toBe(true);
    expect(events.map(e => e.sequence)).toEqual([...events.map(e => e.sequence)].sort((a,b) => a-b));
    reopened.close();
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});

test('run completion and outbox roll back together on duplicate part', async () => {
  const f = fixture();
  try {
    const sessionId = await ready(f.store);
    const accepted = await f.store.acceptInbound(event('one'));
    if (accepted.kind !== 'ok') throw new Error('accept failed');
    const claim = await f.store.claimNext(sessionId, 'owner', new Date(Date.now()+60000).toISOString());
    if (claim.kind !== 'ok' || !claim.value) throw new Error('claim failed');
    const runId = 'run-2' as RunId;
    await f.store.beginRun(runId, claim.value, principalId);
    const message: CanonicalMessage = { id: 'reply' as MessageId, botId, conversationId, sessionId, runId, role: 'assistant', parts: [{ type: 'text', text: 'done' }], createdAt: new Date().toISOString() };
    const part: OutboxPart = { id: 'part-1', botId, messageId: message.id, destination, part: { partIndex: 0, kind: 'text', text: 'done' }, state: 'queued', attempt: 0 };
    await expect(f.store.completeRun(runId, message, [part, part])).rejects.toThrow();
    expect(await f.store.listDeliveries()).toEqual([]);
    const events = [];
    for await (const e of f.store.history({})) events.push(e);
    expect(events.some(e => e.kind === 'assistant_message')).toBe(false);
    expect((await f.store.completeRun(runId, message, [part])).kind).toBe('ok');
    expect((await f.store.updateDelivery(part.id, 'sending')).kind).toBe('ok');
    expect((await f.store.updateDelivery(part.id, 'ambiguous')).kind).toBe('ok');
    expect((await f.store.updateDelivery(part.id, 'sending')).kind).toBe('invalid-transition');
  } finally { f.cleanup(); }
});

test('tool success and sending recovery retain one audit transition each', async () => {
  const f = fixture();
  try {
    const sessionId = await ready(f.store);
    const accepted = await f.store.acceptInbound(event('work'));
    if (accepted.kind !== 'ok') throw new Error('accept failed');
    const claim = await f.store.claimNext(sessionId, 'owner', new Date(Date.now()+60000).toISOString());
    if (claim.kind !== 'ok' || !claim.value) throw new Error('claim failed');
    const runId = 'run-work' as RunId, callId = 'call-work' as ToolCallId;
    await f.store.beginRun(runId, claim.value, principalId);
    expect((await f.store.transitionTool(callId, runId, 'pending', { name: 'work' })).kind).toBe('ok');
    expect((await f.store.transitionTool(callId, runId, 'started', { name: 'work' })).kind).toBe('ok');
    expect((await f.store.transitionTool(callId, runId, 'succeeded', { result: 'done' })).kind).toBe('ok');
    const finalMessage: CanonicalMessage = { id: 'work-reply' as MessageId, botId, conversationId, sessionId, runId, role: 'assistant', parts: [{ type: 'text', text: 'done' }], createdAt: new Date().toISOString() };
    const part: OutboxPart = { id: 'work-part', botId, messageId: finalMessage.id, destination, part: { partIndex: 0, kind: 'text', text: 'done' }, state: 'queued', attempt: 0 };
    expect((await f.store.completeRun(runId, finalMessage, [part])).kind).toBe('ok');
    expect((await f.store.updateDelivery(part.id, 'sending')).kind).toBe('ok');
    f.store.close();
    const reopened = new SqliteBotStore(botId, f.path);
    expect(await reopened.recoverInterrupted()).toBe(0);
    expect((await reopened.listDeliveries())[0]?.state).toBe('ambiguous');
    expect((await reopened.updateDelivery(part.id, 'sending')).kind).toBe('invalid-transition');
    reopened.close();
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});

test('callback single use, revocation, expiry and reset ordering', async () => {
  const f = fixture();
  try {
    const sessionId = await ready(f.store);
    const actionId = await f.store.createAction({ botId, conversationId, sessionId, principalId, destination, label: 'Choose', value: { x: 1 }, expiresAt: new Date(Date.now()+60000).toISOString() });
    const claim = { botId, actionId, actor, destination, now: new Date().toISOString() };
    expect((await f.store.consumeAction(claim))?.value).toEqual({ x: 1 });
    expect(await f.store.consumeAction(claim)).toBeUndefined();
    const first = await f.store.acceptInbound(event('before'));
    const resetEvent: InboundEvent = { ...event('reset'), kind: 'control', control: 'new' };
    const reset = await f.store.acceptInbound(resetEvent);
    await f.store.acceptInbound(event('after'));
    if (reset.kind !== 'ok') throw new Error('reset was not accepted');
    await f.store.appendResetBarrier(conversationId, principalId, reset.value.id);
    expect((await f.store.applyResetBarrier(conversationId, reset.value.id)).kind).toBe('invalid-transition');
    const earlier = await f.store.claimNext(sessionId, 'owner', new Date(Date.now()+60000).toISOString());
    if (earlier.kind !== 'ok' || !earlier.value) throw new Error('before not claimed');
    await f.store.beginRun('run-before' as RunId, earlier.value, principalId);
    const m: CanonicalMessage = { id: 'before-reply' as MessageId, botId, conversationId, sessionId, runId: 'run-before' as RunId, role: 'assistant', parts: [], createdAt: new Date().toISOString() };
    await f.store.completeRun('run-before' as RunId, m, []);
    const applied = await f.store.applyResetBarrier(conversationId, reset.value.id);
    expect(applied.kind).toBe('ok');
    if (applied.kind === 'ok') expect((await f.store.readPendingInbound(applied.value)).map(r => r.event.externalEventId)).toEqual(['after']);
  } finally { f.cleanup(); }
});

test('callback interaction and one-use action commit with durable inbox', async () => {
  const f = fixture();
  try {
    const sessionId = await ready(f.store);
    const actionId = await f.store.createAction({ botId, conversationId, sessionId, principalId, destination, label: 'Approve', value: { answer: 42 }, expiresAt: new Date(Date.now()+60000).toISOString() });
    const callback: InboundEvent = { ...event('callback-1'), kind: 'callback', parts: undefined, callbackData: actionId };
    const accepted = await f.store.acceptInbound(callback);
    expect(accepted.kind).toBe('ok');
    if (accepted.kind !== 'ok') throw new Error('callback not accepted');
    expect(accepted.value.event.parts).toEqual([{ type: 'interaction', actionId, label: 'Approve', value: { answer: 42 } }]);
    expect((await f.store.acceptInbound(callback)).kind).toBe('duplicate');
    expect((await f.store.acceptInbound({ ...callback, externalEventId: 'callback-2' })).kind).toBe('invalid-transition');
    f.store.close();
    const reopened = new SqliteBotStore(botId, f.path);
    expect((await reopened.readPendingInbound(sessionId))[0]?.event.parts).toEqual(accepted.value.event.parts);
    reopened.close();
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});

test('multiple SQLite writers preserve unique inbox acceptance and reject future schema', async () => {
  const f = fixture();
  try {
    const sessionId = await ready(f.store);
    const writer2 = new SqliteBotStore(botId, f.path);
    try {
      const results = await Promise.all(Array.from({ length: 30 }, (_, i) => (i % 2 ? writer2 : f.store).acceptInbound(event(`item-${Math.floor(i / 2)}`))));
      expect(results.filter(r => r.kind === 'ok')).toHaveLength(15);
      expect(results.filter(r => r.kind === 'duplicate')).toHaveLength(15);
      expect(await f.store.readPendingInbound(sessionId)).toHaveLength(15);
      const check = new Database(f.path);
      expect((check.query('PRAGMA foreign_key_check').all() as unknown[]).length).toBe(0);
      check.close();
    } finally { writer2.close(); }
    f.store.close();
    const db = new Database(f.path);
    db.run('PRAGMA user_version = 999'); db.close();
    expect(() => new SqliteBotStore(botId, f.path)).toThrow('Unsupported future SQLite schema');
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});

test('attachment private path remains privileged and expiry keeps metadata', async () => {
  const f = fixture();
  try {
    const id = 'attachment-1' as any;
    const publicPart = { id, name: 'report.pdf', mimeType: 'application/pdf', size: 4 };
    const privatePath = join(f.dir, 'private-report.pdf');
    const metadata = { sha256: 'a'.repeat(64), origin: 'generated' as const, createdAt: '1999-12-31T00:00:00.000Z' };
    await f.store.registerAttachment(publicPart, privatePath, '2000-01-01T00:00:00.000Z', metadata);
    expect(await f.store.getAttachment(id)).toBeUndefined();
    expect(await f.store.getAttachmentStorage(id)).toEqual({ public: publicPart, privatePath, expiresAt: '2000-01-01T00:00:00.000Z', status: 'expired', metadata });
    expect(await f.store.listExpiredAttachments(new Date().toISOString())).toEqual([{ id, privatePath }]);
    await f.store.markAttachmentDeleted(id);
    expect((await f.store.getAttachmentStorage(id))?.status).toBe('deleted');
    expect(await f.store.listExpiredAttachments(new Date().toISOString())).toEqual([]);
  } finally { f.cleanup(); }
});

test('read-only schema inspection and additive attachment migration preserve legacy rows', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'vian-schema-'));
  const path = join(dir, 'state.sqlite');
  try {
    expect(inspectBotSchema(path)).toEqual({ exists: false, currentVersion: 0, supportedVersion: 2, compatible: false });
    const db = new Database(path);
    const { botMigrations } = await import('./schema.ts');
    db.run(botMigrations[0]); db.run('PRAGMA user_version=1');
    const publicPart = { id: 'old' as AttachmentId, name: 'old.txt', mimeType: 'text/plain', size: 3 };
    db.query('INSERT INTO attachments(id,public_json,private_path,expires_at) VALUES (?,?,?,?)').run('old', JSON.stringify(publicPart), '/tmp/old', '2099-01-01T00:00:00.000Z');
    db.close();
    expect(inspectBotSchema(path)).toEqual({ exists: true, currentVersion: 1, supportedVersion: 2, compatible: true });
    const store = new SqliteBotStore(botId, path);
    expect(await store.getAttachmentStorage('old' as any)).toEqual({ public: publicPart, privatePath: '/tmp/old', expiresAt: '2099-01-01T00:00:00.000Z', status: 'available' });
    store.close();
    expect(inspectBotSchema(path)).toEqual({ exists: true, currentVersion: 2, supportedVersion: 2, compatible: true });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('session listing, run terminal audit, authority and /new ordering', async () => {
  const f = fixture();
  try {
    const sessionId = await ready(f.store);
    expect(await f.store.destinationForConversation(conversationId)).toEqual(destination);
    const before = await f.store.acceptInbound(event('one'));
    const reset = await f.store.acceptInbound({ ...event('reset'), kind: 'control', control: 'new' });
    await f.store.acceptInbound(event('after'));
    if (before.kind !== 'ok' || reset.kind !== 'ok') throw new Error('inbound failed');
    await f.store.appendResetBarrier(conversationId, principalId, reset.value.id);
    expect(await f.store.listReadySessions()).toEqual([sessionId]);
    const first = await f.store.claimNext(sessionId, 'owner', new Date(Date.now()+60000).toISOString());
    if (first.kind !== 'ok' || !first.value) throw new Error('claim failed');
    const runId = 'failed-run' as RunId;
    expect((await f.store.beginRun(runId, first.value, principalId)).kind).toBe('ok');
    expect((await f.store.finishRun(runId, 'failed', { safeMessage: 'provider unavailable' })).kind).toBe('ok');
    expect((await f.store.finishRun(runId, 'cancelled', {})).kind).toBe('invalid-transition');
    await f.store.releaseLease({ sessionId, holder: 'owner', expiresAt: '' });
    const barrier = await f.store.claimNext(sessionId, 'owner', new Date(Date.now()+60000).toISOString());
    expect(barrier.kind === 'ok' && barrier.value?.id).toBe(reset.value.id);
    const barrierAgain = await f.store.claimNext(sessionId, 'owner', new Date(Date.now()+60000).toISOString());
    expect(barrierAgain.kind === 'ok' && barrierAgain.value?.id).toBe(reset.value.id);
    const newSession = await f.store.applyResetBarrier(conversationId, reset.value.id);
    expect(newSession.kind).toBe('ok');
    if (newSession.kind !== 'ok') throw new Error('reset failed');
    const sessions = await f.store.listSessions();
    expect(sessions.find(s => s.id === newSession.value)?.state).toBe('active');
    expect(sessions.find(s => s.id === sessionId)?.state).toBe('inactive');
    expect(sessions.find(s => s.id === sessionId)?.messageCount).toBe(1);
    expect((await f.store.controlAuthority(conversationId, principalId))?.sessionInitiatorId).toBe(principalId);
    expect(await f.store.listReadySessions()).toEqual([newSession.value]);
    const events = [];
    for await (const e of f.store.history({ sessionId })) events.push(e.kind);
    expect(events).toContain('run_failed');
  } finally { f.cleanup(); }
});
