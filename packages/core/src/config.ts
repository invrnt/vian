import { resolve } from 'node:path';
import { z } from 'zod';
export const SecretReferenceSchema = z.union([z.string().regex(/^env:[A-Za-z_][A-Za-z0-9_]*$/), z.string().regex(/^profile:[A-Za-z0-9][A-Za-z0-9._-]*$/), z.string().regex(/^oauth:openai-chatgpt:[A-Za-z0-9][A-Za-z0-9._-]*$/)]);
export type SecretReference = z.infer<typeof SecretReferenceSchema>;
const Model = z.strictObject({ provider: z.enum(['google','vercel-ai-gateway','openai-chatgpt']), id: z.string().min(1), credential: SecretReferenceSchema.optional() });
const Access = z.strictObject({ mode: z.enum(['pairing','allowlist']).default('pairing'), groups: z.boolean().default(false), administratorPrincipalIds: z.array(z.string().min(1)).default([]) });
const TelegramApiRoot = z.url().refine(value => {
  const url = new URL(value);
  return !url.username && !url.password && !url.search && !url.hash && url.pathname === '/' &&
    (url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)));
}, 'Use HTTPS or a loopback HTTP Bot API server URL without credentials or path');
const Telegram = z.strictObject({ apiRoot: TelegramApiRoot.default('https://api.telegram.org'), localApi: z.boolean().default(false), localFileRoot: z.string().startsWith('/').optional(), uploadTimeoutSeconds: z.number().int().min(30).max(3600).default(1800), language: z.enum(['es', 'en']).default('es'), streaming: z.boolean().default(true), format: z.enum(['markdown-v2','plain']).default('markdown-v2'), buttons: z.boolean().default(true), stopGeneration: z.boolean().default(true) });
const Gate = z.strictObject({ type: z.literal('telegram'), credential: SecretReferenceSchema, access: Access.prefault({}), telegram: Telegram.prefault({}) }).refine(gate => !gate.telegram.localApi || new URL(gate.telegram.apiRoot).hostname !== 'api.telegram.org', { message: 'localApi requires a local Bot API server', path: ['telegram','apiRoot'] });
const Runtime = z.strictObject({ maxSteps: z.number().int().min(1).max(100).default(12), runTimeoutSeconds: z.number().int().min(1).max(3600).default(180), perBotConcurrency: z.number().int().min(1).max(64).default(4), sameSessionPolicy: z.enum(['steer','queue']).default('steer') });
const Context = z.strictObject({ strategy: z.literal('summary-tail').default('summary-tail'), maxRecentMessages: z.number().int().min(1).max(1000).default(80) });
const Attachments = z.strictObject({ defaultTtlHours: z.number().int().min(1).max(8760).default(24), maxFileBytes: z.number().int().min(1).default(52428800) });
const McpServer = z.strictObject({ name: z.string().min(1), command: z.string().min(1), args: z.array(z.string()).default([]), tools: z.array(z.string().min(1)).min(1) });
export const ManifestSchema = z.strictObject({ $schema: z.string().optional(), schemaVersion: z.literal(1), id: z.uuid(), name: z.string().min(1), instructions: z.string().default('./VIAN.md'), tools: z.string().default('./vian.tools.ts'), model: Model, gate: Gate, runtime: Runtime.prefault({}), context: Context.prefault({}), attachments: Attachments.prefault({}), mcp: z.array(McpServer).default([]) });
export type BotManifest = z.infer<typeof ManifestSchema>;
export class ConfigError extends Error { constructor(readonly botPath: string, readonly field: string, message: string) { super(`${botPath}: ${field}: ${message}`); this.name='ConfigError'; } }
export function parseManifest(value: unknown, botPath: string): BotManifest { const result=ManifestSchema.safeParse(value); if (result.success) return result.data; const issue=result.error.issues[0]!; throw new ConfigError(botPath, issue.path.join('.') || '<root>', issue.message); }
export function resolveBotPath(root: string, path: string): string { return resolve(root,path); }
