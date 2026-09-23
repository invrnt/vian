import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { generateText, jsonSchema, stepCountIs, streamText, tool, type ModelMessage } from 'ai';
import type { ActionId, AttachmentId, AttachmentPort, AuditEvent, BotId, BotManifest, BotStore, CanonicalMessage, ConversationId, ExternalDestination, GateAdapter, InboxRecord, InboundEvent, MessageId, NativeToolSet, OutboxPart, PrincipalId, ProviderAdapter, RunId, SessionId, ToolCallId, ToolContext } from '@vian/core';
export { AccessService } from './access.ts';

export interface RuntimeDependencies {
  botId: BotId;
  botRoot: string;
  manifest: BotManifest;
  store: BotStore;
  gate: GateAdapter;
  provider: ProviderAdapter;
  tools?: NativeToolSet;
  attachments: AttachmentPort;
  /** Optional private services passed to trusted tools, never to the model. */
  services?: Record<string, unknown>;
  now?: () => Date;
  logger?: { info(message: string): void; error(message: string): void };
  /** The daemon may impose a lower shared limit. */
  globalRunPermit?: { acquire(): Promise<() => void> };
}

const asId = <T extends string>(value: string) => value as T;
const safeError = (error: unknown): string => error instanceof Error && error.name === 'AbortError' ? 'Generation stopped.' : 'The request could not be completed.';
const destinationKey = (destination: ExternalDestination): string => JSON.stringify([destination.gate, destination.externalId, destination.threadId ?? '']);
const textOf = (message: CanonicalMessage): string => message.parts.map(part => part.type === 'text' ? part.text : part.type === 'interaction' ? `${part.label}: ${JSON.stringify(part.value)}` : `[attachment: ${part.name ?? part.mimeType ?? 'file'}]`).join('\n');

/** One bot's canonical coordinator. All network actions follow durable store transitions. */
export class BotRuntime {
  private readonly active = new Map<SessionId, { runId: RunId; initiator: PrincipalId; abort: AbortController }>();
  private readonly scheduling = new Set<SessionId>();
  private readonly sending = new Set<string>();
  private readonly deliveryOperations = new Set<Promise<void>>();
  private readonly deliveryAbort = new Map<string, AbortController>();
  private readonly wake = new Set<SessionId>();
  private readonly capacityBlocked = new Set<SessionId>();
  private retryTimer?: ReturnType<typeof setTimeout>;
  private readonly now: () => Date;
  private readonly log: { info(message: string): void; error(message: string): void };
  private stopped = true;
  private runningCount = 0;
  private deliveryTask?: Promise<void>;
  private deliveryWake = false;

  constructor(readonly deps: RuntimeDependencies) {
    this.now = deps.now ?? (() => new Date());
    this.log = deps.logger ?? { info() {}, error() {} };
  }

