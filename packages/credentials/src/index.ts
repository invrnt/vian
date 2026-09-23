import { chmod, mkdir, open, readFile, readdir, rename, rm, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import type { BotId, CredentialStore, ProfileMetadata, SecretReference, SecretResolver } from '@vian/core';
export { safeProviderError } from './provider-error.ts';

const profilePattern = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
function profileName(name: string): string {
  if (!profilePattern.test(name) || name === '.' || name === '..') throw new Error('Invalid credential profile name');
  return name;
}

export function defaultCredentialRoot(): string {
  return resolve(process.env.VIAN_HOME ?? join(homedir(), '.local', 'share', 'vian'), 'credentials');
}

export function redactSecrets(text: string, secrets: Iterable<string>): string {
  let result = text;
  for (const secret of secrets) if (secret) result = result.split(secret).join('[REDACTED]');
  return result;
}

function parseEnv(source: string): Map<string, string> {
  const values = new Map<string, string>();
  for (const line of source.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match) continue;
    let value = match[2]!;
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    else value = value.replace(/\s+#.*$/, '');
    values.set(match[1]!, value);
  }
  return values;
}

export class BotSecretResolver implements SecretResolver {
  constructor(private readonly profiles?: CredentialStore) {}
  async resolve(_botId: BotId, botRoot: string, reference: SecretReference): Promise<string> {
    if (reference.startsWith('env:')) {
      let source: string;
      try { source = await readFile(join(resolve(botRoot), '.env'), 'utf8'); }
      catch { throw new Error(`Missing bot environment file at ${resolve(botRoot)}`); }
      const value = parseEnv(source).get(reference.slice(4));
      if (!value) throw new Error(`Missing bot secret reference ${reference}`);
      return value;
    }
    if (reference.startsWith('profile:') && this.profiles) {
      const value = await this.profiles.read(profileName(reference.slice(8)));
      if (!value) throw new Error(`Credential profile ${reference} requires authentication`);
      return new TextDecoder().decode(value);
    }
    throw new Error('Unsupported credential reference');
  }
}

async function syncDirectory(path: string): Promise<void> {
  const dir = await open(path, 'r');
  try { await dir.sync(); } finally { await dir.close(); }
}

export class FileCredentialStore implements CredentialStore {
  constructor(readonly root = defaultCredentialRoot()) {}
  private async ready(): Promise<void> { await mkdir(this.root, { recursive: true, mode: 0o700 }); await chmod(this.root, 0o700); }
  private path(name: string): string { return join(this.root, `${profileName(name)}.json`); }
  async list(): Promise<ProfileMetadata[]> {
    await this.ready();
    const result: ProfileMetadata[] = [];
    for (const name of await readdir(this.root)) {
      if (!name.endsWith('.json')) continue;
      const profile = name.slice(0, -5);
      if (!profilePattern.test(profile)) continue;
      try {
        const envelope = JSON.parse(await readFile(this.path(profile), 'utf8')) as { metadata: ProfileMetadata };
        const { provider, status, updatedAt, expiresAt } = envelope.metadata;
        if (typeof provider !== 'string' || typeof updatedAt !== 'string' || !['ready', 'reauth-required'].includes(status)) continue;
        result.push({ name: profile, provider, status, updatedAt, ...(typeof expiresAt === 'string' ? { expiresAt } : {}) });
      }
      catch { /* An interrupted temp write is never listed as a profile. */ }
    }
    return result.sort((a, b) => a.name.localeCompare(b.name));
  }
  async read(name: string): Promise<Uint8Array | undefined> {
    await this.ready();
    try {
      const envelope = JSON.parse(await readFile(this.path(name), 'utf8')) as { metadata: ProfileMetadata; payload: string };
      if (envelope.metadata.status !== 'ready' || typeof envelope.payload !== 'string') return undefined;
      return Uint8Array.from(Buffer.from(envelope.payload, 'base64'));
    }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw new Error('Credential profile is unreadable'); }
  }
  async replace(name: string, payload: Uint8Array, metadata: ProfileMetadata): Promise<void> {
    await this.ready(); profileName(name);
    if (metadata.name !== name) throw new Error('Credential profile metadata mismatch');
    const temp = join(this.root, `.${name}.${crypto.randomUUID()}.tmp`);
    const file = await open(temp, 'wx', 0o600);
    try {
      await file.writeFile(JSON.stringify({ metadata, payload: Buffer.from(payload).toString('base64') }));
      await file.sync();
    } finally { await file.close(); }
    try { await rename(temp, this.path(name)); await syncDirectory(this.root); }
    catch (error) { await rm(temp, { force: true }); throw error; }
  }
  async markReauthRequired(name: string): Promise<void> {
    await this.withProfileLock(name, async () => {
      const entry = (await this.list()).find(x => x.name === name);
      if (!entry) return;
      await this.replace(name, new Uint8Array(), { ...entry, status: 'reauth-required', updatedAt: new Date().toISOString() });
    });
  }
  async remove(name: string): Promise<void> {
    await this.withProfileLock(name, async () => { await rm(this.path(name), { force: true }); await syncDirectory(this.root); });
  }
  async withProfileLock<T>(name: string, action: () => Promise<T>): Promise<T> {
    await this.ready();
    const lock = join(this.root, `.${profileName(name)}.lock`);
    const deadline = Date.now() + 15_000;
    while (true) {
      try { await mkdir(lock, { mode: 0o700 }); break; }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        const age = Date.now() - (await stat(lock)).mtimeMs;
        if (age > 60_000) { await rm(lock, { recursive: true, force: true }); continue; }
        if (Date.now() >= deadline) throw new Error('Credential profile is busy');
        await Bun.sleep(40 + Math.floor(Math.random() * 40));
      }
    }
    try { return await action(); } finally { await rm(lock, { recursive: true, force: true }); }
  }
}
