export const CONTROL_VERSION = 1;
export const CONTROL_MAX_BYTES = 65536;
export const CONTROL_TIMEOUT_MS = 5000;
export type ControlOperation = 'load' | 'start' | 'stop' | 'restart' | 'status' | 'shutdown';
export interface ControlRequest { version: typeof CONTROL_VERSION; requestId: string; operation: ControlOperation; bot?: string }
export type ControlResponse = { version: typeof CONTROL_VERSION; requestId: string; ok: true; data?: unknown } | { version: typeof CONTROL_VERSION; requestId: string; ok: false; error: { code: string; message: string } };
/** UTF-8 JSON, one line per request/response, bounded before parsing. */
export function encodeControl(value: ControlRequest | ControlResponse): Uint8Array { const bytes=new TextEncoder().encode(JSON.stringify(value)+'\n'); if(bytes.length>CONTROL_MAX_BYTES) throw new Error('Control frame too large'); return bytes; }
