// Smart QR tag, task 3: encoder, eligibility fixture, vector geometry, polarity, containment. Decodes the engraved geometry with jsQR.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import jsQR from 'jsqr';
import { SDTLayout } from '../lib/layout.mjs';
import { SDTQR } from '../lib/qr.mjs';
import { loadFont } from '../lib/fonts.mjs';
import { toSubpaths, sampledBBox } from '../lib/geometry.mjs';

const ID = 'ABCDEFGHJK';
const PAYLOAD = 'HTTPS://SALTYDOGTAGS.COM/T/' + ID;
const fontCache = {};
const fontFor = async (k) => (fontCache[k] ||= await loadFont(k));
const tagOf = (shape, finish, over = {}) => ({ shape, finish, font: 'block', size: 'medium', icon: 'none', front: [], back: ['WHISKY', '435-555-0123'], qty: 1, ...over });

// Renders marked geometry like the metal looks: dark polarity = dark marks on a light surface; inverse = light marks on a dark surface.
function raster(g, plan, { ppm = 40, spread = 0 } = {}) {
  const pad = 1.0, x0 = plan.x - pad, y0 = plan.y - pad, W = Math.ceil((plan.boxMm + 2 * pad) * ppm), H = W;
  const surface = g.polarity === 'inverse' ? 40 : 205, mark = g.polarity === 'inverse' ? 215 : 30;
  const px = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) { px[i * 4] = px[i * 4 + 1] = px[i * 4 + 2] = surface; px[i * 4 + 3] = 255; }
  const fill = (r, v, grow) => {
    const a = Math.max(0, Math.round((r.x - x0 - grow) * ppm)), b = Math.min(W, Math.round((r.x + r.w - x0 + grow) * ppm));
    const c = Math.max(0, Math.round((r.y - y0 - grow) * ppm)), d = Math.min(H, Math.round((r.y + r.h - y0 + grow) * ppm));
    for (let y = c; y < d; y++) for (let x = a; x < b; x++) { const o = (y * W + x) * 4; px[o] = px[o + 1] = px[o + 2] = v; }
  };
  if (g.polarity === 'inverse') { fill(g.box, mark, spread); for (const r of g.rects) fill(r, surface, -spread); }   // spread eats the unmarked dark modules
  else for (const r of g.rects) fill(r, mark, spread);
  return { data: px, width: W, height: H };
}
const decode = (img) => { const r = jsQR(img.data, img.width, img.height, { inversionAttempts: 'attemptBoth' }); return r && r.data; };

test('encoder: payload is one alphanumeric segment, Q needs V3 and M needs V2 (the ADR table), deterministic', () => {
  assert.equal(PAYLOAD.length, 37);
  const q = SDTQR.encode(PAYLOAD, 'Q'), m = SDTQR.encode(PAYLOAD, 'M');
  assert.equal(q.version, 3); assert.equal(q.size, 29); assert.equal(m.version, 2); assert.equal(m.size, 25);
  assert.deepEqual(SDTQR.encode(PAYLOAD, 'Q').modules, q.modules);
  assert.equal(SDTQR.encode(PAYLOAD, 'Q').mask, q.mask);
  assert.deepEqual(SDTQR.ladder().map((c) => `${c.ecl}${c.version}`), ['Q3', 'M2']);
});

test('encoder: the matrix decodes back to the payload (ideal raster, both error correction levels)', () => {
  for (const ecl of ['Q', 'M']) {
    const e = SDTQR.encode(PAYLOAD, ecl), s = 8, q = 4, W = (e.size + 2 * q) * s, px = new Uint8ClampedArray(W * W * 4).fill(255);
    for (let y = 0; y < e.size; y++) for (let x = 0; x < e.size; x++) if (e.modules[y][x]) for (let j = 0; j < s; j++) for (let i = 0; i < s; i++) { const o = (((y + q) * s + j) * W + (x + q) * s + i) * 4; px[o] = px[o + 1] = px[o + 2] = 0; }
    assert.equal(jsQR(px, W, W).data, PAYLOAD);
  }
});

