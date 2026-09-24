import { expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { MockLanguageModelV4 } from 'ai/test';
import { parseManifest, type AttachmentPort, type BotId, type ConversationId, type EventId, type InboundEvent, type MessageId, type PrincipalId, type ProviderAdapter, type RunId, type ToolCallId } from '@vian/core';
import { SqliteBotStore } from '../../storage/src/index.ts';
import { FakeGate } from '../../testing/src/index.ts';
import { AccessService, BotRuntime } from './index.ts';

const usage = { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } };
const stream = (parts: unknown[], finishReason: 'stop' | 'tool-calls' = 'stop') => ({ stream: new ReadableStream({ start(controller) { for (const part of parts) controller.enqueue(part); controller.enqueue({ type: 'finish', finishReason: { unified: finishReason, raw: undefined }, usage }); controller.close(); } }) });
const textParts = (value: string) => [{ type: 'text-start', id: 'text-1' }, { type: 'text-delta', id: 'text-1', delta: value }, { type: 'text-end', id: 'text-1' }];
const model = () => new MockLanguageModelV4({ doStream: async () => ({ stream: new ReadableStream({ start(controller) {
  controller.enqueue({ type: 'text-start', id: 'text-1' });
  controller.enqueue({ type: 'text-delta', id: 'text-1', delta: 'hello' });
  controller.enqueue({ type: 'text-end', id: 'text-1' });
  controller.enqueue({ type: 'finish', finishReason: { unified: 'stop', raw: undefined }, usage });
  controller.close();
} }) }) });

async function fixture(options: { model?: MockLanguageModelV4; tools?: import('@vian/core').NativeToolSet; sameSessionPolicy?: 'steer' | 'queue'; groups?: boolean } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'vian-runtime-'));
  await writeFile(join(root, 'VIAN.md'), 'Follow the user request.');
  const botId = randomUUID() as BotId;
  const principal = randomUUID() as PrincipalId;
  const conversation = randomUUID() as ConversationId;
  const destination = { gate: 'telegram' as const, externalId: '42' };
  const actor = { gate: 'telegram' as const, externalId: '42' };
  const store = new SqliteBotStore(botId, join(root, 'bot.sqlite'));
  await store.bindActor(actor, principal);
  await store.bindDestination(destination, conversation, principal);
  const gate = new FakeGate();
  const provider: ProviderAdapter = { id: 'fake', async resolveModel() { return options.model ?? model(); } };
  const manifest = parseManifest({ schemaVersion: 1, id: botId, name: 'Fixture', model: { provider: 'google', id: 'fake' }, gate: { type: 'telegram', credential: 'env:FAKE', access: { groups: options.groups ?? false } }, runtime: { sameSessionPolicy: options.sameSessionPolicy } }, root);
  const attachments = { async register() { throw new Error('unused'); }, async ingest() { throw new Error('unused'); }, async open() { throw new Error('unused'); }, async list() { return []; }, async expire() { return 0; } } as AttachmentPort;
  const runtime = new BotRuntime({ botId, botRoot: root, manifest, store, gate, provider, attachments, tools: options.tools });
  const event = (id: string, text: string): InboundEvent => ({ gate: 'telegram', externalEventId: id, actor, destination, receivedAt: new Date().toISOString(), kind: 'message', parts: [{ type: 'text', text }] });
  return { root, botId, principal, conversation, destination, actor, store, gate, runtime, event, async close() { await runtime.stop(); store.close(); await rm(root, { recursive: true, force: true }); } };
}

async function eventually(predicate: () => Promise<boolean>) {
  for (let i = 0; i < 100; i++) { if (await predicate()) return; await Bun.sleep(10); }
  throw new Error('Timed out waiting for fixture');
}

async function seedPriorMessages(f: Awaited<ReturnType<typeof fixture>>, texts: string[]) {
  const sessionId = (await f.store.resolveDestination(f.destination, f.principal))!.sessionId;
  for (const [index, value] of texts.entries()) {
    const messageId = randomUUID() as MessageId;
    const inbound = f.event(`seed-${index}`, value);
    await f.store.appendAudit({ id: randomUUID() as EventId, botId: f.botId, conversationId: f.conversation, sessionId, principalId: f.principal, kind: 'inbound_message', at: new Date().toISOString(), payload: { messageId, event: inbound } });
    await f.store.appendAudit({ id: randomUUID() as EventId, botId: f.botId, conversationId: f.conversation, sessionId, principalId: f.principal, kind: 'inbound_consumed', at: new Date().toISOString(), payload: { messageId } });
  }
}

