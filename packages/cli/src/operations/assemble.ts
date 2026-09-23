import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { BotId, BotManifest, ProviderAdapter, RegistryRecord } from '@vian/core';
import { SqliteBotStore } from '@vian/storage';
import { AttachmentRegistry, assertUniqueToolNames, loadNativeTools } from '@vian/tools';
import { BotRuntime } from '../../../runtime/src/index.ts';
import { TelegramGate } from '../../../gate-telegram/src/index.ts';
import { FileCredentialStore, BotSecretResolver } from '@vian/credentials';
import { chatgptSubscriptionAdapter } from '@vian/provider-openai-chatgpt';
import { googleAdapter } from '../../../provider-google/src/index.ts';
import { gatewayAdapter } from '../../../provider-vercel/src/index.ts';
import { McpToolRuntime } from '../../../mcp/src/index.ts';
import { manifestAt } from '../local/common.ts';

export interface AssembledBot { runtime: BotRuntime; store: SqliteBotStore; manifest: BotManifest; close(): Promise<void> }
export interface SharedRunPermit { acquire(signal?: AbortSignal): Promise<() => void> }

/** A process may recover a bot's leases only after taking this exclusive owner lock. */
export function acquireBotOwnership(root: string): () => void {
  const dir = join(root, '.vian', 'owner.lock');
  mkdirSync(join(root, '.vian'), { recursive: true, mode: 0o700 });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      mkdirSync(dir, { mode: 0o700 });
      writeFileSync(join(dir, 'pid'), String(process.pid), { mode: 0o600 });
      return () => rmSync(dir, { recursive: true, force: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      let pid = 0;
      try { pid = Number(readFileSync(join(dir, 'pid'), 'utf8')); } catch {}
      if (pid > 0) {
        try { process.kill(pid, 0); throw new Error(`Bot is already owned by process ${pid}`); }
        catch (check) { if ((check as NodeJS.ErrnoException).code !== 'ESRCH') throw check; }
      }
      if (!pid && Date.now() - statSync(dir).mtimeMs < 5000) throw new Error('Bot owner lock is initializing');
      if (attempt === 0) rmSync(dir, { recursive: true, force: true });
    }
  }
  throw new Error('Bot owner lock is unavailable');
}

export function providerFor(manifest: BotManifest, secrets: BotSecretResolver, profiles: FileCredentialStore): ProviderAdapter {
  switch (manifest.model.provider) {
    case 'google': return googleAdapter(secrets);
    case 'vercel-ai-gateway': return gatewayAdapter(secrets);
    case 'openai-chatgpt': return chatgptSubscriptionAdapter(profiles);
  }
}

export async function validateBot(record: RegistryRecord): Promise<void> {
  const manifest = manifestAt(record.path);
  if (manifest.id !== record.id) throw new Error(`${record.alias}: registered UUID differs from vian.json`);
  if (!existsSync(resolve(record.path, manifest.instructions))) throw new Error(`${record.alias}: instructions file is missing`);
  const profiles = new FileCredentialStore();
  const secrets = new BotSecretResolver(profiles);
  const token = await secrets.resolve(record.id, record.path, manifest.gate.credential);
  const native = await loadNativeTools(record.path, manifest.tools);
  const mcp = new McpToolRuntime();
  try {
    await mcp.start(manifest.mcp);
    assertUniqueToolNames([Object.keys(native.tools), mcp.definitions().map(tool => tool.name)]);
    await providerFor(manifest, secrets, profiles).resolveModel({ botId: record.id, botRoot: record.path, modelId: manifest.model.id, credential: manifest.model.credential });
    await new TelegramGate({ token, botId: record.id, groupsEnabled: manifest.gate.access.groups }).validate();
  } finally { await mcp.close(); await native.dispose(); }
}

export async function assembleBot(record: RegistryRecord, logger: { info(message: string): void; error(message: string): void }, globalRunPermit?: SharedRunPermit): Promise<AssembledBot> {
  if (!existsSync(record.path)) throw new Error(`${record.alias}: bot path is missing`);
  const manifest = manifestAt(record.path);
  if (manifest.id !== record.id) throw new Error(`${record.alias}: registered UUID differs from vian.json`);
  const instructions = resolve(record.path, manifest.instructions);
  if (!existsSync(instructions)) throw new Error(`${record.alias}: instructions file is missing`);
  const profiles = new FileCredentialStore();
  const secrets = new BotSecretResolver(profiles);
  const token = await secrets.resolve(record.id, record.path, manifest.gate.credential);
  const native = await loadNativeTools(record.path, manifest.tools);
  const mcp = new McpToolRuntime();
  let store: SqliteBotStore | undefined;
  try {
    await mcp.start(manifest.mcp);
    assertUniqueToolNames([Object.keys(native.tools), mcp.definitions().map(tool => tool.name)]);
    const release = acquireBotOwnership(record.path);
    try {
      store = new SqliteBotStore(record.id, join(record.path, '.vian/state.sqlite'));
      const currentStore = store;
      const attachments = new AttachmentRegistry(id => id === record.id ? { root: record.path, store: currentStore } : undefined, manifest.attachments.maxFileBytes, manifest.attachments.defaultTtlHours);
      attachments.trackBot(record.id);
      const gate = new TelegramGate({ token, botId: record.id, groupsEnabled: manifest.gate.access.groups, onFatal: () => logger.error('Telegram polling failed; retrying') });
      const mcpTools = Object.fromEntries(mcp.definitions().map(definition => [definition.name, {
        description: definition.description, inputSchema: definition.inputSchema,
        execute: async (input: unknown, context: Parameters<NonNullable<typeof native.tools[string]['execute']>>[1]) => {
          const server = manifest.mcp.find(item => item.tools.includes(definition.name));
          if (!server) throw new Error('MCP tool is unavailable');
          const result = await mcp.execute(server.name, definition.name, input, context);
          if (!result.ok) throw new Error(result.error.message);
          return result.value;
        },
      }]));
      const runtime = new BotRuntime({ botId: record.id as BotId, botRoot: record.path, manifest, store, gate, provider: providerFor(manifest, secrets, profiles), attachments, tools: { ...native.tools, ...mcpTools }, logger, globalRunPermit });
      try { await runtime.start(); }
      catch (error) { store.close(); release(); throw error; }
      return { runtime, store, manifest, async close() { await runtime.stop(); store!.close(); await mcp.close(); await native.dispose(); release(); } };
    } catch (error) { release(); throw error; }
  } catch (error) { await mcp.close(); await native.dispose(); throw error; }
}
