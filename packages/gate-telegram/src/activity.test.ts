import { expect, test } from 'bun:test';
import { Bot } from 'grammy';
import type { BotId, ExternalDestination, GateDeliveryContext, RunId, UiLanguage } from '@vian/core';
import { TelegramActivity } from './activity.ts';
import { TelegramGate } from './index.ts';

const run = 'run-one' as RunId;
const destination: ExternalDestination = { gate: 'telegram', externalId: '-100', threadId: '42' };
const context = { botId: 'fixture' as BotId, attachments: {} } as GateDeliveryContext;
type Call = { method: string; body: Record<string, unknown> };
function fixture(language: UiLanguage = 'es', respond?: (call: Call) => Promise<object> | object) {
  const calls: Call[] = [];
  let messageId = 10;
  const bot = new Bot('fixture:token', { client: { fetch: (async (input, init) => {
    const call = { method: String(input).split('/').at(-1)!, body: JSON.parse(String(init?.body)) };
    calls.push(call);
    const response = await respond?.(call) ?? { ok: true, result: call.method === 'deleteMessage' ? true : { message_id: messageId++ } };
    return new Response(JSON.stringify(response), { headers: { 'content-type': 'application/json' } });
  }) as typeof fetch } });
  return { calls, activity: new TelegramActivity(bot.api, language, 5), gate: new TelegramGate({ bot, botId: context.botId, token: 'fixture:token', language }) };
}
async function eventually(predicate: () => boolean) {
  for (let attempt = 0; attempt < 100; attempt++) { if (predicate()) return; await Bun.sleep(5); }
  throw new Error('Timed out waiting for Telegram fixture');
}

for (const language of ['es', 'en'] as const) {
  test(`animated ${language} status uses one message and respects topic routing`, async () => {
    const { activity, calls } = fixture(language);
    try {
      await activity.start(run, destination);
      await eventually(() => calls.some(call => call.body.text === (language === 'es' ? 'Trabajando...' : 'Working...')));
      expect(calls[0]).toMatchObject({ method: 'sendMessage', body: { chat_id: '-100', message_thread_id: 42, disable_notification: true, text: language === 'es' ? 'Trabajando.' : 'Working.' } });
      expect(calls.filter(call => call.method === 'sendMessage')).toHaveLength(1);
      await activity.finish(run, 'completed');
      expect(calls.at(-1)?.body.text).toBe(language === 'es' ? 'Hecho' : 'Done');
      await activity.remove(run);
      expect(calls.at(-1)).toMatchObject({ method: 'deleteMessage', body: { chat_id: '-100', message_id: 10 } });
    } finally { await activity.stop(); }
  });
  test(`failed and cancelled activity retain visible ${language} notices`, async () => {
    const { activity, calls } = fixture(language);
    await activity.start(run, destination);
    await activity.finish(run, 'failed');
    expect(calls.at(-1)?.body.text).toBe(language === 'es' ? 'No se pudo completar la solicitud. Inténtalo de nuevo.' : 'The request could not be completed. Please try again.');
    await activity.start('other' as RunId, { ...destination, threadId: '43' });
    await activity.stop();
    expect(calls.at(-1)?.body.text).toBe(language === 'es' ? 'Generación detenida.' : 'Generation stopped.');
    expect(calls.some(call => call.method === 'deleteMessage')).toBe(false);
  });
}

test('successful delivery removes only the matching activity, including attachment-only answers', async () => {
  const { gate, calls } = fixture();
  try {
    await gate.startActivity(run, destination);
    await gate.startActivity('other' as RunId, { ...destination, threadId: '43' });
    const text = await gate.deliver({ partIndex: 0, kind: 'text', text: 'Hello', activityRunId: run }, destination, new AbortController().signal, context);
    expect(text.kind).toBe('succeeded');
    expect(calls.filter(call => call.method === 'deleteMessage').map(call => call.body.message_id)).toEqual([10]);
    await gate.finishActivity(run, 'completed'); // A late finish cannot resurrect the status.
    expect(calls.at(-1)?.method).toBe('deleteMessage');
    const fileContext = { ...context, attachments: { async open() { return { stream: new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new Uint8Array([1])); c.close(); } }), async release() {} }; } } };
    // Use an API transformer so multipart payloads need no custom HTTP parser.
    gate.bot.api.config.use(async (prev, method, payload, signal) => method === 'sendDocument' ? { ok: true, result: { message_id: 99 } } as never : prev(method, payload, signal));
    const file = await gate.deliver({ partIndex: 0, kind: 'file', activityRunId: 'other' as RunId, attachment: { id: 'file', name: 'test.txt', size: 1, mimeType: 'text/plain' } as never }, { ...destination, threadId: '43' }, new AbortController().signal, fileContext);
    expect(file.kind).toBe('succeeded');
    expect(calls.filter(call => call.method === 'deleteMessage').map(call => call.body.message_id)).toEqual([10, 11]);
  } finally { await gate.stop(); }
});

test('ambiguous answer delivery keeps a visible error and never deletes the status', async () => {
  let sends = 0;
  const { gate, calls } = fixture('en', call => {
    if (call.method === 'sendMessage' && ++sends > 1) throw new Error('connection lost');
    return { ok: true, result: { message_id: 10 } };
  });
  try {
    await gate.startActivity(run, destination);
    await gate.finishActivity(run, 'completed');
    expect((await gate.deliver({ partIndex: 0, kind: 'text', text: 'answer', activityRunId: run }, destination, new AbortController().signal, context)).kind).toBe('ambiguous');
    expect(calls.at(-1)?.body.text).toBe('The response delivery could not be confirmed.');
    expect(calls.some(call => call.method === 'deleteMessage')).toBe(false);
  } finally { await gate.stop(); }
});

test('rejected activity send does not retry or block final answer', async () => {
  let sends = 0;
  const { gate, calls } = fixture('es', call => call.method === 'sendMessage' && ++sends === 1
    ? { ok: false, error_code: 429, description: 'Too Many Requests', parameters: { retry_after: 10 } }
    : { ok: true, result: { message_id: 20 } });
  try {
    await gate.startActivity(run, destination);
    expect((await gate.deliver({ partIndex: 0, kind: 'text', text: 'answer', activityRunId: run }, destination, new AbortController().signal, context)).kind).toBe('succeeded');
    expect(calls.map(call => call.method)).toEqual(['sendMessage', 'sendMessage']);
  } finally { await gate.stop(); }
});

test('cleanup waits for an in-flight animation edit and falls back when deletion is rejected', async () => {
  let release!: () => void;
  let editing = false;
  const barrier = new Promise<void>(resolve => { release = resolve; });
  const { activity, calls } = fixture('es', async call => {
    if (call.method === 'editMessageText' && call.body.text === 'Trabajando..') { editing = true; await barrier; }
    return call.method === 'deleteMessage' ? { ok: false, error_code: 400, description: 'Cannot delete' } : { ok: true, result: { message_id: 10 } };
  });
  try {
    await activity.start(run, destination);
    await eventually(() => editing);
    const removal = activity.remove(run);
    expect(calls.some(call => call.method === 'deleteMessage')).toBe(false);
    release();
    await removal;
    expect(calls.slice(-2).map(call => call.method)).toEqual(['deleteMessage', 'editMessageText']);
    expect(calls.at(-1)?.body.text).toBe('Hecho');
  } finally { release(); await activity.stop(); }
});