test('durable canonical message is delivered once after duplicate inbound', async () => {
  const f = await fixture();
  try {
    await f.runtime.start();
    await f.gate.emit(f.event('update-1', 'say hello'));
    await f.gate.emit(f.event('update-1', 'say hello'));
    await eventually(async () => f.gate.deliveries.length === 1);
    expect(f.gate.deliveries[0]?.part.text).toBe('hello');
    const kinds: string[] = [];
    for await (const item of f.store.history({ limit: 100 })) kinds.push(item.kind);
    expect(kinds.filter(kind => kind === 'inbound_message')).toHaveLength(1);
    expect(kinds.filter(kind => ['inbound_message', 'run_started', 'model_step', 'assistant_message', 'delivery_queued', 'run_completed', 'delivery_sending', 'delivery_succeeded'].includes(kind))).toEqual(['inbound_message', 'run_started', 'model_step', 'assistant_message', 'delivery_queued', 'run_completed', 'delivery_sending', 'delivery_succeeded']);
  } finally { await f.close(); }
});

test('steering waits for a completed tool batch and does not repeat side effects', async () => {
  let executions = 0;
  let releaseTool!: () => void;
  const held = new Promise<void>(resolve => { releaseTool = resolve; });
  let toolStarted!: () => void;
  const started = new Promise<void>(resolve => { toolStarted = resolve; });
  let calls = 0;
  const scripted = new MockLanguageModelV4({ doStream: async () => ++calls === 1
    ? stream([{ type: 'tool-call', toolCallId: 'call-1', toolName: 'mutate', input: '{}' }], 'tool-calls')
    : stream(textParts('done')) });
  const f = await fixture({ model: scripted, tools: { mutate: { description: 'mutate once', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, async execute() { executions++; toolStarted(); await held; return { value: 'ok' }; } } } });
  try {
    await f.runtime.start();
    await f.gate.emit(f.event('one', 'first'));
    await started;
    await f.gate.emit(f.event('two', 'second'));
    releaseTool();
    await eventually(async () => f.gate.deliveries.length === 1);
    expect(executions).toBe(1);
    expect(calls).toBe(2);
    expect(JSON.stringify(scripted.doStreamCalls[1]?.prompt)).toContain('second');
    expect(JSON.stringify(scripted.doStreamCalls[1]?.prompt)).toContain('call-1');
    const kinds: string[] = [];
    for await (const item of f.store.history({ limit: 100 })) kinds.push(item.kind);
    expect(kinds.filter(kind => kind === 'inbound_consumed')).toHaveLength(1);
    expect(kinds.filter(kind => kind === 'tool_call_started')).toHaveLength(1);
  } finally { releaseTool(); await f.close(); }
});

test('explicit queue mode keeps a follow-up for a separate run', async () => {
  let releaseTool!: () => void;
  const held = new Promise<void>(resolve => { releaseTool = resolve; });
  let toolStarted!: () => void;
  const started = new Promise<void>(resolve => { toolStarted = resolve; });
  let calls = 0;
  const scripted = new MockLanguageModelV4({ doStream: async () => ++calls === 1
    ? stream([{ type: 'tool-call', toolCallId: 'call-1', toolName: 'wait', input: '{}' }], 'tool-calls')
    : stream(textParts(`reply-${calls}`)) });
  const f = await fixture({ model: scripted, sameSessionPolicy: 'queue', tools: { wait: { description: 'wait', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, async execute() { toolStarted(); await held; return 'ok'; } } } });
  try {
    await f.runtime.start();
    await f.gate.emit(f.event('one', 'first'));
    await started;
    await f.gate.emit(f.event('two', 'second'));
    releaseTool();
    await eventually(async () => f.gate.deliveries.length === 2);
    expect(calls).toBe(3);
    expect(JSON.stringify(scripted.doStreamCalls[1]?.prompt)).not.toContain('second');
    expect(JSON.stringify(scripted.doStreamCalls[2]?.prompt)).toContain('second');
  } finally { releaseTool(); await f.close(); }
});

test('an ordered /new barrier separates sessions and retains prior history', async () => {
  const f = await fixture();
  try {
    await f.runtime.start();
    await f.gate.emit(f.event('one', 'before'));
    await eventually(async () => f.gate.deliveries.length === 1);
    const old = (await f.store.resolveDestination(f.destination, f.principal))!.sessionId;
    await f.gate.emit({ ...f.event('reset', ''), kind: 'control', control: 'new', parts: [] });
    await f.gate.emit(f.event('two', 'after'));
    await eventually(async () => f.gate.deliveries.length === 2);
    const fresh = (await f.store.resolveDestination(f.destination, f.principal))!.sessionId;
    expect(fresh).not.toBe(old);
    const oldEvents: string[] = [], newEvents: string[] = [];
    for await (const item of f.store.history({ sessionId: old, limit: 100 })) oldEvents.push(item.kind);
    for await (const item of f.store.history({ sessionId: fresh, limit: 100 })) newEvents.push(item.kind);
    expect(oldEvents).toContain('assistant_message');
    expect(newEvents).toContain('session_reset');
  } finally { await f.close(); }
});

