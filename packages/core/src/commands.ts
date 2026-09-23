export interface CommandContext { cwd: string; stdout: (text: string) => void; stderr: (text: string) => void }
export interface CommandModule { run(args: string[], context: CommandContext): Promise<number> }
export type OutputEnvelope<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string; bot?: string; path?: string; field?: string } };
export type DoctorProbe = { mode: 'offline' } | { mode: 'online'; timeoutMs: number };
export type TestRequest = { bot: string; prompt: string; session?: string; ephemeral: boolean };
