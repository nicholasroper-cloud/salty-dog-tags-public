// Smart QR tag: lbrn2 QR layer, qr-* presets, the manual gate, the test matrix, and the smart goldens.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, mkdtemp, mkdir, writeFile, copyFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import jsQR from 'jsqr';
import { generateOrder } from '../lib/generate.mjs';
import { SDTQR } from '../lib/qr.mjs';
import { writeMatrix, matrixCodes, matrixFinishes } from '../lib/qrmatrix.mjs';
import { loadPreset, PRESETS_DIR } from '../lib/presets.mjs';
import { smartGoldenSvgs, smartFixtures, SMART_ID } from './smart-golden-lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(await readFile(path.join(here, '..', 'config.json'), 'utf8'));
const ID = SMART_ID;

// A presets dir with the real files, but the QR presets marked tuned (what Nick's import would do).
async function tunedPresets(tune = ['qr-stainless', 'qr-anodized', 'qr-polished', 'qr-brass']) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'sdt-pre-'));
  for (const f of await readdir(PRESETS_DIR)) {
    if (!f.endsWith('.json')) continue;
    const j = JSON.parse(await readFile(path.join(PRESETS_DIR, f), 'utf8'));
    if (tune.includes(j.name)) j.status = 'tuned';
    await writeFile(path.join(dir, f), JSON.stringify(j));
  }
  return dir;
}
const smartTag = (shape, finish, over = {}) => {
  const t = { shape, size: 'large', finish, font: 'block', icon: 'none', color: 'none', photo: false, front: ['BRUNO'], back: ['BRUNO', '801-336-2244'], qty: 1, ...over };
  const ck = SDTQR.checkTag(t, { id: ID, ignoreGate: true });
  assert.ok(ck.ok, JSON.stringify(ck));
  return { ...t, smart: { id: ID, url: 'HTTPS://SALTYDOGTAGS.COM/T/' + ID, ...ck.smart } };
};
const order = (tags) => ({ id: 'SDT-7KQ2', at: 1760638800000, status: 'paid', customer: { name: 'Dana', delivery: 'ship' }, tags, prints: [] });
async function gen(tags, over = {}) {
  const queueDir = await mkdtemp(path.join(os.tmpdir(), 'sdt-gen-'));
  const res = await generateOrder(order(tags), { config, queueDir, presetsDir: await tunedPresets(), qrFlags: { stainless: 'on', black: 'on', royal: 'on', red: 'on', green: 'on', polished: 'on' }, ...over });
  return { ...res, files: (await readdir(res.dir)).sort() };
}

// Parses the QR layer's Path shapes (CutIndex 2) back into field-mm rectangles.
function qrRects(xml) {
  const out = [];
  for (const m of xml.matchAll(/<Shape Type="Path" CutIndex="2">[\s\S]*?<VertList>([^<]*)<\/VertList>/g)) {
    const pts = m[1].split('V').filter(Boolean).map((v) => v.match(/^(-?[\d.]+) (-?[\d.]+)/).slice(1).map(Number));
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    out.push({ x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys), n: pts.length });
  }
  return out;
}
function decodeFromLbrn2(xml, inverse, ppm = 40) {
  const rs = qrRects(xml); assert.ok(rs.length > 10);
  const box = inverse ? rs[0] : { x0: Math.min(...rs.map((r) => r.x0)), x1: Math.max(...rs.map((r) => r.x1)), y0: Math.min(...rs.map((r) => r.y0)), y1: Math.max(...rs.map((r) => r.y1)) };
  const pad = 1.5, W = Math.ceil((box.x1 - box.x0 + 2 * pad) * ppm), H = Math.ceil((box.y1 - box.y0 + 2 * pad) * ppm);
  const px = new Uint8ClampedArray(W * H * 4);
  const surface = inverse ? 40 : 205, mark = inverse ? 215 : 30;
  for (let i = 0; i < W * H; i++) { px[i * 4] = px[i * 4 + 1] = px[i * 4 + 2] = surface; px[i * 4 + 3] = 255; }
  const fill = (r, v) => { for (let y = Math.round((box.y1 + pad - r.y1) * ppm); y < Math.round((box.y1 + pad - r.y0) * ppm); y++) for (let x = Math.round((r.x0 - box.x0 + pad) * ppm); x < Math.round((r.x1 - box.x0 + pad) * ppm); x++) { const o = (y * W + x) * 4; px[o] = px[o + 1] = px[o + 2] = v; } };
  if (inverse) { fill(rs[0], mark); for (const r of rs.slice(1)) fill(r, surface); } else for (const r of rs) fill(r, mark);
  const d = jsQR(px, W, H, { inversionAttempts: 'attemptBoth' });
  return d && d.data;
}

