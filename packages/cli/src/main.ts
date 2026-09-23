import type { CommandContext } from '@vian/core';
const help = `Vian — local conversational runtime\n\nUsage: vian <command> [options]\n\nCommands:\n  help, --help       Show this help\n  list               List registered bots\n  inspect            Inspect a bot\n  sessions           List sessions\n  history            Export history\n  doctor             Check local setup\n  init, create       Prepare a bot directory\n  register           Register a bot\n  test               Run a local test conversation\n  auth               Manage provider authentication\n  daemon             Run the daemon\n  status             Show daemon status\n`;
export async function main(args: string[], context: CommandContext): Promise<number> {
  const [command, ...rest] = args;
  if (!command || command === '--help' || command === '-h' || command === 'help') { context.stdout(help); return 0; }
  if (command === 'auth') {
    const { authCommand } = await import('./auth/index.ts');
    return authCommand.run(rest, context);
  }
  if (command === 'daemon' || command === 'status') {
    context.stderr(`Command ${command} is not available in this build.\n`);
    return 2;
  }
  const { run } = await import('./local/index.ts');
  return run([command, ...rest], context);
}
if (import.meta.main) { process.exitCode = await main(Bun.argv.slice(2), { cwd: process.cwd(), stdout: text => process.stdout.write(text), stderr: text => process.stderr.write(text) }); }
