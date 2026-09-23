import { Database } from 'bun:sqlite';
import { dirname, resolve } from 'node:path';
import { mkdirSync, existsSync } from 'node:fs';
import { botMigrations } from './schema.ts';

export function openDatabase(path: string): Database {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const db = new Database(path, { create: true, strict: true });
  db.run('PRAGMA busy_timeout = 5000');
  db.run('PRAGMA foreign_keys = ON');
  const mode = db.query('PRAGMA journal_mode = WAL').get() as { journal_mode: string };
  if (mode.journal_mode !== 'wal') throw new Error('SQLite WAL is unavailable');
  return db;
}

export function version(db: Database): number {
  return (db.query('PRAGMA user_version').get() as { user_version: number }).user_version;
}

export function migrate(db: Database, migrations: readonly string[]): void {
  const current = version(db);
  if (current > migrations.length) throw new Error(`Unsupported future SQLite schema ${current}`);
  for (let i = current; i < migrations.length; i++) {
    db.transaction(() => {
      db.run(migrations[i]!);
      db.run(`PRAGMA user_version = ${i + 1}`);
    }).immediate();
  }
}

/** VACUUM INTO is SQLite's consistent online snapshot; the target must be new. */
export function backup(db: Database, destinationPath: string): void {
  const target = resolve(destinationPath);
  if (existsSync(target)) throw new Error('Backup destination already exists');
  mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
  db.query('VACUUM INTO ?').run(target);
}

/** Doctor inspection never creates a DB, enables WAL, or applies migrations. */
export function inspectBotSchema(path: string): { exists: boolean; currentVersion: number; supportedVersion: number; compatible: boolean } {
  const supportedVersion = botMigrations.length;
  if (!existsSync(path)) return { exists: false, currentVersion: 0, supportedVersion, compatible: false };
  const db = new Database(path, { readonly: true, strict: true });
  try {
    const currentVersion = version(db);
    return { exists: true, currentVersion, supportedVersion, compatible: currentVersion > 0 && currentVersion <= supportedVersion };
  } finally { db.close(); }
}
