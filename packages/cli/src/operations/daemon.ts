import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:net';
import { dirname } from 'node:path';
import { CONTROL_MAX_BYTES, CONTROL_VERSION, encodeControl, type ControlRequest, type ControlResponse, type RegistryRecord } from '@vian/core';
import { SqliteRegistry } from '@vian/storage';
import { registryPath, socketPath } from '../local/common.ts';
import { assembleBot, validateBot, type AssembledBot } from './assemble.ts';
import { appendLog } from './logs.ts';

type BotState = { record: RegistryRecord; instance?: AssembledBot; error?: string };
const operations = new Set(['load', 'start', 'stop', 'restart', 'status', 'shutdown']);
function safeOperationalError(error: unknown): string {
  const value = error instanceof Error ? error.message : 'Bot operation failed';
  return value.replace(/\b\d{6,}:[A-Za-z0-9_-]{20,}\b/g, '[redacted]').replace(/\bsk-[A-Za-z0-9_-]{16,}\b/g, '[redacted]');
}
export class RunPermit {
  private active = 0;
  private readonly waiting: Array<{ resolve(release: () => void): void; reject(error: Error): void; signal?: AbortSignal }> = [];
  constructor(private readonly limit: number) {}
  acquire(signal?: AbortSignal): Promise<() => void> {
    if (signal?.aborted) return Promise.reject(new DOMException('Generation stopped', 'AbortError'));
    if (this.active < this.limit) { this.active++; return Promise.resolve(() => this.release()); }
    return new Promise((resolve, reject) => {
      const item = { resolve, reject, signal };
      this.waiting.push(item);
      signal?.addEventListener('abort', () => {
        const index = this.waiting.indexOf(item);
        if (index >= 0) { this.waiting.splice(index, 1); reject(new DOMException('Generation stopped', 'AbortError')); }
      }, { once: true });
    });
  }
  private release(): void { const next = this.waiting.shift(); if (next) next.resolve(() => this.release()); else this.active--; }
}

export class VianDaemon {
  private readonly bots = new Map<string, BotState>();
  private registry?: SqliteRegistry;
  private server?: Server;
  private stopping = false;
  private maintenance?: ReturnType<typeof setInterval>;
  private daemonLock?: () => void;
  private readonly runs = new RunPermit(16);
  constructor(private readonly dependencies: { assemble?: typeof assembleBot; validate?: typeof validateBot } = {}) {}