test('shared conversation allows approved messages but rejects another principal reset', async () => {
  const f = await fixture({ groups: true });
  const other = randomUUID() as PrincipalId;
  const otherActor = { gate: 'telegram' as const, externalId: '77' };
  const group = { gate: 'telegram' as const, externalId: '-1001' };
  try {
    await f.store.bindActor(otherActor, other);
    await f.store.bindDestination(group, f.conversation, f.principal);
    await f.runtime.start();
    await f.gate.emit({ ...f.event('wrong-reset', ''), actor: otherActor, destination: group, kind: 'control', control: 'new', parts: [] });
    await f.gate.emit({ ...f.event('allowed', 'hello'), actor: otherActor, destination: group });
    await eventually(async () => f.gate.deliveries.length === 1);
    const context = (await f.store.resolveDestination(group, other))!;
    const kinds: string[] = [];
    for await (const item of f.store.history({ sessionId: context.sessionId, limit: 100 })) kinds.push(item.kind);
    expect(kinds).not.toContain('session_reset');
    expect(kinds).toContain('assistant_message');
  } finally { await f.close(); }
});

test('ambiguous delivery remains held and blocks later parts at that destination', async () => {
  const f = await fixture();
  let attempts = 0;
  f.gate.deliver = async () => { attempts++; return { kind: 'ambiguous', safeMessage: 'Response was lost' }; };
  try {
    await f.runtime.start();
    await f.gate.emit(f.event('one', 'first'));
    await f.gate.emit(f.event('two', 'second'));
    await eventually(async () => (await f.store.listDeliveries()).length === 2);
    await f.runtime.flushDeliveries();
    const parts = await f.store.listDeliveries();
    expect(attempts).toBe(1);
    expect(parts.map(part => part.state)).toEqual(['ambiguous', 'queued']);
  } finally { await f.close(); }
});

test('callback accepted during a run is consumed once in the bound conversation', async () => {
  let releaseTool!: () => void;
  const held = new Promise<void>(resolve => { releaseTool = resolve; });
  let toolStarted!: () => void;
  const started = new Promise<void>(resolve => { toolStarted = resolve; });
  let calls = 0;
  const scripted = new MockLanguageModelV4({ doStream: async () => ++calls === 1
    ? stream([{ type: 'tool-call', toolCallId: 'call-1', toolName: 'wait', input: '{}' }], 'tool-calls')
    : stream(textParts('done')) });
  const f = await fixture({ model: scripted, tools: { wait: { description: 'wait', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, async execute() { toolStarted(); await held; return 'ok'; } } } });
  try {
    await f.runtime.start();
    await f.gate.emit(f.event('one', 'first'));
    await started;
    const sessionId = (await f.store.resolveDestination(f.destination, f.principal))!.sessionId;
    const actionId = await f.store.createAction({ botId: f.botId, conversationId: f.conversation, sessionId, principalId: f.principal, destination: f.destination, label: 'Pick', value: 'a', expiresAt: new Date(Date.now() + 60_000).toISOString() });
    const callback: InboundEvent = { ...f.event('callback', ''), kind: 'callback', parts: [], callbackData: actionId };
    await f.gate.emit(callback);
    await f.gate.emit({ ...callback, externalEventId: 'callback-repeat' });
    releaseTool();
    await eventually(async () => f.gate.deliveries.length === 2);
    const events: string[] = [];
    for await (const item of f.store.history({ sessionId, limit: 100 })) events.push(item.kind);
    expect(events.filter(kind => kind === 'inbound_message')).toHaveLength(2);
    expect(calls).toBe(3);
  } finally { releaseTool(); await f.close(); }
});

test('provider failure after partial text ends the run without leaking its error', async () => {
  const scripted = new MockLanguageModelV4({ doStream: async () => stream([...textParts('partial'), { type: 'error', error: new Error('private-provider-detail') }]) });
  const f = await fixture({ model: scripted });
  try {
    await f.runtime.start();
    await f.gate.emit(f.event('one', 'trigger'));
    await eventually(async () => {
      for await (const event of f.store.history({ limit: 100 })) if (event.kind === 'run_failed') return true;
      return false;
    });
    const history: string[] = [];
    for await (const item of f.store.history({ limit: 100 })) history.push(JSON.stringify(item));
    expect(history.join('\n')).not.toContain('private-provider-detail');
    await eventually(async () => f.gate.deliveries.length === 1);
    expect(f.gate.deliveries[0]?.part.text).toBe('The request could not be completed. Please try again.');
  } finally { await f.close(); }
});

