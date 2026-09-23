import type { AttachmentId, BotId } from './identity.ts';
export interface PublicAttachment { id: AttachmentId; name: string; mimeType: string; size: number }
export interface AttachmentRegistration { path: string; name: string; mimeType: string; ttlHours?: number }
export interface AttachmentReader { stream: ReadableStream<Uint8Array>; release(): Promise<void> }
export interface AttachmentPort { register(botId: BotId, input: AttachmentRegistration): Promise<PublicAttachment>; open(botId: BotId, id: AttachmentId): Promise<AttachmentReader>; list(botId: BotId, ids: AttachmentId[]): Promise<PublicAttachment[]>; expire(now: Date): Promise<number> }
