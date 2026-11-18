// Allow-list SVG sanitizer for customer-uploaded artwork (full-color tags and ornaments).
//
// Workers have no DOM, so this is a small tokenizer that RE-EMITS the document from an allow-list instead of
// trying to delete bad parts of the original. Anything not on the list is dropped, so a construct we did not
// think of cannot survive. Dropped for good (element and everything inside it): script, foreignObject, iframe,
// object, embed, animation elements (animate, set, animateMotion, animateTransform), filter, metadata, and any
// element not on the list. Unwrapped (children kept): a, switch. Stripped from every kept element: on* event
// attributes, any href that is not a same-document "#id" (or a raster data: image on <image>), and url()
// references that leave the document, inside style attributes and <style> blocks too.
// A document with a DOCTYPE or ENTITY declaration is refused outright (entity expansion tricks).
//
// sanitizeSvg(text) -> { ok: true, svg, aspect, removed: [..] } | { ok: false, error }
// Unit-tested in tools/test/fullcolor.test.mjs. The browser never needs its own copy: the builder only shows the
// SVG through <img>/<image>, which cannot run script or fetch anything.
//
// Render-cost limits (Flint CR-002): <use> and <symbol> are not accepted at all (a 2 KB file of nested <use> expands to
// 10^9 instances and hangs the owner's orders page), <pattern> is not accepted (tiles of tiles multiply), <mask> and
// <clipPath> are capped in number and nesting, and inside them every url() reference is removed so one cannot reference
// another. Embedded raster <image> data is checked with the same header parser as direct uploads (_raster.js).

import { inspectRaster } from './_raster.js';

export const SVG_MAX_CHARS = 1_800_000;
const MAX_NODES = 20000;
const MAX_MASKS = 12, MAX_MASK_DEPTH = 2, MAX_IMAGES = 8;
const MAX_G_DEPTH = 16, MAX_GROUPS = 500; // nested groups multiply paint cost (a 66 KB file of 2000 nested filtered groups froze a browser tab)
const CONTAINERS = new Set(['mask', 'clipPath']);

const ELEMENTS = new Set(['svg', 'g', 'defs', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'text', 'tspan', 'title', 'desc', 'linearGradient', 'radialGradient', 'stop', 'clipPath', 'mask', 'image', 'style']);
const UNWRAP = new Set(['a', 'switch']);
const TEXT_PARENTS = new Set(['text', 'tspan', 'title', 'desc', 'style']);

const ATTRS = new Set([
  'id', 'class', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'fx', 'fy', 'width', 'height', 'd', 'points', 'transform',
  'viewBox', 'preserveAspectRatio', 'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-linecap',
  'stroke-linejoin', 'stroke-miterlimit', 'stroke-dasharray', 'stroke-dashoffset', 'opacity', 'clip-path', 'clip-rule', 'mask', 'offset',
  'stop-color', 'stop-opacity', 'gradientUnits', 'gradientTransform', 'spreadMethod', 'patternUnits', 'patternContentUnits', 'patternTransform',
  'clipPathUnits', 'maskUnits', 'maskContentUnits', 'font-family', 'font-size', 'font-weight', 'font-style', 'text-anchor', 'letter-spacing',
  'dominant-baseline', 'dx', 'dy', 'rotate', 'textLength', 'lengthAdjust', 'display', 'visibility', 'version', 'xmlns', 'xml:space',
  'href', 'xlink:href', 'xmlns:xlink', 'style', 'type', 'media', 'overflow', 'color', 'mix-blend-mode', 'vector-effect', 'refX', 'refY', 'markerWidth', 'markerHeight',
]);

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
function decodeEntities(s) {
  return String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : '';
    }
    return NAMED[e.toLowerCase()] ?? m;
  });
}
const escAttr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escText = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// eslint-disable-next-line no-control-regex
const stripCtl = (s) => String(s).replace(/[\u0000-\u001f\u007f\s]+/g, '');

