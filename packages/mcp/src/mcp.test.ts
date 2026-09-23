import { test, expect } from 'bun:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { McpToolRuntime } from './index.ts';

test('stdio MCP explicit allowlist and call lifecycle', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vian-mcp-test-'));
  const script = join(root, 'server.ts');
  await writeFile(script, `
for await (const line of Bun.stdin.stream().pipeThrough(new TextDecoderStream()).pipeThrough(new TransformStream({ transform(chunk, c) { for (const part of chunk.split('\\n')) if (part.trim()) c.enqueue(part); } }))) {
  const request = JSON.parse(line);
  const result = request.method === 'initialize' ? { protocolVersion: request.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'fake', version: '1' } } : request.method === 'tools/list' ? { tools: [ { name:'allowed', inputSchema:{type:'object',properties:{x:{type:'string'}},required:['x'],additionalProperties:false}}, { name:'denied', inputSchema:{type:'object',properties:{}} } ] } : request.method === 'tools/call' ? { content:[{type:'text',text:request.params.name}] } : {};
  if (request.id !== undefined) console.log(JSON.stringify({jsonrpc:'2.0',id:request.id,result}));
}`);
  const runtime = new McpToolRuntime();
  try {
    await runtime.start([{ name: 'fake', command: 'bun', args: [script], tools: ['allowed'] }]);
    expect(runtime.definitions().map(x => x.name)).toEqual(['allowed']);
    const context = { toolCallId: 'call', runId: 'run', abortSignal: new AbortController().signal } as any;
    expect(await runtime.execute('fake', 'denied', {}, context)).toMatchObject({ ok: false, error: { code: 'unknown_tool' } });
    expect(await runtime.execute('fake', 'allowed', { x: 'yes' }, context)).toMatchObject({ ok: true });
  } finally { await runtime.close(); await rm(root, { recursive: true, force: true }); }
});
