// Saying-card helpers shared by build-breeds.mjs and build-pages.mjs: deep links into the builder, prices from the real tables,
// and a deterministic shape/finish pick for cards that do not name their own.
import { appData } from './appdata.mjs';

const d = appData();
export const MAX_LINE = 24, MAX_LINES = 3; // the builder shows three front lines (a fourth is hidden); app.js accepts 4 in t=
export const money = (n) => '$' + (Math.round(n * 100) / 100).toFixed(2).replace(/\.00$/, '');
export const cap = (s) => s[0].toUpperCase() + s.slice(1);
export const norm = (s) => s.toLowerCase().replace(/[‘’]/g, "'").replace(/\s+/g, ' ').trim();

// Clean (non-18+) SAYINGS by their lines joined with a space, lower-cased. First one wins on a duplicate.
export const sayingIndex = new Map();
d.SAYINGS.forEach((s, i) => { if (!s.x) { const k = norm(s.l.join(' ')); if (!sayingIndex.has(k)) sayingIndex.set(k, i); } });

export function assertLines(where, lines) {
  if (!lines.length || lines.length > MAX_LINES || lines.some((l) => !l || l.length > MAX_LINE)) throw new Error(`${where}: lines must be 1-${MAX_LINES} non-empty lines of ${MAX_LINE} characters or fewer: ${JSON.stringify(lines)}`);
}

/* The "Use this" link. s= when the saying exists verbatim in SAYINGS, t= otherwise (or when forceT). Always carries shape and finish. */
export function buildUseUrl(lines, shape, finish, { forceT = false } = {}) {
  const idx = forceT ? undefined : sayingIndex.get(norm(lines.join(' ')));
  const q = idx != null ? `s=${idx}` : `t=${lines.map(encodeURIComponent).join('|')}`;
  return { href: `/#build?${q}&amp;shape=${shape}&amp;finish=${finish}`, idx };
}

// Rough text-fit check (no fonts in Node): can these lines sit on the shape at the builder's 11px floor? Areas are the text-safe boxes in
// assets/shapes/shapes.json (polished bone is narrower). The 0.72em-per-character width was tuned against the real builder
// (tools/test/fixtures/builder-fit.json, captured from SDT.overflows in Chrome for all 181 clean sayings x 5 shapes): it never
// says "fits" where the builder says "too long" (tools/test/pages.test.mjs keeps it that way), and is a little cautious the other way.
const AREA = { bone: [217, 49], heart: [121, 57], round: [113, 97], military: [191, 127], paw: [100, 40] };
export const roomy = (shape, lines, finish) => {
  let [w, h] = AREA[shape]; if (shape === 'bone' && finish === 'polished') w *= 0.72;
  const px = 11;
  return lines.length * px * 1.18 <= h && Math.max(...lines.map((l) => l.length)) * px * 0.72 <= w;
};
export const PREFS = { A: ['round', 'heart', 'bone', 'paw'], B: ['bone', 'heart', 'paw', 'military', 'round'], C: ['military', 'bone', 'heart', 'paw'] };
const FALLBACK = { A: ['bone'], B: ['bone', 'military'], C: ['military', 'bone'] }; // nothing in PREFS has room: the roomiest legal shapes for the variant
const FINISH_CYCLE = ['black', 'red', 'royal', 'green', 'hotpink', 'stainless', 'ssblack', 'red', 'black', 'navy'];
export function autoPick(variant, lines, i) {
  const fits = PREFS[variant].filter((s) => roomy(s, lines));
  const pool = fits.length ? fits : FALLBACK[variant];
  const shape = pool[i % pool.length];
  for (let k = 0; k < FINISH_CYCLE.length; k++) { const finish = FINISH_CYCLE[(i * 3 + k) % FINISH_CYCLE.length]; if (d.finishOk(finish, shape)) return { shape, finish }; }
  throw new Error('no finish for ' + shape);
}

// The shape/finish the gallery and #build?s= give a saying when no picker is passed (same math as app.js).
export function galleryDefault(idx) {
  const shape = d.GALLERY_SHAPE[idx % d.GALLERY_SHAPE.length];
  let finish = d.GALLERY_FIN[(idx * 3) % d.GALLERY_FIN.length];
  if (!d.finishOk(finish, shape)) finish = Object.keys(d.FINISHES).find((k) => d.finishOk(k, shape)) || 'black';
  return { shape, finish };
}

// Same order the builder tries when a saying does not fit its card's shape (app.js FIT_ORDER).
const FIT_ORDER = ['bone', 'military', 'heart', 'round', 'paw'];
/* The shape and finish a saying card should link with: the gallery default if the text fits it, otherwise the first shape it does fit
 * (keeping the finish, or the first finish of the same kind that exists on that shape), exactly the move the builder makes on load. */
export function sayingPick(idx, lines) {
  const def = galleryDefault(idx);
  if (roomy(def.shape, lines, def.finish)) return def;
  const shape = FIT_ORDER.find((sh) => d.visibleShapes.includes(sh) && roomy(sh, lines, def.finish));
  if (!shape) return def; // nothing fits: leave it to the builder's own "too long" message
  const kind = d.FINISHES[def.finish].kind;
  const finish = d.finishOk(def.finish, shape) ? def.finish : Object.keys(d.FINISHES).find((k) => d.finishOk(k, shape) && d.FINISHES[k].kind === kind) || Object.keys(d.FINISHES).find((k) => d.finishOk(k, shape)) || 'black';
  return { shape, finish };
}
