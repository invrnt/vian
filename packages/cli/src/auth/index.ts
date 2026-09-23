import type { CommandModule } from '@vian/core';
import { FileCredentialStore } from '@vian/credentials';
import { createAuthorization, exchangeAuthorization, saveSubscriptionTokens, waitForLoopback } from '@vian/provider-openai-chatgpt';

function hiddenCallbackInput(signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const input = process.stdin;
    if (!input.isTTY || !input.setRawMode) { reject(new Error('Manual callback requires an interactive terminal.')); return; }
    let value = '';
    const previous = input.isRaw;
    const cleanup = () => { input.off('data', onData); signal.removeEventListener('abort', onAbort); input.setRawMode(previous ?? false); input.pause(); process.stderr.write('\n'); };
    const onAbort = () => { cleanup(); reject(new Error('Manual login input cancelled.')); };
    const onData = (chunk: Buffer) => {
      for (const byte of chunk) {
        if (byte === 3) { cleanup(); reject(new Error('Login cancelled.')); return; }
        if (byte === 13 || byte === 10) { cleanup(); resolve(value); return; }
        if (byte === 127) value = value.slice(0, -1);
        else if (byte >= 32 && byte < 127 && value.length < 4096) value += String.fromCharCode(byte);
      }
    };
    process.stderr.write('Paste the complete callback URL, or finish in your browser: ');
    input.setRawMode(true); input.resume(); input.on('data', onData); signal.addEventListener('abort', onAbort, { once: true });
  });
}

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
    if (verb === 'login') {
      try {
        const attempt = createAuthorization();
        const code = await waitForLoopback(attempt, url => context.stdout(`Open this URL to authorize Vian:\n${url}\n`), process.stdin.isTTY ? hiddenCallbackInput : undefined);
        const tokens = await exchangeAuthorization(code, attempt);
        await saveSubscriptionTokens(store, 'default', tokens);
        context.stdout('Codex subscription authentication saved for profile default.\n');
        return 0;
      } catch (error) {
        context.stderr(`${error instanceof Error ? error.message : 'Codex login failed.'}\n`);
        return 1;
      }
    }
    context.stderr('Usage: vian auth login|list|status|logout [openai-chatgpt]\n'); return 2;
  },
};
