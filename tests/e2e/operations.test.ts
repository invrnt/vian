import { expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, stat, mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import type { BotId, RegistryRecord } from '../../packages/core/src/index.ts';
import { SqliteRegistry } from '../../packages/storage/src/index.ts';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RunPermit, VianDaemon } from '../../packages/cli/src/operations/daemon.ts';
import { requestControl } from '../../packages/cli/src/operations/control.ts';
import { acquireBotOwnership } from '../../packages/cli/src/operations/assemble.ts';
import { renderUserUnit, serviceCommand } from '../../packages/cli/src/operations/service.ts';
import { appendLog, logPath } from '../../packages/cli/src/operations/logs.ts';
import { socketPath } from '../../packages/cli/src/local/common.ts';

test('same-user local control validates requests and excludes a second daemon', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vian-control-'));
  const prior = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = root;
  const daemon = new VianDaemon();
  try {
    await daemon.start();
    expect((await stat(socketPath())).mode & 0o777).toBe(0o600);
    expect((await requestControl('status')).ok).toBe(true);
    expect((await requestControl('start', 'missing')).ok).toBe(false);
    await expect(new VianDaemon().start()).rejects.toThrow('already running');
  } finally {
    await daemon.stop();
    if (prior === undefined) delete process.env.XDG_DATA_HOME; else process.env.XDG_DATA_HOME = prior;
    await rm(root, { recursive: true, force: true });
  }
});

test('bot process ownership prevents a second recovery owner', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vian-owner-'));
  const release = acquireBotOwnership(root);
  try { expect(() => acquireBotOwnership(root)).toThrow('already owned'); }
  finally { release(); await rm(root, { recursive: true, force: true }); }
});

test('global run permit removes a cancelled waiter', async () => {
  const permit = new RunPermit(1);
  const release = await permit.acquire();
  const abort = new AbortController();
  const waiting = permit.acquire(abort.signal);
  abort.abort();
  await expect(waiting).rejects.toThrow('Generation stopped');
  release();
  const releaseNext = await permit.acquire();
  releaseNext();
});

test('one broken bot stays in error while another starts; failed restart keeps the healthy instance', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vian-isolation-'));
  const prior = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = root;
  const registry = new SqliteRegistry(join(root, 'vian', 'registry.sqlite'));
  for (const alias of ['healthy', 'broken']) {
    const path = join(root, alias);
    await mkdir(path);
    const record: RegistryRecord = { id: randomUUID() as BotId, alias, path, registeredAt: new Date().toISOString(), enabled: true };
    expect((await registry.register(record)).kind).toBe('ok');
  }
  registry.close();
  let closes = 0;
  const daemon = new VianDaemon({
    assemble: async record => {
      if (record.alias === 'broken') throw new Error('Invalid bot config');
      return { store: { listDeliveries: async () => [] }, close: async () => { closes++; } } as never;
    },
    validate: async () => { throw new Error('Invalid reload'); },
  });
  try {
    await daemon.start();
    const response = await requestControl('status');
    expect(response.ok).toBe(true);
    if (response.ok) expect(response.data).toEqual(expect.arrayContaining([{ bot: 'healthy', id: expect.any(String), enabled: true, status: 'running', heldDeliveries: 0 }, { bot: 'broken', id: expect.any(String), enabled: true, status: 'error', error: 'Invalid bot config' }]));
    expect((await requestControl('restart', 'healthy')).ok).toBe(false);
    expect(closes).toBe(0);
    const after = await requestControl('status', 'healthy');
    if (after.ok) expect((after.data as { status: string }).status).toBe('running');
  } finally {
    await daemon.stop();
    if (prior === undefined) delete process.env.XDG_DATA_HOME; else process.env.XDG_DATA_HOME = prior;
    await rm(root, { recursive: true, force: true });
  }
});

