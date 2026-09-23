import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { CommandContext } from '@vian/core';
import { inspectBotSchema } from '@vian/storage';
import { absolute, findBot, has, manifestAt, positional } from './common.ts';

type Check = { name: string; ok: boolean; detail: string };
function add(checks: Check[], name: string, ok: boolean, detail: string): void { checks.push({ name, ok, detail }); }
function envKeys(path: string): Map<string, boolean> {
  if (!existsSync(path)) return new Map();
  const result = new Map<string, boolean>();
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (match) result.set(match[1]!, !!match[2]!.trim());
  }
  return result;
}
export async function doctor(args: string[], context: CommandContext): Promise<void> {
  const selector = positional(args.slice(1))[0];
  if (!selector) throw new Error('Usage: vian doctor <bot> [--online] [--json]');
  const record = await findBot(selector);
  const checks: Check[] = [];
  const online = has(args, '--online');
  add(checks, 'bot path', existsSync(record.path), record.path);
  if (existsSync(record.path)) {
    let manifest;
    try { manifest = manifestAt(record.path); add(checks, 'config schema', true, 'schemaVersion 1'); }
    catch (error) { add(checks, 'config schema', false, String(error)); }
    if (manifest) {
      const instructions = absolute(record.path, manifest.instructions);
      const tools = absolute(record.path, manifest.tools);
      add(checks, 'instructions', existsSync(instructions), instructions);
      add(checks, 'tool entrypoint', existsSync(tools), tools);
      if (existsSync(tools)) {
        try {
          const { loadNativeTools } = await import('@vian/tools');
          const loaded = await loadNativeTools(record.path, manifest.tools);
          try {
            const nativeNames = Object.keys(loaded.tools);
            add(checks, 'tool import', true, `${nativeNames.length} native tools`);
            const configuredNames = [...nativeNames, ...manifest.mcp.flatMap(server => server.tools)];
            const duplicates = configuredNames.filter((name, index) => configuredNames.indexOf(name) !== index);
            add(checks, 'duplicate tool names', duplicates.length === 0, duplicates.length ? [...new Set(duplicates)].join(', ') : 'none');
          }
          finally { await loaded.dispose(); }
        } catch (error) { add(checks, 'tool import', false, error instanceof Error ? error.message : 'tool import failed'); }
      }
      const envPath = join(record.path, '.env');
      add(checks, '.env', existsSync(envPath), envPath);
      const keys = envKeys(envPath);
      for (const reference of [manifest.model.credential, manifest.gate.credential]) {
        if (reference?.startsWith('env:')) { const name = reference.slice(4); add(checks, `secret ${name}`, keys.get(name) === true, keys.get(name) ? 'value present' : 'value missing'); }
      }
      add(checks, 'Gate configuration', manifest.gate.type === 'telegram', manifest.gate.type);
      add(checks, 'provider configuration', !!manifest.model.id && !!manifest.model.provider, `${manifest.model.provider}/${manifest.model.id}`);
      const dbPath = join(record.path, '.vian/state.sqlite');
      try {
        const schema = inspectBotSchema(dbPath);
        add(checks, 'database migration', schema.exists && schema.compatible && schema.currentVersion === schema.supportedVersion, schema.exists ? `version ${schema.currentVersion}/${schema.supportedVersion}` : 'database missing');
      } catch (error) { add(checks, 'database migration', false, String(error)); }
      const attachments = join(record.path, '.vian/attachments');
      if (!existsSync(attachments)) add(checks, 'attachment directory', false, `${attachments}: missing`);
      else { const mode = statSync(attachments).mode & 0o777; add(checks, 'attachment directory', (mode & 0o077) === 0, `${attachments}: mode ${mode.toString(8)}`); }
    }
  }
  if (online) add(checks, 'online probes', false, 'Online probes require assembled Telegram, provider and MCP adapters');
  const data = { bot: record.alias, mode: online ? 'online' : 'offline', ok: checks.every(check => check.ok), checks };
  if (has(args, '--json')) context.stdout(JSON.stringify({ ok: data.ok, data }) + '\n');
  else for (const check of checks) context.stdout(`${check.ok ? 'OK' : 'FAIL'} ${check.name}: ${check.detail}\n`);
  if (!data.ok) throw new DoctorFailure();
}
export class DoctorFailure extends Error { constructor() { super('Doctor found failed checks'); } }
