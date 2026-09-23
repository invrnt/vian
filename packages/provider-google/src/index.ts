import { createGoogleGenerativeAI, type GoogleGenerativeAIProviderSettings } from '@ai-sdk/google';
import type { ProviderAdapter, SecretResolver } from '@vian/core';

export function googleAdapter(secrets: SecretResolver, options: Pick<GoogleGenerativeAIProviderSettings, 'fetch'> = {}): ProviderAdapter {
  return {
    id: 'google',
    async resolveModel({ botId, botRoot, modelId, credential }) {
      if (!credential || (!credential.startsWith('env:') && credential !== 'profile:google-default')) throw new Error('Google requires a bot environment or profile:google-default credential reference');
      const apiKey = await secrets.resolve(botId, botRoot, credential);
      return createGoogleGenerativeAI({ apiKey, ...options }).languageModel(modelId);
    },
  };
}
