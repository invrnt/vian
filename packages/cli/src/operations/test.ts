import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BotId, CanonicalMessage, CommandContext, ConversationId, DeliveryOutcome, ExternalDestination, GateAdapter, GateCapabilities, InboundEvent, PrincipalId, RenderedPart, ToolContext } from '@vian/core';
import { SqliteBotStore } from '@vian/storage';
import { BotSecretResolver, FileCredentialStore } from '@vian/credentials';
import { AttachmentRegistry, loadNativeTools } from '@vian/tools';
import { BotRuntime } from '../../../runtime/src/index.ts';
import { McpToolRuntime } from '../../../mcp/src/index.ts';
import { findBot, has, manifestAt, option, positional } from '../local/common.ts';
import { acquireBotOwnership, providerFor } from './assemble.ts';

class LocalGate implements GateAdapter {
  readonly type = 'telegram';
  private inbound?: (event: InboundEvent) => Promise<void>;
  readonly deliveries: string[] = [];
  capabilities(): GateCapabilities { return { text: true, formatting: ['plain'], streaming: false, stopGeneration: false, buttons: false, attachments: true, replies: false, groups: false, threads: false }; }
  async validate(): Promise<void> {}
  async start(onInbound: (event: InboundEvent) => Promise<void>): Promise<void> { this.inbound = onInbound; }
  async stop(): Promise<void> { this.inbound = undefined; }
  async emit(event: InboundEvent): Promise<void> { await this.inbound?.(event); }
  async render(message: CanonicalMessage): Promise<RenderedPart[]> { return message.parts.filter(part => part.type === 'text').map((part, partIndex) => ({ partIndex, kind: 'text', text: part.text })); }
  async deliver(part: RenderedPart, _destination: ExternalDestination): Promise<DeliveryOutcome> { this.deliveries.push(part.text ?? ''); return { kind: 'succeeded', receipt: { externalId: String(this.deliveries.length), sentAt: new Date().toISOString() } }; }
}

export async function localTest(args: string[], context: CommandContext): Promise<number> {
  const words = positional(args);
  const selector = words[0], prompt = words.slice(1).join(' ');
  if (!selector || !prompt) throw new Error('Usage: vian test <bot> <prompt> [--session <id>]');
  const record = await findBot(selector);
  const manifest = manifestAt(record.path);
  const selectedSession = option(args, '--session');
  const temp = await mkdtemp(join(tmpdir(), 'vian-local-test-'));
  const release = selectedSession ? acquireBotOwnership(record.path) : undefined;
  let store: SqliteBotStore | undefined;
  let runtime: BotRuntime | undefined;
  let native: Awaited<ReturnType<typeof loadNativeTools>> | undefined;
  const mcp = new McpToolRuntime();
  try {
    store = new SqliteBotStore(record.id, selectedSession ? join(record.path, '.vian/state.sqlite') : join(temp, 'state.sqlite'));
    native = await loadNativeTools(record.path, manifest.tools);
    await mcp.start(manifest.mcp);
    const attachments = new AttachmentRegistry(id => id === record.id ? { root: selectedSession ? record.path : temp, store: store! } : undefined, manifest.attachments.maxFileBytes, manifest.attachments.defaultTtlHours);
    attachments.trackBot(record.id);
    const gate = new LocalGate();
    const destination: ExternalDestination = { gate: 'telegram', externalId: '1' };
    const actor = { gate: 'telegram' as const, externalId: '1' };
    if (selectedSession) {
      const session = (await store.listSessions()).find(item => item.id === selectedSession);
      if (!session) throw new Error('Session is not found');
      const actual = await store.destinationForConversation(session.conversationId);
      if (!actual) throw new Error('Session destination is unavailable');
      Object.assign(destination, actual);
      const binding = (await store.listActorBindings()).find(item => item.principalId === session.initiatorId);
      if (!binding) throw new Error('Session principal is unavailable');
      Object.assign(actor, binding.actor);
    } else {
      const principal = randomUUID() as PrincipalId;
      await store.bindActor(actor, principal);
      await store.bindDestination(destination, randomUUID() as ConversationId, principal);
    }
    const profiles = new FileCredentialStore();
    const provider = providerFor(manifest, new BotSecretResolver(profiles), profiles);
    const mcpTools = Object.fromEntries(mcp.definitions().map(definition => [definition.name, {
      description: definition.description, inputSchema: definition.inputSchema,
      execute: async (input: unknown, context: ToolContext) => {
        const server = manifest.mcp.find(item => item.tools.includes(definition.name));
        if (!server) throw new Error('MCP tool is unavailable');
        const result = await mcp.execute(server.name, definition.name, input, context);
        if (!result.ok) throw new Error(result.error.message);
        return result.value;
      },
    }]));
    runtime = new BotRuntime({ botId: record.id as BotId, botRoot: record.path, manifest, store, gate, provider, attachments, tools: { ...native.tools, ...mcpTools } });
    await runtime.start();
    await gate.emit({ gate: 'telegram', externalEventId: randomUUID(), actor, destination, receivedAt: new Date().toISOString(), kind: 'message', parts: [{ type: 'text', text: prompt }] });
    const deadline = Date.now() + manifest.runtime.runTimeoutSeconds * 1000 + 5000;
    while (Date.now() < deadline) {
      const deliveries = await store.listDeliveries();
      if (gate.deliveries.length && deliveries.every(item => item.state === 'succeeded' || item.state === 'failed-terminal' || item.state === 'ambiguous')) break;
      await Bun.sleep(20);
    }
    if (!gate.deliveries.length) throw new Error('Local test did not produce a response');
    for await (const event of store.history({ toolsOnly: true, limit: 100 })) if (event.kind === 'tool_call_succeeded') context.stdout(`tool ${String(event.payload.tool ?? event.payload.toolName ?? 'completed')} succeeded\n`);
    for (const line of gate.deliveries) context.stdout(line + '\n');
    return 0;
  } finally {
    await runtime?.stop(); store?.close(); await mcp.close(); await native?.dispose(); release?.();
    await rm(temp, { recursive: true, force: true });
  }
}
