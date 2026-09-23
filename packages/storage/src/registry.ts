import { realpathSync, existsSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import type { BotId } from '@vian/core';
import type { RegistryRecord, RegistryStore, StorageOutcome } from '@vian/core';
import { openDatabase, migrate } from './sqlite.ts';
import { registryMigrations } from './schema.ts';

export class SqliteRegistry implements RegistryStore {
  private db;
  constructor(path: string) {
    this.db = openDatabase(path);
    migrate(this.db, registryMigrations);
  }
  async register(record: RegistryRecord, mode: 'new' | 'move' | 'clone' = 'new'): Promise<StorageOutcome<RegistryRecord>> {
    if (!isAbsolute(record.path)) return { kind: 'invalid-transition', reason: 'Bot path must be absolute' };
    if (!existsSync(record.path)) return { kind: 'unavailable-storage', reason: 'Bot path is unavailable' };
    const canonicalPath = realpathSync(record.path);
    const existing = this.db.query('SELECT * FROM bots WHERE id = ?').get(record.id) as Row | null;
    const occupied = this.db.query('SELECT id FROM bots WHERE path = ? OR alias = ?').all(canonicalPath, record.alias) as { id: string }[];
    if (occupied.some(row => row.id !== record.id)) return { kind: 'duplicate', reason: 'Path or alias is already registered' };
    if (existing) {
      if (existing.path === canonicalPath && existing.alias === record.alias) return { kind: 'ok', value: fromRow(existing) };
      if (mode !== 'move' && existsSync(existing.path)) return { kind: 'duplicate', reason: 'Bot UUID already exists; explicit move required' };
      this.db.query('UPDATE bots SET alias = ?, path = ? WHERE id = ?').run(record.alias, canonicalPath, record.id);
      return { kind: 'ok', value: { ...fromRow(existing), alias: record.alias, path: canonicalPath } };
    }
    this.db.query('INSERT INTO bots VALUES (?,?,?,?,?,?,?)').run(record.id, record.alias, canonicalPath, record.registeredAt, record.enabled ? 1 : 0, record.observedName ?? null, record.observedStatus ?? null);
    return { kind: 'ok', value: { ...record, path: canonicalPath } };
  }
  async unregister(botId: BotId): Promise<void> { this.db.query('DELETE FROM bots WHERE id = ?').run(botId); }
  async list(): Promise<RegistryRecord[]> { return (this.db.query('SELECT * FROM bots ORDER BY alias').all() as Row[]).map(fromRow); }
  async get(selector: string): Promise<RegistryRecord | undefined> {
    const row = this.db.query('SELECT * FROM bots WHERE id = ? OR alias = ? OR path = ?').get(selector, selector, resolve(selector)) as Row | null;
    return row ? fromRow(row) : undefined;
  }
  async setEnabled(botId: BotId, enabled: boolean): Promise<void> { this.db.query('UPDATE bots SET enabled = ? WHERE id = ?').run(enabled ? 1 : 0, botId); }
  close(): void { this.db.close(); }
}
interface Row { id: BotId; alias: string; path: string; registered_at: string; enabled: number; observed_name: string | null; observed_status: string | null }
function fromRow(row: Row): RegistryRecord { return { id: row.id, alias: row.alias, path: row.path, registeredAt: row.registered_at, enabled: !!row.enabled, ...(row.observed_name && { observedName: row.observed_name }), ...(row.observed_status && { observedStatus: row.observed_status }) }; }
