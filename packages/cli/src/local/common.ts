import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { parseManifest, type BotManifest, type RegistryRecord } from '@vian/core';
import { SqliteRegistry } from '@vian/storage';

export function stateDir(): string { return process.env.XDG_DATA_HOME ? resolve(process.env.XDG_DATA_HOME, 'vian') : join(homedir(), '.local/share/vian'); }
export function registryPath(): string { return join(stateDir(), 'registry.sqlite'); }
export function socketPath(): string { return join(stateDir(), 'vian.sock'); }
export async function withRegistry<T>(callback: (registry: SqliteRegistry) => Promise<T>): Promise<T> {
  const registry = new SqliteRegistry(registryPath());
  try { return await callback(registry); } finally { registry.close(); }
}
export async function findBot(selector: string): Promise<RegistryRecord> {
  if (!existsSync(registryPath())) throw new Error(`Bot ${selector} is not registered`);
  const record = await withRegistry(registry => registry.get(selector));
  if (!record) throw new Error(`Bot ${selector} is not registered`);
  return record;
}
export function manifestAt(root: string): BotManifest {
  const path = join(root, 'vian.json');
  if (!existsSync(path)) throw new Error(`${path}: config file is missing`);
  let value: unknown;
  try { value = JSON.parse(readFileSync(path, 'utf8')); } catch (error) { throw new Error(`${path}: invalid JSON: ${String(error)}`); }
  return parseManifest(value, path);
}
export function absolute(root: string, configured: string): string { return isAbsolute(configured) ? configured : resolve(root, configured); }
export function option(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  if (!args[i + 1] || args[i + 1]!.startsWith('--')) throw new Error(`${name} requires a value`);
  return args[i + 1];
}
export function has(args: string[], name: string): boolean { return args.includes(name); }
export function positional(args: string[]): string[] {
  const valued = new Set(['--name', '--provider', '--model', '--credential', '--telegram-credential', '--instructions', '--tools', '--session', '--principal', '--since', '--limit']);
  const result: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (valued.has(args[i]!)) { i++; continue; }
    if (!args[i]!.startsWith('--')) result.push(args[i]!);
  }
  return result;
}
