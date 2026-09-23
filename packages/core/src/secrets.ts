import type { BotId } from './identity.ts';
import type { SecretReference } from './config.ts';
export interface SecretResolver { resolve(botId: BotId, botRoot: string, reference: SecretReference): Promise<string> }
export interface ProfileMetadata { name: string; provider: string; status: 'ready' | 'reauth-required'; updatedAt: string; expiresAt?: string }
export interface TokenSink { replace(profile: string, payload: Uint8Array, metadata: ProfileMetadata): Promise<void>; markReauthRequired(profile: string): Promise<void> }
export interface CredentialStore extends TokenSink { list(): Promise<ProfileMetadata[]>; read(profile: string): Promise<Uint8Array | undefined>; remove(profile: string): Promise<void>; withProfileLock<T>(profile: string, action: () => Promise<T>): Promise<T> }
