import type { CredentialStore, ProviderAdapter } from '@vian/core';

export class SubscriptionAuthUnavailable extends Error {
  constructor() { super('ChatGPT subscription authentication requires a supported Vian OAuth client arrangement'); this.name = 'SubscriptionAuthUnavailable'; }
}

// Subscription payload and transport stay in this package. A login or model request
// must never borrow another application's OAuth client registration or credentials.
export function chatgptSubscriptionAdapter(_profiles: CredentialStore): ProviderAdapter {
  return {
    id: 'openai-chatgpt',
    async resolveModel({ credential }) {
      if (!credential?.startsWith('oauth:openai-chatgpt:')) throw new Error('ChatGPT subscription requires a global OAuth profile reference');
      throw new SubscriptionAuthUnavailable();
    },
  };
}
