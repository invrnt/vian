import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { chmod, mkdtemp, realpath, rename, rm, stat } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { Readable, Transform } from 'node:stream';
import type { CommandContext } from '@vian/core';

const repo = 'invrnt/vian';
const api = `https://api.github.com/repos/${repo}/releases`;
const help = 'Usage: vian update [--version TAG] [--runtime bun|standalone]\nUpdates the installed command to the newest published release, including previews.\n';
type Asset = { name: string; browser_download_url: string; state: string };
type Release = { tag_name: string; draft: boolean; published_at: string | null; assets: Asset[] };
type Options = { fetch?: typeof fetch; installedPath?: string; currentRuntime?: 'bun' | 'standalone'; bunPath?: string; platform?: string; arch?: string; musl?: boolean };

function assetName(runtime: 'bun' | 'standalone', arch: string, musl: boolean): string {
  if (runtime === 'bun') return 'vian-bun.js';
  const cpu = arch === 'x64' ? 'x64' : arch === 'arm64' ? 'arm64' : undefined;
  if (!cpu) throw new Error(`Unsupported CPU architecture: ${arch}`);
  return `vian-linux-${cpu}${musl ? '-musl' : ''}`;
}

function releaseAsset(release: Release, name: string): Asset | undefined {
  return release.assets?.find(asset => asset.name === name && asset.state === 'uploaded');
}

function assetUrl(asset: Asset, tag: string): string {
  const url = new URL(asset.browser_download_url);
  const prefix = `/${repo}/releases/download/${encodeURIComponent(tag)}/`;
  if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.pathname !== `${prefix}${asset.name}` || url.search || url.hash) {
    throw new Error(`Unexpected release URL for ${asset.name}`);
  }
  return url.href;
}

