import type { AttachmentId, BotId, ConversationId, EventId, MessageId, PrincipalId, RunId, SessionId } from './identity.ts';
import type { ExternalActor, ExternalDestination } from './identity.ts';
export type MessagePart = { type: 'text'; text: string } | { type: 'image' | 'file'; attachmentId: AttachmentId; mimeType?: string; name?: string };
export interface CanonicalMessage { id: MessageId; botId: BotId; conversationId: ConversationId; sessionId: SessionId; principalId?: PrincipalId; runId?: RunId; role: 'user' | 'assistant'; parts: MessagePart[]; replyTo?: MessageId; createdAt: string }
export interface InboundEvent { gate: 'telegram'; externalEventId: string; actor: ExternalActor; destination: ExternalDestination; receivedAt: string; kind: 'message' | 'control' | 'callback'; parts?: MessagePart[]; control?: 'new' | 'stop' | 'start' | 'help' | 'status'; callbackData?: string; replyToExternalId?: string; metadata?: Record<string, unknown> }
export interface AuditEvent { id: EventId; botId: BotId; sequence: number; conversationId?: ConversationId; sessionId?: SessionId; runId?: RunId; principalId?: PrincipalId; kind: string; at: string; payload: Record<string, unknown> }