/* ---- the fixture: every blank in the shop. This table IS the ADR section 1 verdict, computed. ---- */
const FIXTURE = [
  // [shape, finish, blank w, eligible (gates as shipped), reason when not, version/ecl at the reference text]
  ['round', 'stainless', 25, false, 'size'],        // 1 inch: phone only
  ['round', 'black', 30, false, 'size'],            // 1.25 inch black round: below the 1.5 inch floor
  ['paw', 'stainless', 33, false, 'size'],          // 1.25 inch paw: phone only
  ['bone', 'stainless', 38, true],                  // two-line phone
  ['bone', 'black', 38, true],
  ['heart', 'stainless', 38, true],
  ['round', 'brass', 38, false, 'finish-test'],     // fits, but brass is test-gated
  ['military', 'stainless', 51, true],
  ['military', 'black', 50, true],
  ['bone', 'polished', 48, true],
  ['bone', 'silver', 38, false, 'finish-test'],
  ['military', 'navy', 50, false, 'finish-test'],
  ['military', 'rainbow', 50, false, 'finish'],
  ['military', 'fullcolor', 50, false, 'finish']
];
for (const [shape, finish, w, ok, reason] of FIXTURE) {
  test(`eligibility fixture: ${shape} ${finish} (${w} mm) -> ${ok ? 'eligible' : reason}`, () => {
    const e = SDTQR.qrEligibility(shape, finish);
    assert.equal(Math.round(e.blankMm.w), w);
    assert.equal(e.eligible, ok, JSON.stringify(e));
    if (!ok) assert.equal(e.reason, reason);
  });
}

test('eligibility: stated sizes (ADR): 1 inch and the 33 mm paw never fit a QR with a legal phone line', () => {
  for (const [s, f] of [['round', 'stainless'], ['paw', 'stainless'], ['paw', 'black']]) assert.equal(SDTQR.qrEligibility(s, f, { ignoreGate: true }).fits, false, `${s} ${f}`);
});

test('eligibility: blanks that fit use Q at V3 when 0.50 mm modules fit, otherwise M at V2 with at least 0.40 mm', () => {
  for (const [s, f] of [['military', 'stainless'], ['bone', 'polished'], ['round', 'brass'], ['bone', 'stainless'], ['heart', 'stainless']]) {
    const e = SDTQR.qrEligibility(s, f, { ignoreGate: true });
    assert.ok(e.fits, `${s} ${f}`);
    if (e.ecl === 'Q') { assert.equal(e.version, 3); assert.ok(e.moduleMm >= 0.5, `${s} ${f} Q needs >= 0.50`); }
    else { assert.equal(e.ecl, 'M'); assert.equal(e.version, 2); assert.ok(e.moduleMm >= 0.4); }
    assert.ok([2, 4].includes(e.quiet));
  }
  assert.equal(SDTQR.qrEligibility('military', 'stainless').ecl, 'Q');
});

test('eligibility: the version and module table is recomputed from the payload length (a shorter domain widens it, a longer one narrows it)', () => {
  const dflt = SDTQR.ladder(), short = SDTQR.ladder({ base: 'HTTPS://SDT.PET/T/' }), long = SDTQR.ladder({ base: 'HTTPS://WWW.SALTYDOGTAGS.COM/T/' });
  assert.deepEqual(dflt.map((c) => c.version), [3, 2]);
  assert.deepEqual(short.map((c) => c.version), [2, 2], 'Q now fits Version 2');
  assert.deepEqual(long.map((c) => c.version), [3, 3], 'M no longer fits Version 2');
  const a = SDTQR.qrEligibility('military', 'stainless'), b = SDTQR.qrEligibility('military', 'stainless', { base: 'HTTPS://SDT.PET/T/' });
  assert.ok(b.boxMm < a.boxMm, 'smaller symbol with the short domain');
  const bone = SDTQR.qrEligibility('bone', 'stainless', { base: 'HTTPS://SDT.PET/T/' });
  assert.equal(bone.ecl, 'Q'); assert.equal(bone.version, 2);
  assert.equal(SDTQR.qrEligibility('bone', 'stainless', { base: 'HTTPS://WWW.SALTYDOGTAGS.COM/T/' }).eligible, false, 'a longer domain narrows eligibility');
  assert.equal(SDTQR.qrEligibility('heart', 'stainless', { base: 'HTTPS://WWW.SALTYDOGTAGS.COM/T/' }).eligible, false);
});

