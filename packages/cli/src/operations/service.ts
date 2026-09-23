import { mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import type { CommandContext } from '@vian/core';

export function renderUserUnit(executable: string, script?: string): string {
  const quote = (path: string) => {
    if (/[\r\n]/.test(path) || !path.startsWith('/')) throw new Error('Service command paths must be absolute');
    const escaped = path.replaceAll('%', '%%').replaceAll('\\', '\\\\').replaceAll('"', '\\"');
    return /\s|"/.test(escaped) ? `"${escaped}"` : escaped;
  };
  const command = [quote(executable), ...(script ? [quote(script)] : [])].join(' ');
  return `[Unit]\nDescription=Vian bot daemon\nAfter=network-online.target\nWants=network-online.target\n\n[Service]\nType=exec\nExecStart=${command} daemon\nRestart=on-failure\nRestartSec=3\n\n[Install]\nWantedBy=default.target\n`;
}

export async function serviceCommand(verb: string, context: CommandContext, run = async (command: string, args: string[]) => {
  const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.on('data', chunk => stdout += chunk);
  child.stderr.on('data', chunk => stderr += chunk);
  const code = await new Promise<number>(resolve => child.on('close', result => resolve(result ?? 1)));
  return { code, stdout, stderr };
}, options: { unitDir?: string; executable?: string } = {}): Promise<number> {
  const unitDir = options.unitDir ?? join(homedir(), '.config/systemd/user');
  const unitPath = join(unitDir, 'vian.service');
  if (verb === 'install') {
    if (!options.executable && /\/packages\/cli\/src\/main\.ts$/.test(Bun.main)) throw new Error('Build the standalone Vian executable before installing the service');
    await mkdir(unitDir, { recursive: true, mode: 0o700 });
    const script = !options.executable && Bun.main.endsWith('.js') ? Bun.main : undefined;
    await writeFile(unitPath, renderUserUnit(options.executable ?? process.execPath, script), { mode: 0o600 });
    const reload = await run('systemctl', ['--user', 'daemon-reload']);
    if (reload.code) throw new Error(reload.stderr || 'systemctl daemon-reload failed');
    const enabled = await run('systemctl', ['--user', 'enable', 'vian.service']);
    if (enabled.code) throw new Error(enabled.stderr || 'systemctl enable failed');
    context.stdout(`Installed ${unitPath}\nFor operation after logout, enable user lingering with: loginctl enable-linger ${process.env.USER ?? '<user>'}\n`);
    return 0;
  }
  const result = await run('systemctl', ['--user', verb, 'vian.service']);
  if (result.code) throw new Error(result.stderr || `systemctl ${verb} failed`);
  context.stdout(result.stdout || `Service ${verb} completed\n`);
  return 0;
}