test('authorized stop cancels the active run without delivering hidden output', async () => {
  let releaseTool!: () => void;
  const held = new Promise<void>(resolve => { releaseTool = resolve; });
  let toolStarted!: () => void;
  const started = new Promise<void>(resolve => { toolStarted = resolve; });
  const scripted = new MockLanguageModelV4({ doStream: async () => stream([{ type: 'tool-call', toolCallId: 'call-1', toolName: 'wait', input: '{}' }], 'tool-calls') });
  const f = await fixture({ model: scripted, tools: { wait: { description: 'wait', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, async execute() { toolStarted(); await held; return 'done'; } } } });
  try {
    await f.runtime.start();
    await f.gate.emit(f.event('one', 'start'));
    await started;
    await f.gate.emit({ ...f.event('stop', ''), kind: 'control', control: 'stop', parts: [] });
    releaseTool();
    await eventually(async () => {
      for await (const event of f.store.history({ limit: 100 })) if (event.kind === 'run_cancelled') return true;
      return false;
    });
    expect(f.gate.deliveries).toHaveLength(0);
  } finally { releaseTool(); await f.close(); }
});

test('two principals in distinct sessions overlap without sharing model context', async () => {
  let arrivals = 0;
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  let bothStarted!: () => void;
  const started = new Promise<void>(resolve => { bothStarted = resolve; });
  const scripted = new MockLanguageModelV4({ doStream: async () => {
    arrivals++;
    if (arrivals === 2) bothStarted();
    await held;
    return stream(textParts('done'));
  } });
  const f = await fixture({ model: scripted });
  const secondActor = { gate: 'telegram' as const, externalId: '77' };
  const secondDestination = { gate: 'telegram' as const, externalId: '77' };
  const secondPrincipal = randomUUID() as PrincipalId;
  try {
    await f.store.bindActor(secondActor, secondPrincipal);
    await f.store.bindDestination(secondDestination, randomUUID() as ConversationId, secondPrincipal);
    await f.runtime.start();
    await f.gate.emit(f.event('one', 'secret-alpha'));
    await f.gate.emit({ ...f.event('two', 'secret-beta'), actor: secondActor, destination: secondDestination });
    await started;
    expect(arrivals).toBe(2);
    const prompts = scripted.doStreamCalls.map(call => JSON.stringify(call.prompt));
    expect(prompts.filter(prompt => prompt.includes('secret-alpha'))).toHaveLength(1);
    expect(prompts.filter(prompt => prompt.includes('secret-beta'))).toHaveLength(1);
    release();
    await eventually(async () => f.gate.deliveries.length === 2);
  } finally { release(); await f.close(); }
});

test('restart drains five accepted inputs in FIFO order after a stale lease', async () => {
  const f = await fixture({ sameSessionPolicy: 'queue' });
  try {
    const session = (await f.store.resolveDestination(f.destination, f.principal))!.sessionId;
    for (let n = 1; n <= 5; n++) expect((await f.store.acceptInbound(f.event(`queued-${n}`, `message-${n}`))).kind).toBe('ok');
    expect((await f.store.claimNext(session, 'dead-process', new Date(Date.now() + 100_000).toISOString())).kind).toBe('ok');
    await f.runtime.start();
    await eventually(async () => f.gate.deliveries.length === 5);
    const prompts: string[] = [];
    for await (const item of f.store.history({ sessionId: session, limit: 100 })) if (item.kind === 'inbound_message') {
      const part = (item.payload.event as InboundEvent).parts?.[0];
      prompts.push(part?.type === 'text' ? part.text : '');
    }
    expect(prompts).toEqual(['message-1', 'message-2', 'message-3', 'message-4', 'message-5']);
  } finally { await f.close(); }
});

