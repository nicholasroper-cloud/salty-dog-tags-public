// Captures laser/test/golden-smart/*.svg: the back side of smart tags (QR group included). Re-capturing is a deliberate act: say why in the commit.
// Usage: node test/capture-smart-golden.mjs
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { smartGoldenSvgs } from './smart-golden-lib.mjs';
const here = path.dirname(fileURLToPath(import.meta.url));
await mkdir(path.join(here, 'golden-smart'), { recursive: true });
for (const [id, svg] of await smartGoldenSvgs()) await writeFile(path.join(here, 'golden-smart', `${id}-back.svg`), svg);
console.log('captured smart goldens');
