// Reads the literal tables out of site/app.js (the single source of truth for sayings, prices, finishes and shapes)
// without importing the browser file. Bracket-balance the literal, then evaluate it in a throwaway vm context.
// tools/test/_appdata.mjs does the same for the sync tests; this one adds CATS, GALLERY_FIN and shapeSpec.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const SITE = join(ROOT, 'site');
export const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

export function extractBalanced(text, marker, openChar, closeChar) {
  const markerIdx = text.indexOf(marker);
  if (markerIdx === -1) throw new Error(`Marker not found in app.js: ${marker}`);
  const start = text.indexOf(openChar, markerIdx);
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
  if (depth !== 0) throw new Error(`Unbalanced literal for marker: ${marker}`);
  return text.slice(start, i);
}
// JSON round trip: same-realm plain objects.
const lit = (src, marker, o, c) => JSON.parse(JSON.stringify(vm.runInNewContext('(' + extractBalanced(src, marker, o, c) + ')')));

let cache = null;
export function appData() {
  if (cache) return cache;
  const src = read('site/app.js');
  const blankKeys = lit(src, 'const BLANK_PHOTOS = Object.fromEntries(', '[', ']');
  const d = {
    SAYINGS: lit(src, 'const SAYINGS = ', '[', ']'),
    PRICES: lit(src, 'const PRICES = ', '{', '}'),
    FINISHES: lit(src, 'const FINISHES = ', '{', '}'),
    SIZE_AVAIL: lit(src, 'const SIZE_AVAIL = ', '{', '}'),
    SHAPES: lit(src, 'const SHAPES = ', '{', '}'),
    HIDDEN_SHAPES: lit(src, 'const HIDDEN_SHAPES = ', '[', ']'),
    CATS: lit(src, 'const CATS = ', '{', '}'),
    GALLERY_FIN: lit(src, 'const GALLERY_FIN = ', '[', ']'),
    GALLERY_SHAPE: lit(src, 'const GALLERY_SHAPE = ', '[', ']'),
    blank: new Set(blankKeys),
  };
  // shapeSpec() has no dependencies, so evaluate the real function: the static tag previews use the exact outlines the builder draws.
  const fn = 'function shapeSpec' + src.slice(src.indexOf('function shapeSpec') + 'function shapeSpec'.length);
  const body = fn.slice(0, fn.indexOf('\n  }\n') + 4);
  d.shapeSpec = vm.runInNewContext(`(${body})`);
  d.finishOk = (finish, shape) => d.blank.has(`${shape}-${finish}`);
  d.sizesFor = (shape, finish) => { const a = d.SIZE_AVAIL[shape] || { '*': ['medium'] }; return a[finish] || a[(d.FINISHES[finish] || {}).kind] || a['*']; };
  d.visibleShapes = Object.keys(d.SHAPES).filter((s) => !d.HIDDEN_SHAPES.includes(s));
  d.priceFor = (shape, finish) => d.PRICES.size[d.sizesFor(shape, finish)[0]] + (d.PRICES.premium[finish] || 0);
  d.finishName = (finish) => d.FINISHES[finish].n.replace(/ \+\$\d+$/, ''); // "Royal blue", "Black stainless", "Polished stainless"
  d.cleanCount = d.SAYINGS.filter((s) => !s.x).length;
  d.adultCount = d.SAYINGS.length - d.cleanCount;
  const TIERS = [['aluminum', 'red', 'Anodized aluminum'], ['stainless', 'stainless', 'Stainless steel'], ['polished', 'polished', 'Polished stainless steel'], ['brass', 'brass', 'Brass']];
  d.TIERS = TIERS;
  d.products = [];
  for (const shape of d.visibleShapes) for (const [tier, finish, material] of TIERS) {
    if (!d.finishOk(finish, shape)) continue;
    const size = d.sizesFor(shape, finish)[0];
    d.products.push({ shape, tier, finish, material, size, price: d.PRICES.size[size] + (d.PRICES.premium[finish] || 0) });
  }
  // The counts that are published on pages come from sayings-count.json (the home page test pins it to SAYINGS).
  const exp = JSON.parse(read('tools/out/sayings-count.json'));
  if (exp.clean !== d.cleanCount) throw new Error(`tools/out/sayings-count.json says ${exp.clean} clean sayings but app.js has ${d.cleanCount}. Update the JSON.`);
  d.count = exp;
  return (cache = d);
}
