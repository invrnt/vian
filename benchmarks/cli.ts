import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const binary = resolve(process.argv[2] ?? 'dist/vian');
const bot = process.argv[3];
const runs: Record<string, string[]> = { help: ['--help'], list: ['list'] };
if (bot) { runs.inspect = ['inspect', bot]; runs.doctor = ['doctor', bot]; }
for (const [name, args] of Object.entries(runs)) {
  const samples: number[] = [];
  for (let i = 0; i < 21; i++) {
    const started = performance.now();
    const result = spawnSync(binary, args, { encoding: 'utf8' });
    const elapsed = performance.now() - started;
    if (result.error) throw result.error;
    if (i) samples.push(elapsed);
  }
  samples.sort((a, b) => a - b);
  console.log(JSON.stringify({ command: name, samples: samples.length, minMs: +samples[0]!.toFixed(2), medianMs: +samples[Math.floor(samples.length / 2)]!.toFixed(2), p95Ms: +samples[Math.floor(samples.length * 0.95)]!.toFixed(2), maxMs: +samples.at(-1)!.toFixed(2) }));
}
