import { expect, test } from 'bun:test';
import { chatgptSubscriptionAdapter, SubscriptionAuthUnavailable } from './index.ts';
import type { BotId, CredentialStore } from '@vian/core';

test('subscription adapter fails closed until supported client arrangement exists', async () => {
  const adapter = chatgptSubscriptionAdapter({} as CredentialStore);
  await expect(adapter.resolveModel({ botId: '00000000-0000-4000-8000-000000000001' as BotId, botRoot: '/tmp/bot', modelId: 'model', credential: 'oauth:openai-chatgpt:default' })).rejects.toBeInstanceOf(SubscriptionAuthUnavailable);
});
