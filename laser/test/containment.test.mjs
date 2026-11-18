// Proves engraved text and icons stay inside the blank with >= 1.5 mm clearance (and off the hanging hole).
// The layout box fractions in site/tag-layout.js OUT[shape].box are what this protects: if you enlarge one, this fails
// before a glyph ever reaches a real blank.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SDTLayout } from '../lib/layout.mjs';
import { loadFont } from '../lib/fonts.mjs';
import { checkContained, outlineDesign, flatten, clearanceFor, HOLE_CLEAR_MM } from './containment.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtures = JSON.parse(await readFile(path.join(here, 'fixtures', 'tags.json'), 'utf8'));
const FONTS = ['block', 'bungee', 'script', 'slab', 'marker'];
// One finish per distinct blank width: the same box fractions give different mm margins on each.
const VARIANTS = { bone: ['black', 'polished'], heart: ['red'], round: ['sky', 'black', 'brass'], military: ['black', 'stainless'], paw: ['pink'] };
const W24 = 'MAXIMUM WIGGLES AND WAGS';   // 24 characters, mixed wide and narrow
const SHORT = 'BO';

// A case that does not fit at size 6 is an overflow: the service flags it (warning `overflow`) and the text may spill,
// so containment is only asserted for cases that fit. fits() cases below guard against a box that is simply too small.
function assertCase(shape, tag, side, r, label, overflows) {
  if (!r.fit) { assert.equal(r.fs, 6, `${label}: not fitting but fs is ${r.fs}`); overflows.push(label); return; }
  const res = checkContained(shape, r);
  assert.ok(res.ok, explain(shape, label, res));
}

const fontCache = {};
const fontFor = async (k) => (fontCache[k] ||= await loadFont(k));
const mk = (over) => ({ shape: 'bone', size: 'medium', finish: 'black', font: 'block', icon: 'none', color: 'none', photo: false, front: [], back: [], qty: 1, ...over });

function explain(shape, label, res) {
  return `${shape} ${label}: ${res.outside} points outside, ${res.tooClose} too close to the edge (min ${res.minClearance.toFixed(2)} mm), ${res.nearHole} within the hole keep-out (min ${res.minHoleDist.toFixed(2)} mm from centre)`;
}

test('every shape has hole data inside its bbox, and a text anchor', () => {
  for (const [shape, o] of Object.entries(SDTLayout.OUT)) {
    assert.ok(o.hole.x > o.bb[0] && o.hole.x < o.bb[2] && o.hole.y > o.bb[1] && o.hole.y < o.bb[3], `${shape} hole inside bbox`);
    assert.ok(o.hole.r > 5 && o.hole.r < 25, `${shape} hole radius ${o.hole.r}`);
    assert.ok(o.tx.cx > o.bb[0] && o.tx.cx < o.bb[2] && o.tx.nudge >= 0, `${shape} text anchor`);
  }
});

test('military outline is the true rounded rectangle: its drawn extent equals its stated bbox', () => {
  const sp = outlineDesign('military');
  const xs = flatten(sp).flat().map((p) => p[0]), ys = flatten(sp).flat().map((p) => p[1]);
  const [bx0, by0, bx1, by1] = SDTLayout.OUT.military.bb;
  assert.ok(Math.abs(Math.min(...xs) - bx0) < 0.5 && Math.abs(Math.max(...xs) - bx1) < 0.5);
  assert.ok(Math.abs(Math.min(...ys) - by0) < 0.5 && Math.abs(Math.max(...ys) - by1) < 0.5);
});

for (const { id, tag } of fixtures) {
  for (const side of ['front', 'back']) {
    const hasText = (tag[side] || []).some(Boolean);
    const hasIcon = side === 'front' && tag.icon && tag.icon !== 'none';
    if (!hasText && !hasIcon) continue;
    test(`containment: fixture ${id} ${side} (${tag.shape}/${tag.finish}/${tag.font})`, async (t) => {
      const r = SDTLayout.layout(tag, side, await fontFor(SDTLayout.fontKey(tag)));
      if (!r.fit) {
        // Text that cannot fit even at size 6 is allowed to overflow, but the service must have said so.
        assert.equal(r.fs, 6);
        return t.diagnostic(`${id}: overflow case, flagged by the 'overflow' warning; containment not asserted`);
      }
      const res = checkContained(tag.shape, r);
      assert.ok(res.ok, explain(tag.shape, `${id} ${side}`, res));
    });
  }
}

