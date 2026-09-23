import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { authCommand } from './index.ts';

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
