import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SDTLayout } from '../lib/layout.mjs';
import { SDTQR } from '../lib/qr.mjs';
import { loadFont } from '../lib/fonts.mjs';
const here = path.dirname(fileURLToPath(import.meta.url));
export const SMART_ID = 'ABCDEFGHJK';
export async function smartFixtures() { return JSON.parse(await readFile(path.join(here, 'fixtures', 'smart-tags.json'), 'utf8')); }
// ignoreGate: the golden pins geometry, not which finishes are switched on today.
export async function smartGoldenSvgs() {
  const out = [];
  for (const { id, tag } of await smartFixtures()) {
    const ck = SDTQR.checkTag(tag, { id: SMART_ID, ignoreGate: true });
    if (!ck.ok) throw new Error(`${id}: ${ck.reason}`);
    out.push([id, SDTLayout.svg(tag, 'back', await loadFont(SDTLayout.fontKey(tag)), { qr: SDTQR.layoutOpts(ck.plan, SMART_ID) })]);
  }
  return out;
}
