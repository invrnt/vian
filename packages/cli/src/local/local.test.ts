import { test, expect } from 'bun:test';
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run } from './index.ts';
import { SqliteBotStore } from '@vian/storage';
import type { BotId, ConversationId, EventId, PrincipalId, SessionId } from '@vian/core';
import { Database } from 'bun:sqlite';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'vian-cli-'));
  const data = join(root, 'global');
  const bot = join(root, 'bot');
  mkdirSync(bot);
  const original = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = data;
  const stdout: string[] = [], stderr: string[] = [];
  const context = { cwd: root, stdout: (s: string) => stdout.push(s), stderr: (s: string) => stderr.push(s) };
  const invoke = async (...args: string[]) => { stdout.length = 0; stderr.length = 0; const code = await run(args, context); return { code, out: stdout.join(''), err: stderr.join('') }; };
  const cleanup = () => { if (original === undefined) delete process.env.XDG_DATA_HOME; else process.env.XDG_DATA_HOME = original; rmSync(root, { recursive: true, force: true }); };
  return { root, bot, data, invoke, cleanup };
}

test('init preserves unrelated bytes, env values and gitignore across reruns', async () => {
  const f = fixture();
  try {
    const packageBytes = Buffer.from('{"name":"existing"}\r\n');
    writeFileSync(join(f.bot, 'package.json'), packageBytes);
    writeFileSync(join(f.bot, '.env'), '# existing\r\nTELEGRAM_BOT_TOKEN=keep-this\r\nOTHER=x\r\n');
    writeFileSync(join(f.bot, '.gitignore'), 'node_modules/\r\n');
    writeFileSync(join(f.bot, 'VIAN.md'), 'Custom rules\n');
    writeFileSync(join(f.bot, 'vian.tools.ts'), 'export const tools = {};\n');
    const args = ['init', f.bot, '--model', 'test-model', '--no-register'];
    expect((await f.invoke(...args)).code).toBe(0);
    const env = readFileSync(join(f.bot, '.env'));
    const ignore = readFileSync(join(f.bot, '.gitignore'));
    const manifest = readFileSync(join(f.bot, 'vian.json'));
    expect(env.toString()).toContain('TELEGRAM_BOT_TOKEN=keep-this');
    expect(env.toString()).not.toContain('GEMINI_API_KEY=');
    expect(JSON.parse(manifest.toString()).model.credential).toBe('profile:google-default');
    expect(readFileSync(join(f.bot, 'package.json'))).toEqual(packageBytes);
    expect(readFileSync(join(f.bot, 'VIAN.md'), 'utf8')).toBe('Custom rules\n');
    expect((await f.invoke(...args)).code).toBe(0);
    expect(readFileSync(join(f.bot, '.env'))).toEqual(env);
    expect(readFileSync(join(f.bot, '.gitignore'))).toEqual(ignore);
    expect(readFileSync(join(f.bot, 'vian.json'))).toEqual(manifest);
  } finally { f.cleanup(); }
});

test('interrupted temporary file does not corrupt a subsequent init', async () => {
  const f = fixture();
  try {
    writeFileSync(join(f.bot, '.vian-interrupted.tmp'), 'partial');
    const result = await f.invoke('init', f.bot, '--model', 'test-model', '--no-register');
    expect(result.code).toBe(0);
    expect(JSON.parse(readFileSync(join(f.bot, 'vian.json'), 'utf8')).model.id).toBe('test-model');
    expect(readFileSync(join(f.bot, '.vian-interrupted.tmp'), 'utf8')).toBe('partial');
  } finally { f.cleanup(); }
});

test('Gateway init selects the shared credential profile by default', async () => {
  const f = fixture();
  try {
    expect((await f.invoke('init', f.bot, '--provider', 'vercel-ai-gateway', '--model', 'vendor/model', '--no-register')).code).toBe(0);
    const manifest = JSON.parse(readFileSync(join(f.bot, 'vian.json'), 'utf8'));
    expect(manifest.model.credential).toBe('profile:vercel-ai-gateway-default');
    expect(readFileSync(join(f.bot, '.env'), 'utf8')).toBe('TELEGRAM_BOT_TOKEN=\n');
  } finally { f.cleanup(); }
});

test('offline list with no registry leaves global state untouched', async () => {
  const f = fixture();
  try {
    const result = await f.invoke('list', '--json');
    expect(result.code).toBe(0);
    expect(JSON.parse(result.out).data).toEqual([]);
    expect(existsSync(join(f.data, 'vian/registry.sqlite'))).toBe(false);
  } finally { f.cleanup(); }
});

