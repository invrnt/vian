import type { ActionId, BotId, ConversationId, PrincipalId, SessionId } from './identity.ts';
import type { ExternalActor, ExternalDestination } from './identity.ts';
export const MAX_ACTION_ID_BYTES = 64;
/** Callback data contains only the opaque ID, never the action value or canonical IDs. */
export interface CallbackActionInput { botId: BotId; conversationId: ConversationId; sessionId: SessionId; principalId?: PrincipalId; destination: ExternalDestination; label: string; value: unknown; expiresAt: string }
export interface CallbackActionClaim { botId: BotId; actionId: ActionId; actor: ExternalActor; destination: ExternalDestination; now: string }
export interface CallbackActionValue { conversationId: ConversationId; sessionId: SessionId; principalId?: PrincipalId; label: string; value: unknown }
/** Generated action IDs must fit MAX_ACTION_ID_BYTES as UTF-8. consume is atomic: one use, unexpired, same destination and authorized unrevoked actor. */
export interface ActionPort { createAction(input: CallbackActionInput): Promise<ActionId>; consumeAction(input: CallbackActionClaim): Promise<CallbackActionValue | undefined> }