  private record(selector: string): BotState | undefined { return [...this.bots.values()].find(x => x.record.id === selector || x.record.alias === selector); }
  private async refreshRecord(selector: string): Promise<BotState | undefined> {
    const record = await this.registry!.get(selector);
    if (!record) return;
    const existing = this.bots.get(record.id);
    if (existing) { existing.record = record; return existing; }
    const state = { record };
    this.bots.set(record.id, state);
    return state;
  }
  private async startBot(state: BotState): Promise<void> {
    if (state.instance) return;
    try {
      const root = state.record.path;
      state.instance = await (this.dependencies.assemble ?? assembleBot)(state.record, { info: message => appendLog(root, 'info', message), error: message => appendLog(root, 'error', message) }, this.runs);
      state.error = undefined;
      appendLog(root, 'info', 'bot_started');
    } catch (error) {
      state.error = safeOperationalError(error);
      if (existsSync(state.record.path)) appendLog(state.record.path, 'error', `bot_start_failed: ${state.error}`);
      throw error;
    }
  }
  private async stopBot(state: BotState): Promise<void> {
    if (!state.instance) return;
    const instance = state.instance;
    state.instance = undefined;
    await instance.close();
    appendLog(state.record.path, 'info', 'bot_stopped');
  }
  async start(): Promise<void> {
    const path = socketPath();
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const lock = `${path}.lock`;
    try {
      mkdirSync(lock, { mode: 0o700 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const pidPath = `${lock}/pid`;
      let pid = 0;
      try { pid = Number(readFileSync(pidPath, 'utf8')); } catch {}
      if (pid > 0) {
        try { process.kill(pid, 0); throw new Error(`Daemon already running as process ${pid}`); }
        catch (check) { if ((check as NodeJS.ErrnoException).code !== 'ESRCH') throw check; }
      }
      if (!pid && Date.now() - statSync(lock).mtimeMs < 5000) throw new Error('Daemon is starting');
      rmSync(lock, { recursive: true, force: true });
      mkdirSync(lock, { mode: 0o700 });
    }
    writeFileSync(`${lock}/pid`, String(process.pid), { mode: 0o600 });
    this.daemonLock = () => rmSync(lock, { recursive: true, force: true });
    try {
      if (existsSync(path)) rmSync(path);
      this.registry = new SqliteRegistry(registryPath());
      this.server = createServer(socket => {
        let bytes = 0, body = '', handled = false;
        socket.setTimeout(5000, () => socket.destroy());
        socket.on('data', chunk => {
          if (handled) return;
          bytes += Buffer.byteLength(chunk);
          if (bytes > CONTROL_MAX_BYTES) { socket.destroy(); return; }
          body += chunk.toString('utf8');
          const end = body.indexOf('\n');
          if (end < 0) return;
          handled = true;
          let request: ControlRequest;
          try { request = JSON.parse(body.slice(0, end)); }
          catch { socket.end(); return; }
          void this.control(request).then(response => socket.end(encodeControl(response))).catch(() => socket.end());
        });
      });
      await new Promise<void>((resolve, reject) => { this.server!.once('error', reject); this.server!.listen(path, () => { this.server!.off('error', reject); resolve(); }); });
      const { chmodSync } = await import('node:fs'); chmodSync(path, 0o600);
      for (const record of await this.registry.list()) {
        const state: BotState = { record }; this.bots.set(record.id, state);
        if (record.enabled) await this.startBot(state).catch(() => {});
      }
      this.maintenance = setInterval(() => { for (const state of this.bots.values()) void state.instance?.runtime.deps.attachments.expire(new Date()).catch(() => {}); }, 6 * 3600_000);
    } catch (error) { await this.stop(); throw error; }
  }
  private async control(request: ControlRequest): Promise<ControlResponse> {
    const bad = (code: string, message: string): ControlResponse => ({ version: CONTROL_VERSION, requestId: typeof request?.requestId === 'string' ? request.requestId : '', ok: false, error: { code, message } });
    if (!request || request.version !== CONTROL_VERSION || typeof request.requestId !== 'string' || request.requestId.length > 128 || !operations.has(request.operation)) return bad('INVALID_REQUEST', 'Invalid control request');
    if (this.stopping) return bad('SHUTTING_DOWN', 'Daemon is shutting down');
    try {
      if (request.operation === 'status' && !request.bot) return { version: CONTROL_VERSION, requestId: request.requestId, ok: true, data: await Promise.all([...this.bots.values()].map(state => this.status(state))) };
      if (request.operation === 'shutdown') { setTimeout(() => void this.stop(), 0); return { version: CONTROL_VERSION, requestId: request.requestId, ok: true }; }
      if (!request.bot || typeof request.bot !== 'string') return bad('BOT_REQUIRED', 'Bot selector is required');
      const state = await this.refreshRecord(request.bot);
      if (!state) return bad('BOT_NOT_FOUND', 'Bot is not registered');
      if (request.operation === 'stop') await this.stopBot(state);
      else if (request.operation === 'start' || request.operation === 'load') { if (state.record.enabled || request.operation === 'start') await this.startBot(state); }
      else if (request.operation === 'restart') { await (this.dependencies.validate ?? validateBot)(state.record); await this.stopBot(state); await this.startBot(state); }
      return { version: CONTROL_VERSION, requestId: request.requestId, ok: true, data: await this.status(state) };
    } catch (error) { return bad('BOT_ERROR', safeOperationalError(error)); }
  }
  private async status(state: BotState) {
    const deliveries = state.instance ? await state.instance.store.listDeliveries() : [];
    return { bot: state.record.alias, id: state.record.id, enabled: state.record.enabled, status: state.instance ? 'running' : state.error ? 'error' : 'stopped', ...(state.error ? { error: state.error } : {}), ...(state.instance ? { heldDeliveries: deliveries.filter(item => item.state === 'ambiguous').length } : {}) };
  }
  async stop(): Promise<void> {
    if (this.stopping) return;
    this.stopping = true;
    if (this.maintenance) clearInterval(this.maintenance);
    await Promise.allSettled([...this.bots.values()].map(state => this.stopBot(state)));
    await new Promise<void>(resolve => this.server ? this.server.close(() => resolve()) : resolve());
    this.registry?.close();
    const path = socketPath(); if (existsSync(path)) rmSync(path);
    this.daemonLock?.();
  }
}
