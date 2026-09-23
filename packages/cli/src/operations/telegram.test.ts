import { expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../main.ts';
import { saveTelegramToken } from './telegram.ts';

test('compiled command path exposes the Telegram handoff command', async () => {
  const stdout: string[] = [], stderr: string[] = [];
  expect(await main(['telegram', 'connect'], { cwd: '/tmp', stdout: text => stdout.push(text), stderr: text => stderr.push(text) })).toBe(1);
  expect(stderr.join('')).toContain('vian telegram connect <bot>');
  expect(stdout.join('')).toBe('');
});

test('Telegram token stays bot-local and replacing it preserves unrelated env lines', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vian-telegram-connect-'));
  const path = join(root, '.env');
  try {
    await writeFile(path, '# keep this\r\nAPP_SECRET=leave-me\r\nTELEGRAM_BOT_TOKEN=old\r\n', { mode: 0o644 });
    await saveTelegramToken(root, 'TELEGRAM_BOT_TOKEN', '12345:new-token');
    const first = await readFile(path, 'utf8');
    expect(first).toBe('# keep this\r\nAPP_SECRET=leave-me\r\nTELEGRAM_BOT_TOKEN=12345:new-token\r\n');
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    await expect(saveTelegramToken(root, 'TELEGRAM_BOT_TOKEN', 'bad token')).rejects.toThrow('Invalid');
    expect(await readFile(path, 'utf8')).toBe(first);
    await saveTelegramToken(root, 'OTHER_BOT_TOKEN', '67890:second-token');
    expect(await readFile(path, 'utf8')).toContain('APP_SECRET=leave-me\r\n');
    expect(await readFile(path, 'utf8')).toContain('OTHER_BOT_TOKEN=67890:second-token');
  } finally { await rm(root, { recursive: true, force: true }); }
});