test('two tool calls record durable pending, started and succeeded boundaries', async () => {
  let calls = 0;
  const scripted = new MockLanguageModelV4({ doStream: async () => ++calls === 1
    ? stream([{ type: 'tool-call', toolCallId: 'a', toolName: 'first', input: '{}' }, { type: 'tool-call', toolCallId: 'b', toolName: 'second', input: '{}' }], 'tool-calls')
    : stream(textParts('done')) });
  const tool = { description: 'record', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, async execute() { return { ok: true }; } };
  const f = await fixture({ model: scripted, tools: { first: tool, second: tool } });
  try {
    await f.runtime.start();
    await f.gate.emit(f.event('one', 'invoke'));
    await eventually(async () => f.gate.deliveries.length === 1);
    const kinds: string[] = [];
    for await (const item of f.store.history({ toolsOnly: true, limit: 100 })) kinds.push(item.kind);
    expect(kinds.filter(kind => kind === 'tool_call_pending')).toHaveLength(2);
    expect(kinds.filter(kind => kind === 'tool_call_started')).toHaveLength(2);
    expect(kinds.filter(kind => kind === 'tool_call_succeeded')).toHaveLength(2);
  } finally { await f.close(); }
});

test('multipart delivery serializes one destination while another progresses', async () => {
  const f = await fixture();
  const secondActor = { gate: 'telegram' as const, externalId: '77' };
  const secondDestination = { gate: 'telegram' as const, externalId: '77' };
  const secondPrincipal = randomUUID() as PrincipalId;
  let releaseFirst!: () => void;
  const held = new Promise<void>(resolve => { releaseFirst = resolve; });
  let firstStarted!: () => void;
  const started = new Promise<void>(resolve => { firstStarted = resolve; });
  f.gate.render = async message => [{ partIndex: 0, kind: 'text', text: 'part-1' }, { partIndex: 1, kind: 'text', text: 'part-2' }];
  f.gate.deliver = async (part, destination) => {
    if (destination.externalId === '42' && part.partIndex === 0) { firstStarted(); await held; }
    f.gate.deliveries.push({ part, destination });
    return { kind: 'succeeded', receipt: { externalId: String(f.gate.deliveries.length), sentAt: new Date().toISOString() } };
  };
  try {
    await f.store.bindActor(secondActor, secondPrincipal);
    await f.store.bindDestination(secondDestination, randomUUID() as ConversationId, secondPrincipal);
    await f.runtime.start();
    await f.gate.emit(f.event('one', 'first'));
    await started;
    await f.gate.emit({ ...f.event('two', 'second'), actor: secondActor, destination: secondDestination });
    await eventually(async () => f.gate.deliveries.filter(item => item.destination.externalId === '77').length === 2);
    expect(f.gate.deliveries.filter(item => item.destination.externalId === '42')).toHaveLength(0);
    releaseFirst();
    await eventually(async () => f.gate.deliveries.length === 4);
    expect(f.gate.deliveries.filter(item => item.destination.externalId === '42').map(item => item.part.partIndex)).toEqual([0, 1]);
  } finally { releaseFirst(); await f.close(); }
});

test('startup interrupts a started tool without replaying its mutation', async () => {
  let mutations = 0;
  const f = await fixture({ tools: { mutate: { description: 'mutation', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, async execute() { mutations++; return 'done'; } } } });
  try {
    const session = (await f.store.resolveDestination(f.destination, f.principal))!.sessionId;
    const accepted = await f.store.acceptInbound(f.event('pre-crash', 'mutate'));
    expect(accepted.kind).toBe('ok');
    if (accepted.kind !== 'ok') throw new Error('Fixture acceptance failed');
    const claimed = await f.store.claimNext(session, 'dead-process', new Date(Date.now() + 100_000).toISOString());
    expect(claimed.kind).toBe('ok');
    const runId = randomUUID() as RunId;
    expect((await f.store.beginRun(runId, accepted.value, f.principal)).kind).toBe('ok');
    const callId = randomUUID() as ToolCallId;
    await f.store.transitionTool(callId, runId, 'pending', { tool: 'mutate' });
    await f.store.transitionTool(callId, runId, 'started', { tool: 'mutate' });
    await f.runtime.start();
    await Bun.sleep(20);
    expect(mutations).toBe(0);
    const kinds: string[] = [];
    for await (const item of f.store.history({ limit: 100 })) kinds.push(item.kind);
    expect(kinds).toContain('tool_call_interrupted');
    expect(kinds).toContain('run_interrupted');
  } finally { await f.close(); }
});

test('unknown private sender receives one durable pairing notice without model access', async () => {
  let modelCalls = 0;
  const scripted = new MockLanguageModelV4({ doStream: async () => { modelCalls++; return stream(textParts('unexpected')); } });
  const f = await fixture({ model: scripted });
  const stranger = { gate: 'telegram' as const, externalId: '99' };
  try {
    await f.runtime.start();
    const unknown = { ...f.event('unknown-update', 'hello'), actor: stranger, destination: { gate: 'telegram' as const, externalId: '99' } };
    await f.gate.emit(unknown);
    await f.gate.emit(unknown);
    await eventually(async () => f.gate.deliveries.length === 1);
    expect(modelCalls).toBe(0);
    expect(f.gate.deliveries[0]?.part.text).toContain('Pairing code');
    expect((await f.store.listDeliveries()).filter(part => part.state === 'succeeded')).toHaveLength(1);
  } finally { await f.close(); }
});

