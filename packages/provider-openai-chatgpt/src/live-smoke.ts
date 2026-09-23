// Opt-in local operator check. Never prints credentials, account identity or response bodies.
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { stepCountIs, streamText, tool } from 'ai';
import { z } from 'zod';
import { FileCredentialStore } from '@vian/credentials';
import type { BotId } from '@vian/core';
import { chatgptSubscriptionAdapter } from './index.ts';
import { activeSubscriptionTokens, refreshAuthorization } from './oauth.ts';

const modelId = process.env.VIAN_LIVE_MODEL ?? 'gpt-5.5';
const root = await mkdtemp(join(tmpdir(), 'vian-provider-live-'));
try {
  await Promise.all([mkdir(join(root, 'bot-a')), mkdir(join(root, 'bot-b'))]);
  const profile = new FileCredentialStore();
  const adapter = chatgptSubscriptionAdapter(profile);
  const model = await adapter.resolveModel({ botId: '00000000-0000-4000-8000-000000000001' as BotId, botRoot: join(root, 'bot-a'), modelId, credential: 'oauth:openai-chatgpt:default' });
  const result = streamText({ model, prompt: 'Reply with the single word OK.' });
  let count = 0;
  for await (const delta of result.textStream) count += delta.length;
  const finish = await result.finishReason;
  process.stdout.write(`normal_stream=${count > 0 && finish === 'stop' ? 'PASS' : 'FAIL'} model=${modelId} chars=${count} finish=${finish}\n`);
  if (process.env.VIAN_LIVE_CHECK === 'tools') {
    let executions = 0;
    const toolsResult = streamText({ model, prompt: 'Call the lookup tool with query "vian-live-fixture". Then give a short answer based only on its result.', tools: { lookup: tool({ description: 'Look up a fixture key.', inputSchema: z.object({ query: z.string() }), execute: async () => { executions++; return { value: 'found' }; } }) }, stopWhen: stepCountIs(2) });
    const answer = await toolsResult.text;
    process.stdout.write(`tool_loop=${executions === 1 && answer.length > 0 ? 'PASS' : 'FAIL'} model=${modelId} executions=${executions} answer_chars=${answer.length}\n`);
    if (executions !== 1 || !answer.length) process.exitCode = 1;
  }
  if (process.env.VIAN_LIVE_CHECK === 'abort') {
    const controller = new AbortController();
    const aborted = streamText({ model, prompt: 'Count from 1 to 1000, one number per line.', abortSignal: controller.signal });
    let sawDelta = false, stopped = false;
    try {
      for await (const delta of aborted.textStream) {
        if (delta) { sawDelta = true; controller.abort(); }
      }
    } catch { stopped = controller.signal.aborted; }
    process.stdout.write(`abort=${sawDelta && stopped ? 'PASS' : 'INCONCLUSIVE'} model=${modelId} saw_delta=${sawDelta} cancelled=${stopped}\n`);
    if (!sawDelta || !stopped) process.exitCode = 1;
  }
  if (process.env.VIAN_LIVE_CHECK === 'error') {
    const invalid = await adapter.resolveModel({ botId: '00000000-0000-4000-8000-000000000001' as BotId, botRoot: join(root, 'bot-a'), modelId: 'vian-invalid-model-fixture', credential: 'oauth:openai-chatgpt:default' });
    const tokens = await activeSubscriptionTokens(profile, 'default');
    let safe = false;
    try {
      if (typeof invalid === 'string' || !('doStream' in invalid)) throw new Error('No model object');
      await invalid.doStream({ prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }] });
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      safe = !message.includes(tokens.access) && !message.includes(tokens.refresh) && !message.includes(tokens.accountId) && message === 'Codex request failed';
    }
    process.stdout.write(`safe_error=${safe ? 'PASS' : 'FAIL'} model=vian-invalid-model-fixture\n`);
    if (!safe) process.exitCode = 1;
  }
  if (process.env.VIAN_LIVE_CHECK === 'refresh') {
    const before = await activeSubscriptionTokens(profile, 'default');
    let accessChanged = false, refreshChanged = false;
    await profile.withProfileLock('default', async () => {
      const currentRaw = await profile.read('default');
      if (!currentRaw) throw new Error('Credential unavailable');
      const current = JSON.parse(new TextDecoder().decode(currentRaw)) as typeof before;
      const updated = await refreshAuthorization(current.refresh);
      if (updated.accountId !== current.accountId) throw new Error('Account identity changed');
      await profile.replace('default', new TextEncoder().encode(JSON.stringify(updated)), { name: 'default', provider: 'openai-chatgpt', status: 'ready', updatedAt: new Date().toISOString(), expiresAt: new Date(updated.expires).toISOString() });
      accessChanged = updated.access !== current.access;
      refreshChanged = updated.refresh !== current.refresh;
    });
    const after = await activeSubscriptionTokens(profile, 'default');
    const persisted = after.access !== before.access && (await profile.list())[0]?.status === 'ready';
    process.stdout.write(`refresh=${persisted && accessChanged ? 'PASS' : 'FAIL'} model=${modelId} refresh_rotated=${refreshChanged} persisted=${persisted}\n`);
    if (!persisted || !accessChanged) process.exitCode = 1;
  }
  if (process.env.VIAN_LIVE_CHECK === 'shared') {
    const second = await adapter.resolveModel({ botId: '00000000-0000-4000-8000-000000000002' as BotId, botRoot: join(root, 'bot-b'), modelId, credential: 'oauth:openai-chatgpt:default' });
    const jobs = [model, second].map(async selected => {
      const result = streamText({ model: selected, prompt: 'Reply with OK.' });
      return (await result.text).length > 0 && await result.finishReason === 'stop';
    });
    const results = await Promise.all(jobs);
    process.stdout.write(`shared_profile=${results.every(Boolean) ? 'PASS' : 'FAIL'} model=${modelId} bot_roots=2\n`);
    if (!results.every(Boolean)) process.exitCode = 1;
  }
} catch (error) {
  const message = error instanceof Error ? error.message : '';
  const safeClass = message.includes('sign-in') ? 'auth-required' : message.includes('rate limit') ? 'rate-limited' : 'provider-failure';
  process.stdout.write(`normal_stream=FAIL model=${modelId} class=${safeClass}\n`);
  process.exitCode = 1;
} finally { await rm(root, { recursive: true, force: true }); }
