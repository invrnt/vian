import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { resolve, isAbsolute, join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import type { NativeToolSet, ToolContext, ToolResult, ToolDefinition, BotStore } from '@vian/core';
import { assertSchema, validateInput } from './schema.ts';

export function validateNativeToolSet(value: unknown): NativeToolSet {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Native tools must be an object');
  const tools = value as Record<string, unknown>;
  for (const [name, entry] of Object.entries(tools)) {
    if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(name)) throw new Error(`Invalid tool name: ${name}`);
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error(`Invalid tool: ${name}`);
    const tool = entry as Record<string, unknown>;
    if (typeof tool.description !== 'string' || !tool.description || typeof tool.execute !== 'function') throw new Error(`Invalid tool: ${name}`);
    assertSchema(tool.inputSchema, name);
    if (tool.inputSchema.type !== 'object') throw new Error(`${name}: input schema must be an object`);
    if (tool.audit !== undefined && tool.audit !== 'full' && tool.audit !== 'metadata-only') throw new Error(`${name}: invalid audit policy`);
  }
  return value as NativeToolSet;
}

export function assertUniqueToolNames(groups: Iterable<Iterable<string>>): void {
  const seen = new Set<string>();
  for (const group of groups) for (const name of group) {
    if (seen.has(name)) throw new Error(`Duplicate exposed tool name: ${name}`);
    seen.add(name);
  }
}

export interface LoadedNativeTools { tools: NativeToolSet; dispose(): Promise<void> }

/** Bundle local imports into a fresh artifact so edits to dependencies survive Bun's module cache. */
export async function loadNativeTools(botRoot: string, relativePath: string): Promise<LoadedNativeTools> {
  const source = resolve(botRoot, relativePath);
  if (isAbsolute(relativePath) || !(source === botRoot || source.startsWith(resolve(botRoot) + '/'))) throw new Error('Tool module must be inside bot root');
  const built = await Bun.build({ entrypoints: [source], target: 'bun', format: 'esm', packages: 'external', throw: false });
  if (!built.success || built.outputs.length !== 1) throw new Error(`Tool build failed: ${built.logs.map(x => x.message).join('; ')}`);
  const dir = await mkdtemp(join(tmpdir(), 'vian-tools-'));
  try {
    const artifact = join(dir, 'tools.mjs');
    await writeFile(artifact, new Uint8Array(await built.outputs[0]!.arrayBuffer()));
    const module = await import(pathToFileURL(artifact).href);
    const tools = validateNativeToolSet(module.default);
    return { tools, dispose: () => rm(dir, { recursive: true, force: true }) };
  } catch (error) { await rm(dir, { recursive: true, force: true }); throw error; }
}

export class NativeToolRuntime {
  private current?: LoadedNativeTools;
  constructor(readonly botRoot: string, readonly modulePath: string) {}
  async reload(): Promise<void> {
    const candidate = await loadNativeTools(this.botRoot, this.modulePath);
    const old = this.current;
    this.current = candidate;
    await old?.dispose();
  }
  definitions(): ToolDefinition[] {
    return Object.entries(this.current?.tools ?? {}).map(([name, tool]) => ({ name, description: tool.description, inputSchema: tool.inputSchema, source: 'native' as const }));
  }
  async execute(name: string, input: unknown, context: ToolContext, store?: Pick<BotStore, 'transitionTool'>): Promise<ToolResult> {
    const tool = this.current?.tools[name];
    if (!tool) return { ok: false, error: { code: 'unknown_tool', message: 'Tool is unavailable' } };
    try { validateInput(tool.inputSchema, input); } catch (error) { return { ok: false, error: { code: 'invalid_arguments', message: String(error instanceof Error ? error.message : error) } }; }
    if (context.abortSignal.aborted) return { ok: false, error: { code: 'aborted', message: 'Tool call cancelled' } };
    const audit = (extra: Record<string, unknown>) => ({ toolName: name, ...tool.audit === 'metadata-only' ? {} : { arguments: input }, ...extra });
    try {
      if (store) {
        const pending = await store.transitionTool(context.toolCallId, context.runId, 'pending', audit({}));
        if (pending.kind !== 'ok') throw new Error(pending.reason);
        const started = await store.transitionTool(context.toolCallId, context.runId, 'started', audit({}));
        if (started.kind !== 'ok') throw new Error(started.reason);
      }
      const value = await tool.execute(input, context);
      if (store) await store.transitionTool(context.toolCallId, context.runId, 'succeeded', audit(tool.audit === 'metadata-only' ? {} : { result: value }));
      return { ok: true, value };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Tool failed';
      try { if (store) await store.transitionTool(context.toolCallId, context.runId, 'failed', audit({ error: tool.audit === 'metadata-only' ? 'Tool failed' : message })); } catch {}
      context.logger.error(`Tool ${name} failed`);
      return { ok: false, error: { code: context.abortSignal.aborted ? 'aborted' : 'tool_error', message: 'Tool failed' } };
    }
  }
  async close(): Promise<void> { await this.current?.dispose(); this.current = undefined; }
}