  async start(): Promise<void> {
    if (!this.stopped) return;
    // Caller must hold exclusive process ownership for this bot before recovery clears persisted leases.
    this.stopped = false;
    try {
      await this.deps.store.recoverInterrupted();
      await this.deps.store.syncAdministrators(this.deps.manifest.gate.access.administratorPrincipalIds as PrincipalId[]);
      await this.deps.gate.validate();
      await this.deps.gate.start(event => this.accept(event), {
      botId: this.deps.botId,
      attachments: this.deps.attachments,
      actions: this.deps.store,
      resolveDestination: async conversationId => this.deps.store.destinationForConversation(conversationId),
      });
      for (const sessionId of await this.deps.store.listReadySessions()) this.schedule(sessionId);
      void this.flushDeliveries();
    } catch (error) {
      this.stopped = true;
      await this.deps.gate.stop().catch(() => {});
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    for (const run of this.active.values()) run.abort.abort();
    for (const abort of this.deliveryAbort.values()) abort.abort();
    await this.deps.gate.stop();
    await Promise.allSettled([...this.scheduling].map(async sessionId => {
      while (this.scheduling.has(sessionId)) await Bun.sleep(10);
    }));
    if (this.deliveryTask) await this.deliveryTask;
    await Promise.allSettled([...this.deliveryOperations]);
  }

  async accept(event: InboundEvent): Promise<void> {
    if (this.stopped) return;
    const principalId = await this.deps.store.resolveActor(event.actor);
    if (!principalId) {
      if (event.kind === 'message' && event.destination.externalId === event.actor.externalId && this.deps.manifest.gate.access.mode === 'pairing') {
        const created = await this.deps.store.createPairingNotice(event, new Date(this.now().getTime() + 10 * 60_000).toISOString());
        if (created.kind === 'ok') void this.flushDeliveries();
      }
      return;
    }
    const ctx = await this.deps.store.resolveDestination(event.destination, principalId);
    if (!ctx) return;
    const shared = event.destination.externalId !== event.actor.externalId;
    if (shared && !this.deps.manifest.gate.access.groups) return;
    if (event.control === 'new' || event.control === 'stop') {
      const authority = await this.deps.store.controlAuthority(ctx.conversationId, principalId);
      if (!authority || (shared && !authority.isAdministrator && principalId !== (event.control === 'new' ? authority.sessionInitiatorId : authority.activeRunInitiatorId))) return;
      if (event.control === 'stop') {
        const active = this.active.get(ctx.sessionId);
        if (active) active.abort.abort();
        return;
      }
    }
    if (event.control && event.control !== 'new') return;
    const accepted = await this.deps.store.acceptInbound(event);
    if (accepted.kind !== 'ok') return;
    this.schedule(accepted.value.sessionId!);
  }

  private schedule(sessionId: SessionId): void {
    this.wake.add(sessionId);
    if (this.scheduling.has(sessionId)) return;
    this.scheduling.add(sessionId);
    void this.drain(sessionId).catch(error => this.log.error(`Session scheduling failed: ${safeError(error)}`)).finally(() => {
      this.scheduling.delete(sessionId);
      if (!this.stopped && this.wake.has(sessionId) && !this.capacityBlocked.has(sessionId)) this.schedule(sessionId);
    });
  }

  private async drain(sessionId: SessionId): Promise<void> {
    while (!this.stopped) {
      this.wake.delete(sessionId);
      if (this.active.has(sessionId)) return;
      if (this.runningCount >= this.deps.manifest.runtime.perBotConcurrency) {
        this.capacityBlocked.add(sessionId);
        this.wake.add(sessionId);
        return;
      }
      this.capacityBlocked.delete(sessionId);
      const holder = randomUUID();
      const lease = { sessionId, holder, expiresAt: new Date(this.now().getTime() + this.deps.manifest.runtime.runTimeoutSeconds * 1000 + 30_000).toISOString() };
      const claimed = await this.deps.store.claimNext(sessionId, holder, lease.expiresAt);
      if (claimed.kind !== 'ok') return;
      const input = claimed.value;
      if (!input) { await this.deps.store.releaseLease(lease); return; }
      if (input.event.control === 'new') {
        const principalId = await this.deps.store.resolveActor(input.event.actor);
        const ctx = principalId && await this.deps.store.resolveDestination(input.event.destination, principalId);
        if (ctx) {
          const reset = await this.deps.store.applyResetBarrier(ctx.conversationId, input.id);
          if (reset.kind === 'ok') this.schedule(reset.value);
        }
        await this.deps.store.releaseLease(lease);
        continue;
      }
      const principalId = await this.deps.store.resolveActor(input.event.actor);
      if (!principalId) {
        await this.deps.store.rejectInbound(input.id, 'Actor binding revoked');
        await this.deps.store.releaseLease(lease);
        continue;
      }
      const runId = asId<RunId>(randomUUID());
      const begun = await this.deps.store.beginRun(runId, input, principalId);
      if (begun.kind !== 'ok') { await this.deps.store.releaseLease(lease); return; }
      const abort = new AbortController();
      this.active.set(sessionId, { runId, initiator: principalId, abort });
      this.runningCount++;
      let releaseGlobal: (() => void) | undefined;
      try {
        releaseGlobal = await this.deps.globalRunPermit?.acquire();
        await this.execute(runId, input, principalId, abort.signal);
      }
      catch (error) {
        let failure: CanonicalMessage | undefined;
        let failureParts: OutboxPart[] | undefined;
        if (!abort.signal.aborted) {
          const stillBound = await this.deps.store.resolveActor(input.event.actor);
          const context = stillBound === principalId && await this.deps.store.resolveDestination(input.event.destination, principalId);
          if (context && context.sessionId === sessionId) {
            try {
              failure = { id: asId<MessageId>(randomUUID()), botId: this.deps.botId, conversationId: context.conversationId, sessionId, runId, role: 'assistant', parts: [{ type: 'text', text: 'The request could not be completed. Please try again.' }], createdAt: this.now().toISOString() };
              const rendered = await this.deps.gate.render(failure);
              failureParts = rendered.map(part => ({ id: randomUUID(), botId: this.deps.botId, messageId: failure!.id, destination: input.event.destination, part, state: 'queued', attempt: 0 }));
            } catch { failure = undefined; failureParts = undefined; }
          }
        }
        await this.deps.store.finishRun(runId, abort.signal.aborted ? 'cancelled' : 'failed', { safeMessage: safeError(error) }, failure, failureParts);
        if (failureParts?.length) void this.flushDeliveries();
        this.log.error(`Run ${runId} failed: ${safeError(error)}`);
      } finally {
        releaseGlobal?.();
        this.runningCount--;
        this.active.delete(sessionId);
        await this.deps.store.releaseLease(lease);
        for (const pending of this.capacityBlocked) if (pending !== sessionId) {
          this.capacityBlocked.delete(pending);
          this.schedule(pending);
        }
      }
    }
  }

  private async execute(runId: RunId, input: InboxRecord, principalId: PrincipalId, signal: AbortSignal): Promise<void> {
    const sessionId = input.sessionId!;
    const ctx = await this.deps.store.resolveDestination(input.event.destination, principalId);
    if (!ctx) throw new Error('Authorization changed');
    const model = await this.deps.provider.resolveModel({ botId: this.deps.botId, botRoot: this.deps.botRoot, modelId: this.deps.manifest.model.id, credential: this.deps.manifest.model.credential });
    const instructions = await readFile(resolve(this.deps.botRoot, this.deps.manifest.instructions), 'utf8');
    const availableAttachments = new Set<AttachmentId>(input.event.parts?.filter(part => part.type === 'attachment').map(part => part.attachmentId) ?? []);
    const attachmentTools: NativeToolSet = {
      list_attachments: {
        description: 'List attachments available in the current conversation.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        execute: async () => this.deps.attachments.list(this.deps.botId, [...availableAttachments]),
      },
      send_attachment: {
        description: 'Send an available attachment to this conversation.',
        inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false },
        execute: async args => {
          const id = (args as { id: string }).id as AttachmentId;
          if (!(await this.deps.attachments.list(this.deps.botId, [id])).length) throw new Error('Attachment unavailable');
          return { kind: 'attachment-send', attachmentId: id };
        },
      },
    };
    const gateTools = this.deps.gate.modelTools?.() ?? {};
    for (const name of Object.keys(gateTools)) if (this.deps.tools?.[name]) throw new Error(`Duplicate tool name: ${name}`);
    for (const name of Object.keys(attachmentTools)) if (this.deps.tools?.[name] || gateTools[name]) throw new Error(`Duplicate tool name: ${name}`);
    const modelTools = { ...this.deps.tools, ...gateTools, ...attachmentTools };
    const previous = await this.contextMessages(sessionId, input.messageId!, model);
    const summaryContext = previous.filter(message => message.role === 'system').map(message => message.content).join('\n');
    const messages: ModelMessage[] = [...previous.filter(message => message.role !== 'system'), { role: 'user', content: textOf({ id: input.messageId!, botId: this.deps.botId, conversationId: ctx.conversationId, sessionId, principalId, runId, role: 'user', parts: input.event.parts ?? [], createdAt: input.acceptedAt }) }];
    const toolOutput: unknown[] = [];
    const converted = Object.fromEntries(Object.entries(modelTools).map(([name, native]) => [name, tool({
      description: native.description,
      inputSchema: jsonSchema(native.inputSchema),
      execute: async (args: unknown, options: { abortSignal?: AbortSignal }) => {
        const callId = asId<ToolCallId>(randomUUID());
        const auditArgs = native.audit === 'metadata-only' ? { redacted: true } : { input: args };
        await this.deps.store.transitionTool(callId, runId, 'pending', { tool: name, ...auditArgs });
        await this.deps.store.transitionTool(callId, runId, 'started', { tool: name, ...auditArgs });
        const context: ToolContext = { botId: this.deps.botId, principalId, conversationId: ctx.conversationId, sessionId, runId, toolCallId: callId, idempotencyKey: callId, abortSignal: options.abortSignal ?? signal, attachments: { register: registration => this.deps.attachments.register(this.deps.botId, registration) }, logger: this.log, services: this.deps.services ?? {} };
        try {
          const value = await native.execute(args, context);
          const auditResult = native.audit === 'metadata-only' ? { redacted: true } : { result: value };
          await this.deps.store.transitionTool(callId, runId, 'succeeded', { tool: name, ...auditResult });
          toolOutput.push(value);
          if (value && typeof value === 'object' && 'attachment' in value) {
            const attachment = value.attachment as { id?: AttachmentId } | undefined;
            if (attachment?.id) availableAttachments.add(attachment.id);
          }
          return value;
        } catch (error) {
          await this.deps.store.transitionTool(callId, runId, 'failed', { tool: name, safeMessage: safeError(error) });
          return { error: safeError(error) };
        }
      },
    })]));
    const draft = this.deps.gate.draft;
    let draftId: string | undefined;
    let streamed = '';
    let streamFailed = false;
    const startedAt = this.now().getTime();
    const result = streamText({
      model,
      instructions: `You are Vian. Follow the bot instructions. Current principal: ${principalId}. Gate capabilities: ${JSON.stringify(this.deps.gate.capabilities())}. Attachment handles are opaque. Never expose private paths or hidden reasoning.\n\n${instructions}\n\n${summaryContext}\n\n${this.deps.gate.modelContext?.() ?? ''}`,
      messages,
      tools: converted,
      stopWhen: stepCountIs(this.deps.manifest.runtime.maxSteps),
      timeout: { totalMs: this.deps.manifest.runtime.runTimeoutSeconds * 1000 },
      abortSignal: signal,
      onError: () => { streamFailed = true; },
      onStepFinish: async step => {
        await this.deps.store.appendAudit({ id: asId(randomUUID()), botId: this.deps.botId, conversationId: ctx.conversationId, sessionId, runId, principalId, kind: 'model_step', at: this.now().toISOString(), payload: { provider: this.deps.provider.id, model: this.deps.manifest.model.id, finishReason: step.finishReason, usage: step.usage, latencyMs: this.now().getTime() - startedAt } });
      },
      prepareStep: async ({ stepNumber, messages: current }) => {
        if (stepNumber === 0 || this.deps.manifest.runtime.sameSessionPolicy !== 'steer') return {};
        const batch = await this.deps.store.claimSteeringBatch(runId, sessionId, 16);
        if (!batch.messages.length) return {};
        return { messages: [...current, ...batch.messages.map(message => ({ role: 'user' as const, content: textOf(message) }))] };
      },
    });
    try {
      for await (const chunk of result.textStream) {
        streamed += chunk;
        if (draft && this.deps.gate.capabilities().streaming) {
          try { draftId = await draft.call(this.deps.gate, runId, input.event.destination, streamed) ?? draftId; }
          catch { /* Draft transport failure does not discard durable final output. */ }
        }
      }
      if (signal.aborted) throw new DOMException('Generation stopped', 'AbortError');
      if (streamFailed) throw new Error('Provider stream failed');
      const finalText = await result.text;
      const presentation = toolOutput.flatMap(value => {
        if (!value || typeof value !== 'object' || !('kind' in value) || value.kind !== 'telegram-buttons') return [];
        const p = value as { text?: unknown; rows?: unknown };
        if (typeof p.text !== 'string' || !Array.isArray(p.rows)) return [];
        return [p as { text: string; rows: { label: string; actionId: ActionId }[][] }];
      }).at(-1);
      const sentAttachments = toolOutput.flatMap(value => value && typeof value === 'object' && 'kind' in value && value.kind === 'attachment-send' && 'attachmentId' in value ? [value.attachmentId as AttachmentId] : []);
      const files = await this.deps.attachments.list(this.deps.botId, sentAttachments);
      const finalMessage: CanonicalMessage = { id: asId<MessageId>(randomUUID()), botId: this.deps.botId, conversationId: ctx.conversationId, sessionId, runId, role: 'assistant', parts: [{ type: 'text', text: presentation?.text ?? finalText }, ...files.map(file => ({ type: 'attachment' as const, attachmentId: file.id, name: file.name, mimeType: file.mimeType }))], createdAt: this.now().toISOString() };
      const rendered = await this.deps.gate.render(finalMessage);
      if (presentation?.rows.length && rendered[0]) rendered[0].buttons = presentation.rows;
      const parts: OutboxPart[] = rendered.map(part => ({ id: randomUUID(), botId: this.deps.botId, messageId: finalMessage.id, destination: input.event.destination, part, state: 'queued', attempt: 0 }));
      const completed = await this.deps.store.completeRun(runId, finalMessage, parts);
      if (completed.kind !== 'ok') throw new Error(completed.reason);
      void this.flushDeliveries();
    } finally {
      if (draftId) await this.deps.gate.stopDraft?.(draftId).catch(() => {});
    }
  }

