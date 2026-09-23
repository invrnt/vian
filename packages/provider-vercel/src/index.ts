import { createGateway, type GatewayProviderSettings } from '@ai-sdk/gateway';
import type { ProviderAdapter, SecretResolver } from '@vian/core';

export function gatewayAdapter(secrets: SecretResolver, options: Pick<GatewayProviderSettings, 'fetch'> = {}): ProviderAdapter {
  return {
    id: 'vercel-ai-gateway',
    async resolveModel({ botId, botRoot, modelId, credential }) {
      if (!credential || !credential.startsWith('env:')) throw new Error('Gateway requires a bot environment credential reference');
      const apiKey = await secrets.resolve(botId, botRoot, credential);
      return createGateway({ apiKey, ...options }).languageModel(modelId);
    },
  };
}
