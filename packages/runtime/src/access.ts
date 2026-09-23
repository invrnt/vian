import { randomUUID } from 'node:crypto';
import type { BotStore, ConversationId, ExternalActor, ExternalDestination, PrincipalId, SessionId, StorageOutcome } from '@vian/core';

/** Owner-only access operations for local commands. The caller supplies a bot-local store. */
export class AccessService {
  constructor(private readonly store: BotStore) {}

  pending() { return this.store.listPendingPairings(); }
  list() { return this.store.listActorBindings(); }
  approve(code: string, principalId: PrincipalId): Promise<StorageOutcome<void>> { return this.store.approvePairing(code, principalId); }
  revoke(actor: ExternalActor): Promise<void> { return this.store.revokeBinding(actor); }

  async bindTransport(actor: ExternalActor, destination: ExternalDestination, principalId: PrincipalId, conversationId: ConversationId): Promise<SessionId> {
    await this.store.bindActor(actor, principalId);
    return this.store.bindDestination(destination, conversationId, principalId);
  }

  /** Allowlist identities are numeric Telegram IDs, never usernames. */
  async allowTelegramActor(numericId: string, principalId: PrincipalId): Promise<void> {
    if (!/^[1-9]\d*$/.test(numericId)) throw new Error('Telegram actor ID must be a positive numeric ID');
    const actor = { gate: 'telegram' as const, externalId: numericId };
    await this.store.bindActor(actor, principalId);
    if (!await this.store.resolveDestination(actor, principalId)) await this.store.bindDestination(actor, randomUUID() as ConversationId, principalId);
  }
}
