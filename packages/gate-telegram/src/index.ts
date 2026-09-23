import { Bot, GrammyError, InputFile } from 'grammy';
import type { ActionId, BotId, CanonicalMessage, DeliveryOutcome, ExternalActor, ExternalDestination, GateAdapter, GateCapabilities, GateDeliveryContext, GateRuntimePorts, InboundEvent, NativeToolSet, RenderedPart, RunId } from '@vian/core';
import { chunkMarkdown, escapeMarkdownV2, renderMarkdownV2 } from './render.ts';
import { normalizeMessage, type NormalizePolicy, type TelegramUpdate } from './normalize.ts';

export { chunkMarkdown, escapeMarkdownV2, renderMarkdownV2 } from './render.ts';
export { normalizeMessage, type NormalizePolicy, type TelegramUpdate } from './normalize.ts';

export interface TelegramGateOptions {
  token: string;
  botId: BotId;
  groupsEnabled?: boolean;
  approvedChatIds?: ReadonlySet<string>;
  approvedUserIds?: ReadonlySet<string>;
  now?: () => Date;
  fetch?: typeof fetch;
  /** For deterministic HTTP boundary tests. */
  bot?: Bot;
  onFatal?: (error: unknown) => void;
  retryDelayMs?: number;
}

/** Runtime persists this intent with the final canonical answer and ordered outbox. */
export interface TelegramButtonPresentation { kind: 'telegram-buttons'; text: string; rows: { label: string; actionId: ActionId }[][] }

const MAX_INBOUND_BYTES = 20 * 1024 * 1024;
const ACTION_TTL_MS = 10 * 60 * 1000;
const DRAFT_REFRESH_MS = 20_000;

function destinationKey(destination: ExternalDestination): string { return `${destination.externalId}:${destination.threadId ?? ''}`; }
function numericId(value: string): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number)) throw new Error('Telegram destination must be a numeric ID');
  return number;
}
function thread(destination: ExternalDestination): { message_thread_id?: number } {
  return destination.threadId ? { message_thread_id: numericId(destination.threadId) } : {};
}

export function classifyTelegramFailure(error: unknown): DeliveryOutcome {
  if (error instanceof GrammyError) {
    const retryAfter = error.parameters?.retry_after;
    if (error.error_code === 429) return { kind: 'confirmed-failure', retryable: true, safeMessage: 'Telegram rate limit', ...(retryAfter ? { retryAfterMs: retryAfter * 1000 } : {}) };
    if (error.error_code >= 500) return { kind: 'confirmed-failure', retryable: true, safeMessage: 'Telegram server rejected delivery' };
    return { kind: 'confirmed-failure', retryable: false, safeMessage: 'Telegram rejected delivery' };
  }
  // The request may have reached Telegram before a connection reset or lost response.
  return { kind: 'ambiguous', safeMessage: 'Telegram delivery outcome unknown' };
}

export class TelegramGate implements GateAdapter {
  readonly type = 'telegram' as const;
  readonly bot: Bot;
  private readonly now: () => Date;
  private readonly fetcher: typeof fetch;
  private readonly policy: NormalizePolicy;
  private readonly drafts = new Map<string, { id: number; destination: ExternalDestination; text: string; sentAt: number; timer?: ReturnType<typeof setInterval> }>();
  private readonly stopped = new Set<number>();
  private onInbound?: (event: InboundEvent) => Promise<void>;
  private polling?: Promise<void>;
  private started = false;
  private pollAbort?: AbortController;
  private readonly penaltyUntil = new Map<string, number>();
  private ports?: GateRuntimePorts;

  constructor(private readonly options: TelegramGateOptions) {
    this.bot = options.bot ?? new Bot(options.token);
    this.now = options.now ?? (() => new Date());
    this.fetcher = options.fetch ?? fetch;
    this.policy = { groupsEnabled: options.groupsEnabled ?? false, approvedChatIds: options.approvedChatIds ?? new Set(), approvedUserIds: options.approvedUserIds ?? new Set() };
    this.bot.on('message', async ctx => { await this.handleUpdate(ctx.update as TelegramUpdate); });
    this.bot.on('callback_query', async ctx => {
      // Client progress must not wait for model execution or durable queue work.
      await ctx.answerCallbackQuery().catch(() => undefined);
      await this.handleUpdate(ctx.update as TelegramUpdate);
    });
    this.bot.on('stopped_message_generation', async ctx => { await this.handleUpdate(ctx.update as TelegramUpdate); });
  }