// Worst cases: 4 lines of 24 characters in each font, with and without an icon, on every blank width.
for (const [shape, finishes] of Object.entries(VARIANTS)) {
  for (const finish of finishes) {
    test(`containment: worst case 4 x 24 chars, ${shape}/${finish}, all fonts, with and without icon`, async (t) => {
      const overflows = [];
      for (const font of FONTS) for (const icon of ['none', 'paw', 'skull', 'crown']) {
        const tag = mk({ shape, finish, font, icon, front: [W24, W24, W24, W24] });
        const r = SDTLayout.layout(tag, 'front', await fontFor(font));
        assertCase(shape, tag, 'front', r, `${finish}/${font}/${icon}`, overflows);
      }
      if (overflows.length) t.diagnostic(`${shape}/${finish}: ${overflows.length} of 20 worst cases overflow at size 6 (flagged by the overflow warning): ${overflows.join(', ')}`);
    });

    test(`fits: 4 lines of 12 characters always fit and stay contained, ${shape}/${finish}`, async () => {
      for (const font of FONTS) for (const icon of ['none', 'paw']) {
        const tag = mk({ shape, finish, font, icon, front: ['HOW MUCH FUN', 'HOW MUCH FUN', 'HOW MUCH FUN', 'HOW MUCH FUN'] });
        const r = SDTLayout.layout(tag, 'front', await fontFor(font));
        assert.ok(r.fit, `${shape}/${finish}/${font}/${icon}: 4 x 12 chars does not fit (box too small)`);
        assert.ok(checkContained(shape, r).ok, explain(shape, `${finish}/${font}/${icon} 4x12`, checkContained(shape, r)));
      }
    });

    test(`containment: one long line in every position, ${shape}/${finish}`, async (t) => {
      // A wide line at the top or bottom of the box is where corners get hit; cover each position for 1 to 4 lines.
      const overflows = [];
      for (const font of ['block', 'script']) for (const icon of ['none', 'paw']) {
        for (let n = 1; n <= 4; n++) for (let pos = 0; pos < n; pos++) {
          const front = Array.from({ length: n }, (_, i) => (i === pos ? W24 : SHORT));
          const tag = mk({ shape, finish, font, icon, front });
          const r = SDTLayout.layout(tag, 'front', await fontFor(font));
          assertCase(shape, tag, 'front', r, `${finish}/${font}/${icon} n=${n} pos=${pos}`, overflows);
        }
      }
      if (overflows.length) t.diagnostic(`${shape}/${finish}: ${overflows.length} overflow at size 6 (flagged): ${overflows.slice(0, 4).join(', ')}...`);
    });
  }
}

test('back side (3 lines of 24 characters, never an icon) is contained on every shape and finish', async (t) => {
  const overflows = [];
  for (const [shape, finishes] of Object.entries(VARIANTS)) for (const finish of finishes) for (const font of FONTS) {
    const tag = mk({ shape, finish, font, icon: 'paw', back: [W24, W24, W24] });
    const r = SDTLayout.layout(tag, 'back', await fontFor(font));
    assert.equal(r.iconD, null, 'the icon is never placed on the back');
    assertCase(shape, tag, 'back', r, `${shape}/${finish}/${font} back`, overflows);
  }
  if (overflows.length) t.diagnostic(`${overflows.length} back-side worst cases overflow at size 6 (flagged): ${overflows.join(', ')}`);
});

test('the checker itself catches a glyph that crosses the outline (negative control)', async () => {
  // bone text judged against the paw pad must fail: it is wider than the pad
  const tag = mk({ shape: 'bone', front: [W24, W24, W24] });
  const r = SDTLayout.layout(tag, 'front', await fontFor('block'));
  assert.equal(checkContained('bone', r).ok, true);
  assert.equal(checkContained('paw', r).ok, false);
  assert.equal(checkContained('round', r).ok, false);
});

test('script gets 2.0 mm of edge clearance, the other fonts 1.5 mm', async () => {
  assert.equal(clearanceFor({ fk: 'script' }), 2.0);
  assert.equal(clearanceFor({ fk: 'block' }), 1.5);
  const tag = mk({ shape: 'round', finish: 'black', font: 'script', front: ['Lulu', 'Princess of naps'] });
  const r = SDTLayout.layout(tag, 'front', await fontFor('script'));
  assert.ok(checkContained('round', r).minClearance >= 2.0);
  assert.ok(HOLE_CLEAR_MM === 1.0);
});

// Size report: what letter size the fit lands on for typical content. Printed for review; floors protect against regressions.
test('size report: resulting letter sizes for typical tags', async (t) => {
  const font = await fontFor('block');
  const capH = (r) => { const b = font.charToGlyph('H').getBoundingBox(); return ((b.y2 - b.y1) / font.unitsPerEm) * r.fs * r.s; };
  const cases = [
    ['bone, icon + 3 lines (SDT-DEMO)', mk({ shape: 'bone', icon: 'paw', front: ['REX', 'CALL MY HUMAN', '555-0142'] }), 2.5],
    ['bone, 3 lines no icon', mk({ shape: 'bone', front: ['REX', 'CALL MY HUMAN', '555-0142'] }), 2.9],
    ['bone, 4 lines no icon', mk({ shape: 'bone', front: ['REX', '12 MAIN ST', 'LEHI UT', '555-0142'] }), 2.5],
    ['military, 3 lines', mk({ shape: 'military', finish: 'stainless', front: ['BRUNO', '12 MAIN ST', '555-0123'] }), 3.0],
    ['round, 2 lines', mk({ shape: 'round', finish: 'black', front: ['MAX', '555-0199'] }), 3.0],
    ['heart, 3 lines', mk({ shape: 'heart', finish: 'red', front: ['LULU', 'PRINCESS', '555-0100'] }), 3.0],
    ['paw, 2 lines', mk({ shape: 'paw', finish: 'pink', front: ['QUEEN', '555-0100'] }), 3.0]
  ];
  const rows = [];
  for (const [name, tag, floorMm] of cases) {
    const r = SDTLayout.layout(tag, 'front', font);
    const em = r.fs * r.s;
    rows.push(`${name.padEnd(34)} em ${em.toFixed(2)} mm  cap ${capH(r).toFixed(2)} mm  (size ${r.fs}${r.iconD ? `, icon ${r.iconH.toFixed(1)} units` : ''})`);
    assert.ok(r.fit, `${name} should fit`);
    assert.ok(em >= floorMm, `${name}: letters ${em.toFixed(2)} mm, expected >= ${floorMm} mm`);
    assert.ok(checkContained(tag.shape, r).ok, explain(tag.shape, name, checkContained(tag.shape, r)));
  }
  t.diagnostic('\n' + rows.join('\n'));
  console.log('SIZE REPORT (em = font size in mm; cap = capital letter height)\n' + rows.join('\n'));
});