test('goldens: smart back sides (military, round 38, polished bone, bone 38 two-line, heart 38) match byte for byte', async () => {
  for (const [id, svg] of await smartGoldenSvgs()) assert.equal(svg, await readFile(path.join(here, 'golden-smart', `${id}-back.svg`), 'utf8'), id);
  assert.deepEqual((await smartFixtures()).map((f) => f.id), ['s01', 's02', 's03', 's04', 's05']);
});

test('lbrn2: the QR is its own Scan layer (index 2), crosshatch from the qr preset, shapes on CutIndex 2; text stays on layer 0', async () => {
  const { job, files, dir } = await gen([smartTag('military', 'stainless')]);
  assert.equal(job.tags[0].mode, 'auto'); assert.equal(job.mode, 'queued');
  const xml = await readFile(path.join(dir, 'SDT-7KQ2-tag1-back.lbrn2'), 'utf8');
  assert.match(xml, /<CutSetting type="Scan">\s*<index Value="2"\/>\s*<name Value="SDT qr-stainless QR"\/>[\s\S]*?<crossHatch Value="1"\/>[\s\S]*?<priority Value="3"\/>/);
  assert.ok((xml.match(/CutIndex="2"/g) || []).length > 20);
  assert.ok(/CutIndex="0"/.test(xml), 'the text is still on layer 0');
  assert.match(xml, /QR ABCDEFGHJK: v3-Q, 0\.6 mm modules, dark polarity, preset qr-stainless/);
  // the front file has no QR layer
  assert.ok(!/CutIndex="2"/.test(await readFile(path.join(dir, 'SDT-7KQ2-tag1-front.lbrn2'), 'utf8')));
  assert.ok(files.includes('SDT-7KQ2-tag1-back.svg'));
  assert.match(await readFile(path.join(dir, 'SDT-7KQ2-tag1-back.svg'), 'utf8'), /<g id="qr" data-polarity="dark"/);
});

for (const [shape, finish, inv] of [['military', 'stainless', false], ['bone', 'black', true], ['bone', 'polished', false], ['heart', 'stainless', false], ['military', 'red', true]]) {
  test(`lbrn2: ${shape} ${finish} QR layer decodes with jsQR to the tag payload (${inv ? 'inverse' : 'dark'} polarity)`, async () => {
    const { job, dir } = await gen([smartTag(shape, finish)]);
    assert.equal(job.tags[0].mode, 'auto', job.tags[0].manualReason);
    const xml = await readFile(path.join(dir, 'SDT-7KQ2-tag1-back.lbrn2'), 'utf8');
    assert.equal(decodeFromLbrn2(xml, inv), 'HTTPS://SALTYDOGTAGS.COM/T/' + ID);
  });
}

test('lbrn2: QR geometry is placed in exact mm relative to the outline (inside the blank at the stored position)', async () => {
  const t = smartTag('military', 'stainless');
  const { dir } = await gen([t]);
  const xml = await readFile(path.join(dir, 'SDT-7KQ2-tag1-back.lbrn2'), 'utf8');
  const rs = qrRects(xml), W = 50 + 1, H = 25.5;     // military stainless is 51 mm
  const minX = Math.min(...rs.map((r) => r.x0)), maxX = Math.max(...rs.map((r) => r.x1)), maxY = Math.max(...rs.map((r) => r.y1));
  const [Px, Py] = config.fieldCenter;
  const left = Px - 51 / 2, top = Py + 25.5 / 2;
  assert.ok(Math.abs((minX - left) - (t.smart.x + t.smart.q * t.smart.mm + 0.02)) < 0.05, `left edge ${minX - left}`);
  assert.ok(Math.abs((top - maxY) - (t.smart.y + t.smart.q * t.smart.mm + 0.02)) < 0.05, `top edge ${top - maxY}`);
  assert.ok(maxX < Px + W / 2 && minX > left);
});