  capabilities(): GateCapabilities { return { text: true, formatting: ['MarkdownV2'], streaming: true, stopGeneration: true, buttons: true, attachments: true, replies: true, groups: this.policy.groupsEnabled, threads: this.policy.groupsEnabled }; }
  async validate(): Promise<void> { const me = await this.bot.api.getMe(); this.policy.botId = me.id; this.policy.botUsername = me.username; }

  async start(onInbound: (event: InboundEvent) => Promise<void>, ports: GateRuntimePorts): Promise<void> {
    if (this.started) return;
    this.onInbound = onInbound;
    this.ports = ports;
    if (ports.botId !== this.options.botId) throw new Error('Telegram bot scope mismatch');
    await this.bot.init();
    this.policy.botId = this.bot.botInfo.id;
    this.policy.botUsername = this.bot.botInfo.username;
    this.started = true;
    this.pollAbort = new AbortController();
    this.polling = this.pollLoop();
  }
  private async pollLoop(): Promise<void> {
    let offset = 0;
    while (this.started) {
      try {
        const updates = await this.bot.api.getUpdates({ offset, timeout: 20, allowed_updates: ['message', 'callback_query', 'stopped_message_generation'] }, this.pollAbort?.signal as never);
        for (const update of updates) {
          if (!this.started) break;
          // Telegram confirms updates only when the next getUpdates offset advances.
          // A failed durable-ingestion callback leaves this offset unchanged for replay.
          await this.bot.handleUpdate(update);
          offset = update.update_id + 1;
        }
      } catch (error) {
        if (!this.started) break;
        this.options.onFatal?.(error);
        await new Promise(resolve => setTimeout(resolve, this.options.retryDelayMs ?? 1000));
      }
    }
  }
  async stop(): Promise<void> {
    for (const draft of this.drafts.values()) if (draft.timer) clearInterval(draft.timer);
    this.drafts.clear();
    this.started = false;
    this.pollAbort?.abort();
    await this.polling;
    this.pollAbort = undefined;
  }

