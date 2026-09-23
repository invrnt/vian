import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AuditEvent, BotId, CommandContext, HistoryFilter, PrincipalId, SessionId } from '@vian/core';
import { SqliteBotStore, inspectBotSchema } from '@vian/storage';
import { absolute, findBot, has, manifestAt, option, positional, registryPath, withRegistry } from './common.ts';

function row(values: string[]): string { return values.join('\t') + '\n'; }
function botDb(root: string): string { return join(root, '.vian', 'state.sqlite'); }
function openBot(record: { id: BotId; path: string }): SqliteBotStore {
  const path = botDb(record.path);
  if (!existsSync(path)) throw new Error(`${path}: bot history database is missing`);
  return new SqliteBotStore(record.id, path, { readonly: true });
}
function timestamp(value: string): string {
  const duration = /^([0-9]+)([smhdw])$/.exec(value);
  if (duration) {
    const scale = { s: 1000, m: 60000, h: 3600000, d: 86400000, w: 604800000 }[duration[2] as 's'];
    return new Date(Date.now() - Number(duration[1]) * scale).toISOString();
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) throw new Error(`--since requires an ISO timestamp or duration such as 7d`);
  return parsed.toISOString();
}
export async function list(args: string[], context: CommandContext): Promise<void> {
  const records = existsSync(registryPath()) ? await withRegistry(registry => registry.list()) : [];
  const results = await Promise.all(records.map(async record => {
    const missing = !existsSync(record.path);
    let gate = '', model = '', sessions = 0;
    if (!missing) {
      try { const config = manifestAt(record.path); gate = config.gate.type; model = config.model.id; } catch { /* invalid config is shown by inspect/doctor */ }
      if (existsSync(botDb(record.path)) && inspectBotSchema(botDb(record.path)).compatible) { const store = openBot(record); try { sessions = (await store.listSessions()).length; } catch { /* doctor reports malformed DB */ } finally { store.close(); } }
    }
    return { name: record.alias, id: record.id, status: missing ? 'missing' : record.enabled ? 'stopped' : 'disabled', gate, model, sessions, path: record.path, enabled: record.enabled };
  }));
  if (has(args, '--json')) context.stdout(JSON.stringify({ ok: true, data: results }) + '\n');
  else { context.stdout(row(['NAME', 'STATUS', 'GATE', 'MODEL', 'SESSIONS', 'PATH'])); for (const item of results) context.stdout(row([item.name, item.status, item.gate, item.model, String(item.sessions), item.path])); }
}
export async function inspect(args: string[], context: CommandContext): Promise<void> {
  const selector = positional(args.slice(1))[0];
  if (!selector) throw new Error('Usage: vian inspect <bot> [--json]');
  const record = await findBot(selector);
  const config = manifestAt(record.path);
  const data = { registry: record, manifest: config, resolved: { instructions: absolute(record.path, config.instructions), tools: absolute(record.path, config.tools) } };
  if (has(args, '--json')) context.stdout(JSON.stringify({ ok: true, data }) + '\n');
  else {
    context.stdout(`Bot: ${record.alias}\nID: ${record.id}\nPath: ${record.path}\nEnabled: ${record.enabled}\nModel: ${config.model.provider}/${config.model.id}\nCredential: ${config.model.credential ?? '(none)'}\nGate: ${config.gate.type}\nGate credential: ${config.gate.credential}\nInstructions: ${data.resolved.instructions}\nTools: ${data.resolved.tools}\n`);
  }
}
export async function sessions(args: string[], context: CommandContext): Promise<void> {
  const selector = positional(args.slice(1))[0];
  if (!selector) throw new Error('Usage: vian sessions <bot> [--json]');
  const record = await findBot(selector);
  const store = openBot(record);
  try {
    const data = await store.listSessions();
    if (has(args, '--json')) context.stdout(JSON.stringify({ ok: true, data }) + '\n');
    else { context.stdout(row(['SESSION', 'PRINCIPAL', 'LAST ACTIVE', 'MESSAGES', 'STATE'])); for (const item of data) context.stdout(row([item.id, item.initiatorId, item.lastActiveAt, String(item.messageCount), item.state])); }
  } finally { store.close(); }
}
function textFromEvent(event: AuditEvent): string {
  if (event.kind.startsWith('tool_call_')) return `[${event.kind}] ${String(event.payload.name ?? event.payload.callId ?? '')}`;
  const message = event.payload.message;
  if (message && typeof message === 'object' && 'parts' in message && Array.isArray(message.parts)) return message.parts.map((part: unknown) => part && typeof part === 'object' && 'text' in part ? String(part.text) : '[attachment]').join(' ');
  return event.kind;
}
function outputRedactor(root: string): (value: string) => string {
  const path = join(root, '.env');
  if (!existsSync(path)) return value => value;
  const values = readFileSync(path, 'utf8').split(/\r?\n/).map(line => /^\s*(?:export\s+)?[A-Za-z_][A-Za-z0-9_]*\s*=\s*(.*)$/.exec(line)?.[1]?.trim().replace(/^(['"])(.*)\1$/, '$2')).filter((value): value is string => !!value && value.length >= 4);
  return input => values.reduce((text, value) => text.replaceAll(value, '[redacted]'), input);
}
export async function history(args: string[], context: CommandContext): Promise<void> {
  const selector = positional(args.slice(1))[0];
  if (!selector) throw new Error('Usage: vian history <bot> [--session ID] [--principal ID] [--since 7d] [--tools] [--jsonl]');
  const record = await findBot(selector);
  const store = openBot(record);
  const redact = outputRedactor(record.path);
  const filter: HistoryFilter = { sessionId: option(args, '--session') as SessionId | undefined, principalId: option(args, '--principal') as PrincipalId | undefined, since: option(args, '--since') ? timestamp(option(args, '--since')!) : undefined, toolsOnly: has(args, '--tools'), limit: 1000 };
  let count = 0;
  const requestedLimit = option(args, '--limit') ? Number(option(args, '--limit')) : undefined;
  if (requestedLimit !== undefined && (!Number.isInteger(requestedLimit) || requestedLimit < 1)) throw new Error('--limit must be a positive integer');
  try {
    while (true) {
      let page = 0;
      for await (const event of store.history(filter)) {
        if (has(args, '--jsonl')) context.stdout(JSON.stringify(event, (_key, value: unknown) => typeof value === 'string' ? redact(value) : value) + '\n');
        else context.stdout(redact(`${event.at} ${event.sessionId ?? '-'} ${event.principalId ?? '-'} ${textFromEvent(event)}\n`));
        filter.afterSequence = event.sequence;
        page++; count++;
        if (requestedLimit && count >= requestedLimit) return;
      }
      if (page < 1000) break;
    }
  } finally { store.close(); }
}
