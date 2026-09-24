import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { CommandContext, PrincipalId } from '@vian/core';
import { SqliteBotStore } from '@vian/storage';
import { AccessService } from '../../../runtime/src/index.ts';
import { findBot, option } from '../local/common.ts';

export async function verifyAccess(args: string[], context: CommandContext): Promise<void> {
  const selector = args[0];
  if (!selector || selector.startsWith('--')) throw new Error('Usage: vian access verify <bot> [--as <principal>] [--minutes N]');
  for (let i = 1; i < args.length; i += 2) {
    if (!['--as', '--minutes'].includes(args[i]!) || !args[i + 1] || args[i + 1]!.startsWith('--')) throw new Error('Usage: vian access verify <bot> [--as <principal>] [--minutes N]');
  }
  const rawMinutes = option(args, '--minutes') ?? '10';
  if (!/^\d+$/.test(rawMinutes) || Number(rawMinutes) < 1 || Number(rawMinutes) > 30) throw new Error('--minutes must be an integer from 1 to 30');
  const principalId = (option(args, '--as') ?? randomUUID()) as PrincipalId;
  if (!principalId.trim()) throw new Error('Principal cannot be empty');
  const record = await findBot(selector);
  const store = new SqliteBotStore(record.id, join(record.path, '.vian/state.sqlite'));
  try {
    const access = new AccessService(store);
    const { code, expiresAt } = await access.createVerification(principalId, new Date(Date.now() + Number(rawMinutes) * 60_000).toISOString());
    context.stdout(`Send this code to the bot in a private Telegram message: ${code}\nPrincipal: ${principalId}\nExpires: ${expiresAt}\nWaiting for verification...\n`);
    while (Date.now() < Date.parse(expiresAt)) {
      const status = await access.verificationStatus(code);
      if (status.state === 'used') {
        context.stdout(`Verified Telegram user ${status.actorId} as ${status.principalId}.\n`);
        return;
      }
      if (status.state !== 'pending') break;
      await Bun.sleep(Math.min(250, Date.parse(expiresAt) - Date.now()));
    }
    const finalStatus = await access.verificationStatus(code);
    if (finalStatus.state === 'used') {
      context.stdout(`Verified Telegram user ${finalStatus.actorId} as ${finalStatus.principalId}.\n`);
      return;
    }
    throw new Error(`Verification expired at ${expiresAt}`);
  } finally { store.close(); }
}
