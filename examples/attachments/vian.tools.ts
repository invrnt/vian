import { writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export default {
  generate_report: {
    description: 'Create a sample text report and register it as an attachment',
    inputSchema: { type: 'object', properties: { title: { type: 'string', minLength: 1 } }, required: ['title'], additionalProperties: false },
    async execute(input: { title: string }, ctx: { attachments: { register(input: { path: string; name: string; mimeType: string }): Promise<unknown> } }) {
      const dir = await mkdtemp(join(tmpdir(), 'vian-report-'));
      const path = join(dir, 'report.txt');
      try {
        await writeFile(path, `${input.title}\n`);
        return { message: 'Report generated', attachment: await ctx.attachments.register({ path, name: 'report.txt', mimeType: 'text/plain' }) };
      } finally { await rm(dir, { recursive: true, force: true }); }
    },
  },
};
