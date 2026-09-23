import type { MessageId, RunId, SessionId } from './identity.ts';
import type { CanonicalMessage } from './messages.ts';
/** Called only after all tools and durable results in the current step have settled. */
export interface SteeringBatch { runId: RunId; sessionId: SessionId; messages: CanonicalMessage[]; consumedIds: MessageId[]; barrierReached: boolean }
export interface StepBoundary { runId: RunId; sessionId: SessionId; stepNumber: number; toolBatchSettled: boolean; remainingSteps: number; deadlineAt: string }
export interface StepContinuationPort { claimSteeringBatch(boundary: StepBoundary, maximum: number): Promise<SteeringBatch> }