test('owner verification consumes a private code without model access or legacy code disclosure', async () => {
  let modelCalls = 0;
  const scripted = new MockLanguageModelV4({ doStream: async () => { modelCalls++; return stream(textParts('hello')); } });
  const f = await fixture({ model: scripted });
  const sender = { gate: 'telegram' as const, externalId: '99' };
  try {
    await f.runtime.start();
    const { code } = await f.store.createOwnerVerification('invited-user' as PrincipalId, new Date(Date.now() + 60_000).toISOString());
    await f.gate.emit({ ...f.event('wrong', 'wrong'), actor: sender, destination: sender });
    expect(await f.store.resolveActor(sender)).toBeUndefined();
    expect(await f.store.listDeliveries(sender)).toEqual([]);
    await f.gate.emit({ ...f.event('verify', code), actor: sender, destination: sender });
    expect(await f.store.resolveActor(sender)).toBe('invited-user' as PrincipalId);
    expect(modelCalls).toBe(0);
    expect(await f.store.listDeliveries(sender)).toEqual([]);
    const audit = [];
    for await (const entry of f.store.history({})) audit.push(entry);
    expect(JSON.stringify(audit)).not.toContain(code);
    await f.gate.emit({ ...f.event('message', 'hello'), actor: sender, destination: sender });
    await eventually(async () => modelCalls === 1);
  } finally { await f.close(); }
});

test('five follow-ups steer in accepted order at one settled boundary', async () => {
  let releaseTool!: () => void;
  const held = new Promise<void>(resolve => { releaseTool = resolve; });
  let toolStarted!: () => void;
  const started = new Promise<void>(resolve => { toolStarted = resolve; });
  let calls = 0;
  const scripted = new MockLanguageModelV4({ doStream: async () => ++calls === 1
    ? stream([{ type: 'tool-call', toolCallId: 'call-1', toolName: 'wait', input: '{}' }], 'tool-calls')
    : stream(textParts('done')) });
  const f = await fixture({ model: scripted, tools: { wait: { description: 'wait', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, async execute() { toolStarted(); await held; return 'ok'; } } } });
  try {
    await f.runtime.start();
    await f.gate.emit(f.event('first', 'initial'));
    await started;
    for (let n = 1; n <= 5; n++) await f.gate.emit(f.event(`follow-${n}`, `follow-${n}`));
    releaseTool();
    await eventually(async () => f.gate.deliveries.length === 1);
    const prompt = JSON.stringify(scripted.doStreamCalls[1]?.prompt);
    let previous = -1;
    for (let n = 1; n <= 5; n++) { const position = prompt.indexOf(`follow-${n}`); expect(position).toBeGreaterThan(previous); previous = position; }
    const kinds: string[] = [];
    for await (const item of f.store.history({ limit: 100 })) kinds.push(item.kind);
    expect(kinds.filter(kind => kind === 'inbound_consumed')).toHaveLength(5);
  } finally { releaseTool(); await f.close(); }
});

test('active /new barrier keeps later input out of the old run', async () => {
  let releaseTool!: () => void;
  const held = new Promise<void>(resolve => { releaseTool = resolve; });
  let toolStarted!: () => void;
  const started = new Promise<void>(resolve => { toolStarted = resolve; });
  let calls = 0;
  const scripted = new MockLanguageModelV4({ doStream: async () => ++calls === 1
    ? stream([{ type: 'tool-call', toolCallId: 'call-1', toolName: 'wait', input: '{}' }], 'tool-calls')
    : stream(textParts('done')) });
  const f = await fixture({ model: scripted, tools: { wait: { description: 'wait', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, async execute() { toolStarted(); await held; return 'ok'; } } } });
  try {
    await f.runtime.start();
    await f.gate.emit(f.event('first', 'initial'));
    await started;
    const old = (await f.store.resolveDestination(f.destination, f.principal))!.sessionId;
    await f.gate.emit(f.event('before', 'before-reset'));
    await f.gate.emit({ ...f.event('reset', ''), kind: 'control', control: 'new', parts: [] });
    await f.gate.emit(f.event('after', 'after-reset'));
    releaseTool();
    await eventually(async () => f.gate.deliveries.length === 2);
    const fresh = (await f.store.resolveDestination(f.destination, f.principal))!.sessionId;
    expect(fresh).not.toBe(old);
    expect(JSON.stringify(scripted.doStreamCalls[1]?.prompt)).toContain('before-reset');
    expect(JSON.stringify(scripted.doStreamCalls[1]?.prompt)).not.toContain('after-reset');
    expect(JSON.stringify(scripted.doStreamCalls[2]?.prompt)).toContain('after-reset');
  } finally { releaseTool(); await f.close(); }
});

