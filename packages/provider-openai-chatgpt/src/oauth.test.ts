import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import { FileCredentialStore } from '@vian/credentials';
import { acceptAuthorization, activeSubscriptionTokens, createAuthorization, exchangeAuthorization, saveSubscriptionTokens, SubscriptionAuthError, waitForLoopback } from './oauth.ts';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(x => rm(x, { recursive: true, force: true }))); });
const jwt = (id: string) => `header.${Buffer.from(JSON.stringify({ 'https://api.openai.com/auth': { chatgpt_account_id: id } })).toString('base64url')}.sig`;
async function store(): Promise<FileCredentialStore> { const root = await mkdtemp(join(tmpdir(), 'vian-oauth-')); roots.push(root); return new FileCredentialStore(join(root, 'credentials')); }

test('PKCE URL, strict state, expiry, and token exchange', async () => {
  const attempt = createAuthorization(1000);
  const url = new URL(attempt.url);
  expect(url.origin).toBe('https://auth.openai.com');
  expect(url.searchParams.get('redirect_uri')).toBe('http://localhost:1455/auth/callback');
  expect(url.searchParams.get('code_challenge_method')).toBe('S256');
  expect(attempt.state.length).toBeGreaterThan(32);
  const callback = `http://localhost:1455/auth/callback?state=${attempt.state}&code=fixture-code`;
  expect(acceptAuthorization(callback, attempt, 2000)).toBe('fixture-code');
  expect(() => acceptAuthorization(callback.replace(attempt.state, 'wrong'), attempt, 2000)).toThrow('state');
  expect(() => acceptAuthorization(callback, attempt, attempt.expiresAt)).toThrow('expired');
  expect(() => acceptAuthorization('https://other.example/?code=x', attempt, 2000)).toThrow('complete callback');
  let posted: URLSearchParams | undefined;
  const fetcher = (async (_url: RequestInfo | URL, init?: RequestInit) => {
    posted = init?.body as URLSearchParams;
    return Response.json({ access_token: jwt('acct-a'), refresh_token: 'canary-refresh', expires_in: 3600 });
  }) as typeof fetch;
  const tokens = await exchangeAuthorization('fixture-code', attempt, fetcher);
  expect(tokens.accountId).toBe('acct-a');
  expect(posted?.get('code_verifier')).toBe(attempt.verifier);
  expect(posted?.get('redirect_uri')).toBe(attempt.redirectUri);
});

test('two consumers refresh once through the global profile lock and rotate immediately', async () => {
  const profiles = await store();
  await saveSubscriptionTokens(profiles, 'default', { access: jwt('acct-a'), refresh: 'canary-old', expires: Date.now() - 1, accountId: 'acct-a' });
  let refreshes = 0;
  const fetcher = (async (_url: RequestInfo | URL, init?: RequestInit) => {
    refreshes++;
    expect((init?.body as URLSearchParams).get('refresh_token')).toBe('canary-old');
    await Bun.sleep(25);
    return Response.json({ access_token: jwt('acct-a'), refresh_token: 'canary-new', expires_in: 3600 });
  }) as typeof fetch;
  const [one, two] = await Promise.all([activeSubscriptionTokens(profiles, 'default', fetcher), activeSubscriptionTokens(new FileCredentialStore(profiles.root), 'default', fetcher)]);
  expect(refreshes).toBe(1);
  expect(one.refresh).toBe('canary-new');
  expect(two.refresh).toBe('canary-new');
  expect(new TextDecoder().decode((await profiles.read('default'))!)).toContain('canary-new');
  expect(JSON.stringify(await profiles.list())).not.toContain('canary-new');
});

test('terminal refresh revokes payload and requires one new login', async () => {
  const profiles = await store();
  await saveSubscriptionTokens(profiles, 'default', { access: jwt('acct-a'), refresh: 'canary-old', expires: 0, accountId: 'acct-a' });
  let calls = 0;
  const fetcher = (async () => { calls++; return Response.json({ error: 'invalid_grant' }, { status: 400 }); }) as unknown as typeof fetch;
  await expect(activeSubscriptionTokens(profiles, 'default', fetcher)).rejects.toBeInstanceOf(SubscriptionAuthError);
  expect((await profiles.list())[0]?.status).toBe('reauth-required');
  expect(await profiles.read('default')).toBeUndefined();
  await expect(activeSubscriptionTokens(profiles, 'default', fetcher)).rejects.toBeInstanceOf(SubscriptionAuthError);
  expect(calls).toBe(1);
});

test('loopback rejects forged callback, then accepts the matching state', async () => {
  const attempt = createAuthorization();
  const code = await waitForLoopback(attempt, async () => {
    const invalid = await fetch(`http://localhost:1455/auth/callback?state=wrong&code=forged`);
    expect(invalid.status).toBe(400);
    const valid = await fetch(`http://localhost:1455/auth/callback?state=${attempt.state}&code=valid`);
    expect(valid.status).toBe(200);
    const replay = await fetch(`http://localhost:1455/auth/callback?state=${attempt.state}&code=valid`);
    expect(replay.status).toBe(400);
  });
  expect(code).toBe('valid');
});

test('busy loopback port uses strict manual callback fallback', async () => {
  const blocker = createServer((_req, res) => res.end('occupied'));
  await new Promise<void>(resolve => blocker.listen(1455, 'localhost', resolve));
  try {
    const attempt = createAuthorization();
    const code = await waitForLoopback(attempt, () => {}, async () => `http://localhost:1455/auth/callback?state=${attempt.state}&code=manual`);
    expect(code).toBe('manual');
  } finally { await new Promise<void>(resolve => blocker.close(() => resolve())); }
});