test('service unit and runner use a disposable user directory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vian-service-'));
  const output: string[] = [];
  const calls: string[][] = [];
  const context = { cwd: root, stdout: (text: string) => output.push(text), stderr: (text: string) => output.push(text) };
  const runner = async (command: string, args: string[]) => { calls.push([command, ...args]); return { code: 0, stdout: '', stderr: '' }; };
  try {
    expect(renderUserUnit('/usr/local/bin/vian')).toContain('Restart=on-failure');
    expect(renderUserUnit('/opt/bun/bin/bun', '/home/user/.local/bin/vian')).toContain('ExecStart=/opt/bun/bin/bun /home/user/.local/bin/vian daemon --foreground');
    expect(await serviceCommand('install', context, runner, { unitDir: root, executable: '/usr/local/bin/vian' })).toBe(0);
    expect(await readFile(join(root, 'vian.service'), 'utf8')).toContain('ExecStart=/usr/local/bin/vian daemon --foreground');
    expect(calls).toEqual([['systemctl', '--user', 'daemon-reload'], ['systemctl', '--user', 'enable', 'vian.service']]);
    expect((await stat(join(root, 'vian.service'))).mode & 0o777).toBe(0o600);
    expect(await serviceCommand('start', context, runner, { unitDir: root })).toBe(0);
    expect(calls.at(-1)).toEqual(['systemctl', '--user', 'start', 'vian.service']);
    expect(await serviceCommand('uninstall', context, runner, { unitDir: root })).toBe(0);
    expect(calls.slice(-2)).toEqual([['systemctl', '--user', 'disable', '--now', 'vian.service'], ['systemctl', '--user', 'daemon-reload']]);
    await expect(stat(join(root, 'vian.service'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await serviceCommand('uninstall', context, runner, { unitDir: root })).toBe(0);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('daemon command starts in the background and supports repeated start, restart and stop', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vian-daemon-cli-'));
  const env = { ...process.env, XDG_DATA_HOME: root, VIAN_HOME: join(root, 'credentials-home') };
  const command = async (...args: string[]) => {
    const child = Bun.spawn([process.execPath, join(import.meta.dir, '../../packages/cli/src/main.ts'), ...args], { env, stdout: 'pipe', stderr: 'pipe' });
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    return { stdout, stderr, code };
  };
  try {
    expect((await command('daemon')).stdout).toContain('started successfully');
    expect((await command('daemon')).stdout).toContain('already running');
    expect((await command('status')).code).toBe(0);
    expect((await command('daemon', 'restart')).stdout).toContain('restarted successfully');
    expect((await command('daemon', 'stop')).stdout).toContain('stopped');
    expect((await command('daemon', 'stop')).stdout).toContain('not running');
  } finally {
    await command('daemon', 'stop');
    await rm(root, { recursive: true, force: true });
  }
}, 20_000);

test('daemon command reports startup failure without claiming success', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vian-daemon-failure-'));
  const dataFile = join(root, 'not-a-directory');
  const { writeFile } = await import('node:fs/promises');
  await writeFile(dataFile, 'occupied');
  try {
    const child = Bun.spawn([process.execPath, join(import.meta.dir, '../../packages/cli/src/main.ts'), 'daemon'], {
      env: { ...process.env, XDG_DATA_HOME: dataFile, VIAN_HOME: join(root, 'credentials-home') }, stdout: 'pipe', stderr: 'pipe',
    });
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    expect(code).toBe(1);
    expect(stdout).not.toContain('started successfully');
    expect(stderr).toContain('ENOTDIR');
  } finally { await rm(root, { recursive: true, force: true }); }
}, 20_000);

test('runtime diagnostics rotate without entering conversation history', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vian-logs-'));
  try {
    appendLog(root, 'info', 'bot_started');
    expect(await readFile(logPath(root), 'utf8')).toContain('bot_started');
    const { writeFile } = await import('node:fs/promises');
    await writeFile(logPath(root), 'x'.repeat(2 * 1024 * 1024));
    appendLog(root, 'error', 'provider_failed');
    expect(await readFile(`${logPath(root)}.1`, 'utf8')).toHaveLength(2 * 1024 * 1024);
    expect(await readFile(logPath(root), 'utf8')).toContain('provider_failed');
  } finally { await rm(root, { recursive: true, force: true }); }
});