test('manual gate: no id yet, test-gated finish, untested qr preset, tampered placement, id/payload mismatch all go to manual with a reason', async () => {
  const noId = smartTag('military', 'stainless'); noId.smart = { ...noId.smart, id: null, url: null };
  let r = await gen([noId]); assert.equal(r.job.tags[0].mode, 'manual'); assert.match(r.job.tags[0].manualReason, /Mint QR id/); assert.deepEqual(r.files, ['job.json']);

  r = await gen([smartTag('military', 'stainless')], { qrFlags: { stainless: 'test' } });
  assert.match(r.job.tags[0].manualReason, /test-gated/);
  r = await gen([smartTag('bone', 'silver')], { qrFlags: { silver: 'on' } });
  assert.equal(r.job.tags[0].mode, 'auto', 'flipping the flag file is all it takes (the preset is tuned here)');
  r = await gen([smartTag('bone', 'silver')]);
  assert.match(r.job.tags[0].manualReason, /test-gated/, 'silver is gated by default');

  r = await gen([smartTag('military', 'stainless')], { presetsDir: await tunedPresets([]) });
  assert.match(r.job.tags[0].manualReason, /qr-stainless is untested/);

  const moved = smartTag('military', 'stainless'); moved.smart.x = 40; moved.smart.y = 20;
  r = await gen([moved]); assert.equal(r.job.tags[0].mode, 'manual');
  const mism = smartTag('military', 'stainless'); mism.smart.url = 'HTTPS://SALTYDOGTAGS.COM/T/ZZZZZZZZZZ';
  r = await gen([mism]); assert.equal(r.job.tags[0].mode, 'manual'); assert.match(r.job.tags[0].manualReason, /payload/);
  const bad = smartTag('military', 'stainless'); bad.smart.id = 'not-an-id';
  r = await gen([bad]); assert.equal(r.job.tags[0].mode, 'manual');
});

test('manual gate: a non-smart tag in the same order is unaffected (byte-identical lbrn2 without a QR layer)', async () => {
  const plain = { shape: 'bone', size: 'medium', finish: 'black', font: 'block', icon: 'none', color: 'none', photo: false, front: ['REX'], back: ['REX', '555-0142'], qty: 1 };
  const { dir, job } = await gen([plain, smartTag('military', 'stainless')]);
  assert.equal(job.tags[0].mode, 'auto'); assert.equal(job.tags[1].mode, 'auto');
  const xml = await readFile(path.join(dir, 'SDT-7KQ2-tag1-back.lbrn2'), 'utf8');
  assert.ok(!xml.includes('CutIndex="2"') && !xml.includes('QR'));
});

test('presets: the four qr-* presets exist, are untested seeds with crosshatch on, and load', async () => {
  for (const n of ['qr-stainless', 'qr-anodized', 'qr-polished', 'qr-brass']) {
    const p = await loadPreset(n);
    assert.equal(p.status, 'untested'); assert.equal(p.cutSetting.crossHatch, 1);
  }
});