  /** Used by deterministic HTTP fixtures and by grammY long polling. */
  async handleUpdate(update: TelegramUpdate): Promise<void> {
    if (!this.onInbound) return;
    if (update.message) {
      const event = normalizeMessage(update, this.policy, this.now());
      if (!event) return;
      const media = update.message.photo?.at(-1) ?? update.message.document;
      if (media && this.ports) {
        const file = await this.bot.api.getFile(media.file_id);
        if (!file.file_path || (media.file_size ?? 0) > MAX_INBOUND_BYTES) throw new Error('Telegram attachment unavailable or too large');
        const response = await this.fetcher(`https://api.telegram.org/file/bot${this.options.token}/${file.file_path}`);
        if (!response.ok || !response.body) throw new Error('Telegram attachment download failed');
        const name = 'file_name' in media && typeof media.file_name === 'string' ? media.file_name : 'photo.jpg';
        const mimeType = 'mime_type' in media && typeof media.mime_type === 'string' ? media.mime_type : 'image/jpeg';
        let received = 0;
        const limited = response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({ transform(chunk, controller) { received += chunk.byteLength; if (received > MAX_INBOUND_BYTES) throw new Error('Telegram attachment too large'); controller.enqueue(chunk); } }));
        const saved = await this.ports.attachments.ingest(this.options.botId, { name, mimeType, size: media.file_size ?? 0, bytes: limited });
        event.parts ??= [];
        event.parts.push({ type: 'attachment', attachmentId: saved.id, name: saved.name, mimeType: saved.mimeType });
      }
      // onInbound resolves only after the runtime has durably accepted the update.
      await this.onInbound(event);
      return;
    }
    if (update.callback_query) {
      const query = update.callback_query;
      if (!query.message || !query.data || new TextEncoder().encode(query.data).byteLength > 64) return;
      const message = query.message;
      if (message.chat.type !== 'private' && (!this.policy.groupsEnabled || !this.policy.approvedChatIds.has(String(message.chat.id)) || !this.policy.approvedUserIds.has(String(query.from.id)))) return;
      const destination: ExternalDestination = { gate: 'telegram', externalId: String(message.chat.id), ...(message.message_thread_id ? { threadId: String(message.message_thread_id) } : {}) };
      const actor: ExternalActor = { gate: 'telegram', externalId: String(query.from.id), displayName: query.from.first_name };
      await this.onInbound({ gate: 'telegram', externalEventId: String(update.update_id), actor, destination, receivedAt: this.now().toISOString(), kind: 'callback', callbackData: query.data,
        metadata: { callbackQueryId: query.id, externalMessageId: String(message.message_id) } });
      return;
    }
    const stop = update.stopped_message_generation;
    if (stop && stop.chat.type === 'private' && !this.stopped.has(stop.draft_id)) {
      const correlation = [...this.drafts.entries()].find(([, item]) => item.id === stop.draft_id && item.destination.externalId === String(stop.chat.id) && item.destination.threadId === (stop.message_thread_id ? String(stop.message_thread_id) : undefined));
      if (!correlation) return;
      const [runId, draft] = correlation;
      this.stopped.add(stop.draft_id);
      // Private-chat numeric ID is the sender identity. Group stop updates have no actor and are dropped.
      await this.onInbound({ gate: 'telegram', externalEventId: String(update.update_id), actor: { gate: 'telegram', externalId: String(stop.chat.id) }, destination: draft.destination,
        receivedAt: this.now().toISOString(), kind: 'control', control: 'stop', metadata: { draftId: stop.draft_id, runId } });
    }
  }

  async render(message: CanonicalMessage): Promise<RenderedPart[]> {
    const parts: RenderedPart[] = [];
    for (const content of message.parts) {
      if (content.type === 'text') for (const chunk of chunkMarkdown(content.text)) parts.push({ partIndex: parts.length, kind: 'text', text: chunk.plain });
      else if (content.type === 'attachment' && this.ports) {
        const [attachment] = await this.ports.attachments.list(message.botId, [content.attachmentId]);
        if (attachment) parts.push({ partIndex: parts.length, kind: 'file', attachment });
      }
    }
    return parts;
  }

  async deliver(part: RenderedPart, destination: ExternalDestination, signal: AbortSignal, context: GateDeliveryContext): Promise<DeliveryOutcome> {
    const key = destinationKey(destination);
    const remaining = (this.penaltyUntil.get(key) ?? 0) - this.now().getTime();
    if (remaining > 0) return { kind: 'confirmed-failure', retryable: true, safeMessage: 'Telegram rate limit', retryAfterMs: remaining };
    if (signal.aborted) return { kind: 'confirmed-failure', retryable: false, safeMessage: 'Delivery cancelled before send' };
    try {
      const chatId = numericId(destination.externalId);
      const reply_parameters = part.replyToExternalId ? { message_id: numericId(part.replyToExternalId) } : undefined;
      let sent: { message_id: number };
      if (part.kind === 'text') {
        if (!part.text) return { kind: 'confirmed-failure', retryable: false, safeMessage: 'Empty Telegram text' };
        const base = { ...thread(destination), ...(reply_parameters ? { reply_parameters } : {}) };
        try { sent = await this.bot.api.sendMessage(chatId, renderMarkdownV2(part.text), { ...base, parse_mode: 'MarkdownV2', ...(part.buttons ? { reply_markup: { inline_keyboard: part.buttons.map(row => row.map(button => ({ text: button.label, callback_data: button.actionId }))) } } : {}) }); }
        catch (error) {
          if (!(error instanceof GrammyError) || error.error_code !== 400 || !/parse|entit|format/i.test(error.description)) throw error;
          // The formatting request was explicitly rejected. A plain retry cannot duplicate it.
          sent = await this.bot.api.sendMessage(chatId, part.text, { ...base, ...(part.buttons ? { reply_markup: { inline_keyboard: part.buttons.map(row => row.map(button => ({ text: button.label, callback_data: button.actionId }))) } } : {}) });
        }
      } else {
        if (!part.attachment) return { kind: 'confirmed-failure', retryable: false, safeMessage: 'Attachment unavailable' };
        const maxUpload = part.attachment.mimeType.startsWith('image/') ? 10 * 1024 * 1024 : 50 * 1024 * 1024;
        if (part.attachment.size > maxUpload) return { kind: 'confirmed-failure', retryable: false, safeMessage: 'Telegram file limit exceeded' };
        const opened = await context.attachments.open(context.botId, part.attachment.id);
        try {
          const input = new InputFile(opened.stream as AsyncIterable<Uint8Array>, part.attachment.name);
          const base = { ...thread(destination), ...(reply_parameters ? { reply_parameters } : {}) };
          sent = part.attachment.mimeType.startsWith('image/')
            ? await this.bot.api.sendPhoto(chatId, input, base)
            : await this.bot.api.sendDocument(chatId, input, base);
        } finally { await opened.release(); }
      }
      return { kind: 'succeeded', receipt: { externalId: String(sent.message_id), sentAt: this.now().toISOString() } };
    } catch (error) {
      const outcome = classifyTelegramFailure(error);
      if (outcome.kind === 'confirmed-failure' && outcome.retryAfterMs) this.penaltyUntil.set(key, this.now().getTime() + outcome.retryAfterMs);
      return outcome;
    }
  }

  async draft(runId: RunId, destination: ExternalDestination, text: string): Promise<string | undefined> {
    if (destination.externalId.startsWith('-')) return; // Bot API drafts target private chats only.
    const key = String(runId);
    const now = this.now().getTime();
    let state = this.drafts.get(key);
    if (!state) {
      const id = crypto.getRandomValues(new Uint32Array(1))[0]! || 1;
      state = { id, destination, text: '', sentAt: 0 };
      this.drafts.set(key, state);
      state.timer = setInterval(() => { const active = this.drafts.get(key); if (active) void this.sendDraft(active).catch(() => undefined); }, DRAFT_REFRESH_MS);
    }
    const previousLength = state.text.length;
    state.text = text;
    const elapsed = now - state.sentAt;
    if (elapsed >= 350 || text.length - previousLength >= 80) await this.sendDraft(state);
    return `${key}:${state.id}`;
  }
  private async sendDraft(state: { id: number; destination: ExternalDestination; text: string; sentAt: number }): Promise<void> {
    const text = chunkMarkdown(state.text).at(-1)?.markdown ?? '';
    await this.bot.api.sendMessageDraft(numericId(state.destination.externalId), state.id, text, { ...thread(state.destination), can_stop: true, keep_on_stop: false, parse_mode: 'MarkdownV2' });
    state.sentAt = this.now().getTime();
  }
  async stopDraft(draftId: string): Promise<void> {
    const key = draftId.split(':')[0]!;
    const draft = this.drafts.get(key);
    if (draft?.timer) clearInterval(draft.timer);
    if (draft) this.stopped.delete(draft.id);
    this.drafts.delete(key);
  }
  modelContext(): string { return 'Current Gate: Telegram. Write ordinary Markdown. Files and interactive buttons are available only through authorized tools. Live draft streaming is automatic.'; }
  modelTools(): NativeToolSet {
    if (!this.ports) return {};
    const actions = this.ports.actions;
    const resolveDestination = this.ports.resolveDestination;
    return { telegram_present_buttons: {
      description: 'Present a small set of choices as Telegram inline buttons.',
      inputSchema: { type: 'object', additionalProperties: false, required: ['text', 'rows'], properties: { text: { type: 'string', minLength: 1 }, rows: { type: 'array', minItems: 1, maxItems: 8, items: { type: 'array', minItems: 1, maxItems: 8, items: { type: 'object', additionalProperties: false, required: ['label', 'value'], properties: { label: { type: 'string', minLength: 1, maxLength: 60 }, value: {} } } } } } },
      async execute(input, context) {
        const request = input as { text: string; rows: { label: string; value: unknown }[][] };
        const expiresAt = new Date(Date.now() + ACTION_TTL_MS).toISOString();
        const destination = await resolveDestination(context.conversationId);
        if (!destination) throw new Error('Telegram destination unavailable');
        const rows = await Promise.all(request.rows.map(async row => Promise.all(row.map(async button => ({ label: button.label, actionId: await actions.createAction({ botId: context.botId, conversationId: context.conversationId, sessionId: context.sessionId, principalId: context.principalId, destination, label: button.label, value: button.value, expiresAt }) })))));
        return { kind: 'telegram-buttons', text: request.text, rows } satisfies TelegramButtonPresentation;
      }, audit: 'metadata-only' as const,
    } };
  }
}