test('button tool result becomes canonical text and durable rendered rows', async () => {
  let calls = 0;
  const scripted = new MockLanguageModelV4({ doStream: async () => ++calls === 1
    ? stream([{ type: 'tool-call', toolCallId: 'button-call', toolName: 'telegram_present_buttons', input: '{}' }], 'tool-calls')
    : stream(textParts('model continuation')) });
  let f!: Awaited<ReturnType<typeof fixture>>;
  f = await fixture({ model: scripted, tools: { telegram_present_buttons: { description: 'buttons', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, async execute(_input, ctx) {
    const actionId = await f.store.createAction({ botId: f.botId, conversationId: ctx.conversationId, sessionId: ctx.sessionId, destination: f.destination, label: 'Choose', value: 'yes', expiresAt: new Date(Date.now() + 60_000).toISOString() });
    return { kind: 'telegram-buttons', text: 'Choose one', rows: [[{ label: 'Choose', actionId }]] };
  } } } });
  try {
    await f.runtime.start();
    await f.gate.emit(f.event('button-input', 'show choices'));
    await eventually(async () => f.gate.deliveries.length === 1);
    const part = (await f.store.listDeliveries())[0]!;
    expect(part.part.text).toBe('Choose one');
    expect(part.part.buttons?.[0]?.[0]?.label).toBe('Choose');
    expect(part.state).toBe('succeeded');
  } finally { await f.close(); }
});

test('revoked queued sender is rejected before steering reaches the model', async () => {
  let releaseTool!: () => void;
  const held = new Promise<void>(resolve => { releaseTool = resolve; });
  let toolStarted!: () => void;
  const started = new Promise<void>(resolve => { toolStarted = resolve; });
  let calls = 0;
  const scripted = new MockLanguageModelV4({ doStream: async () => ++calls === 1
    ? stream([{ type: 'tool-call', toolCallId: 'call-1', toolName: 'wait', input: '{}' }], 'tool-calls')
    : stream(textParts('done')) });
  const f = await fixture({ model: scripted, tools: { wait: { description: 'wait', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, async execute() { toolStarted(); await held; return 'ok'; } } } });
  try {
    await f.runtime.start();
    await f.gate.emit(f.event('one', 'first'));
    await started;
    await f.gate.emit(f.event('two', 'private-after-revocation'));
    await f.store.revokeBinding(f.actor);
    releaseTool();
    await eventually(async () => f.gate.deliveries.length === 1);
    expect(JSON.stringify(scripted.doStreamCalls[1]?.prompt)).not.toContain('private-after-revocation');
    const kinds: string[] = [];
    for await (const item of f.store.history({ limit: 100 })) kinds.push(item.kind);
    expect(kinds).toContain('inbound_rejected');
  } finally { releaseTool(); await f.close(); }
});

test('manifest administrator assignment is synchronized on start and removal', async () => {
  const f = await fixture();
  try {
    f.runtime.deps.manifest.gate.access.administratorPrincipalIds = [f.principal];
    await f.runtime.start();
    expect((await f.store.controlAuthority(f.conversation, f.principal))?.isAdministrator).toBe(true);
    await f.runtime.stop();
    f.runtime.deps.manifest.gate.access.administratorPrincipalIds = [];
    await f.runtime.start();
    expect((await f.store.controlAuthority(f.conversation, f.principal))?.isAdministrator).toBe(false);
  } finally { await f.close(); }
});

test('pairing approval creates a usable private canonical conversation', async () => {
  const f = await fixture();
  const stranger = { gate: 'telegram' as const, externalId: '99' };
  const destination = { gate: 'telegram' as const, externalId: '99' };
  try {
    await f.runtime.start();
    await f.gate.emit({ ...f.event('pair-me', 'hello'), actor: stranger, destination });
    await eventually(async () => f.gate.deliveries.length === 1);
    const access = new AccessService(f.store);
    const pending = await access.pending();
    expect(pending).toHaveLength(1);
    const newPrincipal = randomUUID() as PrincipalId;
    expect((await access.approve(pending[0]!.code, newPrincipal)).kind).toBe('ok');
    await f.gate.emit({ ...f.event('approved', 'hello again'), actor: stranger, destination });
    await eventually(async () => f.gate.deliveries.length === 2);
    expect((await f.store.resolveDestination(destination, newPrincipal))?.principalId).toBe(newPrincipal);
    expect(await access.pending()).toHaveLength(0);
  } finally { await f.close(); }
});

