import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, open, rm } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { Readable } from 'node:stream';
import type { AttachmentId, AttachmentIngest, AttachmentPort, AttachmentReader, AttachmentRegistration, BotId, BotStore, PublicAttachment } from '@vian/core';

interface BotAttachments { root: string; store: Pick<BotStore, 'registerAttachment' | 'getAttachmentStorage' | 'listExpiredAttachments' | 'markAttachmentDeleted'> }
export class AttachmentRegistry implements AttachmentPort {
  private active = new Map<string, number>();
  constructor(private readonly bots: (id: BotId) => BotAttachments | undefined, private readonly maxFileBytes: number, private readonly defaultTtlHours = 24, private readonly now: () => Date = () => new Date(), private readonly logger: { error(message: string): void } = console) {}
  private bot(id: BotId): BotAttachments { const bot = this.bots(id); if (!bot) throw new Error('Unknown bot'); return bot; }
  private name(name: string): string {
    if (!name || name !== basename(name) || /[\x00-\x1f\x7f]/.test(name) || name === '.' || name === '..' || name.length > 255) throw new Error('Unsafe attachment name');
    return name;
  }
  private async storeBytes(botId: BotId, input: AttachmentIngest, origin: 'generated' | 'inbound', ttlHours = this.defaultTtlHours): Promise<PublicAttachment> {
    const bot = this.bot(botId);
    const name = this.name(input.name);
    if (!Number.isSafeInteger(input.size) || input.size < 0 || input.size > this.maxFileBytes) throw new Error('Attachment size limit exceeded');
    if (!Number.isFinite(ttlHours) || ttlHours <= 0 || ttlHours > 8760) throw new Error('Invalid attachment TTL');
    const id = `att_${randomUUID().replaceAll('-', '')}` as AttachmentId;
    const dir = join(bot.root, '.vian', 'attachments');
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const path = join(dir, id);
    const file = await open(path, 'wx', 0o600);
    const hash = createHash('sha256');
    let size = 0;
    try {
      for await (const chunk of input.bytes) {
        if (!(chunk instanceof Uint8Array)) throw new Error('Invalid attachment bytes');
        size += chunk.byteLength;
        if (size > this.maxFileBytes) throw new Error('Attachment size limit exceeded');
        hash.update(chunk);
        await file.writeFile(chunk);
      }
      await file.sync();
      await file.close();
      const createdAt = this.now();
      const attachment: PublicAttachment = { id, name, mimeType: input.mimeType, size };
      await bot.store.registerAttachment(attachment, path, new Date(createdAt.getTime() + ttlHours * 3600000).toISOString(), { sha256: hash.digest('hex'), origin, createdAt: createdAt.toISOString() });
      return attachment;
    } catch (error) { await file.close().catch(() => {}); await rm(path, { force: true }); throw error; }
  }
  async ingest(botId: BotId, input: AttachmentIngest): Promise<PublicAttachment> { return this.storeBytes(botId, input, 'inbound'); }
  async register(botId: BotId, input: AttachmentRegistration): Promise<PublicAttachment> {
    const file = Bun.file(input.path);
    if (!(await file.exists())) throw new Error('Attachment source unavailable');
    return this.storeBytes(botId, { name: input.name, mimeType: input.mimeType, size: file.size, bytes: file.stream() }, 'generated', input.ttlHours);
  }
  async open(botId: BotId, id: AttachmentId): Promise<AttachmentReader> {
    const row = await this.bot(botId).store.getAttachmentStorage(id);
    if (!row || row.status !== 'available' || row.expiresAt <= this.now().toISOString()) throw new Error('Attachment unavailable');
    const key = `${botId}:${id}`;
    this.active.set(key, (this.active.get(key) ?? 0) + 1);
    let released = false;
    return { stream: Readable.toWeb(createReadStream(row.privatePath)) as unknown as ReadableStream<Uint8Array>, release: async () => { if (released) return; released = true; const count = (this.active.get(key) ?? 1) - 1; if (count) this.active.set(key, count); else this.active.delete(key); } };
  }
  async list(botId: BotId, ids: AttachmentId[]): Promise<PublicAttachment[]> {
    const result: PublicAttachment[] = [];
    for (const id of ids) {
      const row = await this.bot(botId).store.getAttachmentStorage(id);
      if (row?.status === 'available' && row.expiresAt > this.now().toISOString()) result.push(row.public);
    }
    return result;
  }
  async expire(now: Date): Promise<number> {
    let count = 0;
    // Callers supply the bot registry; maintenance needs a bot list to avoid scanning the filesystem.
    for (const botId of this.knownBots) {
      const bot = this.bot(botId);
      for (const row of await bot.store.listExpiredAttachments(now.toISOString())) {
        if (this.active.get(`${botId}:${row.id}`)) continue;
        try { await rm(row.privatePath, { force: true }); await bot.store.markAttachmentDeleted(row.id); count++; }
        catch { this.logger.error('Attachment cleanup failed'); }
      }
    }
    return count;
  }
  private knownBots: BotId[] = [];
  trackBot(id: BotId): void { if (!this.knownBots.includes(id)) this.knownBots.push(id); }
}
