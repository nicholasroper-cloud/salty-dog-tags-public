import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SDTLayout } from '../lib/layout.mjs';
import { loadFont } from '../lib/fonts.mjs';
import { toSubpaths, fieldMatrix, iconMatrix, applyMatrix, tagGeometry, sampledBBox } from '../lib/geometry.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtures = JSON.parse(await readFile(path.join(here, 'fixtures', 'tags.json'), 'utf8'));
const near = (a, b, eps = 1e-4) => assert.ok(Math.abs(a - b) <= eps, `${a} vs ${b} (eps ${eps})`);
const ID = [1, 0, 0, 1, 0, 0];

async function layoutOf(id, side = 'front') {
  const { tag } = fixtures.find((f) => f.id === id);
  return { tag, r: SDTLayout.layout(tag, side, await loadFont(SDTLayout.fontKey(tag))) };
}

test('worked example 6.3: bone/black field matrix and key points', async () => {
  const { r } = await layoutOf('f01');
  assert.equal(SDTLayout.widthMm({ shape: 'bone', finish: 'black' }), 38);
  const M = fieldMatrix(r, [100, 100]);
  near(M[0], 0.1583333, 1e-7); near(M[3], -0.1583333, 1e-7);
  near(M[4], 74.6666667, 1e-6); near(M[5], 120.5833333, 1e-6);
  const [X, Y] = applyMatrix(M, 82, 50);
  near(X, 87.65); near(Y, 112.6667);
  // bbox left/right and top/bottom
  near(applyMatrix(M, 40, 50)[0], 81); near(applyMatrix(M, 280, 50)[0], 119);
  near(applyMatrix(M, 40, 50)[1], 112.6667); near(applyMatrix(M, 40, 210)[1], 87.3333);
  // paw icon point (12,13): worked example numbers were for the original text box; the icon placement now comes from
  // the layout strings (iconK/Tx/Ty), so check the composition M_field o M_icon against a direct two-step mapping.
  assert.match(r.iconK, /^\d\.\d{4}$/);
  const k = Number(r.iconK), tx = Number(r.iconTx), ty = Number(r.iconTy);
  const dx = k * 12 + tx, dy = k * 13 + ty;                       // design space
  const [wx, wy] = applyMatrix(M, dx, dy);                        // then field matrix
  const [ix, iy] = applyMatrix(iconMatrix(r, [100, 100]), 12, 13);
  near(ix, wx, 1e-9); near(iy, wy, 1e-9);
  near(wx, 100 + (dx - 160) * r.s, 1e-9); near(wy, 100 - (dy - 130) * r.s, 1e-9);
});

test('outline first vertex lands on the worked-example point', async () => {
  const { r } = await layoutOf('f01');
  const g = tagGeometry(r, [100, 100]);
  near(g.tool[0].verts[0].x, 87.65); near(g.tool[0].verts[0].y, 112.6667);
});

test('quadratic is degree-elevated to a cubic', () => {
  const sp = toSubpaths('M0 0 Q3 6 6 0 L0 -3 Z', ID);
  const v = sp[0].verts;
  near(v[0].c0.x, 2); near(v[0].c0.y, 4);
  near(v[1].c1.x, 4); near(v[1].c1.y, 4);
  assert.equal(sp[0].prims[0].t, 'B');
  assert.equal(sp[0].prims[1].t, 'L');
});

test('closing merge moves the dropped vertex c1 onto vertex 0 and re-points the last prim', () => {
  const sp = toSubpaths('M0 0 C0 5 5 5 5 0 C5 -5 0 -5 0 0 Z', ID);
  assert.equal(sp.length, 1);
  assert.equal(sp[0].verts.length, 2);
  assert.deepEqual(sp[0].prims, [{ t: 'B', a: 0, b: 1 }, { t: 'B', a: 1, b: 0 }]);
  assert.deepEqual(sp[0].verts[0].c1, { x: 0, y: -5 });
  assert.deepEqual(sp[0].verts[1].c0, { x: 5, y: -5 });
});

