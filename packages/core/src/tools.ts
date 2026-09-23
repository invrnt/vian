import type { AttachmentRegistration, PublicAttachment } from './attachments.ts';
import type { BotId, ConversationId, PrincipalId, RunId, SessionId, ToolCallId } from './identity.ts';
export type JsonSchema = Record<string, unknown>;
export interface ToolContext { botId: BotId; principalId: PrincipalId; conversationId: ConversationId; sessionId: SessionId; runId: RunId; toolCallId: ToolCallId; idempotencyKey: string; abortSignal: AbortSignal; attachments: { register(input: AttachmentRegistration): Promise<PublicAttachment> }; logger: { info(message: string): void; error(message: string): void }; services: Record<string, unknown> }
export interface NativeTool { description: string; inputSchema: JsonSchema; execute(input: unknown, context: ToolContext): Promise<unknown> | unknown; audit?: 'full' | 'metadata-only' }
export type NativeToolSet = Record<string, NativeTool>;
export type ToolResult = { ok: true; value: unknown } | { ok: false; error: { code: string; message: string } };
export interface ToolDefinition { name: string; description: string; inputSchema: JsonSchema; source: 'native' | 'mcp' | 'gate' }