test('register handles missing paths, explicit moves, clones and file-safe unregister', async () => {
  const f = fixture();
  try {
    expect((await f.invoke('init', f.bot, '--model', 'test-model')).code).toBe(0);
    const first = JSON.parse(readFileSync(join(f.bot, 'vian.json'), 'utf8'));
    const moved = join(f.root, 'moved');
    renameSync(f.bot, moved);
    expect((await f.invoke('list', '--json')).out).toContain('missing');
    expect((await f.invoke('register', moved)).code).toBe(0);
    expect((await f.invoke('list', '--json')).out).toContain(moved);
    const clone = join(f.root, 'clone');
    mkdirSync(clone);
    writeFileSync(join(clone, 'vian.json'), JSON.stringify({ ...first, name: 'clone' }));
    expect((await f.invoke('register', clone)).code).toBe(1);
    expect((await f.invoke('register', clone, '--clone', '--name', 'clone')).code).toBe(0);
    expect(JSON.parse(readFileSync(join(clone, 'vian.json'), 'utf8')).id).not.toBe(first.id);
    expect((await f.invoke('unregister', 'clone')).code).toBe(0);
    expect(existsSync(join(clone, 'vian.json'))).toBe(true);
  } finally { f.cleanup(); }
});

test('offline inspect exposes references and history/doctor errors remain scriptable', async () => {
  const f = fixture();
  try {
    expect((await f.invoke('init', f.bot, '--model', 'test-model')).code).toBe(0);
    const inspected = await f.invoke('inspect', 'bot', '--json');
    expect(inspected.code).toBe(0);
    expect(inspected.out).toContain('profile:google-default');
    expect(inspected.out).not.toContain('secret-value');
    const history = await f.invoke('history', 'bot', '--jsonl');
    expect(history.code).toBe(1);
    expect(history.err).toContain('database is missing');
    const doctor = await f.invoke('doctor', 'bot', '--json');
    expect(doctor.code).toBe(1);
    const report = JSON.parse(doctor.out);
    expect(report.data.checks.some((check: { name: string; ok: boolean }) => check.name === 'database migration' && !check.ok)).toBe(true);
  } finally { f.cleanup(); }
});

