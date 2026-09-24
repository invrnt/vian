import type { CommandContext } from '@vian/core';
const help = `Vian — local conversational runtime\n\nUsage: vian <command> [options]\n\nCommands:\n  help, --help       Show this help\n  update             Update this Vian command (including preview releases)\n  list               List registered bots\n  inspect            Inspect a bot\n  sessions           List sessions\n  history            Export history\n  doctor             Check local setup (--online probes external adapters)\n  init, create       Prepare a bot directory\n  register           Register a bot\n  test               Run a local test conversation\n  auth               Manage provider authentication\n  telegram           Connect a bot with a hidden token prompt\n  daemon             Run the daemon\n  status             Show daemon status\n  start, stop        Control one bot\n  restart            Reload one bot\n  enable, disable    Change daemon startup state\n  access             Manage pairing and bindings\n  access verify <bot> [--as <principal>] [--minutes N]\n  logs               Show runtime diagnostics\n  service            Manage the Linux user service\n`;
export async function main(args: string[], context: CommandContext): Promise<number> {
  const [command, ...rest] = args;
  if (!command || command === '--help' || command === '-h' || command === 'help') { context.stdout(help); return 0; }
  if (command === 'update') {
    const { updateCommand } = await import('./update.ts');
    return updateCommand(rest, context);
  }
  if (command === 'auth') {
    const { authCommand } = await import('./auth/index.ts');
    return authCommand.run(rest, context);
  }
  if (['daemon', 'status', 'start', 'stop', 'restart', 'enable', 'disable', 'service', 'logs', 'access', 'test', 'telegram'].includes(command)) {
    const { runOperations } = await import('./operations/index.ts');
    return runOperations([command, ...rest], context);
  }
  const { run } = await import('./local/index.ts');
  return run([command, ...rest], context);
}
if (import.meta.main) void main(Bun.argv.slice(2), { cwd: process.cwd(), stdout: text => process.stdout.write(text), stderr: text => process.stderr.write(text) }).then(code => { process.exitCode = code; });
