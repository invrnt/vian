import { spawn } from 'node:child_process';
import { closeSync, existsSync, writeSync } from 'node:fs';
import type { CommandContext } from '@vian/core';
import { socketPath } from '../local/common.ts';
import { requestControl } from './control.ts';
import { VianDaemon } from './daemon.ts';

const readyFd = 'VIAN_DAEMON_READY_FD';
const waitMs = 60_000;

function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }

async function running(): Promise<boolean> {
  try { return (await requestControl('status')).ok; }
  catch (error) {
    if (['ENOENT', 'ECONNREFUSED'].includes((error as NodeJS.ErrnoException).code ?? '')) return false;
    throw error;
  }
}

async function serviceRunning(): Promise<boolean> {
  if (process.platform !== 'linux') return false;
  try {
    return (await Bun.spawn(['systemctl', '--user', 'is-active', '--quiet', 'vian.service'], { stdout: 'ignore', stderr: 'ignore' }).exited) === 0;
  } catch { return false; }
}

async function waitForExit(): Promise<void> {
  const deadline = Date.now() + waitMs;
  while (existsSync(socketPath()) || existsSync(`${socketPath()}.lock`)) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for the daemon to stop');
    await Bun.sleep(50);
  }
}

async function launch(): Promise<void> {
  const script = /\.(?:[cm]?[jt]s|tsx|jsx)$/.test(Bun.main) ? Bun.main : undefined;
  const args = [...(script ? [script] : []), 'daemon', '--foreground'];
  const child = spawn(process.execPath, args, {
    detached: true,
    stdio: ['ignore', 'ignore', 'ignore', 'pipe'],
    env: { ...process.env, [readyFd]: '3' },
  });
  try {
    await new Promise<void>((resolve, reject) => {
      let response = '';
      const timer = setTimeout(() => { child.kill('SIGTERM'); reject(new Error('Timed out starting the daemon')); }, waitMs);
      const done = (error?: Error) => { clearTimeout(timer); error ? reject(error) : resolve(); };
      child.stdio[3]!.on('data', chunk => {
        response += chunk.toString();
        if (!response.includes('\n')) return;
        const line = response.slice(0, response.indexOf('\n'));
        done(line === 'ready' ? undefined : new Error(line.startsWith('error:') ? line.slice(6) : 'Daemon startup failed'));
      });
      child.stdio[3]!.on('end', () => done(new Error('Daemon exited before it was ready')));
      child.once('error', done);
      child.once('exit', code => done(new Error(`Daemon exited during startup (${code ?? 'signal'})`)));
    });
  } finally {
    child.stdio[3]?.destroy();
    child.unref();
  }
}

export async function daemonCommand(args: string[], context: CommandContext): Promise<number> {
  const verb = args[0];
  if (verb === '--foreground' && args.length === 1) {
    const daemon = new VianDaemon();
    try {
      await daemon.start();
      if (process.env[readyFd] === '3') { writeSync(3, 'ready\n'); closeSync(3); delete process.env[readyFd]; }
      else context.stdout(`Vian daemon running (PID ${process.pid}).\n`);
    } catch (error) {
      if (process.env[readyFd] === '3') { writeSync(3, `error:${errorMessage(error)}\n`); closeSync(3); }
      throw error;
    }
    const stop = () => { void daemon.stop(); };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    await daemon.stopped;
    process.off('SIGINT', stop);
    process.off('SIGTERM', stop);
    return 0;
  }
  if (args.length > 1 || (verb && !['stop', 'restart'].includes(verb))) throw new Error('Usage: vian daemon [stop|restart|--foreground]');
  if (await serviceRunning()) {
    if (!verb) context.stdout('Vian daemon is already running as a user service.\n');
    else {
      const { serviceCommand } = await import('./service.ts');
      await serviceCommand(verb, context);
    }
    return 0;
  }
  const active = await running();
  if (verb === 'stop') {
    if (!active) { context.stdout('Vian daemon is not running.\n'); return 0; }
    const response = await requestControl('shutdown');
    if (!response.ok) throw new Error(response.error.message);
    await waitForExit();
    context.stdout('Vian daemon stopped.\n');
    return 0;
  }
  if (verb === 'restart' && active) {
    const response = await requestControl('shutdown');
    if (!response.ok) throw new Error(response.error.message);
    await waitForExit();
  } else if (active) {
    context.stdout('Vian daemon is already running.\n');
    return 0;
  }
  await launch();
  context.stdout(`Vian daemon ${verb === 'restart' && active ? 'restarted' : 'started'} successfully.\n`);
  return 0;
}
