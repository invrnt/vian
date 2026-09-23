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
    const run = async () => {
      const child = Bun.spawn(['sh', resolve('install.sh'), '--version', 'v-test', '--dir', bin, '--base-url', `file://${release}`], { stdout: 'pipe', stderr: 'pipe' });
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
