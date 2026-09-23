import { randomUUID, randomBytes } from 'node:crypto';
import { Database } from 'bun:sqlite';
import { existsSync } from 'node:fs';
import type { BotStore, StorageOutcome, RegistryRecord, InboxRecord, SessionLease, HistoryFilter } from '@vian/core';
import type { BotId, PrincipalId, ConversationId, SessionId, RunId, ToolCallId, EventId, MessageId, AttachmentId, ActionId, ExternalActor, ExternalDestination, AuthorizedContext, CallbackActionInput, CallbackActionClaim, CallbackActionValue } from '@vian/core';
import type { AuditEvent, InboundEvent, CanonicalMessage } from '@vian/core';
import type { OutboxPart, DeliveryState } from '@vian/core';
import type { PublicAttachment, AttachmentMetadata, PrivilegedAttachmentRecord } from '@vian/core';
import type { SteeringBatch } from '@vian/core';
import { openDatabase, migrate, backup, version } from './sqlite.ts';
import { botMigrations } from './schema.ts';

const now = () => new Date().toISOString();
const ok = <T>(value: T): StorageOutcome<T> => ({ kind: 'ok', value });
const invalid = (reason: string): StorageOutcome<never> => ({ kind: 'invalid-transition', reason });
const key = (destination: ExternalDestination) => JSON.stringify([destination.gate, destination.externalId, destination.threadId ?? '']);
const json = (value: unknown) => JSON.stringify(value);
const deliveryTransitions: Record<DeliveryState, DeliveryState[]> = { queued: ['sending','failed-retryable','failed-terminal'], sending: ['succeeded','failed-retryable','failed-terminal','ambiguous'], succeeded: [], 'failed-retryable': ['sending','failed-terminal'], 'failed-terminal': [], ambiguous: [] };

