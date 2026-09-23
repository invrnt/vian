import type { CommandModule } from '@vian/core';
import { FileCredentialStore } from '@vian/credentials';
import { SubscriptionAuthUnavailable } from '@vian/provider-openai-chatgpt';

export const authCommand: CommandModule = {
  async run(args, context) {
    const store = new FileCredentialStore();
    const [verb, provider, ...rest] = args;
    if (rest.length || (provider && provider !== 'openai-chatgpt')) {
      context.stderr('Usage: vian auth login|list|status|logout [openai-chatgpt]\n'); return 2;
    }
    if (verb === 'list') {
      if (provider) { context.stderr('Usage: vian auth list\n'); return 2; }
      context.stdout(`${JSON.stringify((await store.list()).map(({ name, provider, status, updatedAt, expiresAt }) => ({ name, provider, status, updatedAt, expiresAt })))}\n`); return 0;
    }
    if (!provider) { context.stderr('Provider required\n'); return 2; }
    if (verb === 'status') {
      const record = (await store.list()).find(x => x.name === 'default' && x.provider === provider);
      context.stdout(`${JSON.stringify(record ?? { name: 'default', provider, status: 'reauth-required' })}\n`); return record?.status === 'ready' ? 0 : 1;
    }
    if (verb === 'logout') { await store.remove('default'); context.stdout('Credential profile removed\n'); return 0; }
    if (verb === 'login') { context.stderr(`${new SubscriptionAuthUnavailable().message}\n`); return 1; }
    context.stderr('Usage: vian auth login|list|status|logout [openai-chatgpt]\n'); return 2;
  },
};
