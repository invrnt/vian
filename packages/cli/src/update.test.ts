import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from './main.ts';
import { updateCommand } from './update.ts';

const releaseUrl = 'https://github.com/invrnt/vian/releases/download';
const apiUrl = 'https://api.github.com/repos/invrnt/vian/releases';
const binaryName = 'vian-linux-x64';
const old = '#!/bin/sh\necho old\n';
const updated = '#!/bin/sh\n[ "$1" = --help ]\n';

function fixture(tag: string, publishedAt: string, assetName = binaryName) {
  return { tag_name: tag, published_at: publishedAt, draft: false, assets: [assetName, 'SHA256SUMS'].map(name => ({ name, state: 'uploaded', browser_download_url: `${releaseUrl}/${tag}/${name}` })) };
}

function fakeFetch(releases: ReturnType<typeof fixture>[], payload: string, checksum = createHash('sha256').update(payload).digest('hex')): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = String(input);
    if (url === `${apiUrl}?per_page=100`) return Response.json(releases);
    if (url.startsWith(`${apiUrl}/tags/`)) return Response.json(releases.find(item => item.tag_name === url.split('/').at(-1)) ?? {}, { status: releases.some(item => item.tag_name === url.split('/').at(-1)) ? 200 : 404 });
    if (url.endsWith('/SHA256SUMS')) return new Response(`${checksum}  ${releases[0]!.assets[0]!.name}\n`);
    if (url.startsWith(releaseUrl)) return new Response(payload);
    throw new Error(`Unexpected URL: ${url}`);
  }) as typeof fetch;
}

test('update command help is routed without loading a release', async () => {
  const stdout: string[] = [];
  expect(await main(['update', '--help'], { cwd: '/tmp', stdout: text => stdout.push(text), stderr: () => {} })).toBe(0);
  expect(stdout.join('')).toContain('--version TAG');
});

test('selects newest published usable preview and replaces the symlink target', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vian-update-'));
  const path = join(root, 'vian');
  const link = join(root, 'command');
  const stdout: string[] = [], stderr: string[] = [];
  try {
    await writeFile(path, old, { mode: 0o755 });
    await symlink(path, link);
    const draft = { ...fixture('v0.3.0-preview.1', '2026-09-26T00:00:00Z'), draft: true };
    const missingAsset = { ...fixture('v0.2.0-preview.3', '2026-09-25T00:00:00Z'), assets: [] };
    const releases = [fixture('v0.2.0-preview.2', '2026-09-24T00:00:00Z'), draft, missingAsset, fixture('v0.1.0', '2026-09-23T00:00:00Z')];
    expect(await updateCommand([], { cwd: root, stdout: text => stdout.push(text), stderr: text => stderr.push(text) }, { installedPath: link, currentRuntime: 'standalone', fetch: fakeFetch(releases, updated), arch: 'x64', musl: false })).toBe(0);
    expect(await readFile(path, 'utf8')).toBe(updated);
    expect(await readFile(link, 'utf8')).toBe(updated);
    expect(stdout.join('')).toContain('v0.2.0-preview.2');
    expect(stderr).toEqual([]);
    expect((await readdir(root)).sort()).toEqual(['command', 'vian']);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('explicit version and Bun runtime install a runnable script', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vian-update-'));
  const path = join(root, 'vian');
  try {
    await writeFile(path, old, { mode: 0o755 });
    const payload = '#!/usr/bin/env bun\nif (Bun.argv.at(-1) !== "--help") process.exit(1);\n';
    const releases = [fixture('v0.2.0-preview.1', '2026-09-22T00:00:00Z', 'vian-bun.js')];
    expect(await updateCommand(['--version', 'v0.2.0-preview.1', '--runtime', 'bun'], { cwd: root, stdout: () => {}, stderr: () => {} }, { installedPath: path, currentRuntime: 'standalone', bunPath: process.execPath, fetch: fakeFetch(releases, payload), arch: 'x64', musl: false })).toBe(0);
    expect(await readFile(path, 'utf8')).toBe(payload);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('bad checksum and failed smoke check preserve installed command', async () => {
  for (const [payload, checksum] of [[updated, '0'.repeat(64)], ['#!/bin/sh\nexit 4\n', undefined]] as const) {
    const root = await mkdtemp(join(tmpdir(), 'vian-update-'));
    const path = join(root, 'vian');
    const stderr: string[] = [];
    try {
      await writeFile(path, old, { mode: 0o755 });
      const releases = [fixture('v0.2.0-preview.2', '2026-09-24T00:00:00Z')];
      expect(await updateCommand([], { cwd: root, stdout: () => {}, stderr: text => stderr.push(text) }, { installedPath: path, currentRuntime: 'standalone', fetch: fakeFetch(releases, payload, checksum), arch: 'x64', musl: false })).toBe(1);
      expect(stderr.join('')).toMatch(checksum ? /Checksum mismatch/ : /failed its --help check/);
      expect(await readFile(path, 'utf8')).toBe(old);
      expect(await readdir(root)).toEqual(['vian']);
    } finally { await rm(root, { recursive: true, force: true }); }
  }
});
