import type { BotId, ConversationId, EventId, MessageId, PrincipalId, RunId, SessionId, ToolCallId, AttachmentId } from './identity.ts';
import type { ExternalActor, ExternalDestination, AuthorizedContext } from './identity.ts';
import type { InboundEvent, AuditEvent, CanonicalMessage } from './messages.ts';
import type { PublicAttachment } from './attachments.ts';
import type { OutboxPart, DeliveryState } from './delivery.ts';
import type { SteeringBatch } from './execution.ts';
export type StorageOutcome<T> = { kind: 'ok'; value: T } | { kind: 'duplicate' | 'lease-busy' | 'invalid-transition' | 'unavailable-storage'; reason: string };
export interface RegistryRecord { id: BotId; alias: string; path: string; registeredAt: string; enabled: boolean; observedName?: string; observedStatus?: string }
export interface RegistryStore { register(record: RegistryRecord, mode?: 'new' | 'move' | 'clone'): Promise<StorageOutcome<RegistryRecord>>; unregister(botId: BotId): Promise<void>; list(): Promise<RegistryRecord[]>; get(selector: string): Promise<RegistryRecord | undefined>; setEnabled(botId: BotId, enabled: boolean): Promise<void> }
export interface InboxRecord { id: EventId; botId: BotId; event: InboundEvent; sequence: number; acceptedAt: string; messageId?: MessageId; sessionId?: SessionId }
export interface SessionLease { sessionId: SessionId; holder: string; expiresAt: string }
export interface HistoryFilter { sessionId?: SessionId; principalId?: PrincipalId; since?: string; toolsOnly?: boolean; afterSequence?: number; limit?: number }
export interface BotStore {
  resolveActor(actor: ExternalActor): Promise<PrincipalId | undefined>;
  resolveDestination(destination: ExternalDestination, principalId: PrincipalId): Promise<AuthorizedContext | undefined>;
  createPairing(actor: ExternalActor, expiresAt: string): Promise<string>;
  approvePairing(code: string, principalId: PrincipalId): Promise<StorageOutcome<void>>;
  revokeBinding(actor: ExternalActor): Promise<void>;
  acceptInbound(event: InboundEvent): Promise<StorageOutcome<InboxRecord>>;
  claimNext(sessionId: SessionId, holder: string, leaseUntil: string): Promise<StorageOutcome<InboxRecord | undefined>>;
  claimSteeringBatch(runId: RunId, sessionId: SessionId, max: number): Promise<SteeringBatch>;
  appendResetBarrier(conversationId: ConversationId, actor: PrincipalId, inboundId: EventId): Promise<void>;
  renewLease(lease: SessionLease): Promise<StorageOutcome<void>>;
  releaseLease(lease: SessionLease): Promise<void>;
  beginRun(runId: RunId, input: InboxRecord, initiator: PrincipalId): Promise<StorageOutcome<void>>;
  transitionTool(callId: ToolCallId, runId: RunId, state: 'pending' | 'started' | 'succeeded' | 'failed' | 'interrupted', audit: Record<string, unknown>): Promise<StorageOutcome<void>>;
  completeRun(runId: RunId, finalMessage: CanonicalMessage, parts: OutboxPart[]): Promise<StorageOutcome<void>>;
  updateDelivery(partId: string, state: DeliveryState, details?: Record<string, unknown>): Promise<StorageOutcome<void>>;
  listDeliveries(destination?: ExternalDestination): Promise<OutboxPart[]>;
  appendSummary(sessionId: SessionId, text: string, throughSequence: number): Promise<void>;
  readSummary(sessionId: SessionId): Promise<{ text: string; throughSequence: number } | undefined>;
  registerAttachment(attachment: PublicAttachment, privatePath: string, expiresAt: string): Promise<void>;
  getAttachment(id: AttachmentId): Promise<PublicAttachment | undefined>;
  history(filter: HistoryFilter): AsyncIterable<AuditEvent>;
  backup(destinationPath: string): Promise<void>;
  close(): void;
}
