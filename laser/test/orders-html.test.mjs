// site/orders.html delegates to SDTLayout. Run its real delegating code in a vm (as the browser would, with the shared
// module as a global) and check it returns exactly what the Node side produces.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SDTLayout } from '../lib/layout.mjs';
import { ensureFontFile, toArrayBuffer, fontUrl } from '../lib/fonts.mjs';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const html = await readFile(path.join(here, '..', '..', 'site', 'orders.html'), 'utf8');
const fixtures = JSON.parse(await readFile(path.join(here, 'fixtures', 'tags.json'), 'utf8'));

test('orders.html loads the shared module before use, with a cache-busting version', () => {
  assert.match(html, /<script src="\/tag-layout\.js\?v=\d+"><\/script>/);
  assert.ok(html.indexOf('/tag-layout.js') > html.indexOf('opentype.min.js'));
  assert.ok(!/const (FONT_TTF|UPPER|ICONS|OUT)=/.test(html), 'layout constants must live only in tag-layout.js');
});

test('N7: the script tag version equals the shipped layout VERSION (cache bust on every layout change)', () => {
  const m = html.match(/\/tag-layout\.js\?v=(\d+)/);
  assert.ok(m, 'versioned script tag present');
  assert.equal(Number(m[1]), SDTLayout.VERSION);
});

test('the delegating block in orders.html produces the same SVG as the module for every fixture side', async () => {
  const a = html.indexOf('const fontCache={};');
  const b = html.indexOf('function download(');
  assert.ok(a > 0 && b > a);
  const block = html.slice(a, b);
  const served = new Map();
  for (const k of Object.keys(SDTLayout.FONT_TTF)) served.set(fontUrl(k), (await ensureFontFile(k, fontUrl(k))).buf);
  const fakeFetch = (url) => served.has(url)
    ? Promise.resolve({ arrayBuffer: () => Promise.resolve(toArrayBuffer(served.get(url))) })
    : Promise.reject(new Error('unexpected fetch ' + url));
  const ctx = vm.createContext({ opentype: require('opentype.js'), fetch: fakeFetch, SDTLayout, SDTSmart: { qrOpts: () => null } });   // non-smart tags: the QR hook returns null, output unchanged
  vm.runInContext(block + ';globalThis.__svg = lightburnSVG;', ctx);
  let n = 0;
  for (const { tag } of fixtures) {
    for (const side of ['front', 'back']) {
      if (!(tag[side] || []).some(Boolean) && !(side === 'front' && tag.icon !== 'none')) continue;
      const font = await (await import('../lib/fonts.mjs')).loadFont(SDTLayout.fontKey(tag));
      assert.equal(await ctx.__svg(tag, side), SDTLayout.svg(tag, side, font));
      n++;
    }
  }
  assert.ok(n >= 12);
});
