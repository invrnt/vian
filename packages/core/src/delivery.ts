import type { BotId, MessageId } from './identity.ts';
import type { ExternalDestination } from './identity.ts';
import type { RenderedPart, DeliveryReceipt } from './gate.ts';
export type DeliveryState = 'queued' | 'sending' | 'succeeded' | 'failed-retryable' | 'failed-terminal' | 'ambiguous';
export interface OutboxPart { id: string; botId: BotId; messageId: MessageId; destination: ExternalDestination; part: RenderedPart; state: DeliveryState; attempt: number; nextAttemptAt?: string; receipt?: DeliveryReceipt; safeError?: string }
