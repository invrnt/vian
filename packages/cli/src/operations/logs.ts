import { existsSync, mkdirSync, renameSync, statSync, writeFileSync, appendFileSync, chmodSync } from 'node:fs';
import { join } from 'node:path';

const MAX_LOG_BYTES = 2 * 1024 * 1024;
const LOG_FILES = 3;
export function logPath(root: string): string { return join(root, '.vian', 'runtime.log'); }
export function appendLog(root: string, level: 'info' | 'error', event: string): void {
  const path = logPath(root);
  mkdirSync(join(root, '.vian'), { recursive: true, mode: 0o700 });
  if (existsSync(path) && statSync(path).size >= MAX_LOG_BYTES) {
    for (let i = LOG_FILES - 1; i > 0; i--) {
      const from = `${path}.${i}`, to = `${path}.${i + 1}`;
      if (existsSync(from)) renameSync(from, to);
    }
    renameSync(path, `${path}.1`);
  }
  if (!existsSync(path)) writeFileSync(path, '', { mode: 0o600 });
  chmodSync(path, 0o600);
  appendFileSync(path, JSON.stringify({ at: new Date().toISOString(), level, event: event.slice(0, 4096) }) + '\n');
}
