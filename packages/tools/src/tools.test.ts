import { test, expect } from 'bun:test';
import { mkdtemp, writeFile, mkdir, rm, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NativeToolRuntime, validateNativeToolSet, assertUniqueToolNames } from './native.ts';
import { AttachmentRegistry } from './attachments.ts';
import type { BotId, ToolContext, AttachmentRegistration } from '@vian/core';
import { SqliteBotStore } from '../../storage/src/bot.ts';

test('native import, schema, local dependency reload and last-valid retention', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vian-tool-test-'));
  const runtime = new NativeToolRuntime(root, 'vian.tools.ts');
  const context = { botId: 'bot' as BotId, principalId: 'p', conversationId: 'c', sessionId: 's', runId: 'r', toolCallId: 't', idempotencyKey: 'key', abortSignal: new AbortController().signal, attachments: { register: async () => { throw Error('unused'); } }, logger: { info() {}, error() {} }, services: {} } as unknown as ToolContext;
  try {
    await writeFile(join(root, 'local.ts'), 'export const result = 1;');
    await writeFile(join(root, 'vian.tools.ts'), `import { result } from './local.ts'; export default { hello: { description: 'Hello', inputSchema: { type:'object', properties:{ name:{type:'string'} }, required:['name'], additionalProperties:false }, execute(input) { return result; } } };`);
    await runtime.reload();
    expect(await runtime.execute('hello', { name: 'x', extra: true }, context)).toMatchObject({ ok: false, error: { code: 'invalid_arguments' } });
    expect(await runtime.execute('hello', { name: 'x' }, context)).toEqual({ ok: true, value: 1 });
    await writeFile(join(root, 'local.ts'), 'export const result = 2;');
    await runtime.reload();
    expect(await runtime.execute('hello', { name: 'x' }, context)).toEqual({ ok: true, value: 2 });
    await writeFile(join(root, 'vian.tools.ts'), 'export default { broken: true };');
    expect(runtime.reload()).rejects.toThrow();
    expect(await runtime.execute('hello', { name: 'x' }, context)).toEqual({ ok: true, value: 2 });
    expect(() => validateNativeToolSet({ bad: { description: 'bad', inputSchema: { type: 'object', unsupported: true }, execute() {} } })).toThrow();
    expect(() => assertUniqueToolNames([['hello'], ['hello']])).toThrow('Duplicate exposed tool name');
  } finally { await runtime.close(); await rm(root, { recursive: true, force: true }); }
});

test('attachment streams measure unknown size, isolate bot, and retain metadata after expiry', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vian-attachment-test-'));
  const one = '11111111-1111-4111-8111-111111111111' as BotId, two = '22222222-2222-4222-8222-222222222222' as BotId;
  await mkdir(join(root, 'one')); await mkdir(join(root, 'two'));
  const storeOne = new SqliteBotStore(one, join(root, 'one', 'bot.db'));
  const storeTwo = new SqliteBotStore(two, join(root, 'two', 'bot.db'));
  let clock = new Date();
  const registry = new AttachmentRegistry(id => id === one ? { root: join(root, 'one'), store: storeOne } : id === two ? { root: join(root, 'two'), store: storeTwo } : undefined, 8, 1, () => clock);
  registry.trackBot(one); registry.trackBot(two);
  try {
    const bytes = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new TextEncoder().encode('abc')); c.close(); } });
    const attachment = await registry.ingest(one, { name: 'a.txt', mimeType: 'text/plain', size: 0, bytes });
    expect(attachment.size).toBe(3);
    expect(Object.keys(attachment).sort()).toEqual(['id', 'mimeType', 'name', 'size']);
    expect((await storeOne.getAttachmentStorage(attachment.id))?.metadata).toMatchObject({ sha256: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad', origin: 'inbound' });
    expect(await registry.list(two, [attachment.id])).toEqual([]);
    expect(registry.open(two, attachment.id)).rejects.toThrow();
    const reader = await registry.open(one, attachment.id);
    const body = await new Response(reader.stream).text();
    expect(body).toBe('abc');
    clock = new Date(clock.getTime() + 2 * 3600000);
    expect(await registry.expire(clock)).toBe(0);
    await reader.release();
    expect(await registry.expire(clock)).toBe(1);
    expect(registry.open(one, attachment.id)).rejects.toThrow();
    const stored = await storeOne.getAttachmentStorage(attachment.id);
    expect(stored?.status).toBe('deleted');
    expect(stored?.privatePath).toBe('');
    const tooLarge = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new Uint8Array(9)); c.close(); } });
    expect(registry.ingest(one, { name: 'b.txt', mimeType: 'text/plain', size: 0, bytes: tooLarge })).rejects.toThrow('size limit');
    expect(registry.ingest(one, { name: '../bad', mimeType: 'text/plain', size: 0, bytes: new ReadableStream() })).rejects.toThrow('Unsafe');
  } finally { storeOne.close(); storeTwo.close(); await rm(root, { recursive: true, force: true }); }
});

