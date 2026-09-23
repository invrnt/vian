import { writeFileSync } from 'node:fs';
import { z } from 'zod';
import { ManifestSchema } from '../packages/core/src/config.ts';
writeFileSync('schema/v1.json', JSON.stringify(z.toJSONSchema(ManifestSchema), null, 2) + '\n');