test('a path that does not return to its start gets a closing line prim', () => {
  const sp = toSubpaths('M0 0 L10 0 L10 10 Z', ID);
  assert.deepEqual(sp[0].prims.at(-1), { t: 'L', a: 2, b: 0 });
});

test('relative commands, implicit repeats, H and V all resolve (icons use them)', () => {
  const sp = toSubpaths('m1 1 h4 v4 h-4 z', ID);
  assert.equal(sp[0].verts.length, 4);
  near(sp[0].verts[1].x, 5); near(sp[0].verts[2].y, 5);
});

test('drawing after Z without M restarts at the subpath start', () => {
  const sp = toSubpaths('M0 0 L4 0 L4 4 Z L0 -4 L4 -4 Z', ID);
  assert.equal(sp.length, 2);
  near(sp[1].verts[0].x, 0); near(sp[1].verts[0].y, 0);
});

test('open subpath is emitted and reported through onWarn', () => {
  const warns = [];
  const sp = toSubpaths('M0 0 L5 0 L5 5', ID, { onWarn: (m) => warns.push(m) });
  assert.equal(sp.length, 1);
  assert.equal(sp[0].prims.length, 2);
  assert.equal(warns.length, 1);
});

test('subpaths with fewer than 2 vertices are discarded', () => {
  assert.equal(toSubpaths('M0 0 Z M5 5 L6 6 Z', ID).length, 1);
});

test('unsupported segment fails loudly', () => {
  // svgpath normalises everything we use; a hand-fed unknown command must not be silently skipped
  assert.throws(() => toSubpaths('M0 0 X1 1', ID));
});

test('round outline (arc) closes into one subpath of beziers', async () => {
  const { r } = await layoutOf('f04');
  const { tool } = tagGeometry(r, [100, 100]);
  assert.equal(tool.length, 1);
  const sp = tool[0];
  assert.equal(sp.prims.at(-1).b, 0);
  assert.ok(sp.prims.filter((p) => p.t === 'B').length >= 4);
});

test('paw outline yields 5 subpaths', async () => {
  const { r } = await layoutOf('f09');
  assert.equal(tagGeometry(r, [100, 100]).tool.length, 5);
});

test('icons: every icon converts, all subpaths closed with prims in range', async () => {
  for (const name of Object.keys(SDTLayout.ICONS)) {
    const sp = toSubpaths(SDTLayout.ICONS[name], ID);
    assert.ok(sp.length >= 1, name);
    for (const s of sp) {
      for (const p of s.prims) { assert.ok(p.a < s.verts.length && p.b < s.verts.length, name); }
      assert.equal(s.prims.at(-1).b, 0, `${name} closes`);
    }
  }
});

for (const { id, tag } of fixtures) {
  test(`Tool-layer bbox equals centred W x H for ${id} (${tag.shape}/${tag.finish})`, async () => {
    const side = (tag.front || []).some(Boolean) || (tag.icon && tag.icon !== 'none') ? 'front' : 'back';
    const { r } = await layoutOf(id, side);
    const P = [100, 100];
    const { tool } = tagGeometry(r, P);
    const [x0, y0, x1, y1] = sampledBBox(tool);
    const W = Number(r.W), H = Number(r.H);
    near(x0, P[0] - W / 2, 0.05); near(x1, P[0] + W / 2, 0.05);
    near(y0, P[1] - H / 2, 0.05); near(y1, P[1] + H / 2, 0.05);
  });
}

test('fieldCenter shifts the geometry', async () => {
  const { r } = await layoutOf('f01');
  const a = sampledBBox(tagGeometry(r, [100, 100]).tool);
  const b = sampledBBox(tagGeometry(r, [60, 140]).tool);
  near(b[0] - a[0], -40, 1e-6); near(b[1] - a[1], 40, 1e-6);
});

test('text geometry lies inside the tag outline bbox for a fitting tag', async () => {
  const { r } = await layoutOf('f01');
  const g = tagGeometry(r, [100, 100]);
  const t = sampledBBox(g.tool), s = sampledBBox([...g.icon, ...g.text]);
  assert.ok(s[0] >= t[0] && s[2] <= t[2] && s[1] >= t[1] && s[3] <= t[3]);
});
