// One-shot golden capture. Runs the layout code exactly as it appears in a given commit of
// site/orders.html (default HEAD, via `git show`, so it still works after the refactor) inside
// node:vm, and writes test/golden/<fixture>-<side>.svg + manifest.json.
//
// Usage: node test/capture-golden.mjs [<sourceCommit>]
//        node test/capture-golden.mjs --from-layout "<reason>"
// Re-capturing is a deliberate act: the commit message must say why.
//
// --from-layout re-captures from site/tag-layout.js itself (the shared module) instead of the original orders.html
// block. Use it after an intentional layout change (for example the enlarged text boxes). The original capture's
// provenance (sourceCommit) is kept in the manifest; the parity proof against the unmodified orders.html is the
// commit that first introduced the goldens.
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureFontFile, toArrayBuffer } from '../lib/fonts.mjs';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..');

// The google/fonts commit that site/tag-layout.js pins (Q9). The unmodified orders.html used @main,
// whose bytes at capture time were identical to this SHA (verified by sha256 on 2026-10-16).
const PINNED_SHA = '47d54ca1ebb14fd864695f1d39dc734f39017c33';
const PINNED_BASE = `https://cdn.jsdelivr.net/gh/google/fonts@${PINNED_SHA}/`;

if (process.argv[2] === '--from-layout') {
  const reason = process.argv[3];
  if (!reason) throw new Error('--from-layout needs a reason string');
  const { SDTLayout } = await import('../lib/layout.mjs');
  const { loadFont } = await import('../lib/fonts.mjs');
  const fontsMod = await import('../lib/fonts.mjs');
  const prev = JSON.parse(await readFile(path.join(here, 'golden', 'manifest.json'), 'utf8'));
  const fixtures = JSON.parse(await readFile(path.join(here, 'fixtures', 'tags.json'), 'utf8'));
  let n = 0;
  const { readdir, unlink } = await import('node:fs/promises');
  for (const f of await readdir(path.join(here, 'golden'))) if (f.endsWith('.svg')) await unlink(path.join(here, 'golden', f)); // stale goldens must not linger
  for (const { id, tag } of fixtures) {
    for (const side of ['front', 'back']) {
      const hasText = (tag[side] || []).filter(Boolean).length > 0;
      const hasIcon = side === 'front' && tag.icon && tag.icon !== 'none';
      if (!hasText && !hasIcon) continue;
      await writeFile(path.join(here, 'golden', `${id}-${side}.svg`), SDTLayout.svg(tag, side, await loadFont(SDTLayout.fontKey(tag))));
      n++;
    }
  }
  const manifest = {
    sourceCommit: prev.sourceCommit,
    note: 'sourceCommit is the original orders.html the parity proof was captured from; the SVGs below were re-captured from site/tag-layout.js',
    recapture: { from: 'site/tag-layout.js', layoutVersion: SDTLayout.VERSION, reason, at: new Date().toISOString().replace(/\.\d+Z$/, 'Z') },
    opentype: prev.opentype, fontBase: SDTLayout.FONT_BASE, pathFixes: prev.pathFixes, capturedAt: prev.capturedAt,
    fonts: await fontsMod.fontHashes()
  };
  await writeFile(path.join(here, 'golden', 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(`re-captured ${n} golden SVGs from site/tag-layout.js (layout v${SDTLayout.VERSION})`);
  process.exit(0);
}

const sourceCommit = process.argv[2] || execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo }).toString().trim();
const html = execFileSync('git', ['show', `${sourceCommit}:site/orders.html`], { cwd: repo, maxBuffer: 64 * 1024 * 1024 }).toString('utf8');

const START = 'const FONT_TTF=';
const END = 'function download(';
const a = html.indexOf(START);
const b = html.indexOf(END);
if (a < 0) throw new Error(`marker not found: ${START}`);
if (b < 0) throw new Error(`marker not found: ${END}`);
if (b < a) throw new Error('markers out of order');
const slice = html.slice(a, b);

// Pull FONT_TTF out of the slice itself so the capture always matches the source being captured.
const probe = {};
vm.runInNewContext(slice.slice(0, slice.indexOf('\n')) + ';__out.FONT_TTF=FONT_TTF', { __out: probe });
const FONT_TTF = probe.FONT_TTF;

// FINDING (2026-10-16): the 'marker' path in the unmodified orders.html (ofl/permanentmarker/...) 404s;
// Permanent Marker lives under apache/ in google/fonts. The source URL is served from the real file so
// the other four fonts and the layout math are captured faithfully. tag-layout.js carries the fixed path.
const PATH_FIX = { 'ofl/permanentmarker/PermanentMarker-Regular.ttf': 'apache/permanentmarker/PermanentMarker-Regular.ttf' };
const fonts = {};
const bytesByRel = {};
for (const [k, rel] of Object.entries(FONT_TTF)) {
  const f = await ensureFontFile(k, PINNED_BASE + (PATH_FIX[rel] || rel));
  fonts[k] = f.sha256;
  bytesByRel[rel] = f.buf;
}

// The source fetches 'https://cdn.jsdelivr.net/gh/google/fonts@main/<rel>'. Serve those from the
// pinned local files and refuse any other URL.
const MAIN_BASE = 'https://cdn.jsdelivr.net/gh/google/fonts@main/';
function fakeFetch(url) {
  if (typeof url === 'string' && url.startsWith(MAIN_BASE) && bytesByRel[url.slice(MAIN_BASE.length)]) {
    const buf = bytesByRel[url.slice(MAIN_BASE.length)];
    return Promise.resolve({ arrayBuffer: () => Promise.resolve(toArrayBuffer(buf)) });
  }
  return Promise.reject(new Error(`golden capture: unexpected fetch ${url}`));
}

const ctx = vm.createContext({ opentype: require('opentype.js'), fetch: fakeFetch });
vm.runInContext(slice + ';globalThis.__lightburnSVG = lightburnSVG;', ctx);
const lightburnSVG = ctx.__lightburnSVG;

const fixtures = JSON.parse(await readFile(path.join(here, 'fixtures', 'tags.json'), 'utf8'));
await mkdir(path.join(here, 'golden'), { recursive: true });
let n = 0;
for (const { id, tag } of fixtures) {
  for (const side of ['front', 'back']) {
    // Same rule the service uses: a side exists when it has text, or (front only) an icon.
    const hasText = (tag[side] || []).filter(Boolean).length > 0;
    const hasIcon = side === 'front' && tag.icon && tag.icon !== 'none';
    if (!hasText && !hasIcon) continue;
    const svg = await lightburnSVG(tag, side);
    await writeFile(path.join(here, 'golden', `${id}-${side}.svg`), svg);
    n++;
  }
}
const manifest = {
  sourceCommit,
  opentype: require('opentype.js/package.json').version,
  fontBase: PINNED_BASE,
  pathFixes: PATH_FIX,
  capturedAt: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
  fonts
};
await writeFile(path.join(here, 'golden', 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`captured ${n} golden SVGs from ${sourceCommit.slice(0, 7)}`);
