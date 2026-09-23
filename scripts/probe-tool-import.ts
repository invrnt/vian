import { pathToFileURL } from 'node:url';
const toolFile = Bun.argv[2];
if (!toolFile) throw new Error('Missing tool file');
const module = await import(pathToFileURL(toolFile).href);
if (typeof module.tools?.hello?.execute !== 'function') throw new Error('Tool export missing');
console.log(await module.tools.hello.execute({}, {}));
