import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BotId, RegistryRecord } from '../packages/core/src/index.ts';
import { SqliteRegistry } from '../packages/storage/src/index.ts';
import { VianDaemon } from '../packages/cli/src/operations/daemon.ts';

const root = await mkdtemp(join(tmpdir(), 'vian-idle-'));
const previous = process.env.XDG_DATA_HOME;
process.env.XDG_DATA_HOME = root;
const registry = new SqliteRegistry(join(root, 'vian', 'registry.sqlite'));
for (let i = 0; i < 25; i++) {
  const path = join(root, `bot-${i}`);
  await mkdir(path);
  const record: RegistryRecord = { id: randomUUID() as BotId, alias: `bot-${i}`, path, registeredAt: new Date().toISOString(), enabled: true };
  const registered = await registry.register(record);
  if (registered.kind !== 'ok') throw new Error(registered.reason);
}
registry.close();
const daemon = new VianDaemon({ assemble: async () => ({ close: async () => {} }) as never });
try {
  await daemon.start();
  await Bun.sleep(200);
  console.log(JSON.stringify({ bots: 25, fakeAdapters: true, rssBytes: process.memoryUsage().rss, pid: process.pid }));
} finally {
  await daemon.stop();
  if (previous === undefined) delete process.env.XDG_DATA_HOME; else process.env.XDG_DATA_HOME = previous;
  await rm(root, { recursive: true, force: true });
}
