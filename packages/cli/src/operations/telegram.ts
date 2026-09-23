import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { chmod, open, readFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { CommandContext } from '@vian/core';
import { TelegramGate } from '../../../gate-telegram/src/index.ts';
import { readHiddenLine } from '../hidden-input.ts';
import { findBot, manifestAt, socketPath } from '../local/common.ts';
import { requestControl } from './control.ts';

/** Replace only the selected bot's token entry; keep all other .env bytes. */
export async function saveTelegramToken(root: string, variable: string, token: string): Promise<void> {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(variable)) throw new Error('Invalid Telegram credential reference.');
  if (!token || token.length > 512 || /[\s#]/.test(token)) throw new Error('Invalid Telegram bot token.');
  const path = join(root, '.env');
  let prior = '';
  try { prior = await readFile(path, 'utf8'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const entry = new RegExp(`(^[ \\t]*(?:export[ \\t]+)?${variable}[ \\t]*=[ \\t]*)[^\\r\\n]*(\\r?\\n|$)`, 'gm');
  let found = false;
  let next = prior.replace(entry, (_line, prefix: string, ending: string) => { found = true; return `${prefix}${token}${ending}`; });
  if (!found) next += `${next && !next.endsWith('\n') ? '\n' : ''}${variable}=${token}\n`;
  const temp = join(root, `.vian-env-${randomUUID()}.tmp`);
  const file = await open(temp, 'wx', 0o600);
  try { await file.writeFile(next); await file.sync(); }
  finally { await file.close(); }
  try { await rename(temp, path); await chmod(path, 0o600); }
  catch (error) { await rm(temp, { force: true }); throw error; }
  const dir = await open(root, 'r');
  try { await dir.sync(); } finally { await dir.close(); }
}

export async function connectTelegram(args: string[], context: CommandContext): Promise<void> {
  const [verb, selector, extra] = args;
  if (verb !== 'connect' || !selector || extra) throw new Error('Usage: vian telegram connect <bot>');
  const record = await findBot(selector);
  const manifest = manifestAt(record.path);
  const reference = manifest.gate.credential;
  if (!reference.startsWith('env:')) throw new Error('Set this bot\'s Telegram credential to an env: reference in vian.json.');
  const token = await readHiddenLine('Telegram bot token (hidden): ');
  try { await new TelegramGate({ token, botId: record.id }).validate(); }
  catch { throw new Error('Telegram did not accept the token or could not be reached; credential was not saved.'); }
  await saveTelegramToken(record.path, reference.slice(4), token);
  context.stdout(`Telegram token saved for ${record.alias}.\n`);
  if (!existsSync(socketPath())) {
    context.stdout('Start the Vian daemon to receive Telegram messages.\n');
    return;
  }
  try {
    const response = await requestControl('restart', record.id);
    if (!response.ok) throw new Error(response.error.message);
    context.stdout('Bot loaded in the running daemon.\n');
  } catch {
    throw new Error('Token saved, but the bot did not start. Run vian doctor <bot> --online and vian status.');
  }
}
