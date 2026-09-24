import { expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { BotId, InboundEvent } from '@vian/core';
import { SqliteBotStore, SqliteRegistry } from '@vian/storage';
import { verifyAccess } from './access.ts';

test('owner CLI waits and reports the Telegram numeric sender after verification', async () => {
  const root = mkdtempSync(join(tmpdir(), 'vian-cli-verify-'));
  const prior = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = join(root, 'global');
  const botRoot = join(root, 'bot');
  mkdirSync(join(botRoot, '.vian'), { recursive: true });
  const botId = randomUUID() as BotId;
  const registry = new SqliteRegistry(join(root, 'global/vian/registry.sqlite'));
  const store = new SqliteBotStore(botId, join(botRoot, '.vian/state.sqlite'));
  try {
    expect((await registry.register({ id: botId, alias: 'example', path: botRoot, registeredAt: new Date().toISOString(), enabled: true })).kind).toBe('ok');
    let output = '';
    const waiting = verifyAccess(['example', '--as', 'friend', '--minutes', '1'], { cwd: root, stdout: text => { output += text; }, stderr: () => {} });
    for (let n = 0; n < 100 && !output.includes('Waiting for verification'); n++) await Bun.sleep(5);
    const code = output.match(/message: ([A-F0-9]{12})/)?.[1];
    expect(code).toBeDefined();
    expect(output).toContain('Expires: ');
    const event: InboundEvent = { gate: 'telegram', externalEventId: 'verify-cli', actor: { gate: 'telegram', externalId: '12345' }, destination: { gate: 'telegram', externalId: '12345' }, receivedAt: new Date().toISOString(), kind: 'message', parts: [{ type: 'text', text: code! }] };
    expect(await store.consumeOwnerVerification(event)).toBe('matched');
    await waiting;
    expect(output).toContain('Verified Telegram user 12345 as friend.');
  } finally {
    registry.close(); store.close();
    if (prior === undefined) delete process.env.XDG_DATA_HOME; else process.env.XDG_DATA_HOME = prior;
    rmSync(root, { recursive: true, force: true });
  }
});
