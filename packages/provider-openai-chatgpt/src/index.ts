import type { CredentialStore, ProviderAdapter } from '@vian/core';
import { subscriptionModel } from './transport.ts';
export { createAuthorization, acceptAuthorization, exchangeAuthorization, refreshAuthorization, activeSubscriptionTokens, saveSubscriptionTokens, waitForLoopback, SubscriptionAuthError } from './oauth.ts';
export type { SubscriptionTokens, AuthorizationAttempt } from './oauth.ts';

export function chatgptSubscriptionAdapter(profiles: CredentialStore, fetcher: typeof fetch = fetch): ProviderAdapter {
  return {
    id: 'openai-chatgpt',
    async resolveModel({ credential, modelId }) {
      if (!credential?.startsWith('oauth:openai-chatgpt:')) throw new Error('ChatGPT subscription requires a global OAuth profile reference');
      return subscriptionModel(profiles, credential.slice('oauth:openai-chatgpt:'.length), modelId, fetcher);
    },
  };
}
