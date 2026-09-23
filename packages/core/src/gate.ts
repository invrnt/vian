import type { ActionId, BotId, ConversationId, RunId } from './identity.ts';
import type { ExternalDestination } from './identity.ts';
import type { InboundEvent, CanonicalMessage } from './messages.ts';
import type { NativeToolSet } from './tools.ts';
import type { AttachmentPort, PublicAttachment } from './attachments.ts';
import type { ActionPort } from './actions.ts';
export interface GateCapabilities { text: boolean; formatting: string[]; streaming: boolean; stopGeneration: boolean; buttons: boolean; attachments: boolean; replies: boolean; groups: boolean; threads: boolean }
export interface RenderedPart { partIndex: number; kind: 'text' | 'file'; text?: string; attachment?: PublicAttachment; replyToExternalId?: string; buttons?: { label: string; actionId: ActionId }[][] }
export interface DeliveryReceipt { externalId: string; sentAt: string }
export type DeliveryOutcome = { kind: 'succeeded'; receipt: DeliveryReceipt } | { kind: 'confirmed-failure'; retryable: boolean; safeMessage: string; retryAfterMs?: number } | { kind: 'ambiguous'; safeMessage: string };
export interface GateRuntimePorts { botId: BotId; attachments: Pick<AttachmentPort, 'ingest' | 'open' | 'list'>; actions: ActionPort; resolveDestination(conversationId: ConversationId): Promise<ExternalDestination | undefined> }
export interface GateDeliveryContext { botId: BotId; attachments: Pick<AttachmentPort, 'open'> }
export interface GateAdapter { type: 'telegram'; capabilities(): GateCapabilities; validate(): Promise<void>; start(onInbound: (event: InboundEvent) => Promise<void>, ports: GateRuntimePorts): Promise<void>; stop(): Promise<void>; render(message: CanonicalMessage): Promise<RenderedPart[]>; deliver(part: RenderedPart, destination: ExternalDestination, signal: AbortSignal, context: GateDeliveryContext): Promise<DeliveryOutcome>; draft?(runId: RunId, destination: ExternalDestination, text: string): Promise<string | undefined>; stopDraft?(draftId: string): Promise<void>; modelContext?(): string | undefined; modelTools?(): NativeToolSet }
export interface GateRuntimeContext { botId: BotId; botRoot: string }
