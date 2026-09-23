import type { CommandContext } from '@vian/core';
import { resolve } from 'node:path';
import { findBot, has, option, positional, withRegistry } from './common.ts';
import { init, initArgs, register, wizardArgs } from './init.ts';
import { doctor, DoctorFailure } from './doctor.ts';
import { history, inspect, list, sessions } from './read.ts';

export async function run(args: string[], context: CommandContext): Promise<number> {
  const command = args[0];
  try {
    switch (command) {
      case 'init': { const parsed = initArgs(command, args); await init(parsed.root, await wizardArgs(resolve(context.cwd, parsed.root), args), context); break; }
      case 'create': { const parsed = initArgs(command, args); await init(parsed.root, await wizardArgs(resolve(context.cwd, parsed.root), args, parsed.name), context, parsed.name); break; }
      case 'register': { const path = positional(args.slice(1))[0] ?? '.'; await register(path, args, context); break; }
      case 'unregister': {
        const selector = positional(args.slice(1))[0];
        if (!selector) throw new Error('Usage: vian unregister <bot>');
        const record = await findBot(selector);
        await withRegistry(registry => registry.unregister(record.id));
        context.stdout(`Unregistered ${record.alias}; bot files retained at ${record.path}\n`);
        break;
      }
      case 'list': await list(args, context); break;
      case 'inspect': await inspect(args, context); break;
      case 'sessions': await sessions(args, context); break;
      case 'history': await history(args, context); break;
      case 'doctor': await doctor(args, context); break;
      default: throw new Error(`Unknown local command: ${command}`);
    }
    return 0;
  } catch (error) {
    if (error instanceof DoctorFailure) return 1;
    const message = error instanceof Error ? error.message : String(error);
    if (has(args, '--json')) context.stdout(JSON.stringify({ ok: false, error: { code: 'LOCAL_COMMAND_FAILED', message } }) + '\n');
    else context.stderr(`${message}\n`);
    return 1;
  }
}
