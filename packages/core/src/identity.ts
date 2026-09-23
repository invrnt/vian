/** Canonical IDs are never raw transport IDs. Storage creates and validates them. */
export type Id<K extends string> = string & { readonly __kind: K };
export type BotId = Id<'bot'>;
export type PrincipalId = Id<'principal'>;
export type ConversationId = Id<'conversation'>;
export type SessionId = Id<'session'>;
export type RunId = Id<'run'>;
export type MessageId = Id<'message'>;
export type ToolCallId = Id<'tool-call'>;
export type AttachmentId = Id<'attachment'>;
export type ActionId = Id<'action'>;
export type EventId = Id<'event'>;
export type GateType = 'telegram';
export interface ExternalActor { gate: GateType; externalId: string; displayName?: string }
export interface ExternalDestination { gate: GateType; externalId: string; threadId?: string }
export interface IdentityBinding { botId: BotId; principalId: PrincipalId; actor: ExternalActor; createdAt: string; revokedAt?: string }
export interface ConversationBinding { botId: BotId; conversationId: ConversationId; destination: ExternalDestination; createdAt: string; revokedAt?: string }
export interface AuthorizedContext { botId: BotId; principalId: PrincipalId; conversationId: ConversationId; sessionId: SessionId; destination: ExternalDestination; isAdministrator: boolean }