test('base url: TAG_BASE_URL via configure(), the short-domain constant is empty until bought, payloads follow the base', () => {
  assert.equal(SDTQR.TAG_BASE_URL, 'HTTPS://SALTYDOGTAGS.COM/T/'); assert.equal(SDTQR.TAG_BASE_URL_SHORT, '');
  assert.equal(SDTQR.payloadFor('abcdefghjk'), PAYLOAD);
  SDTQR.configure({ base: 'HTTPS://SDT.PET/T/' });
  try { assert.equal(SDTQR.payloadFor(ID), 'HTTPS://SDT.PET/T/' + ID); assert.equal(SDTQR.ladder()[0].version, 2); }
  finally { SDTQR.configure({ base: null }); }
  assert.equal(SDTQR.payloadFor(ID), PAYLOAD);
  assert.equal(SDTQR.idFromPayload(PAYLOAD), ID); assert.equal(SDTQR.idFromPayload('HTTPS://EVIL.COM/T/' + ID), null); assert.equal(SDTQR.idFromPayload(PAYLOAD + '?x=1'), null);
});

test('finish gates: stainless and dark anodized on; light anodized, coated, brass test-gated off; configure() overrides; unknown finish is off', () => {
  const st = (f) => SDTQR.finishInfo(f).status;
  for (const f of ['stainless', 'polished', 'black', 'royal', 'red', 'green']) assert.equal(st(f), 'on', f);
  for (const f of ['silver', 'sky', 'yellow', 'pink', 'hotpink', 'ssblack', 'navy', 'gold', 'bronze', 'brass']) assert.equal(st(f), 'test', f);
  for (const f of ['rainbow', 'fullcolor', 'constructor', '__proto__', 'nope']) assert.equal(st(f), 'off', f);
  for (const f of ['black', 'royal', 'red', 'green', 'ssblack', 'navy', 'gold', 'bronze']) assert.equal(SDTQR.finishInfo(f).polarity, 'inverse', f);
  for (const f of ['stainless', 'polished', 'silver', 'sky', 'yellow', 'pink', 'hotpink', 'brass']) assert.equal(SDTQR.finishInfo(f).polarity, 'dark', f);
  SDTQR.configure({ finishes: { silver: 'on', black: 'test', bogus: 'on', sky: 'maybe' } });
  try { assert.equal(st('silver'), 'on'); assert.equal(st('black'), 'test'); assert.equal(st('sky'), 'test'); assert.equal(st('bogus'), 'off'); }
  finally { SDTQR.configure({ finishes: null }); }
});

