// Shared helper for the sync tests: pulls the literal tables out of site/app.js the same way tools/build-sayings.mjs does.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

function extractBalanced(text, marker, openChar, closeChar) {
  const m = text.indexOf(marker);
  if (m === -1) throw new Error('marker not found: ' + marker);
  const start = text.indexOf(openChar, m);
  let depth = 0, inStr = null, i = start;
  for (; i < text.length; i++) {
    const c = text[i];
    if (inStr) { if (c === inStr && text[i - 1] !== '\\') inStr = null; continue; }
    if (c === '/' && text[i + 1] === '/') { const nl = text.indexOf('\n', i); i = nl === -1 ? text.length : nl; continue; }
    if (c === '/' && text[i + 1] === '*') { const e = text.indexOf('*/', i + 2); i = e === -1 ? text.length : e + 1; continue; }
    if (c === '"' || c === "'" || c === '`') { inStr = c; continue; }
    if (c === openChar) depth++;
    else if (c === closeChar) { depth--; if (depth === 0) { i++; break; } }
  }
  return text.slice(start, i);
}
// JSON round-trip so values are same-realm plain objects (deepStrictEqual rejects vm-context prototypes)
const lit = (src, marker, o, c) => JSON.parse(JSON.stringify(vm.runInNewContext('(' + extractBalanced(src, marker, o, c) + ')')));

export function appData() {
  const src = read('site/app.js');
  const blankKeys = lit(src, 'const BLANK_PHOTOS = Object.fromEntries(', '[', ']');
  const d = {
    SAYINGS: lit(src, 'const SAYINGS = ', '[', ']'),
    PRICES: lit(src, 'const PRICES = ', '{', '}'),
    FINISHES: lit(src, 'const FINISHES = ', '{', '}'),
    SIZE_AVAIL: lit(src, 'const SIZE_AVAIL = ', '{', '}'),
    BLANK_MM: lit(src, 'const BLANK_MM = ', '{', '}'),
    HIDDEN_SHAPES: lit(src, 'const HIDDEN_SHAPES = ', '[', ']'),
    SHAPES: lit(src, 'const SHAPES = ', '{', '}'),
    GALLERY_SHAPE: lit(src, 'const GALLERY_SHAPE = ', '[', ']'),
    blank: new Set(blankKeys),
  };
  d.finishOk = (finish, shape) => d.blank.has(`${shape}-${finish}`);
  d.sizesFor = (shape, finish) => { const a = d.SIZE_AVAIL[shape] || { '*': ['medium'] }; return a[finish] || a[(d.FINISHES[finish] || {}).kind] || a['*']; };
  d.visibleShapes = Object.keys(d.SHAPES).filter((s) => !d.HIDDEN_SHAPES.includes(s));
  d.cleanCount = d.SAYINGS.filter((s) => !s.x).length;
  // One entry per visible shape x material tier that really exists (a blank is on hand).
  const TIERS = [['aluminum', 'red', 'Anodized aluminum'], ['stainless', 'stainless', 'Stainless steel'], ['polished', 'polished', 'Polished stainless steel'], ['brass', 'brass', 'Brass']];
  d.products = [];
  for (const shape of d.visibleShapes) for (const [tier, finish, material] of TIERS) {
    if (!d.finishOk(finish, shape)) continue;
    const size = d.sizesFor(shape, finish)[0];
    d.products.push({ shape, tier, finish, material, size, price: d.PRICES.size[size] + (d.PRICES.premium[finish] || 0) });
  }
  return d;
}