async function getResponse(url: string, fetcher: typeof fetch, accept = 'application/octet-stream'): Promise<Response> {
  const response = await fetcher(url, { headers: { Accept: accept, 'User-Agent': 'vian-updater' }, signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Release request failed (HTTP ${response.status})`);
  return response;
}

function isRelease(value: unknown): value is Release {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<Release>;
  return typeof item.tag_name === 'string' && /^[A-Za-z0-9._-]+$/.test(item.tag_name) && typeof item.draft === 'boolean' &&
    (typeof item.published_at === 'string' || item.published_at === null) && Array.isArray(item.assets);
}

async function selectRelease(version: string | undefined, name: string, fetcher: typeof fetch): Promise<Release> {
  const url = version ? `${api}/tags/${encodeURIComponent(version)}` : `${api}?per_page=100`;
  const data: unknown = await (await getResponse(url, fetcher, 'application/vnd.github+json')).json();
  const releases = (version ? [data] : data) as unknown;
  if (!Array.isArray(releases)) throw new Error('Invalid release response');
  const usable = releases.filter(isRelease).filter(release => !release.draft && release.published_at && releaseAsset(release, name) && releaseAsset(release, 'SHA256SUMS'));
  usable.sort((a, b) => Date.parse(b.published_at!) - Date.parse(a.published_at!));
  const selected = usable[0];
  if (!selected) throw new Error(version ? `Release ${version} has no usable ${name} asset` : `No published release has a usable ${name} asset`);
  return selected;
}

function expectedChecksum(text: string, name: string): string {
  const hashes = text.split(/\r?\n/).map(line => /^([a-fA-F0-9]{64})  \*?([^\s]+)$/.exec(line)).filter(match => match?.[2] === name);
  if (hashes.length !== 1) throw new Error(`Missing or duplicate checksum for ${name}`);
  return hashes[0]![1]!.toLowerCase();
}

async function download(url: string, dest: string, fetcher: typeof fetch): Promise<string> {
  const response = await getResponse(url, fetcher);
  if (!response.body) throw new Error('Release asset response was empty');
  const hash = createHash('sha256');
  let bytes = 0;
  const meter = new Transform({ transform(chunk: Buffer, _encoding, callback) {
    bytes += chunk.length;
    if (bytes > 200_000_000) callback(new Error('Release asset exceeds 200 MB'));
    else { hash.update(chunk); callback(null, chunk); }
  } });
  await pipeline(Readable.fromWeb(response.body as never), meter, createWriteStream(dest, { mode: 0o700, flags: 'wx' }));
  if (!bytes) throw new Error('Release asset was empty');
  return hash.digest('hex');
}

async function runnable(file: string, runtime: 'bun' | 'standalone', bunPath: string): Promise<void> {
  const command = runtime === 'bun' ? bunPath : file;
  const args = runtime === 'bun' ? [file, '--help'] : ['--help'];
  const child = spawn(command, args, { stdio: 'ignore' });
  const code = await new Promise<number>((resolve, reject) => {
    const timeout = setTimeout(() => { child.kill(); reject(new Error('Downloaded command timed out')); }, 10_000);
    child.once('error', error => { clearTimeout(timeout); reject(error); });
    child.once('close', result => { clearTimeout(timeout); resolve(result ?? 1); });
  });
  if (code !== 0) throw new Error('Downloaded command failed its --help check');
}

export async function updateCommand(args: string[], context: CommandContext, options: Options = {}): Promise<number> {
  if (args.length === 1 && ['--help', '-h'].includes(args[0]!)) { context.stdout(help); return 0; }
  let version: string | undefined;
  let runtime: 'bun' | 'standalone' | undefined;
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    const value = args[++i];
    if (!value || !['--version', '--runtime'].includes(flag!)) { context.stderr(help); return 1; }
    if (flag === '--version') {
      if (version || !/^[A-Za-z0-9._-]+$/.test(value)) { context.stderr('Invalid version tag\n'); return 1; }
      version = value;
    } else {
      if (runtime || !['bun', 'standalone'].includes(value)) { context.stderr('Runtime must be bun or standalone\n'); return 1; }
      runtime = value as 'bun' | 'standalone';
    }
  }
  try {
    if ((options.platform ?? process.platform) !== 'linux') throw new Error('Prebuilt updates currently support Linux only');
    const source = Bun.main;
    if (!options.installedPath && source.endsWith('.ts')) throw new Error('Run update from an installed Vian command, not a source checkout');
    const compiled = source.startsWith('/$bunfs/');
    const installed = await realpath(options.installedPath ?? (compiled ? process.execPath : source));
    if (!(await stat(installed)).isFile()) throw new Error('Installed command is not a regular file');
    const currentRuntime = options.currentRuntime ?? (compiled ? 'standalone' : 'bun');
    runtime ??= currentRuntime;
    const bunPath = options.bunPath ?? (currentRuntime === 'bun' ? process.execPath : 'bun');
    if (runtime === 'bun') {
      const check = spawnSync(bunPath, ['--version'], { stdio: 'ignore' });
      if (check.status !== 0) throw new Error('Bun is required for --runtime bun');
    }
    const musl = options.musl ?? /musl/i.test(spawnSync('ldd', ['--version'], { encoding: 'utf8' }).stdout ?? '');
    const name = assetName(runtime, options.arch ?? process.arch, musl);
    const fetcher = options.fetch ?? fetch;
    const release = await selectRelease(version, name, fetcher);
    const binary = releaseAsset(release, name)!;
    const sums = releaseAsset(release, 'SHA256SUMS')!;
    const sumsText = await (await getResponse(assetUrl(sums, release.tag_name), fetcher)).text();
    if (sumsText.length > 1_000_000) throw new Error('Checksum file is too large');
    const expected = expectedChecksum(sumsText, name);
    const staging = await mkdtemp(join(dirname(installed), '.vian-update-'));
    try {
      const candidate = join(staging, basename(installed));
      const actual = await download(assetUrl(binary, release.tag_name), candidate, fetcher);
      if (actual !== expected) throw new Error(`Checksum mismatch for ${name}`);
      await chmod(candidate, 0o755);
      await runnable(candidate, runtime, bunPath);
      await rename(candidate, installed);
    } finally { await rm(staging, { recursive: true, force: true }); }
    context.stdout(`Updated ${installed} to ${release.tag_name} (${runtime}).\n`);
    return 0;
  } catch (error) {
    context.stderr(`vian update: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}
