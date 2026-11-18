// The Node side of site/tag-qr.js (smart QR tag geometry). Loads the finish gate file Nick flips after the laser test matrix.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
export const SDTQR = require('../../site/tag-qr.js');
export const FLAGS_FILE = new URL('../../site/tag-qr-finishes.json', import.meta.url);

export function loadFinishFlags() {
  const j = JSON.parse(readFileSync(FLAGS_FILE, 'utf8'));
  SDTQR.configure({ finishes: j.finishes });
  return j.finishes;
}
loadFinishFlags();
export default SDTQR;
