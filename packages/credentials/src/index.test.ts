import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, readFile, stat, writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { BotSecretResolver, FileCredentialStore, redactSecrets } from './index.ts';
import type { BotId } from '@vian/core';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(x => rm(x, { recursive: true, force: true }))); });
async function fixture(): Promise<string> { const root = await mkdtemp(join(tmpdir(), 'vian-credentials-')); roots.push(root); return root; }
const botId = '00000000-0000-4000-8000-000000000001' as BotId;

test('bot environment resolution stays relative to each bot and output can be redacted', async () => {
  const root = await fixture();
  const a = join(root, 'a'), b = join(root, 'b');
  await mkdir(a); await mkdir(b);
  await writeFile(join(a, '.env'), 'API_KEY=canary-a\n');
  await writeFile(join(b, '.env'), 'API_KEY=canary-b\n');
  const resolver = new BotSecretResolver();
  expect(await resolver.resolve(botId, a, 'env:API_KEY')).toBe('canary-a');
  expect(await resolver.resolve(botId, b, 'env:API_KEY')).toBe('canary-b');
  expect(redactSecrets('canary-a canary-b', ['canary-a', 'canary-b'])).toBe('[REDACTED] [REDACTED]');
});

test('profile replacement is atomic, restrictive and metadata only', async () => {
  const root = await fixture();
  const store = new FileCredentialStore(join(root, 'profiles'));
  const metadata = { name: 'default', provider: 'openai-chatgpt', status: 'ready' as const, updatedAt: '2026-09-22T00:00:00Z' };
  await store.replace('default', Buffer.from('canary-refresh'), metadata);
  expect((await store.list())[0]).toEqual(metadata);
  expect(Buffer.from((await store.read('default'))!).toString()).toBe('canary-refresh');
  expect((await stat(join(root, 'profiles', 'default.json'))).mode & 0o777).toBe(0o600);
  expect((await stat(join(root, 'profiles'))).mode & 0o777).toBe(0o700);
  await store.markReauthRequired('default');
  expect(await store.read('default')).toBeUndefined();
  expect(await readFile(join(root, 'profiles', 'default.json'), 'utf8')).not.toContain('canary-refresh');
  await store.remove('default');
  expect(await store.list()).toEqual([]);
});

test('profile lock serializes concurrent writers', async () => {
  const root = await fixture();
  const a = new FileCredentialStore(join(root, 'profiles'));
  const b = new FileCredentialStore(join(root, 'profiles'));
  const order: number[] = [];
  await Promise.all([
    a.withProfileLock('default', async () => { order.push(1); await Bun.sleep(50); order.push(2); }),
    b.withProfileLock('default', async () => { order.push(3); order.push(4); }),
  ]);
  expect(order.join(',')).toMatch(/^(1,2,3,4|3,4,1,2)$/);
});

test('interrupted replacement leaves the previous complete profile available', async () => {
  const root = await fixture();
  const store = new FileCredentialStore(join(root, 'profiles'));
  await store.replace('default', Buffer.from('first'), { name: 'default', provider: 'openai-chatgpt', status: 'ready', updatedAt: '2026-09-22T00:00:00Z' });
  await writeFile(join(root, 'profiles', '.default.abandoned.tmp'), '{ incomplete');
  expect(Buffer.from((await store.read('default'))!).toString()).toBe('first');
  expect((await store.list()).map(x => x.name)).toEqual(['default']);
});