  private async contextMessages(sessionId: SessionId, currentMessageId: MessageId, model: Parameters<typeof generateText>[0]['model']): Promise<ModelMessage[]> {
    const summary = await this.deps.store.readSummary(sessionId);
    const records: AuditEvent[] = [];
    let afterSequence = summary?.throughSequence;
    while (true) {
      let read = 0;
      for await (const event of this.deps.store.history({ sessionId, afterSequence, limit: 1000 })) {
        records.push(event);
        afterSequence = event.sequence;
        read++;
      }
      if (read < 1000) break;
    }
    const max = this.deps.manifest.context.maxRecentMessages;
    const accepted = new Map<MessageId, InboundEvent>();
    const transcript: { sequence: number; message: ModelMessage }[] = [];
    for (const event of records) {
      if (event.kind === 'inbound_message' && event.payload.messageId && event.payload.event) accepted.set(event.payload.messageId as MessageId, event.payload.event as InboundEvent);
      if (event.kind === 'run_started' || event.kind === 'inbound_consumed') {
        const id = event.payload.messageId as MessageId | undefined;
        const inbound = id && accepted.get(id);
        if (inbound && id !== currentMessageId) transcript.push({ sequence: event.sequence, message: { role: 'user', content: inbound.parts?.map(part => part.type === 'text' ? part.text : part.type === 'interaction' ? `${part.label}: ${JSON.stringify(part.value)}` : '[attachment]').join('\n') ?? '' } });
      }
      if (event.kind === 'assistant_message') {
        const message = event.payload.message as CanonicalMessage | undefined;
        if (message) transcript.push({ sequence: event.sequence, message: { role: 'assistant', content: textOf(message) } });
      }
    }
    if (transcript.length > max) {
      const older = transcript.slice(0, -max);
      try {
        const result = await generateText({ model, system: 'Summarize the earlier conversation faithfully and concisely. Do not include hidden reasoning or credentials.', messages: older.map(item => item.message), timeout: { totalMs: 15_000 } });
        if (result.text.trim()) {
          await this.deps.store.appendSummary(sessionId, [summary?.text, result.text.trim()].filter(Boolean).join('\n'), older.at(-1)!.sequence);
          return [{ role: 'system', content: `Earlier conversation summary: ${[summary?.text, result.text.trim()].filter(Boolean).join('\n')}` }, ...transcript.slice(-max).map(item => item.message)];
        }
      } catch { /* Recent tail remains usable when summarization fails. */ }
    }
    return [...(summary ? [{ role: 'system' as const, content: `Earlier conversation summary: ${summary.text}` }] : []), ...transcript.slice(-max).map(item => item.message)];
  }

