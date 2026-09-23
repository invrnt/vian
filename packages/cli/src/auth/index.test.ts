import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { BotSecretResolver, FileCredentialStore } from '@vian/credentials';
import type { BotId } from '@vian/core';
import { authCommand, saveProviderApiKey } from './index.ts';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(x => rm(x, { recursive: true, force: true }))); });

test('auth commands expose only safe metadata', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vian-auth-')); roots.push(root);
  const previous = process.env.VIAN_HOME;
  process.env.VIAN_HOME = root;
  try {
    const stdout: string[] = [], stderr: string[] = [];
    const context = { cwd: root, stdout: (value: string) => stdout.push(value), stderr: (value: string) => stderr.push(value) };
    expect(await authCommand.run(['list'], context)).toBe(0);
    expect(stdout.join('')).toBe('[]\n');
    expect(await authCommand.run(['status', 'openai-chatgpt'], context)).toBe(1);
    expect(stdout.join('')).toContain('reauth-required');
    expect(await authCommand.run(['logout', 'openai-chatgpt'], context)).toBe(0);
  } finally {
    if (previous === undefined) delete process.env.VIAN_HOME; else process.env.VIAN_HOME = previous;
  }
});

test('global API-key profiles are provider-specific, private and never printed', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vian-auth-')); roots.push(root);
  const previous = process.env.VIAN_HOME;
  process.env.VIAN_HOME = root;
  try {
    const store = new FileCredentialStore();
    await saveProviderApiKey(store, 'google', 'canary-google-key');
    await saveProviderApiKey(store, 'vercel-ai-gateway', 'canary-gateway-key');
    expect(new TextDecoder().decode(await store.read('google-default'))).toBe('canary-google-key');
    expect(new TextDecoder().decode(await store.read('vercel-ai-gateway-default'))).toBe('canary-gateway-key');
    const resolver = new BotSecretResolver(store);
    expect(await resolver.resolve('00000000-0000-4000-8000-000000000001' as BotId, root, 'profile:google-default')).toBe('canary-google-key');
    expect((await stat(join(root, 'credentials', 'google-default.json'))).mode & 0o777).toBe(0o600);
    const stdout: string[] = [], stderr: string[] = [];
    const context = { cwd: root, stdout: (value: string) => stdout.push(value), stderr: (value: string) => stderr.push(value) };
    expect(await authCommand.run(['list'], context)).toBe(0);
    expect(await authCommand.run(['status', 'google'], context)).toBe(0);
    expect(await authCommand.run(['status', 'vercel-ai-gateway'], context)).toBe(0);
    expect(stdout.join('')).not.toContain('canary-');
    await expect(saveProviderApiKey(store, 'google', 'bad key')).rejects.toThrow('malformed');
    expect(await authCommand.run(['logout', 'google'], context)).toBe(0);
    expect(await store.read('google-default')).toBeUndefined();
    expect(await store.read('vercel-ai-gateway-default')).toBeDefined();
  } finally {
    if (previous === undefined) delete process.env.VIAN_HOME; else process.env.VIAN_HOME = previous;
  }
});
