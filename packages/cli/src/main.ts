import type { CommandContext } from '@vian/core';
const help = `Vian — local conversational runtime\n\nUsage: vian <command> [options]\n\nCommands:\n  help, --help       Show this help\n  list               List registered bots\n  inspect            Inspect a bot\n  sessions           List sessions\n  history            Export history\n  doctor             Check local setup\n  init, create       Prepare a bot directory\n  register           Register a bot\n  test               Run a local test conversation\n  auth               Manage provider authentication\n  daemon             Run the daemon\n  status             Show daemon status\n`;
export async function main(args: string[], context: CommandContext): Promise<number> {
  const [command, ...rest] = args;
  if (!command || command === '--help' || command === '-h' || command === 'help') { context.stdout(help); return 0; }
  const modulePath = command === 'auth' ? './auth/index.ts' : command === 'daemon' || command === 'status' ? './operations/index.ts' : './local/index.ts';
  try {
    const module = await import(modulePath);
    return await module.run([command, ...rest], context);
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ERR_MODULE_NOT_FOUND') { context.stderr(`Command ${command} is not available in this build.\n`); return 2; }
    throw error;
  }
}
if (import.meta.main) { process.exitCode = await main(Bun.argv.slice(2), { cwd: process.cwd(), stdout: text => process.stdout.write(text), stderr: text => process.stderr.write(text) }); }
