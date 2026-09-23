import { createHash } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, test } from 'bun:test';

test('installer verifies a release asset before replacing the command', async () => {
  if (process.platform !== 'linux' || process.arch !== 'x64') return;
  const root = await mkdtemp(join(tmpdir(), 'vian-installer-'));
  const release = join(root, 'release');
  const bin = join(root, 'bin');
  const asset = 'vian-linux-x64';
  const binary = '#!/bin/sh\n[ "$1" = "--help" ]\n';
  const checksum = createHash('sha256').update(binary).digest('hex');
  try {
    await mkdir(release);
    await writeFile(join(release, asset), binary);
    await chmod(join(release, asset), 0o755);
    await writeFile(join(release, 'SHA256SUMS'), `${checksum}  ${asset}\n`);
    const run = async (runtime: 'standalone' | 'auto' = 'standalone') => {
      const args = ['sh', resolve('install.sh'), '--version', 'v-test', '--dir', bin, '--base-url', `file://${release}`];
      if (runtime === 'standalone') args.push('--runtime', 'standalone');
      const child = Bun.spawn(args, { stdout: 'pipe', stderr: 'pipe', env: runtime === 'auto' ? { ...process.env, PATH: '/usr/bin:/bin' } : process.env });
      const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
      return { code, stdout, stderr };
    };
    const good = await run();
    expect(good.code).toBe(0);
    expect(good.stdout).toContain('Installed Vian');
    expect(await readFile(join(bin, 'vian'), 'utf8')).toBe(binary);
    expect((await run('auto')).code).toBe(0);
    await writeFile(join(release, 'SHA256SUMS'), `${'0'.repeat(64)}  ${asset}\n`);
    const bad = await run();
    expect(bad.code).not.toBe(0);
    expect(bad.stderr).toContain('checksum mismatch');
    expect(await readFile(join(bin, 'vian'), 'utf8')).toBe(binary);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('installer supports a small bundle for an existing Bun runtime', async () => {
  if (process.platform !== 'linux') return;
  const root = await mkdtemp(join(tmpdir(), 'vian-bun-installer-'));
  const release = join(root, 'release');
  const bin = join(root, 'bin');
  const asset = 'vian-bun.js';
  const script = '#!/usr/bin/env bun\nif (Bun.argv[2] !== "--help") process.exit(1);\n';
  try {
    await mkdir(release);
    await writeFile(join(release, asset), script);
    await writeFile(join(release, 'SHA256SUMS'), `${createHash('sha256').update(script).digest('hex')}  ${asset}\n`);
    const child = Bun.spawn(['sh', resolve('install.sh'), '--version', 'v-test', '--dir', bin, '--base-url', `file://${release}`], { stdout: 'pipe', stderr: 'pipe' });
    const [code, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
    expect(code).toBe(0);
    expect(stderr).toBe('');
    expect(await readFile(join(bin, 'vian'), 'utf8')).toBe(script);
    const command = Bun.spawn([join(bin, 'vian'), '--help'], { stdout: 'pipe', stderr: 'pipe' });
    expect(await command.exited).toBe(0);
  } finally { await rm(root, { recursive: true, force: true }); }
});