test('history filters session, principal, time and tools across export pages', async () => {
  const f = fixture();
  try {
    expect((await f.invoke('init', f.bot, '--model', 'test-model')).code).toBe(0);
    const manifest = JSON.parse(readFileSync(join(f.bot, 'vian.json'), 'utf8'));
    const store = new SqliteBotStore(manifest.id as BotId, join(f.bot, '.vian/state.sqlite'));
    const old = new Date(Date.now() - 10 * 86400000).toISOString();
    const recent = new Date().toISOString();
    try {
      for (let i = 0; i < 1003; i++) await store.appendAudit({ id: `event-${i}` as EventId, botId: manifest.id as BotId, sessionId: (i % 2 ? 'session-b' : 'session-a') as SessionId, principalId: (i % 2 ? 'bob' : 'alice') as PrincipalId, kind: i % 3 ? 'message' : 'tool_call_started', at: i === 0 ? old : recent, payload: { index: i } });
    } finally { store.close(); }
    const db = new Database(join(f.bot, '.vian/state.sqlite'), { readonly: true });
    const beforeVersion = (db.query('PRAGMA user_version').get() as { user_version: number }).user_version;
    db.close();
    const all = await f.invoke('history', 'bot', '--jsonl');
    expect(all.code).toBe(0);
    expect(all.out.trim().split('\n').length).toBe(1003);
    const filtered = await f.invoke('history', 'bot', '--session', 'session-a', '--principal', 'alice', '--since', '7d', '--tools', '--jsonl');
    expect(filtered.code).toBe(0);
    const events = filtered.out.trim().split('\n').map(line => JSON.parse(line));
    expect(events.length).toBeGreaterThan(0);
    expect(events.every(event => event.sessionId === 'session-a' && event.principalId === 'alice' && event.kind.startsWith('tool_call_') && event.at >= new Date(Date.now() - 7 * 86400000).toISOString())).toBe(true);
    const afterDb = new Database(join(f.bot, '.vian/state.sqlite'), { readonly: true });
    expect((afterDb.query('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(beforeVersion);
    afterDb.close();
  } finally { f.cleanup(); }
});

test('session listing and registry count use bot-local state while offline', async () => {
  const f = fixture();
  try {
    expect((await f.invoke('init', f.bot, '--model', 'test-model')).code).toBe(0);
    const manifest = JSON.parse(readFileSync(join(f.bot, 'vian.json'), 'utf8'));
    const store = new SqliteBotStore(manifest.id as BotId, join(f.bot, '.vian/state.sqlite'));
    try {
      await store.bindActor({ gate: 'telegram', externalId: '101' }, 'alice' as PrincipalId);
      await store.bindDestination({ gate: 'telegram', externalId: '201' }, 'conversation-1' as ConversationId, 'alice' as PrincipalId);
    } finally { store.close(); }
    const sessions = await f.invoke('sessions', 'bot', '--json');
    expect(sessions.code).toBe(0);
    expect(JSON.parse(sessions.out).data).toHaveLength(1);
    const listed = await f.invoke('list', '--json');
    expect(JSON.parse(listed.out).data[0].sessions).toBe(1);
  } finally { f.cleanup(); }
});

test('history export redacts bot-local env secret values', async () => {
  const f = fixture();
  try {
    expect((await f.invoke('init', f.bot, '--model', 'test-model')).code).toBe(0);
    writeFileSync(join(f.bot, '.env'), 'GEMINI_API_KEY="canary-secret-value"\n');
    const manifest = JSON.parse(readFileSync(join(f.bot, 'vian.json'), 'utf8'));
    const store = new SqliteBotStore(manifest.id as BotId, join(f.bot, '.vian/state.sqlite'));
    try { await store.appendAudit({ id: 'sensitive-event' as EventId, botId: manifest.id as BotId, kind: 'tool_call_started', at: new Date().toISOString(), payload: { args: 'canary-secret-value' } }); }
    finally { store.close(); }
    for (const args of [['history', 'bot', '--jsonl'], ['history', 'bot']]) {
      const output = await f.invoke(...args);
      expect(output.code).toBe(0);
      expect(output.out).not.toContain('canary-secret-value');
    }
  } finally { f.cleanup(); }
});

test('offline doctor identifies missing local inputs, unsafe permissions and future database schema', async () => {
  const f = fixture();
  try {
    expect((await f.invoke('init', f.bot, '--model', 'test-model', '--credential', 'env:GEMINI_API_KEY')).code).toBe(0);
    const manifest = JSON.parse(readFileSync(join(f.bot, 'vian.json'), 'utf8'));
    const store = new SqliteBotStore(manifest.id as BotId, join(f.bot, '.vian/state.sqlite'));
    store.close();
    unlinkSync(join(f.bot, 'VIAN.md'));
    unlinkSync(join(f.bot, 'vian.tools.ts'));
    unlinkSync(join(f.bot, '.env'));
    chmodSync(join(f.bot, '.vian/attachments'), 0o755);
    const db = new Database(join(f.bot, '.vian/state.sqlite'));
    db.run('PRAGMA user_version = 999');
    db.close();
    const result = await f.invoke('doctor', 'bot', '--json');
    expect(result.code).toBe(1);
    const failed = JSON.parse(result.out).data.checks.filter((check: { ok: boolean }) => !check.ok).map((check: { name: string }) => check.name);
    for (const name of ['instructions', 'tool entrypoint', '.env', 'secret GEMINI_API_KEY', 'secret TELEGRAM_BOT_TOKEN', 'database migration', 'attachment directory']) expect(failed).toContain(name);
  } finally { f.cleanup(); }
});

test('offline doctor imports the configured local tool without network probes', async () => {
  const f = fixture();
  try {
    expect((await f.invoke('init', f.bot, '--model', 'test-model')).code).toBe(0);
    writeFileSync(join(f.bot, '.env'), 'GEMINI_API_KEY=local-key\nTELEGRAM_BOT_TOKEN=local-token\n');
    const manifest = JSON.parse(readFileSync(join(f.bot, 'vian.json'), 'utf8'));
    const store = new SqliteBotStore(manifest.id as BotId, join(f.bot, '.vian/state.sqlite'));
    store.close();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() => { throw new Error('network attempted'); }) as unknown as typeof fetch;
    try {
      const result = await f.invoke('doctor', 'bot', '--json');
      expect(result.code).toBe(0);
      const report = JSON.parse(result.out);
      expect(report.data.checks.find((check: { name: string }) => check.name === 'tool import').ok).toBe(true);
      expect(report.data.checks.find((check: { name: string }) => check.name === 'duplicate tool names').ok).toBe(true);
    } finally { globalThis.fetch = originalFetch; }
  } finally { f.cleanup(); }
});

test('doctor reports duplicate names across configured MCP tools', async () => {
  const f = fixture();
  try {
    expect((await f.invoke('init', f.bot, '--model', 'test-model')).code).toBe(0);
    const path = join(f.bot, 'vian.json');
    const manifest = JSON.parse(readFileSync(path, 'utf8'));
    manifest.mcp = [
      { name: 'one', command: 'example', args: [], tools: ['duplicate'] },
      { name: 'two', command: 'example', args: [], tools: ['duplicate'] }
    ];
    writeFileSync(path, JSON.stringify(manifest));
    const result = await f.invoke('doctor', 'bot', '--json');
    expect(result.code).toBe(1);
    const check = JSON.parse(result.out).data.checks.find((item: { name: string }) => item.name === 'duplicate tool names');
    expect(check.ok).toBe(false);
    expect(check.detail).toContain('duplicate');
  } finally { f.cleanup(); }
});
