import type { BotId, ConversationId, EventId, MessageId, PrincipalId, RunId, SessionId, ToolCallId, AttachmentId } from './identity.ts';
import type { ExternalActor, ExternalDestination, AuthorizedContext } from './identity.ts';
import type { InboundEvent, AuditEvent, CanonicalMessage } from './messages.ts';
import type { AttachmentMetadata, PrivilegedAttachmentRecord, PublicAttachment } from './attachments.ts';
import type { OutboxPart, DeliveryState } from './delivery.ts';
import type { SteeringBatch } from './execution.ts';
import type { ActionPort } from './actions.ts';
export type StorageOutcome<T> = { kind: 'ok'; value: T } | { kind: 'duplicate' | 'lease-busy' | 'invalid-transition' | 'unavailable-storage'; reason: string };
export interface RegistryRecord { id: BotId; alias: string; path: string; registeredAt: string; enabled: boolean; observedName?: string; observedStatus?: string }
export interface RegistryStore { register(record: RegistryRecord, mode?: 'new' | 'move' | 'clone'): Promise<StorageOutcome<RegistryRecord>>; unregister(botId: BotId): Promise<void>; list(): Promise<RegistryRecord[]>; get(selector: string): Promise<RegistryRecord | undefined>; setEnabled(botId: BotId, enabled: boolean): Promise<void> }
export interface InboxRecord { id: EventId; botId: BotId; event: InboundEvent; sequence: number; acceptedAt: string; messageId?: MessageId; sessionId?: SessionId }
export interface SessionLease { sessionId: SessionId; holder: string; expiresAt: string }
export interface SessionSummary { id: SessionId; conversationId: ConversationId; initiatorId: PrincipalId; createdAt: string; lastActiveAt: string; messageCount: number; state: 'active' | 'inactive' }
export interface BotSchemaInspection { exists: boolean; currentVersion: number; supportedVersion: number; compatible: boolean }
/** Implemented as a read-only standalone storage export. It must not create or migrate a database. */
export type InspectBotSchema = (path: string) => BotSchemaInspection;
export interface HistoryFilter { sessionId?: SessionId; principalId?: PrincipalId; since?: string; toolsOnly?: boolean; afterSequence?: number; limit?: number }
export interface BotStore extends ActionPort {
  listSessions(): Promise<SessionSummary[]>;
  /** Includes queued inbox and unapplied reset barriers for restart scheduling. */
  listReadySessions(): Promise<SessionId[]>;
  /** Trusted current authority; undefined when the principal/conversation is not bound. */
  controlAuthority(conversationId: ConversationId, principalId: PrincipalId): Promise<{ isAdministrator: boolean; sessionInitiatorId: PrincipalId; activeRunInitiatorId?: PrincipalId } | undefined>;
  bindActor(actor: ExternalActor, principalId: PrincipalId): Promise<void>;
  bindDestination(destination: ExternalDestination, conversationId: ConversationId, initiatorId: PrincipalId): Promise<SessionId>;
  setAdministrator(principalId: PrincipalId, enabled: boolean): Promise<void>;
  /** Atomically make administrator flags equal the manifest list, including unbound principals; insert configured IDs and audit changed rows. Call before Gate admission. */
  syncAdministrators(principalIds: PrincipalId[]): Promise<void>;
  appendAudit(event: Omit<AuditEvent, 'sequence'>): Promise<number>;
  recoverInterrupted(): Promise<number>;
  readPendingInbound(sessionId: SessionId): Promise<InboxRecord[]>;
  resolveActor(actor: ExternalActor): Promise<PrincipalId | undefined>;
  resolveDestination(destination: ExternalDestination, principalId: PrincipalId): Promise<AuthorizedContext | undefined>;
  /** Trusted reverse lookup of the active nonrevoked destination binding. */
  destinationForConversation(conversationId: ConversationId): Promise<ExternalDestination | undefined>;
  createPairing(actor: ExternalActor, expiresAt: string): Promise<string>;
  /** Privileged local-owner read: unused, unexpired codes ordered by expiry. Never expose via model, Gate, audit or general list output. */
  listPendingPairings(): Promise<Array<{ code: string; actor: ExternalActor; expiresAt: string }>>;
  /** Active, unrevoked actor bindings for local-owner access management. */
  listActorBindings(): Promise<Array<{ actor: ExternalActor; principalId: PrincipalId; isAdministrator: boolean; createdAt: string }>>;
  /** For an unaccepted unknown private message only: dedupe by Gate event ID, create/reuse one unexpired actor code, and persist plain system notice plus outbox atomically. No principal, session or model access. */
  createPairingNotice(event: InboundEvent, expiresAt: string): Promise<StorageOutcome<void>>;
  approvePairing(code: string, principalId: PrincipalId): Promise<StorageOutcome<void>>;
  /** Create an owner-visible, one-use Telegram DM verification. The code is never persisted in plaintext. */
  createOwnerVerification(principalId: PrincipalId, expiresAt: string): Promise<{ code: string; expiresAt: string }>;
  /** Atomically consume a matching private Telegram message, bind its numeric sender, and suppress legacy pairing while an owner code is active. */
  consumeOwnerVerification(event: InboundEvent): Promise<'matched' | 'blocked' | 'none'>;
  /** Owner-only lookup for the waiting CLI. */
  ownerVerificationStatus(code: string): Promise<{ state: 'pending' | 'used' | 'expired' | 'missing'; actorId?: string; principalId?: PrincipalId }>;
  revokeBinding(actor: ExternalActor): Promise<void>;
  acceptInbound(event: InboundEvent): Promise<StorageOutcome<InboxRecord>>;
  /** After authorization recheck, consume only queued/claimed input and append inbound_rejected audit in one transaction; lease release remains caller-owned. */
  rejectInbound(inboundId: EventId, reason: string): Promise<StorageOutcome<void>>;
  claimNext(sessionId: SessionId, holder: string, leaseUntil: string): Promise<StorageOutcome<InboxRecord | undefined>>;
  claimSteeringBatch(runId: RunId, sessionId: SessionId, max: number): Promise<SteeringBatch>;
  appendResetBarrier(conversationId: ConversationId, actor: PrincipalId, inboundId: EventId): Promise<void>;
  /** Apply an ordered /new barrier only after prior input is consumed and the active run has ended; create the next session and audit session_reset atomically. */
  applyResetBarrier(conversationId: ConversationId, inboundId: EventId): Promise<StorageOutcome<SessionId>>;
  renewLease(lease: SessionLease): Promise<StorageOutcome<void>>;
  releaseLease(lease: SessionLease): Promise<void>;
  beginRun(runId: RunId, input: InboxRecord, initiator: PrincipalId): Promise<StorageOutcome<void>>;
  transitionTool(callId: ToolCallId, runId: RunId, state: 'pending' | 'started' | 'succeeded' | 'failed' | 'interrupted', audit: Record<string, unknown>): Promise<StorageOutcome<void>>;
  completeRun(runId: RunId, finalMessage: CanonicalMessage, parts: OutboxPart[]): Promise<StorageOutcome<void>>;
  /** Terminal transition and safe audit. Only failed runs may include a safe assistant final and queued outbox parts, atomically linked to the run; cancellation remains silent. Parts require a final message. */
  finishRun(runId: RunId, state: 'failed' | 'cancelled', audit: Record<string, unknown>, finalMessage?: CanonicalMessage, parts?: OutboxPart[]): Promise<StorageOutcome<void>>;
  updateDelivery(partId: string, state: DeliveryState, details?: Record<string, unknown>): Promise<StorageOutcome<void>>;
  listDeliveries(destination?: ExternalDestination): Promise<OutboxPart[]>;
  appendSummary(sessionId: SessionId, text: string, throughSequence: number): Promise<void>;
  readSummary(sessionId: SessionId): Promise<{ text: string; throughSequence: number } | undefined>;
  registerAttachment(attachment: PublicAttachment, privatePath: string, expiresAt: string, metadata: AttachmentMetadata): Promise<void>;
  getAttachment(id: AttachmentId): Promise<PublicAttachment | undefined>;
  /** Privileged bot-local metadata for byte access; never expose privatePath to model or public responses. */
  getAttachmentStorage(id: AttachmentId): Promise<PrivilegedAttachmentRecord | undefined>;
  markAttachmentDeleted(id: AttachmentId): Promise<void>;
  listExpiredAttachments(now: string): Promise<{ id: AttachmentId; privatePath: string }[]>;
  history(filter: HistoryFilter): AsyncIterable<AuditEvent>;
  backup(destinationPath: string): Promise<void>;
  close(): void;
}
