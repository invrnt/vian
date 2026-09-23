import { describe, expect, test } from 'bun:test';
import { Bot } from 'grammy';
import type { BotId, GateDeliveryContext, GateRuntimePorts, RenderedPart } from '@vian/core';
import { TelegramGate } from './index.ts';
import { normalizeMessage } from './normalize.ts';
import { chunkMarkdown, renderMarkdownV2 } from './render.ts';

const botId = 'bot_fixture' as BotId;
const destination = { gate: 'telegram' as const, externalId: '123' };
const noAttachments = { open: async () => { throw Error('not used'); } } as GateDeliveryContext['attachments'];
const deliveryContext: GateDeliveryContext = { botId, attachments: noAttachments };

function fixture(responses: Array<{ ok?: boolean; result?: unknown; error_code?: number; description?: string; parameters?: object }>) {
  const calls: Array<{ method: string; body: Record<string, unknown> }> = [];
  const bot = new Bot('fixture:token', { client: { fetch: (async (input, init) => {
    const method = String(input).split('/').at(-1)!;
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    calls.push({ method, body });
    const response = responses.shift() ?? { ok: true, result: { message_id: 77 } };
    return new Response(JSON.stringify(response), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch } });
  const gate = new TelegramGate({ botId, token: 'fixture:token', bot, now: () => new Date('2026-09-22T00:00:00.000Z') });
  return { gate, calls };
}

describe('Telegram normalization', () => {
  const policy = { groupsEnabled: false, approvedChatIds: new Set<string>(), approvedUserIds: new Set<string>(), botId: 99, botUsername: 'VianBot' };
  test('numeric actor, reply target, topic, commands and media metadata', () => {
    const event = normalizeMessage({ update_id: 5, message: { message_id: 8, chat: { id: 123, type: 'private' }, from: { id: 456, first_name: 'Ada', username: 'untrusted' }, caption: 'Hi', document: { file_id: 'f', file_name: 'report.pdf', mime_type: 'application/pdf' }, reply_to_message: { message_id: 4 } } }, policy);
    expect(event?.actor.externalId).toBe('456');
    expect(event?.replyToExternalId).toBe('4');
    expect(event?.parts).toEqual([{ type: 'text', text: 'Hi' }]);
    expect(event?.metadata?.document).toMatchObject({ file_id: 'f' });
    const command = normalizeMessage({ update_id: 6, message: { message_id: 9, chat: { id: 123, type: 'private' }, from: { id: 456 }, text: '/new@VianBot' } }, policy);
    expect(command?.control).toBe('new');
    expect(normalizeMessage({ update_id: 7, message: { message_id: 9, chat: { id: 123, type: 'private' }, from: { id: 456 }, text: '/stop@OtherBot' } }, policy)).toBeUndefined();
  });
  test('groups require chat, actor and mention or bot reply', () => {
    const update = { update_id: 1, message: { message_id: 2, chat: { id: -100, type: 'supergroup' }, from: { id: 7 }, text: 'hi @VianBot', message_thread_id: 12 } };
    expect(normalizeMessage(update, policy)).toBeUndefined();
    const enabled = { ...policy, groupsEnabled: true, approvedChatIds: new Set(['-100']), approvedUserIds: new Set(['7']) };
    expect(normalizeMessage(update, enabled)?.destination.threadId).toBe('12');
    expect(normalizeMessage({ ...update, message: { ...update.message, text: '/stop@VianBot' } }, enabled)?.control).toBe('stop');
    expect(normalizeMessage({ ...update, message: { ...update.message, text: 'hi' } }, enabled)).toBeUndefined();
    expect(normalizeMessage({ ...update, message: { ...update.message, from: { id: 8 } } }, enabled)).toBeUndefined();
  });
});

describe('renderer and delivery', () => {
  test('escapes reserved characters and preserves code and links', () => {
    expect(renderMarkdownV2('a_b. `x_y` [site](https://example.com/a)')).toBe('a\\_b\\. `x_y` [site](https://example.com/a)');
    const chunks = chunkMarkdown('🙂'.repeat(1200));
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.map(chunk => chunk.plain).join('')).toBe('🙂'.repeat(1200));
    expect(chunks.every(chunk => [...chunk.markdown].length <= 4096)).toBe(true);
    const code = chunkMarkdown('```ts\n' + 'a'.repeat(3600) + '\n```');
    expect(code.length).toBeGreaterThan(1);
    expect(code.every(chunk => chunk.markdown.startsWith('```ts\n') && chunk.markdown.endsWith('```'))).toBe(true);
  });
  test('accepted receipt and explicit Markdown rejection falls back to plain once', async () => {
    const { gate, calls } = fixture([{ ok: false, error_code: 400, description: "Bad Request: can't parse entities" }, { ok: true, result: { message_id: 22 } }]);
    const result = await gate.deliver({ partIndex: 0, kind: 'text', text: 'a_b' }, destination, new AbortController().signal, deliveryContext);
    expect(result).toMatchObject({ kind: 'succeeded', receipt: { externalId: '22' } });
    expect(calls.map(call => call.body)).toMatchObject([{ parse_mode: 'MarkdownV2', text: 'a\\_b' }, { text: 'a_b' }]);
  });
  test('429 penalty and ambiguous response loss', async () => {
    const limited = fixture([{ ok: false, error_code: 429, description: 'Too Many Requests', parameters: { retry_after: 3 } }]);
    const part: RenderedPart = { partIndex: 0, kind: 'text', text: 'hello' };
    expect(await limited.gate.deliver(part, destination, new AbortController().signal, deliveryContext)).toMatchObject({ kind: 'confirmed-failure', retryable: true, retryAfterMs: 3000 });
    expect(await limited.gate.deliver(part, destination, new AbortController().signal, deliveryContext)).toMatchObject({ kind: 'confirmed-failure', retryAfterMs: 3000 });
    expect(limited.calls.length).toBe(1);
    const bot = new Bot('fixture:token', { client: { fetch: (async () => { throw Error('connection lost'); }) as unknown as typeof fetch } });
    const gate = new TelegramGate({ botId, token: 'fixture:token', bot });
    expect(await gate.deliver(part, destination, new AbortController().signal, deliveryContext)).toMatchObject({ kind: 'ambiguous' });
  });
  test('actorless group stop ignored; correlated private stop becomes control', async () => {
    const { gate } = fixture([{ ok: true, result: true }]);
    const inbound: unknown[] = [];
    const ports = { botId, attachments: { ingest: async () => { throw Error('not used'); }, open: async () => { throw Error('not used'); } }, actions: { createAction: async () => { throw Error('not used'); }, consumeAction: async () => undefined } } as unknown as GateRuntimePorts;
    // Simulate an initialized transport without starting long polling.
    (gate as unknown as { onInbound: (event: unknown) => Promise<void>; ports: GateRuntimePorts }).onInbound = async event => { inbound.push(event); };
    (gate as unknown as { ports: GateRuntimePorts }).ports = ports;
    const draftId = await gate.draft('run_1' as never, destination, 'working');
    const draft = Number(draftId?.split(':')[1]);
    await gate.handleUpdate({ update_id: 1, stopped_message_generation: { chat: { id: -100, type: 'supergroup' }, draft_id: draft } });
    expect(inbound).toHaveLength(0);
    await gate.handleUpdate({ update_id: 2, stopped_message_generation: { chat: { id: 123, type: 'private' }, draft_id: draft } });
    expect(inbound).toMatchObject([{ control: 'stop', actor: { externalId: '123' } }]);
    await gate.stopDraft(draftId!);
  });
  test('button tool stores opaque actions and returns a presentation intent', async () => {
    const actions: unknown[] = [];
    const { gate, calls } = fixture([]);
    const ports = { botId, attachments: {}, resolveDestination: async () => destination, actions: { createAction: async (input: unknown) => { actions.push(input); return 'opaque_1'; }, consumeAction: async () => undefined } } as unknown as GateRuntimePorts;
    (gate as unknown as { ports: GateRuntimePorts }).ports = ports;
    const tool = gate.modelTools().telegram_present_buttons!;
    const result = await tool.execute({ text: 'Choose', rows: [[{ label: 'One', value: { hidden: 'value' } }]] }, { botId, conversationId: 'conversation_1', sessionId: 'session_1', principalId: 'principal_1' } as never);
    expect(result).toEqual({ kind: 'telegram-buttons', text: 'Choose', rows: [[{ label: 'One', actionId: 'opaque_1' }]] });
    expect(actions).toMatchObject([{ botId, destination, value: { hidden: 'value' } }]);
    expect(calls).toHaveLength(0);
  });
  test('callback is ACKed before durable acceptance and carries only opaque transport data', async () => {
    const { gate, calls } = fixture([{ ok: true, result: { id: 99, is_bot: true, first_name: 'Vian', username: 'VianBot', can_join_groups: true, can_read_all_group_messages: false, supports_inline_queries: false } }, { ok: true, result: true }]);
    const accepted: unknown[] = [];
    await gate.bot.init();
    (gate as unknown as { onInbound: (event: unknown) => Promise<void> }).onInbound = async event => { accepted.push(event); expect(calls.at(-1)?.method).toBe('answerCallbackQuery'); };
    await gate.bot.handleUpdate({ update_id: 70, callback_query: { id: 'cb1', from: { id: 456, first_name: 'Ada' }, data: 'opaque_1', message: { message_id: 10, chat: { id: 123, type: 'private' }, date: 1 } } } as never);
    expect(accepted).toMatchObject([{ kind: 'callback', externalEventId: '70', actor: { externalId: '456' }, callbackData: 'opaque_1', metadata: { externalMessageId: '10' } }]);
    expect((accepted[0] as { parts?: unknown }).parts).toBeUndefined();
  });
  test('text delivery carries ordered part receipt, reply and button IDs', async () => {
    const { gate, calls } = fixture([{ ok: true, result: { message_id: 88 } }]);
    const result = await gate.deliver({ partIndex: 2, kind: 'text', text: 'Choose', replyToExternalId: '5', buttons: [[{ label: 'One', actionId: 'opaque_1' as never }]] }, destination, new AbortController().signal, deliveryContext);
    expect(result).toMatchObject({ kind: 'succeeded', receipt: { externalId: '88' } });
    expect(calls[0]?.body).toMatchObject({ reply_parameters: { message_id: 5 }, reply_markup: { inline_keyboard: [[{ text: 'One', callback_data: 'opaque_1' }]] } });
  });
  test('polling offset advances only after durable inbound acceptance', async () => {
    const update = { update_id: 41, message: { message_id: 7, date: 1, chat: { id: 123, type: 'private' }, from: { id: 123, is_bot: false, first_name: 'Ada' }, text: 'hello' } };
    const { gate, calls } = fixture([
      { ok: true, result: { id: 99, is_bot: true, first_name: 'Vian', username: 'VianBot', can_join_groups: true, can_read_all_group_messages: false, supports_inline_queries: false } },
      { ok: true, result: [update] }, { ok: true, result: [update] }, { ok: true, result: [] },
    ]);
    let seen = 0;
    let accepted!: () => void;
    const done = new Promise<void>(resolve => { accepted = resolve; });
    const ports = { botId, attachments: {}, actions: {}, resolveDestination: async () => destination } as unknown as GateRuntimePorts;
    (gate as unknown as { options: { retryDelayMs: number } }).options.retryDelayMs = 0;
    await gate.start(async () => { if (++seen === 1) throw Error('disk temporarily unavailable'); accepted(); }, ports);
    await Promise.race([done, new Promise((_, reject) => setTimeout(() => reject(Error('poll timeout')), 1000))]);
    await new Promise(resolve => setTimeout(resolve, 0));
    await gate.stop();
    const offsets = calls.filter(call => call.method === 'getUpdates').map(call => call.body.offset);
    expect(offsets.slice(0, 3)).toEqual([0, 0, 42]);
    expect(seen).toBe(2);
  });
  test('incoming document streams into the bot-scoped attachment port', async () => {
    const { gate } = fixture([{ ok: true, result: { file_id: 'f1', file_path: 'docs/f1', file_size: 3 } }]);
    const accepted: unknown[] = [];
    let ingested = '';
    const ports = { botId, attachments: { ingest: async (_botId: BotId, input: { bytes: ReadableStream<Uint8Array>; size: number }) => {
      expect(_botId).toBe(botId); expect(input.size).toBe(3);
      ingested = new TextDecoder().decode(await Bun.readableStreamToArrayBuffer(input.bytes));
      return { id: 'attachment_1', name: 'note.txt', mimeType: 'text/plain', size: 3 };
    } }, actions: {}, resolveDestination: async () => destination } as unknown as GateRuntimePorts;
    (gate as unknown as { ports: GateRuntimePorts; onInbound: (event: unknown) => Promise<void> }).ports = ports;
    (gate as unknown as { onInbound: (event: unknown) => Promise<void> }).onInbound = async event => { accepted.push(event); };
    (gate as unknown as { fetcher: typeof fetch }).fetcher = (async () => new Response('abc')) as unknown as typeof fetch;
    await gate.handleUpdate({ update_id: 55, message: { message_id: 9, chat: { id: 123, type: 'private' }, from: { id: 123 }, caption: 'See file', document: { file_id: 'f1', file_name: 'note.txt', mime_type: 'text/plain', file_size: 3 } } });
    expect(ingested).toBe('abc');
    expect(accepted).toMatchObject([{ parts: [{ type: 'text', text: 'See file' }, { type: 'attachment', attachmentId: 'attachment_1' }] }]);
  });
  test('file delivery opens by opaque ID and releases after Telegram response', async () => {
    const methods: string[] = [];
    const bot = new Bot('fixture:token', { client: { fetch: (async (input: unknown) => {
      methods.push(String(input).split('/').at(-1)!);
      return new Response(JSON.stringify({ ok: true, result: { message_id: 91 } }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch } });
    const gate = new TelegramGate({ botId, token: 'fixture:token', bot });
    let released = false;
    const context = { botId, attachments: { open: async (_id: BotId, id: string) => {
      expect(id).toBe('attachment_1');
      return { stream: new Blob(['abc']).stream(), release: async () => { released = true; } };
    } } } as unknown as GateDeliveryContext;
    const outcome = await gate.deliver({ partIndex: 0, kind: 'file', attachment: { id: 'attachment_1' as never, name: 'note.txt', mimeType: 'text/plain', size: 3 } }, destination, new AbortController().signal, context);
    expect(outcome).toMatchObject({ kind: 'succeeded', receipt: { externalId: '91' } });
    expect(methods).toEqual(['sendDocument']);
    expect(released).toBe(true);
  });
});
