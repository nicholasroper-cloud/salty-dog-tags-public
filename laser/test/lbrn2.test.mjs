import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SDTLayout } from '../lib/layout.mjs';
import { loadFont } from '../lib/fonts.mjs';
import { tagGeometry } from '../lib/geometry.mjs';
import { buildLbrn2, escapeAttr, fmt, vertList, primList } from '../lib/lbrn2.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtures = JSON.parse(await readFile(path.join(here, 'fixtures', 'tags.json'), 'utf8'));
const CUT = { maxPower: 70, maxPower2: 20, speed: 800, frequency: 50000, QPulseWidth: 250, interval: 0.02 };

async function fileFor(id, side = 'front', over = {}) {
  const { tag } = fixtures.find((f) => f.id === id);
  const r = SDTLayout.layout(tag, side, await loadFont(SDTLayout.fontKey(tag)));
  const g = tagGeometry(r, [100, 100]);
  return buildLbrn2({ deviceName: 'JCZFiber (USB-Lite)', layerName: 'SDT anodized (UNTESTED)', cutSetting: CUT,
    tool: g.tool, scan: [...g.icon, ...g.text], notes: 'SDT-TEST  tag 1 of 1  FRONT\nQty: 1', ...over });
}

const VERT_RE = /^(V-?[\d.]+ -?[\d.]+(c0x1|c0x-?[\d.]+c0y-?[\d.]+)(c1x1|c1x-?[\d.]+c1y-?[\d.]+))+$/;
const PRIM_RE = /^([LB]\d+ \d+)+$/;

test('fmt: 0.1 micron precision, no -0, no exponent', () => {
  assert.equal(fmt(87.65004), '87.65');
  assert.equal(fmt(-0.00001), '0');
  assert.equal(fmt(112.66666667), '112.6667');
  assert.equal(fmt(100), '100');
});

test('vertList / primList match the documented encoding', () => {
  assert.equal(vertList([{ x: 87.65, y: 112.6667, c0: { x: 88.1201, y: 114.5503 } }]), 'V87.65 112.6667c0x88.1201c0y114.5503c1x1');
  assert.equal(vertList([{ x: 1, y: 2, c1: { x: 3, y: 4 } }]), 'V1 2c0x1c1x3c1y4');
  assert.equal(primList([{ t: 'B', a: 0, b: 1 }, { t: 'L', a: 1, b: 2 }]), 'B0 1L1 2');
});

test('generated file is well-formed XML (xmllint)', async (t) => {
  if (!existsSync('/usr/bin/xmllint')) return t.skip('xmllint not installed');
  const dir = await mkdtemp(path.join(os.tmpdir(), 'sdt-xml-'));
  for (const id of ['f01', 'f03', 'f05', 'f09', 'f12']) {
    const f = path.join(dir, `${id}.lbrn2`);
    await writeFile(f, await fileFor(id, id === 'f05' ? 'back' : 'front'));
    execFileSync('/usr/bin/xmllint', ['--noout', f]);
  }
});

for (const { id, tag } of fixtures) {
  test(`structure: ${id} has one Scan(0) and one Tool(30), valid lists, no scanOpt`, async () => {
    const side = (tag.front || []).some(Boolean) || (tag.icon && tag.icon !== 'none') ? 'front' : 'back';
    const xml = await fileFor(id, side);
    assert.equal((xml.match(/<CutSetting type="Scan">/g) || []).length, 1);
    assert.equal((xml.match(/<CutSetting type="Tool">/g) || []).length, 1);
    assert.match(xml, /<CutSetting type="Scan">\s*<index Value="0"\/>/);
    assert.match(xml, /<CutSetting type="Tool">\s*<index Value="30"\/>/);
    assert.ok(!/scanOpt/.test(xml));
    assert.match(xml, /<Notes ShowOnLoad="0" /);
    assert.match(xml, /AppVersion="2.1.03"/);
    const shapes = [...xml.matchAll(/<Shape Type="Path" CutIndex="(\d+)">\s*<XForm>1 0 0 1 0 0<\/XForm>\s*<VertList>([^<]*)<\/VertList>\s*<PrimList>([^<]*)<\/PrimList>/g)];
    assert.equal(shapes.length, (xml.match(/<Shape /g) || []).length);
    assert.ok(shapes.length > 1);
    for (const [, ci, verts, prims] of shapes) {
      assert.ok(ci === '0' || ci === '30', `CutIndex ${ci}`);
      assert.match(verts, VERT_RE);
      assert.match(prims, PRIM_RE);
      const nVerts = (verts.match(/V-?[\d.]+ /g) || []).length;
      for (const m of prims.matchAll(/[LB](\d+) (\d+)/g)) {
        assert.ok(+m[1] < nVerts && +m[2] < nVerts, 'prim index in range');
      }
    }
    assert.ok(shapes.some((s) => s[1] === '30'));
    assert.ok(shapes.some((s) => s[1] === '0'));
  });
}

test('Tool shapes come first and use CutIndex 30; scan shapes use 0', async () => {
  const xml = await fileFor('f01');
  const idx = [...xml.matchAll(/CutIndex="(\d+)"/g)].map((m) => m[1]);
  const firstScan = idx.indexOf('0');
  assert.ok(idx.slice(0, firstScan).every((v) => v === '30'));
  assert.ok(idx.slice(firstScan).every((v) => v === '0'));
});

test('cutSetting fields are written in file order between name and priority', async () => {
  const xml = await fileFor('f01');
  const block = xml.match(/<CutSetting type="Scan">([\s\S]*?)<\/CutSetting>/)[1];
  const keys = [...block.matchAll(/<(\w+) Value=/g)].map((m) => m[1]);
  assert.deepEqual(keys, ['index', 'name', 'maxPower', 'maxPower2', 'speed', 'frequency', 'QPulseWidth', 'interval', 'priority']);
});

test('XML escaping of & < > " \' in Notes and the layer name, newlines as &#10;', async () => {
  const nasty = `A&B <x> "q" 'z'\nline2`;
  const xml = await fileFor('f01', 'front', { notes: nasty, layerName: nasty });
  assert.ok(xml.includes('Notes="A&amp;B &lt;x&gt; &quot;q&quot; &apos;z&apos;&#10;line2"'));
  assert.ok(xml.includes('<name Value="A&amp;B &lt;x&gt; &quot;q&quot; &apos;z&apos;&#10;line2"/>'));
  assert.equal(escapeAttr('a\u0000b\u0007c'), 'abc');
});

test('bad preset keys are rejected at write time', async () => {
  await assert.rejects(fileFor('f01', 'front', { cutSetting: { 'bad key': 1 } }));
  await assert.rejects(fileFor('f01', 'front', { cutSetting: { scanOpt: 'individual' } }));
});