/* ---- geometry ---- */
const CASES = [['bone', 'stainless'], ['bone', 'black'], ['heart', 'stainless'], ['military', 'stainless'], ['military', 'red'], ['bone', 'polished'], ['round', 'brass'], ['heart', 'green']];
for (const [shape, finish] of CASES) {
  test(`geometry: ${shape} ${finish} decodes with jsQR, with anneal spread and slight over-burn, and stays inside the blank`, () => {
    const t = tagOf(shape, finish);
    const ck = SDTQR.checkTag(t, { id: ID, ignoreGate: true });
    assert.ok(ck.ok, JSON.stringify(ck));
    const p = ck.plan, g = SDTQR.geometry(p, ID);
    assert.equal(g.payload, PAYLOAD); assert.equal(g.polarity, SDTQR.finishInfo(finish).polarity);
    assert.equal(decode(raster(g, p)), PAYLOAD, 'ideal');
    assert.equal(decode(raster(g, p, { spread: 0.02 })), PAYLOAD, 'with the 0.02 mm/edge anneal spread the inset compensates for');
    assert.equal(decode(raster(g, p, { spread: 0.05 })), PAYLOAD, 'robust to 0.05 mm/edge over-burn');
    assert.ok(SDTQR.verify(p, ID).ok, 'verify()');
    // independent containment: the sampled outline of the real blank, not the placement grid
    const clear15 = SDTLayout.clearance(t, 1.4), clear03 = SDTLayout.clearance(t, 0.25);
    const dataRects = g.polarity === 'inverse' ? [{ x: p.dataX, y: p.dataY, w: p.dataMm, h: p.dataMm }] : g.rects;
    for (const r of dataRects) for (let i = 0; i <= 8; i++) for (const [x, y] of [[r.x + r.w * i / 8, r.y], [r.x + r.w * i / 8, r.y + r.h], [r.x, r.y + r.h * i / 8], [r.x + r.w, r.y + r.h * i / 8]]) assert.ok(clear15(x, y), `data edge ${x},${y}`);
    for (let i = 0; i <= 40; i++) for (const [x, y] of [[p.x + p.boxMm * i / 40, p.y], [p.x + p.boxMm * i / 40, p.y + p.boxMm], [p.x, p.y + p.boxMm * i / 40], [p.x + p.boxMm, p.y + p.boxMm * i / 40]]) assert.ok(clear03(x, y), `quiet edge ${x},${y}`);
    // never touches the hanging hole
    const o = SDTLayout.OUT[shape], mm = SDTLayout.widthMm(t) / (o.bb[2] - o.bb[0]), hx = (o.hole.x - o.bb[0]) * mm, hy = (o.hole.y - o.bb[1]) * mm, hr = o.hole.r * mm;
    const cx = Math.max(p.x, Math.min(hx, p.x + p.boxMm)), cy = Math.max(p.y, Math.min(hy, p.y + p.boxMm));
    assert.ok(Math.hypot(cx - hx, cy - hy) >= hr + 0.8, 'clear of the hole ring');
    // module size and the version table
    assert.ok(p.moduleMm >= 0.4 && p.moduleMm <= 0.6);
    assert.equal(p.version, g.version);
  });
}

test('geometry: paths are run-merged rectangles in exact mm with 3 decimals; inverse = box plus reverse-wound holes', () => {
  const dark = SDTQR.checkTag(tagOf('military', 'stainless'), { id: ID }).plan, inv = SDTQR.checkTag(tagOf('military', 'red'), { id: ID }).plan;
  const gd = SDTQR.geometry(dark, ID), gi = SDTQR.geometry(inv, ID);
  const modulesDark = gd.modules.flat().filter(Boolean).length;
  assert.ok(gd.rects.length < modulesDark, 'merged: fewer rects than dark modules');
  assert.equal(gd.box, null); assert.ok(gi.box);
  const dd = SDTQR.pathD(gd), di = SDTQR.pathD(gi);
  assert.match(dd, /^(M-?\d+(\.\d{1,3})? -?\d+(\.\d{1,3})?h-?[\d.]+v-?[\d.]+h-?[\d.]+z)+$/);
  assert.ok(di.startsWith('M') && di.includes('v') && (di.match(/z/g) || []).length === gi.rects.length + 1);
  const area = (g) => g.rects.reduce((a, r) => a + r.w * r.h, 0);
  const m2 = dark.moduleMm * dark.moduleMm;
  assert.ok(Math.abs(area(gd) - (modulesDark * m2 * (1 - 0.0)) ) < modulesDark * m2 * 0.2, 'dark marks cover about the dark modules (inset removes a little)');
  assert.ok(area(gd) < modulesDark * m2, 'inset shrinks the marked area on edges that touch light modules');
});

test('geometry: the inset applies only on light-adjacent edges (no hairline seams inside solid blocks)', () => {
  const rs = SDTQR.runs([[true, true, true], [true, true, true], [true, true, true]], 1, -0.1);
  assert.equal(rs.length, 1); assert.deepEqual(rs[0], { x: 0.1, y: 0.1, w: 2.8, h: 2.8 });
  const two = SDTQR.runs([[true, false, true], [false, false, false], [false, false, false]], 1, -0.1);
  assert.equal(two.length, 2);
});

