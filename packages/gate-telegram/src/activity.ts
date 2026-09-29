import type { Api } from 'grammy';
import { uiMessages, type ExternalDestination, type RunId, type UiLanguage } from '@vian/core';

type Activity = { destination: ExternalDestination; messageId?: number; frame: number; task: Promise<void>; timer?: ReturnType<typeof setInterval>; finished: boolean };

/** Best-effort UI, serialized separately from the durable answer outbox. */
export class TelegramActivity {
  private readonly active = new Map<RunId, Activity>();
  private readonly words;
  constructor(private readonly api: Api, language: UiLanguage = 'es', private readonly intervalMs = 1500) { this.words = uiMessages[language]; }

  private enqueue(state: Activity, action: () => Promise<unknown>): Promise<void> {
    state.task = state.task.then(action).then(() => {}, () => {});
    return state.task;
  }
  private edit(state: Activity, text: string): Promise<unknown> {
    if (state.messageId === undefined) return Promise.resolve();
    return this.api.editMessageText(state.destination.externalId, state.messageId, text, {}, AbortSignal.timeout(5000) as Parameters<Api['sendMessage']>[3]);
  }
  async start(runId: RunId, destination: ExternalDestination): Promise<void> {
    if (this.active.has(runId)) return;
    const state: Activity = { destination, frame: 1, task: Promise.resolve(), finished: false };
    this.active.set(runId, state);
    await this.enqueue(state, async () => {
      const sent = await this.api.sendMessage(destination.externalId, `${this.words.working}.`, { ...(destination.threadId ? { message_thread_id: Number(destination.threadId) } : {}), disable_notification: true }, AbortSignal.timeout(5000) as Parameters<Api['sendMessage']>[3]);
      state.messageId = sent.message_id;
    });
    if (this.active.get(runId) !== state || state.finished) return;
    if (state.messageId === undefined) { this.active.delete(runId); return; }
    let editing = false;
    state.timer = setInterval(() => {
      if (editing || state.finished) return;
      editing = true;
      state.frame = state.frame % 3 + 1;
      void this.enqueue(state, async () => {
        try { await this.edit(state, `${this.words.working}${'.'.repeat(state.frame)}`); }
        catch { // Stop animation on rejection/429; final cleanup remains available.
          if (state.timer) clearInterval(state.timer);
        }
      }).finally(() => { editing = false; });
    }, this.intervalMs);
  }
  async finish(runId: RunId, outcome: 'completed' | 'failed' | 'cancelled' | 'delivery-failed' | 'delivery-unknown'): Promise<void> {
    const state = this.active.get(runId);
    if (!state || (outcome === 'completed' && state.finished)) return;
    state.finished = true;
    if (state.timer) clearInterval(state.timer);
    const text = outcome === 'completed' ? this.words.done : outcome === 'failed' ? this.words.failed : outcome === 'cancelled' ? this.words.cancelled : outcome === 'delivery-unknown' ? this.words.deliveryUnknown : this.words.deliveryFailed;
    await this.enqueue(state, () => this.edit(state, text));
    // Retain completed/failed correlation until the final outbox message is delivered.
    if (outcome === 'cancelled') this.active.delete(runId);
  }
  async remove(runId: RunId): Promise<void> {
    const state = this.active.get(runId);
    if (!state) return;
    this.active.delete(runId);
    state.finished = true;
    if (state.timer) clearInterval(state.timer);
    await this.enqueue(state, async () => {
      if (state.messageId === undefined) return;
      try { await this.api.deleteMessage(state.destination.externalId, state.messageId, AbortSignal.timeout(5000) as Parameters<Api['sendMessage']>[3]); }
      catch { await this.edit(state, this.words.done); }
    });
  }
  async stop(): Promise<void> {
    await Promise.all([...this.active].map(([id, state]) => state.finished ? state.task : this.finish(id, 'cancelled')));
    this.active.clear();
  }
}
