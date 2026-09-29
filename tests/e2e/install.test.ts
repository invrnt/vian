import { createHash } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, readlink, rm, writeFile } from 'node:fs/promises';
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
    const run = async () => {
      const args = ['sh', resolve('install.sh'), '--version', 'v-test', '--dir', bin, '--base-url', `file://${release}`];
      args.push('--runtime', 'standalone');
      const child = Bun.spawn(args, { stdout: 'pipe', stderr: 'pipe' });
      const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
      return { code, stdout, stderr };
    };
    const good = await run();
    expect(good.code).toBe(0);
    expect(good.stdout).toContain('Installed Vian');
    expect(await readFile(join(bin, 'vian'), 'utf8')).toBe(binary);
    await writeFile(join(release, 'SHA256SUMS'), `${'0'.repeat(64)}  ${asset}\n`);
    const bad = await run();
    expect(bad.code).not.toBe(0);
    expect(bad.stderr).toContain('checksum mismatch');
    expect(await readFile(join(bin, 'vian'), 'utf8')).toBe(binary);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('installer puts Vian source and frozen Bun dependencies beside a small command wrapper', async () => {
  if (process.platform !== 'linux') return;
  const root = await mkdtemp(join(tmpdir(), 'vian-bun-installer-'));
  const release = join(root, 'release');
  const bin = join(root, 'bin');
  const asset = 'vian-source.tar.gz';
  try {
    await mkdir(release);
    const archive = Bun.spawn(['tar', '--exclude=node_modules', '-czf', join(release, asset), 'package.json', 'bun.lock', 'install.sh', 'LICENSE', 'packages'], { cwd: resolve('.') });
    expect(await archive.exited).toBe(0);
    const archiveBytes = await readFile(join(release, asset));
    await writeFile(join(release, 'SHA256SUMS'), `${createHash('sha256').update(archiveBytes).digest('hex')}  ${asset}\n`);
    const install = async (version: string) => {
      const child = Bun.spawn(['sh', resolve('install.sh'), '--version', version, '--dir', bin, '--base-url', `file://${release}`], { stdout: 'pipe', stderr: 'pipe', env: { ...process.env, PATH: '/usr/bin:/bin' } });
      const [code, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
      return { code, stderr };
    };
    const { code, stderr } = await install('v-test');
    expect(code).toBe(0);
    expect(stderr).not.toContain('error');
    expect((await readFile(join(bin, 'vian'), 'utf8')).length).toBeLessThan(500);
    expect(await readFile(join(bin, '.vian-app', 'current', 'bun.lock'), 'utf8')).toContain('lockfileVersion');
    expect(await readFile(join(bin, '.vian-app', 'current', 'LICENSE'), 'utf8')).toContain('MIT License');
    const command = Bun.spawn([join(bin, 'vian'), '--help'], { stdout: 'pipe', stderr: 'pipe' });
    expect(await command.exited).toBe(0);
    const first = await readlink(join(bin, '.vian-app', 'current'));
    expect((await install('v-test')).code).toBe(0);
    expect(await readlink(join(bin, '.vian-app', 'current'))).toBe(first);
    expect((await install('v-test-next')).code).toBe(0);
    const second = await readlink(join(bin, '.vian-app', 'current'));
    expect(second).not.toBe(first);
    await writeFile(join(release, 'SHA256SUMS'), `${'0'.repeat(64)}  ${asset}\n`);
    expect((await install('v-bad')).code).not.toBe(0);
    expect(await readlink(join(bin, '.vian-app', 'current'))).toBe(second);
  } finally { await rm(root, { recursive: true, force: true }); }
});
