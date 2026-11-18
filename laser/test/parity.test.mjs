import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SDTLayout } from '../lib/layout.mjs';
import { loadFont, fontHashes } from '../lib/fonts.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtures = JSON.parse(await readFile(path.join(here, 'fixtures', 'tags.json'), 'utf8'));
const manifest = JSON.parse(await readFile(path.join(here, 'golden', 'manifest.json'), 'utf8'));

test('site/tag-layout.js loads through require() as a classic script', () => {
  const require = createRequire(import.meta.url);
  const mod = require('../../site/tag-layout.js');
  assert.equal(typeof mod.layout, 'function');
  assert.equal(typeof mod.svg, 'function');
  assert.equal(typeof mod.fullcolorLayout, 'function'); // v5 adds the full-color print layout; engraving output is unchanged (goldens still match)
  assert.equal(mod.VERSION, 5);
});

test('no package.json with type=module sits above tag-layout.js (it would break require)', async () => {
  for (const dir of [path.join(here, '..', '..', 'site'), path.join(here, '..', '..')]) {
    let pkg = null;
    try { pkg = JSON.parse(await readFile(path.join(dir, 'package.json'), 'utf8')); } catch { /* none */ }
    assert.notEqual(pkg && pkg.type, 'module', `${dir}/package.json must not set type=module`);
  }
});

test('cached fonts match the hashes recorded with the goldens, and FONT_BASE matches the manifest', async () => {
  assert.equal(SDTLayout.FONT_BASE, manifest.fontBase);
  const have = await fontHashes();
  assert.deepEqual(have, manifest.fonts);
});

test('every font path in tag-layout.js is the one the goldens were captured with', () => {
  for (const [k, rel] of Object.entries(SDTLayout.FONT_TTF)) {
    assert.match(rel, /^(ofl|apache)\/[a-z]+\/[A-Za-z-]+\.ttf$/, k);
  }
});

const goldens = (await readdir(path.join(here, 'golden'))).filter((f) => f.endsWith('.svg')).sort();

test('golden set covers every fixture side that has text or an icon', () => {
  const expected = [];
  for (const { id, tag } of fixtures) {
    for (const side of ['front', 'back']) {
      const text = (tag[side] || []).filter(Boolean).length > 0;
      const icon = side === 'front' && tag.icon && tag.icon !== 'none';
      if (text || icon) expected.push(`${id}-${side}.svg`);
    }
  }
  assert.deepEqual(goldens, expected.sort());
});

for (const name of goldens) {
  test(`parity: SDTLayout.svg equals golden byte for byte (${name})`, async () => {
    const [id, side] = name.replace('.svg', '').split('-');
    const { tag } = fixtures.find((f) => f.id === id);
    const font = await loadFont(SDTLayout.fontKey(tag));
    const got = SDTLayout.svg(tag, side, font);
    const want = await readFile(path.join(here, 'golden', name), 'utf8');
    assert.equal(got, want);
  });
}

test('layout() reports the numbers the SVG is built from', async () => {
  const { tag } = fixtures.find((f) => f.id === 'f01');
  const r = SDTLayout.layout(tag, 'front', await loadFont('block'));
  assert.equal(r.W, '38.00');
  assert.equal(r.H, '25.33');
  assert.deepEqual(r.bb, [40, 50, 280, 210]);
  assert.equal(r.textPaths.length, 3);
  assert.ok(r.fit);
  assert.match(r.iconK, /^\d\.\d{4}$/);
});

test('fit is false and fs bottoms out at 6 for f10 (overflow)', async () => {
  const { tag } = fixtures.find((f) => f.id === 'f10');
  const r = SDTLayout.layout(tag, 'front', await loadFont('block'));
  assert.equal(r.fit, false);
  assert.equal(r.fs, 6);
});