test('generated report returns only public handle and opens through bot ID', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vian-report-test-'));
  const botId = '33333333-3333-4333-8333-333333333333' as BotId;
  const store = new SqliteBotStore(botId, join(root, 'bot.db'));
  const registry = new AttachmentRegistry(id => id === botId ? { root, store } : undefined, 1024);
  const tools = new NativeToolRuntime(root, 'vian.tools.ts');
  try {
    await copyFile(new URL('../../../examples/attachments/vian.tools.ts', import.meta.url), join(root, 'vian.tools.ts'));
    await tools.reload();
    const context = { botId, principalId: 'p', conversationId: 'c', sessionId: 's', runId: 'r', toolCallId: 't', idempotencyKey: 'key', abortSignal: new AbortController().signal, attachments: { register: (input: AttachmentRegistration) => registry.register(botId, input) }, logger: { info() {}, error() {} }, services: {} } as unknown as ToolContext;
    const result = await tools.execute('generate_report', { title: 'Quarter' }, context);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('Unreachable');
    const publicHandle = (result.value as any).attachment;
    expect(publicHandle.name).toBe('report.txt');
    expect(JSON.stringify(result.value)).not.toContain(root);
    const reader = await registry.open(botId, publicHandle.id);
    expect(await new Response(reader.stream).text()).toBe('Quarter\n');
    await reader.release();
  } finally { await tools.close(); store.close(); await rm(root, { recursive: true, force: true }); }
});

test('tool audit metadata-only omits canary arguments and abort skips execution', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vian-audit-test-'));
  const runtime = new NativeToolRuntime(root, 'vian.tools.ts');
  try {
    await writeFile(join(root, 'vian.tools.ts'), `export default { secret: { description:'test', audit:'metadata-only', inputSchema:{type:'object',properties:{value:{type:'string'}},required:['value'],additionalProperties:false}, execute(){ throw Error('private failure'); } } };`);
    await runtime.reload();
    const audits: unknown[] = [];
    const store = { async transitionTool(_id: unknown, _run: unknown, _state: unknown, audit: unknown) { audits.push(audit); return { kind: 'ok' as const, value: undefined }; } };
    const context = { toolCallId: 'call', runId: 'run', abortSignal: new AbortController().signal, logger: { error() {} } } as unknown as ToolContext;
    expect(await runtime.execute('secret', { value: 'CANARY' }, context, store)).toMatchObject({ ok: false, error: { message: 'Tool failed' } });
    expect(JSON.stringify(audits)).not.toContain('CANARY');
    expect(JSON.stringify(audits)).not.toContain('private failure');
    const controller = new AbortController(); controller.abort();
    expect(await runtime.execute('secret', { value: 'CANARY' }, { ...context, abortSignal: controller.signal }, store)).toMatchObject({ ok: false, error: { code: 'aborted' } });
    expect(audits).toHaveLength(3);
  } finally { await runtime.close(); await rm(root, { recursive: true, force: true }); }
});