test('per-bot capacity queues another session without polling or overlap', async () => {
  let arrivals = 0;
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  let firstStarted!: () => void;
  const started = new Promise<void>(resolve => { firstStarted = resolve; });
  const scripted = new MockLanguageModelV4({ doStream: async () => {
    arrivals++;
    if (arrivals === 1) { firstStarted(); await held; }
    return stream(textParts('done'));
  } });
  const f = await fixture({ model: scripted });
  const secondActor = { gate: 'telegram' as const, externalId: '77' };
  const secondPrincipal = randomUUID() as PrincipalId;
  try {
    f.runtime.deps.manifest.runtime.perBotConcurrency = 1;
    await f.store.bindActor(secondActor, secondPrincipal);
    await f.store.bindDestination(secondActor, randomUUID() as ConversationId, secondPrincipal);
    await f.runtime.start();
    await f.gate.emit(f.event('first', 'one'));
    await started;
    await f.gate.emit({ ...f.event('second', 'two'), actor: secondActor, destination: secondActor });
    await Bun.sleep(20);
    expect(arrivals).toBe(1);
    release();
    await eventually(async () => f.gate.deliveries.length === 2);
    expect(arrivals).toBe(2);
  } finally { release(); await f.close(); }
});

test('summary-tail persists a summary and retains recent context', async () => {
  const scripted = new MockLanguageModelV4({
    doGenerate: async () => ({ content: [{ type: 'text', text: 'Earlier requests summarized.' }], finishReason: { unified: 'stop', raw: undefined }, warnings: [], usage }),
    doStream: async () => stream(textParts('done')),
  });
  const f = await fixture({ model: scripted });
  try {
    f.runtime.deps.manifest.context.maxRecentMessages = 2;
    await seedPriorMessages(f, ['old-one', 'old-two', 'recent-three', 'recent-four']);
    await f.runtime.start();
    await f.gate.emit(f.event('current', 'current'));
    await eventually(async () => f.gate.deliveries.length === 1);
    const sessionId = (await f.store.resolveDestination(f.destination, f.principal))!.sessionId;
    expect((await f.store.readSummary(sessionId))?.text).toContain('Earlier requests summarized.');
    expect(scripted.doStreamCalls.length).toBe(1);
    expect(f.gate.deliveries[0]?.part.text).toBe('done');
    const prompt = JSON.stringify(scripted.doStreamCalls[0]?.prompt);
    expect(prompt).toContain('recent-four');
    expect(prompt).toContain('Earlier requests summarized.');
    expect(prompt).not.toContain('old-one');
  } finally { await f.close(); }
});

test('summary failure uses the recent tail without losing the run', async () => {
  const scripted = new MockLanguageModelV4({
    doGenerate: async () => { throw new Error('summary provider unavailable'); },
    doStream: async () => stream(textParts('tail answer')),
  });
  const f = await fixture({ model: scripted });
  try {
    f.runtime.deps.manifest.context.maxRecentMessages = 2;
    await seedPriorMessages(f, ['old-one', 'old-two', 'recent-three', 'recent-four']);
    await f.runtime.start();
    await f.gate.emit(f.event('current', 'current'));
    await eventually(async () => f.gate.deliveries.length === 1);
    expect(f.gate.deliveries[0]?.part.text).toBe('tail answer');
    expect(await f.store.readSummary((await f.store.resolveDestination(f.destination, f.principal))!.sessionId)).toBeUndefined();
    const prompt = JSON.stringify(scripted.doStreamCalls[0]?.prompt);
    expect(prompt).toContain('recent-four');
    expect(prompt).not.toContain('old-one');
  } finally { await f.close(); }
});

test('one bot provider failure does not stop another bot', async () => {
  const broken = await fixture({ model: new MockLanguageModelV4({ doStream: async () => { throw new Error('provider unavailable'); } }) });
  const healthy = await fixture();
  try {
    await broken.runtime.start();
    await healthy.runtime.start();
    await broken.gate.emit(broken.event('broken', 'fail'));
    await healthy.gate.emit(healthy.event('healthy', 'continue'));
    await eventually(async () => healthy.gate.deliveries.length === 1);
    expect(healthy.gate.deliveries[0]?.part.text).toBe('hello');
    await eventually(async () => broken.gate.deliveries.length === 1);
    expect(broken.gate.deliveries[0]?.part.text).toContain('could not be completed');
  } finally { await broken.close(); await healthy.close(); }
});
