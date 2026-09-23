import type { CommandModule } from '@vian/core';
import { FileCredentialStore } from '@vian/credentials';
import { createAuthorization, exchangeAuthorization, saveSubscriptionTokens, waitForLoopback } from '@vian/provider-openai-chatgpt';
import { readHiddenLine } from '../hidden-input.ts';

type ApiKeyProvider = 'google' | 'vercel-ai-gateway';
const apiKeyProviders = new Set<string>(['google', 'vercel-ai-gateway']);
export function providerProfile(provider: string): string {
  return provider === 'openai-chatgpt' ? 'default' : `${provider}-default`;
}

export async function saveProviderApiKey(store: FileCredentialStore, provider: ApiKeyProvider, key: string): Promise<void> {
  if (!key || /\s/.test(key) || key.length > 4096) throw new Error('Provider API key is empty or malformed.');
  const name = providerProfile(provider);
  await store.withProfileLock(name, () => store.replace(name, new TextEncoder().encode(key), {
    name, provider, status: 'ready', updatedAt: new Date().toISOString(),
  }));
}

export const authCommand: CommandModule = {
  async run(args, context) {
    const store = new FileCredentialStore();
    const [verb, provider, ...rest] = args;
    if (rest.length || (provider && provider !== 'openai-chatgpt' && !apiKeyProviders.has(provider))) {
      context.stderr('Usage: vian auth login openai-chatgpt | set google|vercel-ai-gateway | list | status|logout <provider>\n'); return 2;
    }
    if (verb === 'list') {
      if (provider) { context.stderr('Usage: vian auth list\n'); return 2; }
      context.stdout(`${JSON.stringify((await store.list()).map(({ name, provider, status, updatedAt, expiresAt }) => ({ name, provider, status, updatedAt, expiresAt })))}\n`); return 0;
    }
    if (!provider) { context.stderr('Provider required\n'); return 2; }
    if (verb === 'status') {
      const name = providerProfile(provider);
      const record = (await store.list()).find(x => x.name === name && x.provider === provider);
      context.stdout(`${JSON.stringify(record ?? { name, provider, status: 'reauth-required' })}\n`); return record?.status === 'ready' ? 0 : 1;
    }
    if (verb === 'logout') { await store.remove(providerProfile(provider)); context.stdout('Credential profile removed\n'); return 0; }
    if (verb === 'set' && apiKeyProviders.has(provider)) {
      try {
        const key = await readHiddenLine(`${provider} API key: `);
        await saveProviderApiKey(store, provider as ApiKeyProvider, key);
        context.stdout(`Credential saved as profile:${providerProfile(provider)}.\n`);
        return 0;
      } catch (error) { context.stderr(`${error instanceof Error ? error.message : 'Credential was not saved.'}\n`); return 1; }
    }
    if (verb === 'login') {
      if (provider !== 'openai-chatgpt') { context.stderr('Use vian auth set for API-key providers.\n'); return 2; }
      try {
        const attempt = createAuthorization();
        const code = await waitForLoopback(attempt, url => context.stdout(`Open this URL to authorize Vian:\n${url}\n`), process.stdin.isTTY ? signal => readHiddenLine('Paste the complete callback URL, or finish in your browser: ', signal) : undefined);
        const tokens = await exchangeAuthorization(code, attempt);
        await saveSubscriptionTokens(store, 'default', tokens);
        context.stdout('Codex subscription authentication saved for profile default.\n');
        return 0;
      } catch (error) {
        context.stderr(`${error instanceof Error ? error.message : 'Codex login failed.'}\n`);
        return 1;
      }
    }
    context.stderr('Usage: vian auth login openai-chatgpt | set google|vercel-ai-gateway | list | status|logout <provider>\n'); return 2;
  },
};
