// Adapted from OpenClaw 0e79899fedc26ae9a90a196a8bc41b97fd39d7e5,
// extensions/openai/openai-chatgpt-oauth-{authorization,flow,token}.runtime.ts (MIT).
import { createHash, randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { CredentialStore, ProfileMetadata } from '@vian/core';

const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const AUTHORIZE_URL = 'https://auth.openai.com/oauth/authorize';
const TOKEN_URL = 'https://auth.openai.com/oauth/token';
const REDIRECT_URI = 'http://localhost:1455/auth/callback';
const TOKEN_TIMEOUT_MS = 30_000;
const MAX_TOKEN_BYTES = 1024 * 1024;
const encoder = new TextEncoder();

export class SubscriptionAuthError extends Error {
  constructor(readonly kind: 'reauth-required' | 'transient' | 'cancelled' | 'invalid-callback', message: string) {
    super(message); this.name = 'SubscriptionAuthError';
  }
}

export interface SubscriptionTokens { access: string; refresh: string; expires: number; accountId: string }
export interface AuthorizationAttempt { url: string; verifier: string; state: string; redirectUri: string; expiresAt: number }

function accountIdFromJwt(access: string): string {
  try {
    const payload = JSON.parse(Buffer.from(access.split('.')[1] ?? '', 'base64url').toString('utf8')) as Record<string, unknown>;
    const auth = payload['https://api.openai.com/auth'];
    if (auth && typeof auth === 'object') {
      const id = (auth as Record<string, unknown>).chatgpt_account_id;
      if (typeof id === 'string' && id.length > 0) return id;
    }
  } catch { /* A malformed token is a failed login, never an output diagnostic. */ }
  throw new SubscriptionAuthError('reauth-required', 'Codex token has no ChatGPT account identity.');
}

export function createAuthorization(now = Date.now()): AuthorizationAttempt {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const state = randomBytes(24).toString('hex');
  const url = new URL(AUTHORIZE_URL);
  for (const [key, value] of Object.entries({
    response_type: 'code', client_id: CLIENT_ID, redirect_uri: REDIRECT_URI,
    scope: 'openid profile email offline_access', code_challenge: challenge,
    code_challenge_method: 'S256', state, id_token_add_organizations: 'true',
    codex_cli_simplified_flow: 'true', originator: 'vian',
  })) url.searchParams.set(key, value);
  return { url: url.toString(), verifier, state, redirectUri: REDIRECT_URI, expiresAt: now + 10 * 60_000 };
}

export function acceptAuthorization(input: string, attempt: AuthorizationAttempt, now = Date.now()): string {
  if (now >= attempt.expiresAt) throw new SubscriptionAuthError('invalid-callback', 'Login expired. Start again.');
  let params: URLSearchParams;
  try {
    const url = new URL(input);
    if (url.origin !== 'http://localhost:1455' || url.pathname !== '/auth/callback') throw new Error();
    params = url.searchParams;
  } catch {
    if (!input.startsWith('?')) throw new SubscriptionAuthError('invalid-callback', 'Paste the complete callback URL.');
    params = new URLSearchParams(input.slice(1));
  }
  if (params.get('state') !== attempt.state) throw new SubscriptionAuthError('invalid-callback', 'Login state did not match.');
  const code = params.get('code');
  if (!code || params.has('error')) throw new SubscriptionAuthError('invalid-callback', 'Login was not authorized.');
  return code;
}

async function tokenRequest(body: URLSearchParams, fetcher: typeof fetch, signal?: AbortSignal): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetcher(TOKEN_URL, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body, signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(TOKEN_TIMEOUT_MS)]) : AbortSignal.timeout(TOKEN_TIMEOUT_MS) });
  } catch {
    if (signal?.aborted) throw new SubscriptionAuthError('cancelled', 'Login cancelled.');
    throw new SubscriptionAuthError('transient', 'Codex token service is unavailable.');
  }
  const chunks: Uint8Array[] = [];
  let length = 0;
  const reader = response.body?.getReader();
  if (!reader) throw new SubscriptionAuthError('transient', 'Codex token response was empty.');
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;
      length += value.byteLength;
      if (length > MAX_TOKEN_BYTES) throw new SubscriptionAuthError('transient', 'Codex token response was too large.');
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  const bytes = Buffer.concat(chunks, length);
  let data: Record<string, unknown> = {};
  try { data = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>; } catch { /* Keep raw body out of diagnostics. */ }
  if (!response.ok) {
    const raw = typeof data.error === 'string' ? data.error : typeof data.error === 'object' && data.error ? (data.error as Record<string, unknown>).code : undefined;
    const terminal = response.status === 400 || response.status === 401 || raw === 'invalid_grant' || raw === 'invalid_refresh_token';
    throw new SubscriptionAuthError(terminal ? 'reauth-required' : 'transient', terminal ? 'Codex authentication expired. Sign in again.' : 'Codex token service is unavailable.');
  }
  return data;
}

function decodeTokens(data: Record<string, unknown>, existingRefresh?: string, now = Date.now()): SubscriptionTokens {
  const access = data.access_token, refresh = data.refresh_token ?? existingRefresh, duration = data.expires_in;
  if (typeof access !== 'string' || typeof refresh !== 'string' || typeof duration !== 'number' || !Number.isFinite(duration) || duration <= 0) {
    throw new SubscriptionAuthError('transient', 'Codex token response was incomplete.');
  }
  return { access, refresh, expires: now + duration * 1000, accountId: accountIdFromJwt(access) };
}

