import { existsSync, readFileSync, watch } from 'node:fs';
import { join } from 'node:path';
import type { CommandContext, PrincipalId } from '@vian/core';
import { SqliteBotStore } from '@vian/storage';
import { AccessService } from '../../../runtime/src/index.ts';
import { findBot, has, option, positional, socketPath, withRegistry } from '../local/common.ts';
import { requestControl } from './control.ts';
import { logPath } from './logs.ts';
import { daemonCommand } from './daemon-command.ts';

function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }
function output(context: CommandContext, value: unknown, json: boolean): void { context.stdout(json ? `${JSON.stringify({ ok: true, data: value })}\n` : `${typeof value === 'string' ? value : JSON.stringify(value, null, 2)}\n`); }
async function service(args: string[], context: CommandContext): Promise<number> {
  if (process.platform !== 'linux') throw new Error('Systemd user service is supported on Linux only');
  const verb = args[0];
  if (!['install', 'uninstall', 'start', 'stop', 'restart', 'status'].includes(verb ?? '')) throw new Error('Usage: vian service install|uninstall|start|stop|restart|status');
  const { serviceCommand } = await import('./service.ts');
  return serviceCommand(verb!, context);
}

async function access(args: string[], context: CommandContext): Promise<void> {
  const [verb, selector, code] = args;
  if (!verb || !selector) throw new Error('Usage: vian access verify|list|pending|approve|revoke <bot> [code|principal]');
  if (verb === 'verify') { const { verifyAccess } = await import('./access.ts'); await verifyAccess(args.slice(1), context); return; }
  const record = await findBot(selector);
  const store = new SqliteBotStore(record.id, join(record.path, '.vian/state.sqlite'));
  try {
    const service = new AccessService(store);
    if (verb === 'list') output(context, await service.list(), has(args, '--json'));
    else if (verb === 'pending') output(context, await service.pending(), has(args, '--json'));
    else if (verb === 'approve') {
      const principal = option(args, '--as');
      if (!code || !principal) throw new Error('Usage: vian access approve <bot> <code> --as <principal>');
      const result = await service.approve(code, principal as PrincipalId);
      if (result.kind !== 'ok') throw new Error(result.reason);
      output(context, 'Pairing approved', false);
    } else if (verb === 'revoke') {
      if (!code) throw new Error('Usage: vian access revoke <bot> <principal>');
      const binding = (await service.list()).find(item => item.principalId === code);
      if (!binding) throw new Error(`Principal ${code} has no active binding`);
      await service.revoke(binding.actor);
      output(context, 'Binding revoked', false);
    } else throw new Error('Usage: vian access list|pending|approve|revoke <bot>');
  } finally { store.close(); }
}

async function showLogs(args: string[], context: CommandContext): Promise<void> {
  const selector = positional(args)[0];
  if (!selector) throw new Error('Usage: vian logs <bot> [--follow] [--json]');
  const record = await findBot(selector);
  const path = logPath(record.path);
  let offset = 0;
  const print = () => {
    if (!existsSync(path)) return;
    const contents = readFileSync(path, 'utf8');
    if (contents.length < offset) offset = 0;
    const newText = contents.slice(offset); offset = contents.length;
    for (const line of newText.split('\n').filter(Boolean)) {
      if (has(args, '--json')) context.stdout(line + '\n');
      else { try { const event = JSON.parse(line) as { at: string; level: string; event: string }; context.stdout(`${event.at} ${event.level.toUpperCase()} ${event.event}\n`); } catch {} }
    }
  };
  print();
  if (!has(args, '--follow')) return;
  await new Promise<void>(resolve => {
    const watcher = watch(join(record.path, '.vian'), () => print());
    const stop = () => { watcher.close(); process.off('SIGINT', stop); process.off('SIGTERM', stop); resolve(); };
    process.on('SIGINT', stop); process.on('SIGTERM', stop);
  });
}

export async function runOperations(args: string[], context: CommandContext): Promise<number> {
  const [command, ...rest] = args;
  try {
    if (command === 'daemon') return daemonCommand(rest, context);
    if (command === 'service') return service(rest, context);
    if (command === 'telegram') { const { connectTelegram } = await import('./telegram.ts'); await connectTelegram(rest, context); return 0; }
    if (command === 'test') { const { localTest } = await import('./test.ts'); return localTest(rest, context); }
    if (command === 'access') { await access(rest, context); return 0; }
    if (command === 'logs') { await showLogs(rest, context); return 0; }
    if (command === 'enable' || command === 'disable') {
      const selector = rest[0]; if (!selector) throw new Error(`Usage: vian ${command} <bot>`);
      const record = await findBot(selector);
      await withRegistry(registry => registry.setEnabled(record.id, command === 'enable'));
      if (existsSync(socketPath())) {
        const response = await requestControl(command === 'enable' ? 'start' : 'stop', record.id);
        if (!response.ok) throw new Error(response.error.message);
      }
      output(context, `${record.alias} ${command === 'enable' ? 'enabled' : 'disabled'}`, false);
      return 0;
    }
    if (['start', 'stop', 'restart', 'status'].includes(command ?? '')) {
      const selector = rest[0];
      if (command !== 'status' && !selector) throw new Error(`Usage: vian ${command} <bot>`);
      const response = await requestControl(command as 'start' | 'stop' | 'restart' | 'status', selector);
      if (!response.ok) throw new Error(response.error.message);
      output(context, response.data ?? 'OK', has(rest, '--json'));
      return 0;
    }
    throw new Error(`Unknown operations command: ${command}`);
  } catch (error) {
    if (has(args, '--json')) context.stdout(JSON.stringify({ ok: false, error: { code: 'OPERATION_FAILED', message: message(error) } }) + '\n');
    else context.stderr(`${message(error)}\n`);
    return 1;
  }
}