// A dash pattern with a tiny positive value (0.00001) makes a renderer draw millions of dashes.
export function dashBad(value) {
  const nums = String(value).match(/\d*\.?\d+(?:e-?\d+)?/gi) || [];
  return nums.some((n) => { const v = Number(n); return v > 0 && v < 0.1; });
}
// CSS: drop everything if it carries an import, scriptable value, or binding; neutralise url() that leaves the document.
export function cleanCss(css) {
  const c = decodeEntities(css).replace(/\/\*[\s\S]*?\*\//g, '');
  // A backslash (CSS escapes such as u\72l( and @\69mport), any at-rule, image-set(), src() and expression-like values are
  // not worth parsing: the whole block or attribute is dropped.
  if (/[\\@]|image-set|\bsrc\s*\(|expression\s*\(|javascript\s*:|vbscript\s*:|-moz-binding|behavior\s*:|<\s*\/?\s*(script|style)/i.test(c)) return '';
  return c
    .replace(/url\(\s*(['"]?)\s*([^)]*?)\s*\1\s*\)/gi, (m, _q, ref) => (/^#[\w.:-]+$/.test(ref) ? m : 'none'))
    // filter (and backdrop-filter) are not allowed CSS properties: blur and friends are what make nested groups expensive.
    .replace(/(^|[;{\s])(?:-webkit-)?(?:backdrop-)?filter\s*:[^;}]*;?/gi, '$1')
    .replace(/(^|[;{\s])stroke-dasharray\s*:([^;}]*);?/gi, (m, p, v) => (dashBad(v) ? p : m));
}

// An href is kept only as a same-document fragment, or a raster data: URI on <image>.
function hrefOk(name, value) {
  const v = stripCtl(decodeEntities(value));
  if (/^#[\w.:-]+$/.test(v)) return name !== 'image'; // <use> is gone; a fragment on <image> means nothing
  const m = name === 'image' && /^data:image\/(png|jpeg|jpg|webp);base64,([A-Za-z0-9+/=]+)$/i.exec(v);
  if (!m) return false;
  try { return inspectRaster(Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0))).ok; } catch { return false; }
}

// Scan one tag starting at s[i] === '<'. Returns { end, kind, name, attrs, selfClose } or null when unterminated.
function readTag(s, i) {
  let j = i + 1, q = null;
  for (; j < s.length; j++) {
    const c = s[j];
    if (q) { if (c === q) q = null; continue; }
    if (c === '"' || c === "'") { q = c; continue; }
    if (c === '>') break;
  }
  if (j >= s.length) return null;
  let inner = s.slice(i + 1, j);
  const end = j + 1;
  if (inner[0] === '/') return { end, kind: 'close', name: inner.slice(1).trim().split(/\s/)[0] };
  const selfClose = /\/\s*$/.test(inner);
  if (selfClose) inner = inner.replace(/\/\s*$/, '');
  const m = /^([^\s/>]+)/.exec(inner);
  if (!m) return { end, kind: 'junk' };
  const attrs = [];
  const re = /([^\s=/>"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  re.lastIndex = m[0].length;
  let a;
  while ((a = re.exec(inner))) attrs.push([a[1], a[2] ?? a[3] ?? a[4] ?? '']);
  return { end, kind: 'open', name: m[1], attrs, selfClose };
}

export function sanitizeSvg(input) {
  let s = String(input == null ? '' : input);
  if (!s.trim()) return { ok: false, error: 'That SVG file is empty.' };
  if (s.length > SVG_MAX_CHARS) return { ok: false, error: 'That SVG is too large. Use a file under 1.8 MB.' };
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
  if (/<!DOCTYPE|<!ENTITY/i.test(s)) return { ok: false, error: 'That SVG uses features we do not accept (DOCTYPE or ENTITY). Export it again as plain SVG.' };

  const out = [];
  const removed = new Set();
  const stack = []; // emitted element names, so closers match
  let gDepth = 0, groups = 0, skipDepth = 0, nodes = 0, i = 0, sawSvg = false, styleBuf = null, rootAttrs = null, masks = 0, images = 0, maskDepth = 0;
  let curText = []; // text-bearing ancestors

  while (i < s.length) {
    const lt = s.indexOf('<', i);
    const text = lt === -1 ? s.slice(i) : s.slice(i, lt);
    if (text && !skipDepth && curText.length) {
      if (styleBuf !== null) styleBuf += text; else out.push(escText(decodeEntities(text)));
    }
    if (lt === -1) break;
    if (s.startsWith('<!--', lt)) { const e = s.indexOf('-->', lt + 4); i = e === -1 ? s.length : e + 3; continue; }
    if (s.startsWith('<![CDATA[', lt)) {
      const e = s.indexOf(']]>', lt + 9); const body = s.slice(lt + 9, e === -1 ? s.length : e);
      if (!skipDepth && curText.length) { if (styleBuf !== null) styleBuf += body; else out.push(escText(body)); }
      i = e === -1 ? s.length : e + 3; continue;
    }
    if (s[lt + 1] === '?' || s[lt + 1] === '!') { const e = s.indexOf('>', lt); i = e === -1 ? s.length : e + 1; continue; }
    const tag = readTag(s, lt);
    if (!tag) return { ok: false, error: 'That SVG could not be read (unterminated tag).' };
    i = tag.end;
    if (tag.kind === 'junk') continue;
    if (++nodes > MAX_NODES) return { ok: false, error: 'That SVG is too complex. Simplify it or export a PNG.' };

    if (tag.kind === 'close') {
      if (skipDepth) { skipDepth--; continue; }
      const top = stack[stack.length - 1];
      if (top && top.name === tag.name && !top.emit) { stack.pop(); continue; }
      if (top && top.name === tag.name) {
        stack.pop();
        if (top.name === 'style') { const css = cleanCss(styleBuf || ''); styleBuf = null; if (css) out.push(escText(css)); else removed.add('style'); }
        if (TEXT_PARENTS.has(top.name)) curText.pop();
        if (CONTAINERS.has(top.name)) maskDepth--;
        if (top.name === 'g') gDepth--;
        out.push(`</${top.name}>`);
      }
      continue;
    }

    // open tag
    if (skipDepth) { if (!tag.selfClose) skipDepth++; continue; }
    const name = tag.name;
    if (UNWRAP.has(name)) { removed.add(name); if (!tag.selfClose) stack.push({ name, emit: false }); continue; }
    if (!ELEMENTS.has(name) || (name === 'svg' && sawSvg)) {
      // Unknown, dangerous, or a nested/second root: drop it and everything inside.
      removed.add(name);
      if (!tag.selfClose) skipDepth = 1;
      continue;
    }
    if (name === 'svg') sawSvg = true;
    if (!sawSvg) continue; // anything before the root
    if (CONTAINERS.has(name) && (++masks > MAX_MASKS || maskDepth + 1 > MAX_MASK_DEPTH)) return { ok: false, error: 'That SVG is too complex (masks or clip paths nested too deep). Simplify it or export a PNG.' };
    if (name === 'g' && (++groups > MAX_GROUPS || (!tag.selfClose && gDepth + 1 > MAX_G_DEPTH))) return { ok: false, error: 'That SVG is too complex (groups nested too deep or too many). Simplify it or export a PNG.' };
    if (name === 'image' && ++images > MAX_IMAGES) return { ok: false, error: 'That SVG embeds too many images. Export a PNG instead.' };
    const inContainer = maskDepth > 0 || CONTAINERS.has(name);
    const kept = [];
    const seen = new Set();
    for (const [an, av] of tag.attrs) {
      const lower = an.toLowerCase();
      if (lower.startsWith('on')) { removed.add(an); continue; }
      if (an.includes(':') && an !== 'xlink:href' && an !== 'xml:space' && an !== 'xmlns:xlink') { removed.add(an); continue; }
      if (!ATTRS.has(an)) { removed.add(an); continue; }
      if (seen.has(an)) continue; seen.add(an);
      if (an === 'href' || an === 'xlink:href') {
        if (!hrefOk(name, av)) { removed.add(an); continue; }
        kept.push([an, stripCtl(decodeEntities(av))]);
        continue;
      }
      if (an === 'style') { const css = cleanCss(av); if (css && !(inContainer && /url\s*\(/i.test(css))) kept.push([an, css]); else removed.add('style-attr'); continue; }
      const dv = decodeEntities(av);
      if (inContainer && /url\s*\(/i.test(dv)) { removed.add(an); continue; } // masks and clip paths cannot reference each other
      if (an === 'stroke-dasharray' && dashBad(dv)) { removed.add(an); continue; }
      // Presentation attributes can carry url(): keep only same-document references.
      if (/url\s*\(/i.test(dv)) { const c = cleanCss(dv); if (!c) { removed.add(an); continue; } kept.push([an, c]); continue; }
      if (/javascript\s*:|data\s*:/i.test(dv) && an !== 'd') { removed.add(an); continue; }
      kept.push([an, dv]);
    }
    // xmlns is pinned: the root always declares the SVG namespace (and xlink only as xlink); nothing else may redeclare it.
    for (let k = kept.length - 1; k >= 0; k--) {
      if (kept[k][0] === 'xmlns' || kept[k][0] === 'xmlns:xlink') kept.splice(k, 1);
    }
    if (name === 'svg') {
      rootAttrs = Object.fromEntries(kept);
      kept.unshift(['xmlns', 'http://www.w3.org/2000/svg']);
      if ((tag.attrs || []).some(([a]) => a === 'xmlns:xlink')) kept.splice(1, 0, ['xmlns:xlink', 'http://www.w3.org/1999/xlink']);
    }
    if (name === 'image' && !kept.some(([a]) => a === 'href' || a === 'xlink:href')) { removed.add('image'); images--; if (!tag.selfClose) skipDepth = 1; continue; }
    const attrStr = kept.map(([a, v]) => ` ${a}="${escAttr(v)}"`).join('');
    if (tag.selfClose) {
      out.push(`<${name}${attrStr}/>`);
    } else {
      out.push(`<${name}${attrStr}>`);
      stack.push({ name, emit: true });
      if (CONTAINERS.has(name)) maskDepth++;
      if (name === 'g') gDepth++;
      if (TEXT_PARENTS.has(name)) { curText.push(name); if (name === 'style') styleBuf = ''; }
    }
  }
  // Close anything left open so the result is well formed.
  while (stack.length) { const t = stack.pop(); if (t.emit) out.push(`</${t.name}>`); }

  if (!sawSvg || !rootAttrs) return { ok: false, error: 'That file does not look like an SVG image.' };
  let vb = String(rootAttrs.viewBox || '').trim().split(/[\s,]+/).map(Number);
  if (vb.length !== 4 || vb.some((n) => !Number.isFinite(n)) || vb[2] <= 0 || vb[3] <= 0) {
    const w = parseFloat(rootAttrs.width), h = parseFloat(rootAttrs.height);
    if (!(w > 0 && h > 0)) return { ok: false, error: 'That SVG has no size. Export it with a viewBox, or as a PNG.' };
    vb = [0, 0, w, h];
    const svg0 = out.join('').replace('<svg', `<svg viewBox="0 0 ${w} ${h}"`);
    return { ok: true, svg: svg0, aspect: w / h, removed: [...removed] };
  }
  const svg = out.join('');
  if (!/<(path|rect|circle|ellipse|line|polyline|polygon|text|image|use)\b/.test(svg)) return { ok: false, error: 'That SVG has nothing drawn in it after cleaning.' };
  return { ok: true, svg, aspect: vb[2] / vb[3], removed: [...removed] };
}