test('qr-matrix: one file per QR finish and polarity, 10 codes each (5 module sizes x M and Q), codes decode', async () => {
  const outDir = await mkdtemp(path.join(os.tmpdir(), 'sdt-mx-'));
  const files = await writeMatrix({ outDir, config });
  assert.equal(files.length, matrixFinishes().length * 2); assert.equal(files.length, 32);
  assert.ok(!files.some((f) => /rainbow|fullcolor/.test(f)));
  assert.deepEqual(matrixCodes('dark').map((c) => `${c.ecl}${c.mm}`), ['M0.35', 'M0.4', 'M0.45', 'M0.5', 'M0.6', 'Q0.35', 'Q0.4', 'Q0.45', 'Q0.5', 'Q0.6']);
  const xml = await readFile(path.join(outDir, 'qrtest-stainless-dark.lbrn2'), 'utf8');
  assert.match(xml, /Layer 2 is the QR layer/); assert.match(xml, /#10 \(row 3, col 2\): Q 0\.6 mm/);
  const inv = await readFile(path.join(outDir, 'qrtest-black-inverse.lbrn2'), 'utf8');
  assert.match(inv, /INVERSE: the light modules and the quiet zone are engraved/);
  assert.ok((await readFile(path.join(outDir, 'INDEX.csv'), 'utf8')).split('\n').length > 32);
  // every code in a file fits the 110 mm field around the centre
  const rs = qrRects(xml);
  assert.ok(Math.max(...rs.map((r) => r.x1)) - Math.min(...rs.map((r) => r.x0)) < 100);
});

// Browser parity: run orders.html's real export block and the real orders-smart.js in a vm (the browser's view) and compare with the Node goldens.
test('orders.html export: smart tags get the QR group and re-fitted back text, byte for byte equal to the Node side and the goldens', async () => {
  const { createRequire } = await import('node:module');
  const vm = (await import('node:vm')).default;
  const require = createRequire(import.meta.url);
  const { SDTLayout } = await import('../lib/layout.mjs');
  const { ensureFontFile, toArrayBuffer, fontUrl, loadFont } = await import('../lib/fonts.mjs');
  const html = await readFile(path.join(here, '..', '..', 'site', 'orders.html'), 'utf8');
  const smartJs = await readFile(path.join(here, '..', '..', 'site', 'orders-smart.js'), 'utf8');
  const block = html.slice(html.indexOf('const fontCache={};'), html.indexOf('function download('));
  const served = new Map();
  for (const k of Object.keys(SDTLayout.FONT_TTF)) served.set(fontUrl(k), (await ensureFontFile(k, fontUrl(k))).buf);
  const fakeFetch = (url) => served.has(url) ? Promise.resolve({ arrayBuffer: () => Promise.resolve(toArrayBuffer(served.get(url))) }) : Promise.reject(new Error('unexpected fetch ' + url));
  const ctx = vm.createContext({ opentype: require('opentype.js'), fetch: fakeFetch, SDTLayout, SDTQR, document: {}, location: { origin: 'https://x.test' } });
  ctx.window = ctx;
  vm.runInContext(smartJs, ctx);
  vm.runInContext(block + ';globalThis.__svg = lightburnSVG;', ctx);
  ctx.SDTSmart.init({ key: () => 'k', orders: () => [], toast() {}, esc: String, rerender() {} });
  for (const { id, tag } of await smartFixtures()) {
    const ck = SDTQR.checkTag(tag, { id: ID, ignoreGate: true });
    const t = { ...tag, smart: { id: ID, url: 'HTTPS://SALTYDOGTAGS.COM/T/' + ID, ...ck.smart } };
    assert.equal(await ctx.__svg(t, 'back'), await readFile(path.join(here, 'golden-smart', `${id}-back.svg`), 'utf8'), id);
    assert.ok(!(await ctx.__svg(t, 'front')).includes('id="qr"'));
  }
  const noId = { ...(await smartFixtures())[0].tag, smart: { id: null } };
  await assert.rejects(() => ctx.__svg(noId, 'back'), /no QR id yet/);
});

test('orders-smart.js: the scan check compares the decoded text to the payload exactly; the slip carries the code, the claim QR and the 3 steps', async () => {
  const vm = (await import('node:vm')).default;
  const smartJs = await readFile(path.join(here, '..', '..', 'site', 'orders-smart.js'), 'utf8');
  const ctx = vm.createContext({ SDTQR, document: {}, location: { origin: 'https://x.test' } }); ctx.window = ctx;
  vm.runInContext(smartJs, ctx);
  const S = ctx.SDTSmart, P = 'HTTPS://SALTYDOGTAGS.COM/T/' + ID;
  assert.equal(S.matches(P, P), true);
  for (const bad of [P + ' ', P.toLowerCase(), P + '?x=1', 'HTTPS://SALTYDOGTAGS.COM/T/ABCDEFGHJM', '', null, undefined]) assert.equal(S.matches(bad, P), false, String(bad));
  const html = S.slipHtml({ orderId: 'SDT-7KQ2', slips: [{ dog: 'Whisky <b>', qty: 2, code: 'ABCD-EFGH-JKMN', url: 'saltydogtags.com/t/abcdefghjk', claimUrl: 'https://saltydogtags.com/claim?t=ABCDEFGHJK&c=ABCDEFGHJKMN' }] });
  assert.match(html, /ABCD-EFGH-JKMN/); assert.match(html, /saltydogtags\.com\/t\/abcdefghjk/); assert.match(html, /<svg[^>]+viewBox="0 0 \d+ \d+"/);
  assert.match(html, /slip\.css/); assert.equal((html.match(/<li>/g) || []).length, 3);
  assert.ok(!html.includes('Whisky <b>'), 'dog name is escaped');
  // the claim QR decodes to the claim URL
  const svg = S.qrSvg('https://saltydogtags.com/claim?t=ABCDEFGHJK&c=ABCDEFGHJKMN');
  const e = SDTQR.encode('https://saltydogtags.com/claim?t=ABCDEFGHJK&c=ABCDEFGHJKMN', 'M');
  assert.ok(svg.includes('viewBox="0 0 ' + (e.size + 8) + ' ' + (e.size + 8) + '"'));
});
