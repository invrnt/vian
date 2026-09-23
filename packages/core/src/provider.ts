import type { LanguageModel } from 'ai';
import type { SecretReference } from './config.ts';
import type { BotId } from './identity.ts';
export interface ProviderAdapter { id: string; resolveModel(input: { botId: BotId; botRoot: string; modelId: string; credential?: SecretReference }): Promise<LanguageModel> }
export type ProviderErrorCode = 'auth-required' | 'unsupported-input' | 'rate-limited' | 'retryable-transport' | 'terminal-provider' | 'cancelled';
export interface SafeProviderError { code: ProviderErrorCode; message: string; retryAfterMs?: number }
export interface ProviderMetadata { provider: string; model: string; finishReason?: string; inputTokens?: number; outputTokens?: number; latencyMs?: number; correlationId?: string }
