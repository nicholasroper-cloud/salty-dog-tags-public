// Font cache: download the Google Fonts TTFs once, keep them in laser/fonts/, hash them.
// Low-level helpers take the base URL and file map as arguments so the golden-capture script
// can use them before site/tag-layout.js exists. The layout-bound API is at the bottom.
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const FONT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fonts');
const MAX_FONT_BYTES = 5 * 1024 * 1024;

export function sha256(buf) {
  return 'sha256:' + createHash('sha256').update(buf).digest('hex');
}

// Returns {key, file, buf, sha256}. Downloads when the cached file is absent.
export async function ensureFontFile(key, url, { dir = FONT_DIR, fetchImpl = fetch } = {}) {
  if (!/^[a-z]+$/.test(key)) throw new Error(`bad font key "${key}"`);
  const file = path.join(dir, `${key}.ttf`);
  let buf;
  try {
    buf = await readFile(file);
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new Error(`font ${key}: HTTP ${res.status}`);
    buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0 || buf.length > MAX_FONT_BYTES) throw new Error(`font ${key}: bad size ${buf.length}`);
    await mkdir(dir, { recursive: true });
    const tmp = `${file}.tmp-${process.pid}`;
    await writeFile(tmp, buf);
    await rename(tmp, file);
  }
  return { key, file, buf, sha256: sha256(buf) };
}

// Exact ArrayBuffer for opentype.parse (a Buffer's backing store can be pooled/shared).
export function toArrayBuffer(buf) {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

// ---- layout-bound API (used by generate.mjs and the parity tests) ----
import opentype from 'opentype.js';
import { SDTLayout } from './layout.mjs';
import { log } from './log.mjs';

const parsed = new Map();

export function fontUrl(key) {
  return SDTLayout.FONT_BASE + SDTLayout.FONT_TTF[key];
}

// Parsed opentype Font for a font key; downloads and caches the TTF on first need.
export async function loadFont(key, opts = {}) {
  if (!SDTLayout.FONT_TTF[key]) throw new Error(`unknown font key "${key}"`);
  if (parsed.has(key) && !opts.dir) return parsed.get(key);
  const f = await ensureFontFile(key, fontUrl(key), opts);
  const font = opentype.parse(toArrayBuffer(f.buf));
  if (!opts.dir) parsed.set(key, font);
  return font;
}

// sha256 of every cached/downloaded font, keyed by font key.
export async function fontHashes(opts = {}) {
  const out = {};
  for (const k of Object.keys(SDTLayout.FONT_TTF)) out[k] = (await ensureFontFile(k, fontUrl(k), opts)).sha256;
  return out;
}

// Compare against the hashes recorded when the goldens were captured; WARN when they differ.
export function warnIfFontsChanged(hashes, manifestFonts) {
  const changed = Object.keys(manifestFonts || {}).filter((k) => hashes[k] !== manifestFonts[k]);
  if (changed.length) log.warn(`fonts changed upstream since goldens were captured: ${changed.join(', ')}`);
  return changed;
}