export async function exchangeAuthorization(code: string, attempt: AuthorizationAttempt, fetcher: typeof fetch = fetch, signal?: AbortSignal): Promise<SubscriptionTokens> {
  const data = await tokenRequest(new URLSearchParams({ grant_type: 'authorization_code', client_id: CLIENT_ID, code, code_verifier: attempt.verifier, redirect_uri: attempt.redirectUri }), fetcher, signal);
  return decodeTokens(data);
}

export async function refreshAuthorization(refresh: string, fetcher: typeof fetch = fetch, signal?: AbortSignal): Promise<SubscriptionTokens> {
  const data = await tokenRequest(new URLSearchParams({ grant_type: 'refresh_token', client_id: CLIENT_ID, refresh_token: refresh }), fetcher, signal);
  return decodeTokens(data, refresh);
}

function metadata(profile: string, tokens: SubscriptionTokens): ProfileMetadata {
  return { name: profile, provider: 'openai-chatgpt', status: 'ready', updatedAt: new Date().toISOString(), expiresAt: new Date(tokens.expires).toISOString() };
}

export async function saveSubscriptionTokens(store: CredentialStore, profile: string, tokens: SubscriptionTokens): Promise<void> {
  await store.withProfileLock(profile, () => store.replace(profile, encoder.encode(JSON.stringify(tokens)), metadata(profile, tokens)));
}

export async function activeSubscriptionTokens(store: CredentialStore, profile: string, fetcher: typeof fetch = fetch): Promise<SubscriptionTokens> {
  return store.withProfileLock(profile, async () => {
    const raw = await store.read(profile);
    if (!raw) throw new SubscriptionAuthError('reauth-required', 'Codex sign-in is required.');
    let current: SubscriptionTokens;
    try { current = JSON.parse(new TextDecoder().decode(raw)) as SubscriptionTokens; }
    catch { throw new SubscriptionAuthError('reauth-required', 'Codex credential is invalid.'); }
    if (!current.refresh || !current.access || !current.accountId || !Number.isFinite(current.expires)) throw new SubscriptionAuthError('reauth-required', 'Codex credential is invalid.');
    if (current.expires > Date.now() + 60_000) return current;
    let updated: SubscriptionTokens;
    try { updated = await refreshAuthorization(current.refresh, fetcher); }
    catch (error) {
      if (error instanceof SubscriptionAuthError && error.kind === 'reauth-required') {
        await store.replace(profile, new Uint8Array(), { name: profile, provider: 'openai-chatgpt', status: 'reauth-required', updatedAt: new Date().toISOString() });
      }
      throw error;
    }
    if (updated.accountId !== current.accountId) {
      await store.replace(profile, new Uint8Array(), { name: profile, provider: 'openai-chatgpt', status: 'reauth-required', updatedAt: new Date().toISOString() });
      throw new SubscriptionAuthError('reauth-required', 'Codex account changed during refresh. Sign in again.');
    }
    await store.replace(profile, encoder.encode(JSON.stringify(updated)), metadata(profile, updated));
    return updated;
  });
}

export async function waitForLoopback(attempt: AuthorizationAttempt, onUrl: (url: string) => Promise<void> | void, manualCode?: (signal: AbortSignal) => Promise<string>, signal?: AbortSignal): Promise<string> {
  if (signal?.aborted) throw new SubscriptionAuthError('cancelled', 'Login cancelled.');
  let server: Server | undefined;
  let consumed = false;
  const stopManual = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let finish!: (value: string) => void;
  let fail!: (error: Error) => void;
  const callback = new Promise<string>((resolve, reject) => { finish = resolve; fail = reject; });
  try {
    server = createServer((request, response) => {
      try {
        if (consumed) throw new SubscriptionAuthError('invalid-callback', 'Login callback was already used.');
        const code = acceptAuthorization(new URL(request.url ?? '', REDIRECT_URI).toString(), attempt);
        consumed = true;
        response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', connection: 'close' }); response.end('Vian login complete. You can close this page.');
        finish(code);
      } catch (error) {
        response.writeHead(400, { 'content-type': 'text/plain; charset=utf-8', connection: 'close' }); response.end('Invalid or expired login callback.');
        // A forged callback does not consume a valid attempt.
        if (!(error instanceof SubscriptionAuthError)) fail(new SubscriptionAuthError('invalid-callback', 'Invalid callback.'));
      }
    });
    const listening = await new Promise<boolean>(resolve => { server!.once('error', () => resolve(false)); server!.listen(1455, 'localhost', () => resolve(true)); });
    await onUrl(attempt.url);
    if (!listening && !manualCode) throw new SubscriptionAuthError('invalid-callback', 'Loopback callback is unavailable.');
    const candidates: Promise<string>[] = [];
    if (listening) candidates.push(callback);
    if (manualCode) candidates.push(manualCode(stopManual.signal).then(value => acceptAuthorization(value, attempt)));
    const timeout = new Promise<never>((_, reject) => { timeoutId = setTimeout(() => reject(new SubscriptionAuthError('invalid-callback', 'Login expired. Start again.')), Math.max(0, attempt.expiresAt - Date.now())); });
    const abort = new Promise<never>((_, reject) => signal?.addEventListener('abort', () => reject(new SubscriptionAuthError('cancelled', 'Login cancelled.')), { once: true }));
    return await Promise.race([...candidates, timeout, abort]);
  } finally { stopManual.abort(); if (timeoutId) clearTimeout(timeoutId); server?.close(); server?.closeAllConnections(); }
}