test('plan: back text avoids the QR box, capitals stay at least 1.6 mm, text never overlaps the QR (real fonts, all five)', async () => {
  for (const [shape, finish] of [['bone', 'stainless'], ['heart', 'stainless'], ['military', 'stainless'], ['bone', 'polished']]) {
    for (const font of ['block', 'bungee', 'slab', 'script', 'marker']) {
      const t = tagOf(shape, finish, { font, back: [font === 'script' || font === 'marker' ? 'Whisky' : 'WHISKY', '435-555-0123'] });
      const ck = SDTQR.checkTag(t, { id: ID });
      if (!ck.ok) { assert.equal(ck.reason, 'text', `${shape} ${finish} ${font}`); continue; }   // a font too wide for the blank is refused, never squeezed
      const f = await fontFor(font);
      const lopts = { qr: SDTQR.layoutOpts(ck.plan, ID) };
      const r = SDTLayout.layout(t, 'back', f, lopts);
      assert.ok(r.fit, `${shape} ${finish} ${font} fit`);
      const capMm = r.fs * r.s * SDTQR.CAP_RATIO[font];
      assert.ok(capMm >= 1.6 - 0.02, `${shape} ${finish} ${font}: cap ${capMm.toFixed(2)} mm`);
      const [bx0, by0] = r.bb, box = ck.plan;
      for (const d of r.textPaths) {
        const [x0, y0, x1, y1] = sampledBBox(toSubpaths(d, [1, 0, 0, 1, 0, 0]), 10);
        const mx0 = (x0 - bx0) * r.s, mx1 = (x1 - bx0) * r.s, my0 = (y0 - by0) * r.s, my1 = (y1 - by0) * r.s;
        const clear = mx1 <= box.x || mx0 >= box.x + box.boxMm || my1 <= box.y || my0 >= box.y + box.boxMm;
        assert.ok(clear, `${shape} ${finish} ${font}: text box overlaps the QR box`);
      }
    }
  }
});

test('plan: a name or phone too long for the blank is refused with a clear reason, not squeezed', () => {
  const ck = SDTQR.checkTag(tagOf('heart', 'stainless', { back: ['ABCDEFGHIJKLMNOPQRSTUVWX', '435-555-0123'] }), { id: ID });
  assert.equal(ck.ok, false); assert.equal(ck.reason, 'text'); assert.match(ck.message, /too long/);
});

test('plan: bone and heart split the phone on two lines; the others keep one line; a line 3 still fits or is refused', () => {
  assert.deepEqual(SDTQR.splitPhone('435-555-0123'), ['(435)', '555-0123']);
  assert.deepEqual(SDTQR.splitPhone('1 (435) 555 0123'), ['(435)', '555-0123']);
  assert.equal(SDTQR.checkTag(tagOf('bone', 'stainless'), { id: ID }).plan.backLines.length, 3);
  assert.equal(SDTQR.checkTag(tagOf('military', 'stainless'), { id: ID }).plan.backLines.length, 2);
  assert.equal(SDTQR.checkTag(tagOf('bone', 'polished'), { id: ID }).plan.backLines.length, 2);
});

test('layout: opts.qr is the only change; a tag without it renders byte for byte as before', async () => {
  const t = tagOf('bone', 'black'), f = await fontFor('block');
  assert.equal(SDTLayout.svg(t, 'back', f), SDTLayout.svg(t, 'back', f, {}));
  assert.equal(SDTLayout.svg(t, 'back', f), SDTLayout.svg(t, 'back', f, { qr: undefined }));
  assert.ok(!SDTLayout.svg(t, 'back', f).includes('id="qr"'));
  const ck = SDTQR.checkTag(t, { id: ID });
  const svg = SDTLayout.svg(t, 'back', f, { qr: SDTQR.layoutOpts(ck.plan, ID) });
  assert.match(svg, /<g id="engrave"[\s\S]*<\/g>\n<g id="qr" data-polarity="inverse"/);
  assert.ok(!SDTLayout.svg(t, 'front', f, { qr: SDTQR.layoutOpts(ck.plan, ID) }).includes('id="qr"'), 'front never carries the QR');
});

test('placeholder: the builder preview QR is the right size and cannot be scanned', () => {
  const p = SDTQR.checkTag(tagOf('military', 'stainless'), { id: ID }).plan;
  const g = SDTQR.placeholderGroup(p);
  assert.match(g, /class="qr-ph"/);
  const real = SDTQR.geometry(p, ID);
  // rasterize the placeholder modules the same way and make sure jsQR does not read the real payload from it
  const e = SDTQR.encode(PAYLOAD, p.ecl);
  assert.equal(real.size, e.size);
});
