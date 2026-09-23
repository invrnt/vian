import { createMCPClient, type MCPClient } from '@ai-sdk/mcp';
import { Experimental_StdioMCPTransport } from '@ai-sdk/mcp/mcp-stdio';
import type { BotManifest, JsonSchema, ToolContext, ToolDefinition, ToolResult, BotStore } from '@vian/core';
import { assertSchema, validateInput } from '@vian/tools';

type ServerConfig = BotManifest['mcp'][number];
interface Server { client: MCPClient; tools: Map<string, ToolDefinition> }

export class McpToolRuntime {
  private servers = new Map<string, Server>();
  async start(configs: ServerConfig[]): Promise<void> {
    const next = new Map<string, Server>();
    try {
      for (const config of configs) {
        if (next.has(config.name)) throw new Error(`Duplicate MCP server: ${config.name}`);
        const client = await createMCPClient({ transport: new Experimental_StdioMCPTransport({ command: config.command, args: config.args, stderr: 'ignore' }) });
        try {
          const tools = new Map<string, ToolDefinition>();
          let cursor: string | undefined;
          const cursors = new Set<string>();
          do {
            const listed = await client.listTools(cursor ? { params: { cursor } } : undefined);
            for (const tool of listed.tools) {
              if (!config.tools.includes(tool.name)) continue;
              assertSchema(tool.inputSchema);
              if (tools.has(tool.name) || [...next.values()].some(server => server.tools.has(tool.name))) throw new Error(`Duplicate exposed tool name: ${tool.name}`);
              tools.set(tool.name, { name: tool.name, description: tool.description ?? '', inputSchema: tool.inputSchema as JsonSchema, source: 'mcp' });
            }
            cursor = listed.nextCursor;
            if (cursor) { if (cursors.has(cursor)) throw new Error('MCP tool pagination loop'); cursors.add(cursor); }
          } while (cursor);
          for (const allowed of config.tools) if (!tools.has(allowed)) throw new Error(`MCP tool unavailable: ${config.name}/${allowed}`);
          next.set(config.name, { client, tools });
        } catch (error) { await client.close(); throw error; }
      }
      const old = this.servers;
      this.servers = next;
      for (const server of old.values()) await server.client.close();
    } catch (error) { for (const server of next.values()) await server.client.close(); throw error; }
  }
  definitions(): ToolDefinition[] {
    const result: ToolDefinition[] = [];
    for (const server of this.servers.values()) for (const definition of server.tools.values()) result.push(definition);
    return result;
  }
  async execute(serverName: string, toolName: string, input: unknown, context: ToolContext, store?: Pick<BotStore, 'transitionTool'>): Promise<ToolResult> {
    const server = this.servers.get(serverName), tool = server?.tools.get(toolName);
    if (!server || !tool) return { ok: false, error: { code: 'unknown_tool', message: 'Tool is unavailable' } };
    try { validateInput(tool.inputSchema, input); } catch (error) { return { ok: false, error: { code: 'invalid_arguments', message: String(error) } }; }
    if (context.abortSignal.aborted) return { ok: false, error: { code: 'aborted', message: 'Tool call cancelled' } };
    const audit = { toolName, serverName, arguments: input };
    try {
      if (store) {
        const pending = await store.transitionTool(context.toolCallId, context.runId, 'pending', audit);
        if (pending.kind !== 'ok') throw new Error(pending.reason);
        const started = await store.transitionTool(context.toolCallId, context.runId, 'started', audit);
        if (started.kind !== 'ok') throw new Error(started.reason);
      }
      const value = await server.client.callTool({ name: toolName, arguments: input as Record<string, unknown>, options: { signal: context.abortSignal } });
      if (value.isError) throw new Error('MCP tool returned an error');
      if (store) await store.transitionTool(context.toolCallId, context.runId, 'succeeded', { ...audit, result: value });
      return { ok: true, value };
    } catch (error) {
      if (store) await store.transitionTool(context.toolCallId, context.runId, 'failed', { ...audit, error: 'MCP call failed' }).catch(() => {});
      return { ok: false, error: { code: context.abortSignal.aborted ? 'aborted' : 'mcp_error', message: 'MCP call failed' } };
    }
  }
  async close(): Promise<void> { for (const server of this.servers.values()) await server.client.close(); this.servers.clear(); }
}