  async flushDeliveries(): Promise<void> {
    if (this.deliveryTask) { this.deliveryWake = true; return this.deliveryTask; }
    this.deliveryWake = false;
    this.deliveryTask = this.deliverPending().finally(() => {
      this.deliveryTask = undefined;
      if (this.deliveryWake && !this.stopped) void this.flushDeliveries();
    });
    return this.deliveryTask;
  }

  private async deliverPending(): Promise<void> {
    while (!this.stopped) {
      const all = await this.deps.store.listDeliveries();
      const firstByDestination = new Map<string, OutboxPart>();
      for (const part of all) {
        if (part.state === 'succeeded' || part.state === 'failed-terminal') continue;
        const key = destinationKey(part.destination);
        if (!firstByDestination.has(key)) firstByDestination.set(key, part);
      }
      const due = [...firstByDestination].filter(([key, part]) => !this.sending.has(key) && (part.state === 'queued' || part.state === 'failed-retryable') && (!part.nextAttemptAt || part.nextAttemptAt <= this.now().toISOString()));
      const tasks = due.map(async ([key, part]) => {
        this.sending.add(key);
        const abort = new AbortController();
        this.deliveryAbort.set(key, abort);
        try {
          const sending = await this.deps.store.updateDelivery(part.id, 'sending');
          if (sending.kind !== 'ok') return;
          let outcome;
          try { outcome = await this.deps.gate.deliver(part.part, part.destination, abort.signal, { botId: this.deps.botId, attachments: this.deps.attachments }); }
          catch { outcome = { kind: 'ambiguous' as const, safeMessage: 'Delivery result is unknown.' }; }
          if (outcome.kind === 'succeeded') await this.deps.store.updateDelivery(part.id, 'succeeded', { receipt: outcome.receipt });
          else if (outcome.kind === 'ambiguous') await this.deps.store.updateDelivery(part.id, 'ambiguous', { safeError: outcome.safeMessage });
          else await this.deps.store.updateDelivery(part.id, outcome.retryable ? 'failed-retryable' : 'failed-terminal', { safeError: outcome.safeMessage, nextAttemptAt: outcome.retryable ? new Date(this.now().getTime() + Math.max(outcome.retryAfterMs ?? 1000, 1000)).toISOString() : undefined });
        } finally {
          this.sending.delete(key);
          this.deliveryAbort.delete(key);
          if (!this.stopped) void this.flushDeliveries();
        }
      });
      if (!tasks.length) {
        const times = [...firstByDestination.values()].filter(part => part.state === 'failed-retryable' && part.nextAttemptAt).map(part => Date.parse(part.nextAttemptAt!));
        const next = Math.min(...times);
        if (Number.isFinite(next) && !this.stopped) {
          if (this.retryTimer) clearTimeout(this.retryTimer);
          this.retryTimer = setTimeout(() => { void this.flushDeliveries(); }, Math.max(0, next - this.now().getTime()));
        }
        return;
      }
      for (const task of tasks) {
        this.deliveryOperations.add(task);
        void task.catch(error => this.log.error(`Delivery failed: ${safeError(error)}`)).finally(() => this.deliveryOperations.delete(task));
      }
      return;
    }
  }
}