export class SqliteBotStore implements BotStore {
  private db: Database;
  constructor(readonly botId: BotId, path: string, options: { readonly?: boolean } = {}) {
    if (options.readonly) {
      if (!existsSync(path)) throw new Error('Bot SQLite database does not exist');
      this.db = new Database(path, { readonly: true, strict: true });
      const current = version(this.db);
      if (current < 1 || current > botMigrations.length) { this.db.close(); throw new Error(`Unsupported bot SQLite schema ${current}`); }
    } else {
      this.db = openDatabase(path);
      migrate(this.db, botMigrations);
    }
  }
  private audit(event: Omit<AuditEvent, 'sequence'>): number {
    if (event.botId !== this.botId) throw new Error('Audit event belongs to another bot');
    this.db.query('INSERT INTO events(id,conversation_id,session_id,run_id,principal_id,kind,at,payload_json) VALUES (?,?,?,?,?,?,?,?)')
      .run(event.id, event.conversationId ?? null, event.sessionId ?? null, event.runId ?? null, event.principalId ?? null, event.kind, event.at, json(event.payload));
    return Number((this.db.query('SELECT last_insert_rowid() AS id').get() as { id: number }).id);
  }
  async appendAudit(event: Omit<AuditEvent, 'sequence'>): Promise<number> { return this.db.transaction(() => this.audit(event)).immediate(); }
  async bindActor(actor: ExternalActor, principalId: PrincipalId): Promise<void> {
    this.db.transaction(() => {
      this.db.query('INSERT OR IGNORE INTO principals(id) VALUES (?)').run(principalId);
      this.db.query('INSERT INTO actor_bindings(gate,external_id,principal_id,created_at,revoked_at) VALUES (?,?,?,?,NULL) ON CONFLICT(gate,external_id) DO UPDATE SET principal_id=excluded.principal_id,revoked_at=NULL').run(actor.gate, actor.externalId, principalId, now());
      this.audit({ id: randomUUID() as EventId, botId: this.botId, principalId, kind: 'principal_bound', at: now(), payload: { gate: actor.gate, externalId: actor.externalId } });
    }).immediate();
  }
  async setAdministrator(principalId: PrincipalId, enabled: boolean): Promise<void> {
    this.db.transaction(() => {
      this.db.query('INSERT INTO principals(id,is_admin) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET is_admin=excluded.is_admin').run(principalId, enabled ? 1 : 0);
      this.audit({ id: randomUUID() as EventId, botId: this.botId, principalId, kind: 'authorization_changed', at: now(), payload: { isAdministrator: enabled } });
    }).immediate();
  }
  async bindDestination(destination: ExternalDestination, conversationId: ConversationId, initiatorId: PrincipalId): Promise<SessionId> {
    return this.db.transaction(() => {
      this.db.query('INSERT OR IGNORE INTO principals(id) VALUES (?)').run(initiatorId);
      let row = this.db.query('SELECT active_session_id FROM conversations WHERE id=?').get(conversationId) as { active_session_id: SessionId } | null;
      if (!row) {
        const sessionId = randomUUID() as SessionId;
        this.db.query('INSERT INTO conversations(id,initiator_id,active_session_id,created_at) VALUES (?,?,?,?)').run(conversationId, initiatorId, sessionId, now());
        this.db.query('INSERT INTO sessions(id,conversation_id,initiator_id,created_at) VALUES (?,?,?,?)').run(sessionId, conversationId, initiatorId, now());
        this.audit({ id: randomUUID() as EventId, botId: this.botId, conversationId, sessionId, principalId: initiatorId, kind: 'conversation_created', at: now(), payload: {} });
        row = { active_session_id: sessionId };
      }
      this.db.query('INSERT INTO destination_bindings(gate,external_id,thread_id,conversation_id,created_at,revoked_at) VALUES (?,?,?,?,?,NULL) ON CONFLICT(gate,external_id,thread_id) DO UPDATE SET conversation_id=excluded.conversation_id,revoked_at=NULL').run(destination.gate, destination.externalId, destination.threadId ?? '', conversationId, now());
      return row.active_session_id;
    }).immediate();
  }
  async resolveActor(actor: ExternalActor): Promise<PrincipalId | undefined> {
    return (this.db.query('SELECT principal_id FROM actor_bindings WHERE gate=? AND external_id=? AND revoked_at IS NULL').get(actor.gate, actor.externalId) as { principal_id: PrincipalId } | null)?.principal_id;
  }
  async resolveDestination(destination: ExternalDestination, principalId: PrincipalId): Promise<AuthorizedContext | undefined> {
    const row = this.db.query(`SELECT c.id conversation_id,c.active_session_id session_id,p.is_admin FROM destination_bindings d JOIN conversations c ON c.id=d.conversation_id JOIN principals p ON p.id=? WHERE d.gate=? AND d.external_id=? AND d.thread_id=? AND d.revoked_at IS NULL`).get(principalId, destination.gate, destination.externalId, destination.threadId ?? '') as { conversation_id: ConversationId; session_id: SessionId; is_admin: number } | null;
    return row ? { botId: this.botId, principalId, conversationId: row.conversation_id, sessionId: row.session_id, destination, isAdministrator: !!row.is_admin } : undefined;
  }
  async destinationForConversation(conversationId: ConversationId): Promise<ExternalDestination | undefined> {
    const row = this.db.query(`SELECT gate,external_id,thread_id FROM destination_bindings
      WHERE conversation_id=? AND revoked_at IS NULL ORDER BY created_at DESC,rowid DESC LIMIT 1`).get(conversationId) as { gate: ExternalDestination['gate']; external_id: string; thread_id: string } | null;
    return row ? { gate: row.gate, externalId: row.external_id, ...(row.thread_id && { threadId: row.thread_id }) } : undefined;
  }
  async createPairing(actor: ExternalActor, expiresAt: string): Promise<string> {
    const code = randomBytes(12).toString('base64url');
    this.db.query('INSERT INTO pairing_requests(code,gate,external_id,expires_at) VALUES (?,?,?,?)').run(code, actor.gate, actor.externalId, expiresAt);
    return code;
  }
  private nextDeliverySequence(): number {
    this.db.query('INSERT INTO delivery_order DEFAULT VALUES').run();
    return Number((this.db.query('SELECT last_insert_rowid() id').get() as { id: number }).id);
  }
  async createPairingNotice(event: InboundEvent, expiresAt: string): Promise<StorageOutcome<void>> {
    return this.db.transaction(() => {
      if (event.kind !== 'message' || event.actor.gate !== event.destination.gate || event.actor.externalId !== event.destination.externalId || event.destination.threadId || expiresAt <= now()) return invalid('Pairing notice requires an unknown private message and future expiry');
      if (this.db.query('SELECT principal_id FROM actor_bindings WHERE gate=? AND external_id=? AND revoked_at IS NULL').get(event.actor.gate, event.actor.externalId)) return invalid('Actor is already authorized');
      if (this.db.query('SELECT id FROM inbox WHERE gate=? AND external_event_id=?').get(event.gate, event.externalEventId) || this.db.query('SELECT id FROM pairing_notices WHERE gate=? AND external_event_id=?').get(event.gate, event.externalEventId)) return { kind: 'duplicate' as const, reason: 'Gate event already handled' };
      const reusable = this.db.query('SELECT code,expires_at FROM pairing_requests WHERE gate=? AND external_id=? AND used_at IS NULL AND expires_at>? ORDER BY expires_at DESC LIMIT 1').get(event.actor.gate, event.actor.externalId, now()) as { code: string; expires_at: string } | null;
      let code = reusable?.code;
      if (!code) {
        code = randomBytes(12).toString('base64url');
        this.db.query('INSERT INTO pairing_requests(code,gate,external_id,expires_at) VALUES (?,?,?,?)').run(code, event.actor.gate, event.actor.externalId, expiresAt);
      }
      const id = randomUUID();
      const part: OutboxPart = { id, botId: this.botId, messageId: `pairing:${id}` as MessageId, destination: event.destination, part: { partIndex: 0, kind: 'text', text: `Pairing code: ${code}\nAsk the bot owner to approve this code locally.` }, state: 'queued', attempt: 0 };
      this.db.query('INSERT INTO pairing_notices(id,gate,external_event_id,destination_key,code,part_json,state,created_at,expires_at,delivery_sequence) VALUES (?,?,?,?,?,?,?,?,?,?)').run(id, event.gate, event.externalEventId, key(event.destination), code, json(part), part.state, now(), reusable?.expires_at ?? expiresAt, this.nextDeliverySequence());
      this.audit({ id: randomUUID() as EventId, botId: this.botId, kind: 'pairing_notice_queued', at: now(), payload: { noticeId: id, gate: event.gate, externalEventId: event.externalEventId } });
      return ok(undefined);
    }).immediate();
  }
  async approvePairing(code: string, principalId: PrincipalId): Promise<StorageOutcome<void>> {
    return this.db.transaction(() => {
      const row = this.db.query('SELECT gate,external_id FROM pairing_requests WHERE code=? AND used_at IS NULL AND expires_at > ?').get(code, now()) as { gate: ExternalActor['gate']; external_id: string } | null;
      if (!row) return invalid('Pairing code is invalid, expired or used');
      this.db.query('UPDATE pairing_requests SET used_at=? WHERE code=?').run(now(), code);
      this.db.query('INSERT OR IGNORE INTO principals(id) VALUES (?)').run(principalId);
      this.db.query('INSERT INTO actor_bindings(gate,external_id,principal_id,created_at,revoked_at) VALUES (?,?,?,?,NULL) ON CONFLICT(gate,external_id) DO UPDATE SET principal_id=excluded.principal_id,revoked_at=NULL').run(row.gate, row.external_id, principalId, now());
      for (const notice of this.db.query("SELECT id,part_json FROM pairing_notices WHERE code=? AND state IN ('queued','failed-retryable')").all(code) as { id: string; part_json: string }[]) {
        const part = JSON.parse(notice.part_json) as OutboxPart;
        part.state = 'failed-terminal'; part.safeError = 'Pairing code was approved';
        this.db.query("UPDATE pairing_notices SET state='failed-terminal',part_json=? WHERE id=?").run(json(part), notice.id);
      }
      this.audit({ id: randomUUID() as EventId, botId: this.botId, principalId, kind: 'principal_bound', at: now(), payload: { gate: row.gate, externalId: row.external_id } });
      return ok(undefined);
    }).immediate();
  }
  async revokeBinding(actor: ExternalActor): Promise<void> {
    this.db.transaction(() => {
      this.db.query('UPDATE actor_bindings SET revoked_at=? WHERE gate=? AND external_id=? AND revoked_at IS NULL').run(now(), actor.gate, actor.externalId);
      this.audit({ id: randomUUID() as EventId, botId: this.botId, kind: 'authorization_changed', at: now(), payload: { gate: actor.gate, externalId: actor.externalId, revoked: true } });
    }).immediate();
  }
  async acceptInbound(event: InboundEvent): Promise<StorageOutcome<InboxRecord>> {
    return this.db.transaction(() => {
      const duplicate = this.db.query('SELECT id FROM inbox WHERE gate=? AND external_event_id=?').get(event.gate, event.externalEventId);
      if (duplicate) return { kind: 'duplicate' as const, reason: 'Inbound event already accepted' };
      const principal = this.db.query('SELECT principal_id FROM actor_bindings WHERE gate=? AND external_id=? AND revoked_at IS NULL').get(event.actor.gate, event.actor.externalId) as { principal_id: PrincipalId } | null;
      if (!principal) return invalid('Actor is not bound');
      const ctx = this.db.query(`SELECT c.id conversation_id,c.active_session_id session_id FROM destination_bindings d JOIN conversations c ON c.id=d.conversation_id WHERE d.gate=? AND d.external_id=? AND d.thread_id=? AND d.revoked_at IS NULL`).get(event.destination.gate, event.destination.externalId, event.destination.threadId ?? '') as { conversation_id: ConversationId; session_id: SessionId } | null;
      if (!ctx) return invalid('Destination is not bound');
      if (event.kind === 'control' && event.control === 'new') {
        const authority = this.db.query(`SELECT s.initiator_id, p.is_admin FROM sessions s
          JOIN principals p ON p.id=? WHERE s.id=?`).get(principal.principal_id, ctx.session_id) as { initiator_id: PrincipalId; is_admin: number } | null;
        const isShared = event.actor.externalId !== event.destination.externalId || !!event.destination.threadId;
        if (!authority || (isShared && authority.initiator_id !== principal.principal_id && !authority.is_admin)) return invalid('Actor cannot reset this session');
      }
      const id = randomUUID() as EventId, messageId = randomUUID() as MessageId;
      let acceptedEvent = event;
      if (event.kind === 'callback') {
        if (!event.callbackData) return invalid('Callback has no action ID');
        const action = this.db.query('SELECT * FROM callback_actions WHERE id=? AND consumed_at IS NULL AND expires_at>?').get(event.callbackData, now()) as any;
        if (!action || action.destination_key !== key(event.destination) || action.conversation_id !== ctx.conversation_id || action.session_id !== ctx.session_id || (action.principal_id && action.principal_id !== principal.principal_id)) return invalid('Callback action is unavailable');
        this.db.query('UPDATE callback_actions SET consumed_at=? WHERE id=?').run(now(), event.callbackData);
        acceptedEvent = { ...event, parts: [{ type: 'interaction', actionId: event.callbackData as ActionId, label: action.label, value: JSON.parse(action.value_json) }] };
      }
      this.db.query('INSERT INTO inbox(id,gate,external_event_id,event_json,accepted_at,message_id,session_id) VALUES (?,?,?,?,?,?,?)').run(id, event.gate, event.externalEventId, json(acceptedEvent), now(), messageId, ctx.session_id);
      const sequence = Number((this.db.query('SELECT last_insert_rowid() AS id').get() as { id: number }).id);
      const record: InboxRecord = { id, botId: this.botId, event: acceptedEvent, sequence, acceptedAt: now(), messageId, sessionId: ctx.session_id };
      this.audit({ id: randomUUID() as EventId, botId: this.botId, conversationId: ctx.conversation_id, sessionId: ctx.session_id, principalId: principal.principal_id, kind: 'inbound_message', at: record.acceptedAt, payload: { messageId, event: acceptedEvent } });
      if (acceptedEvent.kind === 'control' && acceptedEvent.control === 'new') {
        this.db.query('INSERT INTO reset_barriers(id,conversation_id,actor_id,inbox_sequence) VALUES (?,?,?,?)').run(id, ctx.conversation_id, principal.principal_id, sequence);
        this.audit({ id: randomUUID() as EventId, botId: this.botId, conversationId: ctx.conversation_id, sessionId: ctx.session_id, principalId: principal.principal_id, kind: 'session_reset_requested', at: record.acceptedAt, payload: { inboundId: id, inboxSequence: sequence } });
      }
      return ok(record);
    }).immediate();
  }
  async rejectInbound(inboundId: EventId, reason: string): Promise<StorageOutcome<void>> {
    return this.db.transaction(() => {
      const row = this.db.query(`SELECT i.state,i.session_id,s.conversation_id FROM inbox i
        JOIN sessions s ON s.id=i.session_id WHERE i.id=?`).get(inboundId) as { state: string; session_id: SessionId; conversation_id: ConversationId } | null;
      if (!row || (row.state !== 'queued' && row.state !== 'claimed')) return invalid('Inbound is unavailable or already consumed');
      this.db.query("UPDATE inbox SET state='consumed' WHERE id=?").run(inboundId);
      this.audit({ id: randomUUID() as EventId, botId: this.botId, conversationId: row.conversation_id, sessionId: row.session_id, kind: 'inbound_rejected', at: now(), payload: { inboundId, reason } });
      return ok(undefined);
    }).immediate();
  }
  private inbox(row: any): InboxRecord { return { id: row.id, botId: this.botId, event: JSON.parse(row.event_json), sequence: row.sequence, acceptedAt: row.accepted_at, messageId: row.message_id, sessionId: row.session_id }; }
  async readPendingInbound(sessionId: SessionId): Promise<InboxRecord[]> { return (this.db.query("SELECT * FROM inbox WHERE session_id=? AND state='queued' ORDER BY sequence").all(sessionId) as any[]).map(row => this.inbox(row)); }
  async listReadySessions(): Promise<SessionId[]> {
    return (this.db.query(`SELECT DISTINCT s.id FROM sessions s
      JOIN inbox i ON i.session_id=s.id AND i.state!='consumed'
      WHERE (s.lease_holder IS NULL OR s.lease_expires_at<=?)
      AND NOT EXISTS (SELECT 1 FROM runs r WHERE r.session_id=s.id AND r.state='running')
      GROUP BY s.id ORDER BY MIN(i.sequence)`).all(now()) as { id: SessionId }[]).map(row => row.id);
  }
  async listSessions(): Promise<{ id: SessionId; conversationId: ConversationId; initiatorId: PrincipalId; createdAt: string; lastActiveAt: string; messageCount: number; state: 'active' | 'inactive' }[]> {
    return (this.db.query(`SELECT s.id,s.conversation_id,s.initiator_id,s.created_at,
      COALESCE((SELECT MAX(e.at) FROM events e WHERE e.session_id=s.id),s.created_at) last_active_at,
      (SELECT COUNT(*) FROM messages m WHERE m.session_id=s.id) message_count,
      CASE WHEN c.active_session_id=s.id THEN 'active' ELSE 'inactive' END state
      FROM sessions s JOIN conversations c ON c.id=s.conversation_id ORDER BY last_active_at DESC,s.id`).all() as any[]).map(row => ({ id: row.id, conversationId: row.conversation_id, initiatorId: row.initiator_id, createdAt: row.created_at, lastActiveAt: row.last_active_at, messageCount: row.message_count, state: row.state }));
  }
  async controlAuthority(conversationId: ConversationId, principalId: PrincipalId): Promise<{ isAdministrator: boolean; sessionInitiatorId: PrincipalId; activeRunInitiatorId?: PrincipalId } | undefined> {
    const row = this.db.query(`SELECT s.initiator_id session_initiator_id,
      p.is_admin is_admin,
      (SELECT initiator_id FROM runs WHERE session_id=s.id AND state='running' ORDER BY started_at DESC LIMIT 1) run_initiator_id
      FROM conversations c JOIN sessions s ON s.id=c.active_session_id
      JOIN principals p ON p.id=? WHERE c.id=?`).get(principalId, conversationId) as { session_initiator_id: PrincipalId; is_admin: number; run_initiator_id: PrincipalId | null } | null;
    return row ? { isAdministrator: !!row.is_admin, sessionInitiatorId: row.session_initiator_id, ...(row.run_initiator_id && { activeRunInitiatorId: row.run_initiator_id }) } : undefined;
  }
  async claimNext(sessionId: SessionId, holder: string, leaseUntil: string): Promise<StorageOutcome<InboxRecord | undefined>> {
    return this.db.transaction(() => {
      const lease = this.db.query('SELECT lease_holder,lease_expires_at FROM sessions WHERE id=?').get(sessionId) as { lease_holder: string | null; lease_expires_at: string | null } | null;
      if (!lease) return invalid('Unknown session');
      if (lease.lease_holder && lease.lease_holder !== holder && lease.lease_expires_at && lease.lease_expires_at > now()) return { kind: 'lease-busy' as const, reason: 'Session is leased' };
      if (this.db.query("SELECT id FROM runs WHERE session_id=? AND state='running' LIMIT 1").get(sessionId)) return { kind: 'lease-busy' as const, reason: 'Session has an active run' };
      const row = this.db.query("SELECT * FROM inbox WHERE session_id=? AND state!='consumed' ORDER BY sequence LIMIT 1").get(sessionId) as any;
      this.db.query('UPDATE sessions SET lease_holder=?,lease_expires_at=? WHERE id=?').run(holder, leaseUntil, sessionId);
      if (!row) return ok(undefined);
      if (row.state === 'queued') this.db.query("UPDATE inbox SET state='claimed' WHERE id=?").run(row.id);
      return ok(this.inbox(row));
    }).immediate();
  }
  async claimSteeringBatch(runId: RunId, sessionId: SessionId, max: number): Promise<SteeringBatch> {
    return this.db.transaction(() => {
      const run = this.db.query("SELECT state FROM runs WHERE id=? AND session_id=?").get(runId, sessionId) as { state: string } | null;
      if (run?.state !== 'running' || max <= 0) return { runId, sessionId, messages: [], consumedIds: [], barrierReached: false };
      const rows = this.db.query("SELECT * FROM inbox WHERE session_id=? AND state='queued' ORDER BY sequence LIMIT ?").all(sessionId, max) as any[];
      const messages: CanonicalMessage[] = [];
      const consumedIds: MessageId[] = [];
      let barrierReached = false;
      for (const row of rows) {
        const event = JSON.parse(row.event_json) as InboundEvent;
        if (event.kind !== 'message' || event.control) { barrierReached = true; break; }
        const principal = this.db.query('SELECT principal_id FROM actor_bindings WHERE gate=? AND external_id=? AND revoked_at IS NULL').get(event.actor.gate, event.actor.externalId) as { principal_id: PrincipalId } | null;
        if (!principal) {
          this.db.query("UPDATE inbox SET state='consumed' WHERE id=?").run(row.id);
          this.audit({ id: randomUUID() as EventId, botId: this.botId, sessionId, runId, kind: 'inbound_rejected', at: now(), payload: { inboundId: row.id, reason: 'Actor binding revoked' } });
          continue;
        }
        const ctx = this.db.query('SELECT conversation_id FROM sessions WHERE id=?').get(sessionId) as { conversation_id: ConversationId };
        const message: CanonicalMessage = { id: row.message_id, botId: this.botId, conversationId: ctx.conversation_id, sessionId, principalId: principal.principal_id, runId, role: 'user', parts: event.parts ?? [], createdAt: row.accepted_at };
        this.db.query("UPDATE inbox SET state='consumed',run_id=? WHERE id=?").run(runId, row.id);
        this.db.query('INSERT INTO messages(id,conversation_id,session_id,run_id,role,message_json) VALUES (?,?,?,?,?,?)').run(message.id, message.conversationId, sessionId, runId, message.role, json(message));
        this.audit({ id: randomUUID() as EventId, botId: this.botId, conversationId: message.conversationId, sessionId, runId, principalId: principal.principal_id, kind: 'inbound_consumed', at: now(), payload: { messageId: message.id } });
        messages.push(message); consumedIds.push(message.id);
      }
      return { runId, sessionId, messages, consumedIds, barrierReached };
    }).immediate();
  }
  async appendResetBarrier(conversationId: ConversationId, actor: PrincipalId, inboundId: EventId): Promise<void> {
    this.db.transaction(() => {
      const row = this.db.query('SELECT sequence FROM inbox WHERE id=?').get(inboundId) as { sequence: number } | null;
      if (!row) throw new Error('Reset inbound not found');
      if (this.db.query('SELECT id FROM reset_barriers WHERE id=?').get(inboundId)) return;
      this.db.query('INSERT OR IGNORE INTO reset_barriers(id,conversation_id,actor_id,inbox_sequence) VALUES (?,?,?,?)').run(inboundId, conversationId, actor, row.sequence);
      this.audit({ id: randomUUID() as EventId, botId: this.botId, conversationId, principalId: actor, kind: 'session_reset_requested', at: now(), payload: { inboundId, inboxSequence: row.sequence } });
    }).immediate();
  }
  async applyResetBarrier(conversationId: ConversationId, inboundId: EventId): Promise<StorageOutcome<SessionId>> {
    return this.db.transaction(() => {
      const barrier = this.db.query('SELECT b.inbox_sequence,b.actor_id,b.applied_at,i.state FROM reset_barriers b JOIN inbox i ON i.id=b.id WHERE b.id=? AND b.conversation_id=?').get(inboundId, conversationId) as { inbox_sequence: number; actor_id: PrincipalId; applied_at: string | null; state: string } | null;
      if (!barrier || barrier.applied_at || barrier.state !== 'claimed') return invalid('Reset barrier is unavailable, unclaimed or already applied');
      const conversation = this.db.query('SELECT active_session_id FROM conversations WHERE id=?').get(conversationId) as { active_session_id: SessionId } | null;
      if (!conversation) return invalid('Unknown conversation');
      const earlier = this.db.query("SELECT id FROM inbox WHERE session_id=? AND sequence < ? AND state!='consumed' LIMIT 1").get(conversation.active_session_id, barrier.inbox_sequence);
      if (earlier) return invalid('Earlier inbox work remains');
      const running = this.db.query("SELECT id FROM runs WHERE session_id=? AND state='running' LIMIT 1").get(conversation.active_session_id);
      if (running) return invalid('Active run remains');
      const newSession = randomUUID() as SessionId;
      this.db.query('INSERT INTO sessions(id,conversation_id,initiator_id,created_at) VALUES (?,?,?,?)').run(newSession, conversationId, barrier.actor_id, now());
      this.db.query('UPDATE conversations SET active_session_id=? WHERE id=?').run(newSession, conversationId);
      this.db.query('UPDATE inbox SET session_id=? WHERE session_id=? AND sequence>=?').run(newSession, conversation.active_session_id, barrier.inbox_sequence);
      this.db.query("UPDATE inbox SET state='consumed' WHERE id=?").run(inboundId);
      this.db.query('UPDATE reset_barriers SET applied_at=? WHERE id=?').run(now(), inboundId);
      this.audit({ id: randomUUID() as EventId, botId: this.botId, conversationId, sessionId: newSession, principalId: barrier.actor_id, kind: 'session_reset', at: now(), payload: { previousSessionId: conversation.active_session_id, inboundId } });
      return ok(newSession);
    }).immediate();
  }
  async createAction(input: CallbackActionInput): Promise<ActionId> {
    if (input.botId !== this.botId) throw new Error('Wrong bot for action');
    const id = randomUUID() as ActionId;
    this.db.query('INSERT INTO callback_actions(id,conversation_id,session_id,principal_id,destination_key,label,value_json,expires_at) VALUES (?,?,?,?,?,?,?,?)').run(id, input.conversationId, input.sessionId, input.principalId ?? null, key(input.destination), input.label, json(input.value), input.expiresAt);
    return id;
  }
  async consumeAction(input: CallbackActionClaim): Promise<CallbackActionValue | undefined> {
    if (input.botId !== this.botId) return undefined;
    return this.db.transaction(() => {
      const action = this.db.query('SELECT * FROM callback_actions WHERE id=? AND consumed_at IS NULL AND expires_at>?').get(input.actionId, input.now) as any;
      if (!action || action.destination_key !== key(input.destination)) return undefined;
      const binding = this.db.query('SELECT principal_id FROM actor_bindings WHERE gate=? AND external_id=? AND revoked_at IS NULL').get(input.actor.gate, input.actor.externalId) as { principal_id: PrincipalId } | null;
      if (!binding || (action.principal_id && action.principal_id !== binding.principal_id)) return undefined;
      const destination = this.db.query('SELECT conversation_id FROM destination_bindings WHERE gate=? AND external_id=? AND thread_id=? AND revoked_at IS NULL').get(input.destination.gate, input.destination.externalId, input.destination.threadId ?? '') as { conversation_id: ConversationId } | null;
      if (!destination || destination.conversation_id !== action.conversation_id) return undefined;
      this.db.query('UPDATE callback_actions SET consumed_at=? WHERE id=?').run(input.now, input.actionId);
      this.audit({ id: randomUUID() as EventId, botId: this.botId, conversationId: action.conversation_id, sessionId: action.session_id, principalId: binding.principal_id, kind: 'callback_action_consumed', at: input.now, payload: { actionId: input.actionId } });
      return { conversationId: action.conversation_id, sessionId: action.session_id, principalId: action.principal_id ?? undefined, label: action.label, value: JSON.parse(action.value_json) };
    }).immediate();
  }
  async renewLease(lease: SessionLease): Promise<StorageOutcome<void>> {
    const changed = this.db.query('UPDATE sessions SET lease_expires_at=? WHERE id=? AND lease_holder=?').run(lease.expiresAt, lease.sessionId, lease.holder).changes;
    return changed ? ok(undefined) : invalid('Lease holder mismatch');
  }
  async releaseLease(lease: SessionLease): Promise<void> { this.db.query('UPDATE sessions SET lease_holder=NULL,lease_expires_at=NULL WHERE id=? AND lease_holder=?').run(lease.sessionId, lease.holder); }
  async beginRun(runId: RunId, input: InboxRecord, initiator: PrincipalId): Promise<StorageOutcome<void>> {
    return this.db.transaction(() => {
      const row = this.db.query("SELECT i.session_id,i.state,s.conversation_id FROM inbox i JOIN sessions s ON s.id=i.session_id WHERE i.id=?").get(input.id) as { session_id: SessionId; state: string; conversation_id: ConversationId } | null;
      if (!row || row.state !== 'claimed' || row.session_id !== input.sessionId) return invalid('Input is not claimed');
      if (this.db.query('SELECT id FROM runs WHERE id=?').get(runId)) return invalid('Run already exists');
      this.db.query('INSERT INTO runs(id,session_id,input_id,initiator_id,state,started_at) VALUES (?,?,?,?,?,?)').run(runId, row.session_id, input.id, initiator, 'running', now());
      this.db.query("UPDATE inbox SET state='consumed',run_id=? WHERE id=?").run(runId, input.id);
      const message: CanonicalMessage = { id: input.messageId!, botId: this.botId, conversationId: row.conversation_id, sessionId: row.session_id, principalId: initiator, runId, role: 'user', parts: input.event.parts ?? [], createdAt: input.acceptedAt };
      this.db.query('INSERT INTO messages(id,conversation_id,session_id,run_id,role,message_json) VALUES (?,?,?,?,?,?)').run(message.id, message.conversationId, message.sessionId, runId, message.role, json(message));
      this.audit({ id: randomUUID() as EventId, botId: this.botId, conversationId: row.conversation_id, sessionId: row.session_id, runId, principalId: initiator, kind: 'run_started', at: now(), payload: { inputId: input.id, messageId: input.messageId } });
      return ok(undefined);
    }).immediate();
  }
  async finishRun(runId: RunId, state: 'failed' | 'cancelled', audit: Record<string, unknown>): Promise<StorageOutcome<void>> {
    return this.db.transaction(() => {
      const row = this.db.query(`SELECT r.state,r.session_id,r.initiator_id,s.conversation_id
        FROM runs r JOIN sessions s ON s.id=r.session_id WHERE r.id=?`).get(runId) as { state: string; session_id: SessionId; initiator_id: PrincipalId; conversation_id: ConversationId } | null;
      if (!row || row.state !== 'running') return invalid('Run is not active');
      for (const tool of this.db.query("SELECT id FROM tool_calls WHERE run_id=? AND state='started'").all(runId) as { id: ToolCallId }[]) {
        this.db.query("UPDATE tool_calls SET state='interrupted',ended_at=? WHERE id=?").run(now(), tool.id);
        this.audit({ id: randomUUID() as EventId, botId: this.botId, conversationId: row.conversation_id, sessionId: row.session_id, runId, principalId: row.initiator_id, kind: 'tool_call_interrupted', at: now(), payload: { callId: tool.id, possiblePartialExecution: true } });
      }
      this.db.query('UPDATE runs SET state=?,ended_at=? WHERE id=?').run(state, now(), runId);
      this.audit({ id: randomUUID() as EventId, botId: this.botId, conversationId: row.conversation_id, sessionId: row.session_id, runId, principalId: row.initiator_id, kind: `run_${state}`, at: now(), payload: audit });
      return ok(undefined);
    }).immediate();
  }
  async transitionTool(callId: ToolCallId, runId: RunId, state: 'pending' | 'started' | 'succeeded' | 'failed' | 'interrupted', audit: Record<string, unknown>): Promise<StorageOutcome<void>> {
    return this.db.transaction(() => {
      const run = this.db.query('SELECT session_id,state FROM runs WHERE id=?').get(runId) as { session_id: SessionId; state: string } | null;
      if (!run || run.state !== 'running') return invalid('Run is not active');
      const prior = this.db.query('SELECT state FROM tool_calls WHERE id=?').get(callId) as { state: string } | null;
      const allowed = !prior ? state === 'pending' : prior.state === 'pending' ? state === 'started' : prior.state === 'started' ? ['succeeded','failed','interrupted'].includes(state) : false;
      if (!allowed) return invalid('Tool transition is not allowed');
      if (!prior) this.db.query('INSERT INTO tool_calls(id,run_id,state,audit_json) VALUES (?,?,?,?)').run(callId, runId, state, json(audit));
      else this.db.query('UPDATE tool_calls SET state=?,started_at=CASE WHEN ?="started" THEN ? ELSE started_at END,ended_at=CASE WHEN ? IN ("succeeded","failed","interrupted") THEN ? ELSE ended_at END,audit_json=? WHERE id=?').run(state, state, now(), state, now(), json(audit), callId);
      this.audit({ id: randomUUID() as EventId, botId: this.botId, sessionId: run.session_id, runId, kind: `tool_call_${state}`, at: now(), payload: { callId, ...audit } });
      return ok(undefined);
    }).immediate();
  }
  async completeRun(runId: RunId, finalMessage: CanonicalMessage, parts: OutboxPart[]): Promise<StorageOutcome<void>> {
    return this.db.transaction(() => {
      const run = this.db.query('SELECT session_id,state FROM runs WHERE id=?').get(runId) as { session_id: SessionId; state: string } | null;
      if (!run || run.state !== 'running' || run.session_id !== finalMessage.sessionId || finalMessage.runId !== runId) return invalid('Run/final message mismatch');
      if (this.db.query("SELECT id FROM tool_calls WHERE run_id=? AND state IN ('pending','started') LIMIT 1").get(runId)) return invalid('Tool calls are unsettled');
      this.db.query('INSERT INTO messages(id,conversation_id,session_id,run_id,role,message_json) VALUES (?,?,?,?,?,?)').run(finalMessage.id, finalMessage.conversationId, finalMessage.sessionId, runId, finalMessage.role, json(finalMessage));
      this.audit({ id: randomUUID() as EventId, botId: this.botId, conversationId: finalMessage.conversationId, sessionId: finalMessage.sessionId, runId, kind: 'assistant_message', at: now(), payload: { message: finalMessage } });
      for (const [ordinal, part] of parts.entries()) {
        if (part.messageId !== finalMessage.id || part.botId !== this.botId || part.state !== 'queued') throw new Error('Outbox part/final message mismatch');
        this.db.query('INSERT INTO outbox(id,message_id,destination_key,ordinal,part_json,state,attempt,next_attempt_at,delivery_sequence) VALUES (?,?,?,?,?,?,?,?,?)').run(part.id, finalMessage.id, key(part.destination), ordinal, json(part), part.state, part.attempt, part.nextAttemptAt ?? null, this.nextDeliverySequence());
        this.audit({ id: randomUUID() as EventId, botId: this.botId, conversationId: finalMessage.conversationId, sessionId: finalMessage.sessionId, runId, kind: 'delivery_queued', at: now(), payload: { partId: part.id, ordinal } });
      }
      this.db.query("UPDATE runs SET state='completed',ended_at=? WHERE id=?").run(now(), runId);
      this.audit({ id: randomUUID() as EventId, botId: this.botId, conversationId: finalMessage.conversationId, sessionId: finalMessage.sessionId, runId, kind: 'run_completed', at: now(), payload: {} });
      return ok(undefined);
    }).immediate();
  }
  async updateDelivery(partId: string, state: DeliveryState, details: Record<string, unknown> = {}): Promise<StorageOutcome<void>> {
    return this.db.transaction(() => {
      const regular = this.db.query('SELECT part_json,state,attempt,delivery_sequence FROM outbox WHERE id=?').get(partId) as { part_json: string; state: DeliveryState; attempt: number; delivery_sequence: number } | null;
      const pairing = regular ? null : this.db.query('SELECT part_json,state,attempt,delivery_sequence,expires_at FROM pairing_notices WHERE id=?').get(partId) as { part_json: string; state: DeliveryState; attempt: number; delivery_sequence: number; expires_at: string } | null;
      const row = regular ?? pairing;
      if (!row) return invalid('Unknown outbox part');
      if (!deliveryTransitions[row.state].includes(state)) return invalid('Delivery transition is not allowed');
      const part = JSON.parse(row.part_json) as OutboxPart;
      if (state === 'sending') {
        if (pairing && pairing.expires_at <= now()) {
          part.state = 'failed-terminal'; part.safeError = 'Pairing code expired before delivery';
          this.db.query("UPDATE pairing_notices SET state='failed-terminal',part_json=? WHERE id=?").run(json(part), partId);
          this.audit({ id: randomUUID() as EventId, botId: this.botId, kind: 'delivery_failed_terminal', at: now(), payload: { partId, reason: part.safeError } });
          return invalid('Pairing code expired before delivery');
        }
        const earlier = this.db.query(`SELECT id FROM (
          SELECT id,destination_key,state FROM outbox WHERE delivery_sequence<?
          UNION ALL SELECT id,destination_key,state FROM pairing_notices WHERE delivery_sequence<?
        ) WHERE destination_key=? AND state NOT IN ('succeeded','failed-terminal') LIMIT 1`).get(row.delivery_sequence, row.delivery_sequence, key(part.destination));
        if (earlier) return invalid('Earlier destination part is unresolved');
      }
      part.state = state; part.attempt += state === 'sending' ? 1 : 0;
      if (typeof details.nextAttemptAt === 'string') part.nextAttemptAt = details.nextAttemptAt;
      if (typeof details.safeError === 'string') part.safeError = details.safeError;
      if (details.receipt && typeof details.receipt === 'object') part.receipt = details.receipt as OutboxPart['receipt'];
      this.db.query(`UPDATE ${pairing ? 'pairing_notices' : 'outbox'} SET part_json=?,state=?,attempt=?,next_attempt_at=? WHERE id=?`).run(json(part), state, part.attempt, part.nextAttemptAt ?? null, partId);
      this.audit({ id: randomUUID() as EventId, botId: this.botId, kind: `delivery_${state.replaceAll('-','_')}`, at: now(), payload: { partId, ...details } });
      return ok(undefined);
    }).immediate();
  }
  async listDeliveries(destination?: ExternalDestination): Promise<OutboxPart[]> {
    const rows = destination ? this.db.query(`SELECT part_json FROM (
      SELECT part_json,delivery_sequence,destination_key FROM outbox
      UNION ALL SELECT part_json,delivery_sequence,destination_key FROM pairing_notices
    ) WHERE destination_key=? ORDER BY delivery_sequence`).all(key(destination)) : this.db.query(`SELECT part_json FROM (
      SELECT part_json,delivery_sequence FROM outbox
      UNION ALL SELECT part_json,delivery_sequence FROM pairing_notices
    ) ORDER BY delivery_sequence`).all();
    return (rows as { part_json: string }[]).map(row => JSON.parse(row.part_json));
  }
  async appendSummary(sessionId: SessionId, text: string, throughSequence: number): Promise<void> {
    this.db.transaction(() => {
      this.db.query('INSERT INTO summaries(session_id,text,through_sequence,created_at) VALUES (?,?,?,?) ON CONFLICT(session_id) DO UPDATE SET text=excluded.text,through_sequence=excluded.through_sequence,created_at=excluded.created_at WHERE excluded.through_sequence > summaries.through_sequence').run(sessionId, text, throughSequence, now());
      this.audit({ id: randomUUID() as EventId, botId: this.botId, sessionId, kind: 'context_summary_created', at: now(), payload: { throughSequence } });
    }).immediate();
  }
  async readSummary(sessionId: SessionId): Promise<{ text: string; throughSequence: number } | undefined> {
    const row = this.db.query('SELECT text,through_sequence FROM summaries WHERE session_id=?').get(sessionId) as { text: string; through_sequence: number } | null;
    return row ? { text: row.text, throughSequence: row.through_sequence } : undefined;
  }
  async registerAttachment(attachment: PublicAttachment, privatePath: string, expiresAt: string, metadata: AttachmentMetadata): Promise<void> {
    if (!/^[0-9a-f]{64}$/.test(metadata.sha256)) throw new Error('Attachment SHA-256 must be lowercase hex');
    if (metadata.origin !== 'generated' && metadata.origin !== 'inbound') throw new Error('Unsupported attachment origin');
    this.db.transaction(() => {
      this.db.query('INSERT INTO attachments(id,public_json,private_path,expires_at,sha256,origin,created_at) VALUES (?,?,?,?,?,?,?)').run(attachment.id, json(attachment), privatePath, expiresAt, metadata.sha256, metadata.origin, metadata.createdAt);
      this.audit({ id: randomUUID() as EventId, botId: this.botId, kind: 'attachment_registered', at: now(), payload: { attachment, metadata } });
    }).immediate();
  }
  async getAttachment(id: AttachmentId): Promise<PublicAttachment | undefined> {
    const row = this.db.query("SELECT public_json FROM attachments WHERE id=? AND status='available' AND expires_at > ?").get(id, now()) as { public_json: string } | null;
    return row ? JSON.parse(row.public_json) : undefined;
  }
  async getAttachmentStorage(id: AttachmentId): Promise<PrivilegedAttachmentRecord | undefined> {
    const row = this.db.query('SELECT public_json,private_path,expires_at,status,sha256,origin,created_at FROM attachments WHERE id=?').get(id) as { public_json: string; private_path: string; expires_at: string; status: 'available' | 'expired' | 'deleted'; sha256: string | null; origin: 'generated' | 'inbound' | null; created_at: string | null } | null;
    return row ? { public: JSON.parse(row.public_json), privatePath: row.private_path, expiresAt: row.expires_at, status: row.status === 'available' && row.expires_at <= now() ? 'expired' : row.status, ...(row.sha256 && row.origin && row.created_at ? { metadata: { sha256: row.sha256, origin: row.origin, createdAt: row.created_at } } : {}) } : undefined;
  }
  async listExpiredAttachments(at: string): Promise<{ id: AttachmentId; privatePath: string }[]> {
    return (this.db.query("SELECT id,private_path FROM attachments WHERE expires_at<=? AND status!='deleted' ORDER BY expires_at").all(at) as { id: AttachmentId; private_path: string }[]).map(row => ({ id: row.id, privatePath: row.private_path }));
  }
  async markAttachmentDeleted(id: AttachmentId): Promise<void> {
    this.db.transaction(() => {
      this.db.query("UPDATE attachments SET status='deleted',private_path='' WHERE id=? AND status!='deleted'").run(id);
      this.audit({ id: randomUUID() as EventId, botId: this.botId, kind: 'attachment_deleted', at: now(), payload: { attachmentId: id } });
    }).immediate();
  }
  async *history(filter: HistoryFilter): AsyncIterable<AuditEvent> {
    const clauses: string[] = [], values: (string | number)[] = [];
    if (filter.sessionId) { clauses.push('session_id=?'); values.push(filter.sessionId); }
    if (filter.principalId) { clauses.push('principal_id=?'); values.push(filter.principalId); }
    if (filter.since) { clauses.push('at>=?'); values.push(filter.since); }
    if (filter.afterSequence) { clauses.push('sequence>?'); values.push(filter.afterSequence); }
    if (filter.toolsOnly) clauses.push("kind LIKE 'tool_call_%'");
    const limit = Math.min(Math.max(filter.limit ?? 100, 1), 1000);
    const sql = `SELECT * FROM events ${clauses.length ? 'WHERE ' + clauses.join(' AND ') : ''} ORDER BY sequence LIMIT ?`;
    for (const row of this.db.query(sql).all(...values, limit) as any[]) yield { id: row.id, botId: this.botId, sequence: row.sequence, conversationId: row.conversation_id ?? undefined, sessionId: row.session_id ?? undefined, runId: row.run_id ?? undefined, principalId: row.principal_id ?? undefined, kind: row.kind, at: row.at, payload: JSON.parse(row.payload_json) };
  }
  async recoverInterrupted(): Promise<number> {
    return this.db.transaction(() => {
      const rows = this.db.query("SELECT id,run_id FROM tool_calls WHERE state='started'").all() as { id: ToolCallId; run_id: RunId }[];
      for (const row of rows) {
        this.db.query("UPDATE tool_calls SET state='interrupted',ended_at=? WHERE id=?").run(now(), row.id);
        this.audit({ id: randomUUID() as EventId, botId: this.botId, runId: row.run_id, kind: 'tool_call_interrupted', at: now(), payload: { callId: row.id, possiblePartialExecution: true } });
      }
      const runs = this.db.query("SELECT id FROM runs WHERE state='running'").all() as { id: RunId }[];
      for (const run of runs) {
        this.db.query("UPDATE runs SET state='interrupted',ended_at=? WHERE id=?").run(now(), run.id);
        this.audit({ id: randomUUID() as EventId, botId: this.botId, runId: run.id, kind: 'run_interrupted', at: now(), payload: { possiblePartialExecution: rows.some(row => row.run_id === run.id) } });
      }
      const sends = this.db.query("SELECT id,part_json FROM outbox WHERE state='sending'").all() as { id: string; part_json: string }[];
      for (const send of sends) {
        const part = JSON.parse(send.part_json) as OutboxPart;
        part.state = 'ambiguous'; part.safeError = 'Delivery outcome unknown after process interruption';
        this.db.query("UPDATE outbox SET state='ambiguous',part_json=? WHERE id=?").run(json(part), send.id);
        this.audit({ id: randomUUID() as EventId, botId: this.botId, kind: 'delivery_ambiguous', at: now(), payload: { partId: send.id, reason: part.safeError } });
      }
      const pairingSends = this.db.query("SELECT id,part_json FROM pairing_notices WHERE state='sending'").all() as { id: string; part_json: string }[];
      for (const send of pairingSends) {
        const part = JSON.parse(send.part_json) as OutboxPart;
        part.state = 'ambiguous'; part.safeError = 'Delivery outcome unknown after process interruption';
        this.db.query("UPDATE pairing_notices SET state='ambiguous',part_json=? WHERE id=?").run(json(part), send.id);
        this.audit({ id: randomUUID() as EventId, botId: this.botId, kind: 'delivery_ambiguous', at: now(), payload: { partId: send.id, reason: part.safeError } });
      }
      this.db.query('UPDATE sessions SET lease_holder=NULL,lease_expires_at=NULL WHERE lease_holder IS NOT NULL').run();
      return runs.length;
    }).immediate();
  }
  async backup(destinationPath: string): Promise<void> { backup(this.db, destinationPath); }
  close(): void { this.db.close(); }
}
