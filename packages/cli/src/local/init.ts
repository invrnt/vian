import { randomUUID } from 'node:crypto';
import { closeSync, existsSync, linkSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync, chmodSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import type { BotId, BotManifest, CommandContext, RegistryRecord } from '@vian/core';
import { parseManifest } from '@vian/core';
import { absolute, has, manifestAt, option, positional, socketPath, withRegistry } from './common.ts';

function atomicNew(path: string, content: string, mode = 0o644): boolean {
  if (existsSync(path)) return false;
  const temp = join(dirname(path), `.vian-${randomUUID()}.tmp`);
  try {
    const fd = openSync(temp, 'wx', mode);
    try { writeFileSync(fd, content); } finally { closeSync(fd); }
    linkSync(temp, path);
    return true;
  } catch (error) {
    if (existsSync(path)) return false;
    throw error;
  } finally { if (existsSync(temp)) unlinkSync(temp); }
}
function atomicReplace(path: string, content: string, mode: number): void {
  const temp = join(dirname(path), `.vian-${randomUUID()}.tmp`);
  try { writeFileSync(temp, content, { mode, flag: 'wx' }); renameSync(temp, path); chmodSync(path, mode); }
  finally { if (existsSync(temp)) unlinkSync(temp); }
}
function appendMissing(path: string, lines: string[], mode: number, present: (text: string, line: string) => boolean): string[] {
  const prior = existsSync(path) ? readFileSync(path, 'utf8') : '';
  const missing = lines.filter(line => !present(prior, line));
  if (!missing.length) return [];
  const addition = `${prior && !prior.endsWith('\n') ? '\n' : ''}${missing.join('\n')}\n`;
  if (!prior && !existsSync(path)) atomicNew(path, addition, mode);
  else atomicReplace(path, prior + addition, mode);
  return missing;
}
function envName(ref: string | undefined): string | undefined { return ref?.startsWith('env:') ? ref.slice(4) : undefined; }
function validateChoice(value: string, choices: readonly string[], flag: string): string { if (!choices.includes(value)) throw new Error(`${flag} must be ${choices.join(', ')}`); return value; }
function defaultManifest(root: string, args: string[], forcedName?: string): BotManifest {
  const name = forcedName ?? option(args, '--name') ?? basename(root);
  const provider = validateChoice(option(args, '--provider') ?? 'google', ['google', 'vercel-ai-gateway', 'openai-chatgpt'], '--provider') as BotManifest['model']['provider'];
  const credential = option(args, '--credential') ?? (provider === 'google' ? 'env:GEMINI_API_KEY' : provider === 'vercel-ai-gateway' ? 'env:AI_GATEWAY_API_KEY' : 'oauth:openai-chatgpt:default');
  const model = option(args, '--model');
  if (!model) throw new Error('Specify --model with a model ID verified for your provider');
  const raw = { schemaVersion: 1, id: randomUUID(), name, instructions: option(args, '--instructions') ?? './VIAN.md', tools: option(args, '--tools') ?? './vian.tools.ts', model: { provider, id: model, credential }, gate: { type: 'telegram', credential: option(args, '--telegram-credential') ?? 'env:TELEGRAM_BOT_TOKEN', access: { mode: 'pairing', groups: false, administratorPrincipalIds: [] } }, runtime: { sameSessionPolicy: 'steer' } };
  return parseManifest(raw, join(root, 'vian.json'));
}
export async function register(rootInput: string, args: string[], context: CommandContext): Promise<void> {
  const root = resolve(context.cwd, rootInput);
  if (!existsSync(root) || !statSync(root).isDirectory()) throw new Error(`${root}: bot directory is missing`);
  let manifest = manifestAt(root);
  if (has(args, '--move') && has(args, '--clone')) throw new Error('Choose either --move or --clone');
  let cloneContent: string | undefined;
  let cloneMode = 0o644;
  if (has(args, '--clone')) {
    if (existsSync(join(root, '.vian', 'state.sqlite'))) throw new Error(`${root}: clone requires a fresh bot state; preserve or move this bot instead`);
    const path = join(root, 'vian.json');
    const original = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
    original.id = randomUUID();
    original.name = option(args, '--name') ?? `${String(original.name)}-clone`;
    manifest = parseManifest(original, path);
    cloneContent = JSON.stringify(original, null, 2) + '\n';
    cloneMode = statSync(path).mode & 0o777;
  }
  const record: RegistryRecord = { id: manifest.id as BotId, alias: manifest.name, path: root, registeredAt: new Date().toISOString(), enabled: !has(args, '--no-autostart'), observedName: manifest.name };
  const result = await withRegistry(registry => registry.register(record, has(args, '--move') ? 'move' : has(args, '--clone') ? 'clone' : 'new'));
  if (result.kind !== 'ok') throw new Error(`${root}: registration failed: ${result.reason}`);
  if (cloneContent) {
    try { atomicReplace(join(root, 'vian.json'), cloneContent, cloneMode); }
    catch (error) { await withRegistry(registry => registry.unregister(record.id)); throw error; }
  }
  context.stdout(`Registered ${manifest.name} at ${result.value.path}\n`);
}
export async function init(rootInput: string, args: string[], context: CommandContext, forcedName?: string): Promise<void> {
  const root = resolve(context.cwd, rootInput);
  if (!existsSync(root)) mkdirSync(root, { recursive: true });
  if (!statSync(root).isDirectory()) throw new Error(`${root}: not a directory`);
  const manifestPath = join(root, 'vian.json');
  const existing = existsSync(manifestPath);
  const manifest = existing ? manifestAt(root) : defaultManifest(root, args, forcedName);
  if (!existing) atomicNew(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  const instructionsPath = absolute(root, manifest.instructions);
  const toolsPath = absolute(root, manifest.tools);
  mkdirSync(dirname(instructionsPath), { recursive: true });
  mkdirSync(dirname(toolsPath), { recursive: true });
  atomicNew(instructionsPath, `# ${manifest.name}\n\nDescribe this bot's purpose and rules here.\n`);
  atomicNew(toolsPath, `// Export trusted tools from this module.\nexport default {};\n`);
  const envVariables = [envName(manifest.model.credential), envName(manifest.gate.credential)].filter((x): x is string => !!x);
  const envPath = join(root, '.env');
  const missing = appendMissing(envPath, [...new Set(envVariables)].map(name => `${name}=`), 0o600, (content, line) => new RegExp(`^\\s*(?:export\\s+)?${line.slice(0, -1)}\\s*=`, 'm').test(content));
  chmodSync(envPath, 0o600);
  appendMissing(join(root, '.gitignore'), ['.vian/', '.env'], 0o644, (content, line) => content.split(/\r?\n/).some(row => row.trim() === line));
  mkdirSync(join(root, '.vian'), { recursive: true, mode: 0o700 });
  mkdirSync(join(root, '.vian', 'attachments'), { recursive: true, mode: 0o700 });
  chmodSync(join(root, '.vian'), 0o700);
  chmodSync(join(root, '.vian', 'attachments'), 0o700);
  manifestAt(root);
  if (!has(args, '--no-register')) await register(root, args, context);
  context.stdout(`Initialized ${root}${missing.length ? `; set ${missing.map(x => x.slice(0, -1)).join(', ')} in .env` : ''}\n`);
  if (!has(args, '--no-register')) await notifyLoad(manifest.id, context);
}
async function notifyLoad(botId: string, context: CommandContext): Promise<void> {
  const socket = socketPath();
  if (!existsSync(socket)) return;
  try {
    const net = await import('node:net');
    const requestId = randomUUID();
    await new Promise<void>((resolvePromise, reject) => {
      const client = net.createConnection(socket);
      const timer = setTimeout(() => { client.destroy(); reject(new Error('load notification timed out')); }, 5000);
      client.on('connect', () => client.write(JSON.stringify({ version: 1, requestId, operation: 'load', bot: botId }) + '\n'));
      client.on('data', bytes => { clearTimeout(timer); client.end(); try { const response = JSON.parse(String(bytes).split('\n')[0]!); response.ok ? resolvePromise() : reject(new Error(response.error?.message ?? 'load rejected')); } catch (error) { reject(error); } });
      client.on('error', error => { clearTimeout(timer); reject(error); });
    });
    context.stdout('Requested daemon load\n');
  } catch (error) { context.stderr(`Daemon load request failed: ${String(error)}\n`); }
}
export function initArgs(command: string, args: string[]): { root: string; name?: string } {
  const values = positional(args.slice(1));
  if (command === 'create') {
    if (values.length < 2) throw new Error('Usage: vian create <name> <path> --model <id>');
    return { name: values[0], root: values[1]! };
  }
  return { root: values[0] ?? '.' };
}
export async function wizardArgs(root: string, args: string[], forcedName?: string): Promise<string[]> {
  if (existsSync(join(root, 'vian.json')) || option(args, '--model')) return args;
  if (!process.stdin.isTTY) throw new Error('Specify --model <provider-model-id> for non-interactive init');
  const { createInterface } = await import('node:readline/promises');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const name = forcedName ?? option(args, '--name') ?? ((await rl.question(`Bot name [${basename(root)}]: `)).trim() || basename(root));
    const providerInput = (await rl.question('Model provider (google, vercel-ai-gateway, openai-chatgpt) [google]: ')).trim();
    const provider = providerInput || 'google';
    validateChoice(provider, ['google', 'vercel-ai-gateway', 'openai-chatgpt'], 'provider');
    const model = (await rl.question('Verified model ID: ')).trim();
    if (!model) throw new Error('Model ID is required');
    const defaultCredential = provider === 'google' ? 'env:GEMINI_API_KEY' : provider === 'vercel-ai-gateway' ? 'env:AI_GATEWAY_API_KEY' : 'oauth:openai-chatgpt:default';
    const credential = (await rl.question(`Model credential reference [${defaultCredential}]: `)).trim() || defaultCredential;
    const telegram = (await rl.question('Telegram credential reference [env:TELEGRAM_BOT_TOKEN]: ')).trim() || 'env:TELEGRAM_BOT_TOKEN';
    const registerAnswer = (await rl.question('Register globally? [Y/n]: ')).trim().toLowerCase();
    const autostartAnswer = (await rl.question('Enable on daemon startup? [Y/n]: ')).trim().toLowerCase();
    return [...args, '--name', name, '--provider', provider, '--model', model, '--credential', credential, '--telegram-credential', telegram, ...(registerAnswer === 'n' ? ['--no-register'] : []), ...(autostartAnswer === 'n' ? ['--no-autostart'] : [])];
  } finally { rl.close(); }
}
