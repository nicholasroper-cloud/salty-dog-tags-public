// node --test tools/test/
// Full color print finish, the paid raised-lettering option, art uploads (rights tick, SVG sanitizer), and the holiday ornament.
// Server prices everything (the client never sends a price); site/app.js mirrors the constants and a test here keeps them equal.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {
  price, tagUnitBase, checkoutLineItems, ornamentUnit, FULLCOLOR_PRICE, FULLCOLOR_SHAPES, RAISED_UPCHARGE_CENTS, ORNAMENT_PRICE_CENTS,
  ORNAMENT_RAISED_INCLUDED, SHIP_FROM, ART_STYLES, ART_ACK_TEXT, ART_ACK_VERSION, SIZES, PREMIUM,
} from '../../functions/api/_lib.js';
import { sanitizeSvg, cleanCss } from '../../functions/api/_svg.js';
import { onRequestPost } from '../../functions/api/order.js';
import { appData, read, extractBalanced } from '../lib/appdata.mjs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const L = require('../../site/tag-layout.js');

/* ---------- harness: the real handler on an in-memory KV ---------- */
function kv() { const m = new Map(); return { get: async (k) => m.get(k)?.v ?? null, put: async (k, v, o) => { m.set(k, { v, meta: o && o.metadata }); }, delete: async (k) => { m.delete(k); }, getWithMetadata: async (k) => ({ value: m.get(k)?.v ?? null, metadata: m.get(k)?.meta ?? null }), _m: m }; }
let ipN = 0;
async function post(body, env = {}) {
  const e = { ORDERS: kv(), ORNAMENTS_ON: 'true', ...env };
  const res = await onRequestPost({ request: new Request('https://x.test/api/order', { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.' + (++ipN % 250) }, body: JSON.stringify(body) }), env: e, waitUntil() {} });
  return { status: res.status, data: await res.json(), env: e };
}
import { mkPng, mkJpeg, dataUrl } from './_images.mjs';
import { ORN_HTML, withOrnamentHome } from './_ornament.mjs';
const jpeg = dataUrl('image/jpeg', mkJpeg(800, 600));
const svgUrl = (svg) => 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
const base = { name: 'Nick Roper', email: 'n@example.com', delivery: 'ship', street: '123 Main St', city: 'Lehi', state: 'FL', zip: '33601' };
const fcTag = (extra = {}) => ({ shape: 'bone', size: 'medium', finish: 'fullcolor', font: 'block', qty: 1, front1: 'Built like', front2: 'a loaf.', back1: 'Whisky', back2: '801-336-2244', art: 'design', style: 'bold', ...extra });
const orn = (extra = {}) => ({ tier: 'acrylic', name: 'Whisky', year: '2026', qty: 1, art: 'design', style: 'photo', photoImage: jpeg, ack: true, ...extra });
const stored = (env, id) => JSON.parse(env.ORDERS._m.get('order:' + id).v);

/* ---------- prices ---------- */
test('full color: base price per size defaults to the aluminum price, and is its own table', () => {
  assert.deepEqual(FULLCOLOR_PRICE, { small: 12, medium: 14, large: 16, xl: 18 });
  assert.deepEqual(FULLCOLOR_PRICE, SIZES, 'default: same as aluminum. Reprice by editing FULLCOLOR_PRICE only.');
  for (const size of Object.keys(SIZES)) assert.equal(tagUnitBase({ size, finish: 'fullcolor' }), FULLCOLOR_PRICE[size]);
  assert.equal(tagUnitBase({ size: 'large', finish: 'polished' }), SIZES.large + PREMIUM.polished, 'other finishes unchanged');
});

test('raised lettering: +$3 per tag, only on full color, only when the flag is sent', () => {
  assert.equal(RAISED_UPCHARGE_CENTS, 300);
  const t = (finish, raised) => ({ shape: 'bone', size: 'medium', finish, qty: 2, ...(raised === undefined ? {} : { raised }) });
  assert.equal(price([t('fullcolor', true)], [], 'ship').subtotal, (14 + 3) * 2, 'flag sent on full color: charged per tag');
  assert.equal(price([t('fullcolor', false)], [], 'ship').subtotal, 14 * 2, 'flag false: no charge');
  assert.equal(price([t('fullcolor')], [], 'ship').subtotal, 14 * 2, 'flag absent: no charge');
  assert.equal(price([t('fullcolor', 'true')], [], 'ship').subtotal, 14 * 2, 'only a real true counts, not the string "true"');
  for (const f of ['red', 'stainless', 'polished', 'brass']) assert.equal(price([t(f, true)], [], 'ship').subtotal, price([t(f)], [], 'ship').subtotal, `${f}: raised is ignored`);
});

test('raised lettering is an add-on: not discounted by the 3-tag deal', () => {
  const tags = [{ shape: 'bone', size: 'medium', finish: 'fullcolor', qty: 3, raised: true }];
  const p = price(tags, [], 'ship');
  assert.equal(p.subtotal, 3 * 17);
  assert.equal(p.discount, +(3 * 14 * 0.15).toFixed(2), 'discount is on the $14 base only');
});

test('ornament unit prices come from cents tables: $24 acrylic, $36 stainless (+$12), raised included', () => {
  assert.deepEqual(ORNAMENT_PRICE_CENTS, { acrylic: 2400, stainless: 3600 });
  assert.equal(ORNAMENT_PRICE_CENTS.stainless - ORNAMENT_PRICE_CENTS.acrylic, 1200);
  assert.equal(ORNAMENT_RAISED_INCLUDED, true);
  assert.equal(ornamentUnit({ tier: 'acrylic', raised: true }), 24);
  assert.equal(ornamentUnit({ tier: 'acrylic', raised: false }), 24);
  assert.equal(ornamentUnit({ tier: 'stainless' }), 36);
  const p = price([], [], 'ship', false, [{ tier: 'acrylic', qty: 2 }, { tier: 'stainless', qty: 1 }]);
  assert.equal(p.subtotal, 84);
  assert.equal(p.shipping, 0, 'over the $35 line');
  assert.equal(price([], [], 'ship', false, [{ tier: 'acrylic', qty: 1 }]).shipping, 4.5);
  assert.equal(price([], [], 'ship', false, [{ tier: 'acrylic', qty: 4 }]).discount, 0, 'ornaments never count toward the tag discount');
});

/* ---------- the handler: server-side pricing, whitelist, validation ---------- */
test('order: full color tag is accepted and priced server-side; any client price is ignored', async () => {
  const { status, data, env } = await post({ ...base, tags: [fcTag({ price: 0.01, unit: 0.01, unitBase: 0.01, total: 0.01 })], totals: { total: 0.01 } });
  assert.equal(status, 200, JSON.stringify(data));
  assert.equal(data.totals.subtotal, 14);
  assert.equal(data.totals.total, 18.5);
  const o = stored(env, data.id);
  assert.equal(o.tags[0].finish, 'fullcolor');
  assert.equal(o.tags[0].art, 'design'); assert.equal(o.tags[0].style, 'bold');
  assert.equal(o.tags[0].photo, false, 'bold type needs no image');
  assert.equal(o.tags[0].raised, false);
});

test('order: raised is charged only with raised:true on a full color tag', async () => {
  const on = await post({ ...base, tags: [fcTag({ raised: true })] });
  assert.equal(on.data.totals.subtotal, 17); assert.equal(stored(on.env, on.data.id).tags[0].raised, true);
  for (const raised of [false, 'true', 1, 'yes', null]) {
    const r = await post({ ...base, tags: [fcTag({ raised })] });
    assert.equal(r.data.totals.subtotal, 14, `raised=${JSON.stringify(raised)}`);
    assert.equal(stored(r.env, r.data.id).tags[0].raised, false);
  }
  const other = await post({ ...base, tags: [{ shape: 'bone', size: 'medium', finish: 'red', font: 'block', qty: 1, front1: 'a', back1: 'W', back2: '801-336-2244', raised: true }] });
  assert.equal(other.data.totals.subtotal, 14, 'raised on an engraved tag is ignored');
  assert.equal(stored(other.env, other.data.id).tags[0].raised, undefined);
});

test('order: finish whitelist. Unknown finishes fall back to black, full color needs an allowed shape', async () => {
  const unknown = await post({ ...base, tags: [{ ...fcTag(), finish: 'neon' }] });
  assert.equal(stored(unknown.env, unknown.data.id).tags[0].finish, 'black');
  const hidden = await post({ ...base, tags: [fcTag({ shape: 'hydrant' })] });
  assert.equal(hidden.status, 400);
  assert.deepEqual(FULLCOLOR_SHAPES, ['bone', 'round', 'heart', 'paw', 'military']);
  for (const shape of FULLCOLOR_SHAPES) for (const size of Object.keys(SIZES)) {
    const r = await post({ ...base, tags: [fcTag({ shape, size })] });
    assert.equal(r.status, 200, `${shape} ${size}`);
    assert.equal(r.data.totals.subtotal, FULLCOLOR_PRICE[size]);
  }
});

test('order: the image is required for "Upload your own" and for the photo style, and is dropped for styles that do not use one', async () => {
  const noUp = await post({ ...base, tags: [fcTag({ art: 'upload', style: undefined })] });
  assert.equal(noUp.status, 400); assert.match(noUp.data.error, /image/i);
  const noPhoto = await post({ ...base, tags: [fcTag({ style: 'photo', ack: true })] });
  assert.equal(noPhoto.status, 400);
  const ignored = await post({ ...base, tags: [fcTag({ style: 'synthwave', photoImage: jpeg, ack: true })] });
  assert.equal(ignored.status, 200);
  assert.equal(stored(ignored.env, ignored.data.id).tags[0].photo, false, 'a style with no image never stores one');
  assert.ok(![...ignored.env.ORDERS._m.keys()].some((k) => k.startsWith('photo:')));
  const noSaying = await post({ ...base, tags: [fcTag({ front1: '', front2: '' })] });
  assert.equal(noSaying.status, 400, 'design path needs a saying');
  const upNoSaying = await post({ ...base, tags: [fcTag({ art: 'upload', style: undefined, front1: '', front2: '', photoImage: jpeg, ack: true })] });
  assert.equal(upNoSaying.status, 200, 'finished artwork may carry its own words');
  const bad = await post({ ...base, tags: [fcTag({ style: 'rainbow-unicorn' })] });
  assert.equal(bad.status, 400);
});

test('order: the rights acknowledgment is required whenever an image is sent, and is stored with the order', async () => {
  for (const ack of [false, undefined, 'true', 1, null]) {
    const r = await post({ ...base, tags: [fcTag({ art: 'upload', style: undefined, photoImage: jpeg, ack })] });
    assert.equal(r.status, 400, `ack=${JSON.stringify(ack)}`); assert.equal(r.data.field, 'artAck');
    assert.ok(![...r.env.ORDERS._m.keys()].some((k) => k.startsWith('photo:') || k.startsWith('order:SDT')), 'nothing stored on a refused order');
  }
  const ok = await post({ ...base, tags: [fcTag({ art: 'upload', style: undefined, photoImage: jpeg, ack: true })] });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  const o = stored(ok.env, ok.data.id);
  assert.equal(o.tags[0].ack.ownRights, true); assert.ok(o.tags[0].ack.at > 0);
  assert.equal(o.tags[0].photo, true); assert.equal(o.tags[0].art, 'upload');
  assert.ok(![...ok.env.ORDERS._m.keys()].some((k) => k.startsWith('order:SDT') && JSON.parse(ok.env.ORDERS._m.get(k).v).tags[0].photoImage), 'the image is not inside the order JSON');
  assert.equal(o.tags[0].ack.v, ART_ACK_VERSION); assert.match(o.tags[0].ack.h, /^[0-9a-f]{16}$/);
  assert.match(ART_ACK_TEXT, /I took this photo or made this art, or I have permission from whoever did to have it printed/);
  assert.ok(ART_ACK_TEXT.includes('[artwork terms](/policies/#artwork)'));
});

test('order: an uploaded SVG is sanitized before it is stored; unusable SVG is refused', async () => {
  const dirty = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" onload="alert(1)"><script>alert(1)</script><rect width="10" height="10" fill="red" onclick="x()"/><foreignObject><div>x</div></foreignObject><image href="https://evil.test/x.png" width="1" height="1"/></svg>';
  const r = await post({ ...base, tags: [fcTag({ art: 'upload', style: undefined, photoImage: svgUrl(dirty), ack: true })] });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const key = [...r.env.ORDERS._m.keys()].find((k) => k.startsWith('photo:'));
  const meta = r.env.ORDERS._m.get(key);
  assert.equal(meta.meta.mime, 'image/svg+xml');
  const svg = Buffer.from(meta.v, 'base64').toString('utf8');
  for (const bad of ['script', 'onload', 'onclick', 'foreignObject', 'evil.test', 'alert']) assert.ok(!svg.includes(bad), 'stored svg must not contain ' + bad);
  assert.match(svg, /<rect/);
  assert.equal(stored(r.env, r.data.id).tags[0].photoMime, 'image/svg+xml');
  const doctype = await post({ ...base, tags: [fcTag({ art: 'upload', style: undefined, photoImage: svgUrl('<!DOCTYPE svg [<!ENTITY a "b">]><svg viewBox="0 0 1 1"><rect/></svg>'), ack: true })] });
  assert.equal(doctype.status, 400);
  const notSvg = await post({ ...base, tags: [fcTag({ art: 'upload', style: undefined, photoImage: svgUrl('<html><body>hi</body></html>'), ack: true })] });
  assert.equal(notSvg.status, 400);
});

test('order: an SVG is not accepted as a "photo style" image or for the engraved stainless ornament', async () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>';
  const style = await post({ ...base, tags: [fcTag({ style: 'photo', photoImage: svgUrl(svg), ack: true })] });
  assert.equal(style.status, 400);
  const stainless = await post({ ...base, ornaments: [orn({ tier: 'stainless', photoImage: svgUrl(svg) })] });
  assert.equal(stainless.status, 400);
});

test('order: ornaments are priced server-side from the cents table', async () => {
  const a = await post({ ...base, ornaments: [orn({ price: 1, unit: 1, cents: 1 })] });
  assert.equal(a.status, 200, JSON.stringify(a.data));
  assert.equal(a.data.totals.subtotal, 24); assert.equal(a.data.totals.total, 28.5);
  const s = await post({ ...base, ornaments: [orn({ tier: 'stainless', qty: 2, price: 1 })] });
  assert.equal(s.data.totals.subtotal, 72); assert.equal(s.data.totals.shipping, 0);
  const o = stored(a.env, a.data.id);
  assert.equal(o.ornaments[0].raised, true, 'raised name and year are included in the acrylic tier');
  assert.equal(o.ornaments[0].ack.ownRights, true);
  assert.equal(o.ornaments[0].photoIndex, 100);
  assert.ok(a.env.ORDERS._m.has('photo:' + a.data.id + ':100'));
  const stainlessOrder = stored(s.env, s.data.id);
  assert.equal(stainlessOrder.ornaments[0].raised, false); assert.equal(stainlessOrder.ornaments[0].art, 'upload');
  const withTag = await post({ ...base, tags: [fcTag()], ornaments: [orn()] });
  assert.equal(withTag.data.totals.subtotal, 38);
});

test('order: ornament validation (tier, name, year, image, rights tick)', async () => {
  const cases = [
    ['bad tier', orn({ tier: 'gold' })], ['no name', orn({ name: '' })], ['long name', orn({ name: 'x'.repeat(25) })],
    ['year text', orn({ year: 'abcd' })], ['year 1999', orn({ year: '1999' })], ['no photo (style photo)', orn({ photoImage: undefined })],
    ['no photo (stainless)', orn({ tier: 'stainless', photoImage: undefined })], ['no ack', orn({ ack: false })], ['bad style', orn({ style: 'nope' })],
    ['upload without image', orn({ art: 'upload', photoImage: undefined })],
  ];
  for (const [label, o] of cases) { const r = await post({ ...base, ornaments: [o] }); assert.equal(r.status, 400, label); }
  const house = await post({ ...base, ornaments: [orn({ style: 'synthwave', photoImage: undefined, ack: false })] });
  assert.equal(house.status, 200, 'a house style with no upload needs no image and no tick');
  assert.ok(![...house.env.ORDERS._m.keys()].some((k) => k.startsWith('photo:')));
});

test('checkout line items: full color name and note, its own raised line, ornament lines in cents', () => {
  const order = {
    customer: { name: 'A B', email: 'a@b.co', delivery: 'ship', state: 'FL' },
    tags: [{ shape: 'bone', size: 'medium', finish: 'fullcolor', qty: 2, front: ['Built like', 'a loaf.'], back: ['Whisky'], art: 'design', style: 'bold', raised: true, photo: false }],
    prints: [],
    ornaments: [{ tier: 'acrylic', name: 'Whisky', year: '2026', qty: 1, raised: true }, { tier: 'stainless', name: 'Whisky', year: '2026', qty: 1 }],
    totals: { multi: false, prize: 0, shipping: 0 },
  };
  const items = checkoutLineItems({}, order);
  const tag = items[0];
  assert.match(tag.name, /Full color print/); assert.match(tag.note, /FULL COLOR/); assert.match(tag.note, /RAISED/);
  assert.equal(tag.price, 1400);
  const raised = items.find((i) => i.name === 'Raised lettering');
  assert.equal(raised.price, 300); assert.equal(raised.unitQty, 2);
  const a = items.find((i) => /full-color printed acrylic/.test(i.name)), s = items.find((i) => /engraved stainless bone/.test(i.name));
  assert.equal(a.price, 2400); assert.equal(s.price, 3600);
  assert.match(a.note, /Whisky/); assert.match(a.note, /RAISED/);
  assert.ok(!items.some((i) => i.name === 'Photo engraving'), 'no engraving add-on on full color');
  const sum = items.reduce((n, i) => n + i.price * i.unitQty, 0);
  assert.equal(sum, 2 * 1400 + 2 * 300 + 2400 + 3600);
});

/* ---------- SVG sanitizer ---------- */
test('sanitizeSvg: strips script, events, foreignObject, animation, external references; keeps the drawing', () => {
  const r = sanitizeSvg(`<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 10 10" onload="alert(1)">
    <script>alert(1)</script><a xlink:href="javascript:alert(1)"><rect width="5" height="5" fill="red" onclick="x()" style="fill:url(http://evil.test/x.svg#a)"/></a>
    <foreignObject><iframe src="http://evil.test"></iframe></foreignObject><animate attributeName="href" to="javascript:1"/><set attributeName="onclick" to="x"/>
    <image href="http://evil.test/a.png" width="1" height="1"/><use xlink:href="http://evil.test/x.svg#a"/><use href="#ok"/><pattern id="p"><rect/></pattern><circle id="ok" cx="5" cy="5" r="2" fill="url(#g)"/>
    <linearGradient id="g"><stop offset="0" stop-color="#f0f"/></linearGradient></svg>`);
  assert.equal(r.ok, true);
  for (const bad of ['script', 'onload', 'onclick', 'foreignObject', 'iframe', 'animate', '<set', 'javascript', 'evil.test', '<image', '<use', '<pattern']) assert.ok(!r.svg.includes(bad), 'removed: ' + bad);
  for (const keep of ['<rect', '<circle', 'url(#g)', '<linearGradient', 'viewBox="0 0 10 10"']) assert.ok(r.svg.includes(keep), 'kept: ' + keep);
  assert.equal(r.aspect, 1);
});

test('sanitizeSvg: entity-obfuscated javascript: and data: hrefs are caught after decoding', () => {
  const r = sanitizeSvg('<svg viewBox="0 0 1 1"><a href="jav&#x61;script:alert(1)"><rect width="1" height="1"/></a><use href="&#106;avascript:alert(1)"/><image href="data:text/html;base64,PHNjcmlwdD4=" width="1" height="1"/><image href="' + dataUrl('image/png', mkPng(10, 10)) + '" width="1" height="1"/><image href="data:image/png;base64,AAAA" width="1" height="1"/></svg>');
  assert.equal(r.ok, true);
  assert.ok(!/javascript/i.test(r.svg) && !r.svg.includes('text/html'));
  assert.equal((r.svg.match(/<image/g) || []).length, 1, 'a real small raster data: image is kept, a fake one is dropped');
});

test('sanitizeSvg: <style> blocks keep plain rules and lose imports and external url()', () => {
  const r = sanitizeSvg('<svg viewBox="0 0 2 2"><style>.a{fill:red}</style><style>@import url(http://evil.test/x.css); .b{fill:blue}</style><style>.c{fill:url(http://evil.test/x#y);stroke:green}</style><rect class="a" width="1" height="1"/></svg>');
  assert.equal(r.ok, true);
  assert.ok(r.svg.includes('.a{fill:red}'));
  assert.ok(!r.svg.includes('evil.test') && !r.svg.includes('@import'));
  assert.ok(r.svg.includes('stroke:green'));
  assert.equal(cleanCss('a{background:url( "https://x.test/a.png" )}'), 'a{background:none}');
  assert.equal(cleanCss('a{width:expression(alert(1))}'), '');
});

test('sanitizeSvg: refuses DOCTYPE/ENTITY, empty files, non-SVG, oversize, and SVG with nothing to draw', () => {
  assert.equal(sanitizeSvg('<!DOCTYPE svg [<!ENTITY a "aaaa">]><svg viewBox="0 0 1 1"><rect/></svg>').ok, false);
  assert.equal(sanitizeSvg('').ok, false);
  assert.equal(sanitizeSvg('<html><body>nope</body></html>').ok, false);
  assert.equal(sanitizeSvg('<svg viewBox="0 0 1 1"></svg>').ok, false);
  assert.equal(sanitizeSvg('<svg><rect width="1" height="1"/></svg>').ok, false, 'no viewBox and no size');
  assert.equal(sanitizeSvg('<svg width="10" height="20"><rect width="1" height="1"/></svg>').aspect, 0.5, 'size becomes a viewBox');
  assert.equal(sanitizeSvg('<svg viewBox="0 0 1 1">' + '<g/>'.repeat(25000) + '<rect/></svg>').ok, false, 'node cap');
  assert.equal(sanitizeSvg('x'.repeat(2_000_000)).ok, false);
});

test('sanitizeSvg: output is re-emitted from an allow-list, so unknown elements and attributes cannot survive', () => {
  const r = sanitizeSvg('<svg viewBox="0 0 1 1" evil="1" xmlns:x="urn:x"><weird><rect width="1" height="1"/></weird><rect width="1" height="1" data-x="1" onfocus="1" fill="red"/><svg><rect/></svg></svg>');
  assert.equal(r.ok, true);
  assert.ok(!/weird|evil|data-x|onfocus|urn:x/.test(r.svg));
  assert.equal((r.svg.match(/<svg/g) || []).length, 1, 'a nested root is dropped');
});

/* ---------- client / server sync ---------- */
const src = read('site/app.js');
const lit = (marker, o, c) => JSON.parse(JSON.stringify(vm.runInNewContext('(' + extractBalanced(src, marker, o, c) + ')')));
const strConst = (name) => new RegExp(`const ${name} = ('(?:[^'\\\\]|\\\\.)*'|"(?:[^"\\\\]|\\\\.)*")`).exec(src);

test('sync: app.js prices and options equal the server', () => {
  const d = appData();
  assert.deepEqual(d.PRICES.fullcolor, FULLCOLOR_PRICE);
  assert.equal(d.PRICES.raisedCents, RAISED_UPCHARGE_CENTS);
  assert.deepEqual(d.PRICES.ornament, ORNAMENT_PRICE_CENTS);
  assert.deepEqual(lit('const FULLCOLOR_SHAPES = ', '[', ']'), FULLCOLOR_SHAPES);
  assert.deepEqual(Object.keys(lit('const ART_STYLES = ', '{', '}')), ART_STYLES);
  assert.equal(/const ORNAMENT_RAISED_INCLUDED = (true|false)/.exec(src)[1] === 'true', ORNAMENT_RAISED_INCLUDED);
  assert.equal(vm.runInNewContext(strConst('SHIP_FROM')[1]), SHIP_FROM);
  assert.equal(vm.runInNewContext(strConst('ART_ACK_TEXT')[1]), ART_ACK_TEXT);
  assert.deepEqual(d.FINISHES.fullcolor, { n: 'Full color print', c: '#FFFFFF', kind: 'fullcolor', ink: 'dark' });
  assert.ok(/const UPLOAD_BLOCK_PX = 150, UPLOAD_WARN_PX = 300;/.test(src), 'resolution thresholds: block under 150 px, warn under 300 px');
});

test('sync: full color geometry in app.js equals tools tag-layout.js (preview and print sheet agree)', () => {
  for (const [name, mine] of [['FC_BBOX', L.FC_BBOX], ['FC_TEXT', L.FC_TEXT], ['FC_BOLD', L.FC_BOLD], ['FC_LONG_MM', L.FC_LONG_MM]]) assert.deepEqual(lit(`const ${name} = `, '{', '}'), mine, name);
  for (const shape of Object.keys(L.FC_BBOX)) assert.deepEqual(L.FC_BBOX[shape], L.OUT[shape].bb, `${shape}: preview box equals the engraving outline box`);
  assert.deepEqual(Object.keys(L.FC_BBOX).sort(), [...FULLCOLOR_SHAPES].sort());
});

/* ---------- print layout ---------- */
test('fullcolorLayout: sizes in mm, three layers, raised flag on every element', () => {
  const spec = { product: 'tag', shape: 'bone', size: 'medium', lines: ['Built like', 'a loaf.'], back: ['Whisky', '801-336-2244'], font: 'block', art: 'design', style: 'synthwave', raised: true, rightsAcknowledged: false, orderId: 'SDT-TEST', item: 'tag1' };
  const lay = L.fullcolorLayout(spec);
  assert.deepEqual(lay.tagMm, [38, 25.33]);
  assert.deepEqual(L.fullcolorLayout({ ...spec, size: 'xl', shape: 'round' }).tagMm, [64, 64]);
  assert.deepEqual(lay.layers, ['color', 'white', 'raised']);
  assert.ok(lay.elements.every((e) => typeof e.raised === 'boolean'), 'raised is present on every element');
  const raisedIds = lay.elements.filter((e) => e.raised).map((e) => e.id).sort();
  assert.deepEqual(raisedIds, ['back-text', 'rim', 'saying']);
  assert.equal(lay.elements.find((e) => e.id === 'white-underlay').layer, 'white');
  assert.equal(lay.art.raisedLettering, true);
  const flat = L.fullcolorLayout({ ...spec, raised: false });
  assert.ok(flat.elements.every((e) => e.raised === false), 'no raised element when the option was not bought');
  assert.equal(flat.art.raisedLettering, false);
});

test('fullcolorLayout: photo crop box, ornament disc, acknowledgment carried', () => {
  const lay = L.fullcolorLayout({ product: 'tag', shape: 'bone', size: 'medium', lines: ['x'], back: ['y'], art: 'upload', raised: false, rightsAcknowledged: true, image: { file: 'a.jpg', mime: 'image/jpeg', w: 1000, h: 1000 } });
  const img = lay.elements.find((e) => e.id === 'image');
  assert.equal(img.fit, 'cover'); assert.deepEqual(img.boxMm, { x: 0, y: 0, w: 38, h: 25.33 });
  assert.equal(img.cropPx.w, 1000); assert.equal(img.cropPx.h, Math.round(1000 * 25.33 / 38));
  assert.equal(lay.art.rightsAcknowledged, true);
  const disc = L.fullcolorLayout({ product: 'ornament', ornamentTier: 'acrylic', shape: 'round', lines: ['Whisky', '2026'], font: 'bungee', art: 'design', style: 'photo', raised: true, image: { file: 'b.jpg' } });
  assert.deepEqual(disc.tagMm, [76.2, 76.2]); assert.equal(disc.finish, 'ornament-acrylic');
  assert.ok(disc.elements.find((e) => e.id === 'name-year').raised);
  const svg = L.fullcolorSVG(lay, { imageHref: 'data:image/png;base64,AAAA', marks: true });
  assert.match(svg, /width="38mm" height="25.33mm"/);
});

/* ---------- the pages ---------- */
test('ornament page: one Offer per tier at the server prices, honest copy, no fake reviews, linked from the home page', () => {
  const html = ORN_HTML;
  const ld = [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)].map((m) => JSON.parse(m[1]));
  const products = ld.filter((j) => j['@type'] === 'Product');
  assert.equal(products.length, 2);
  for (const p of products) assert.equal([].concat(p.offers).length, 1, 'a single Offer per tier');
  assert.deepEqual(products.map((p) => p.offers.price).sort(), ['24.00', '36.00']);
  assert.ok(!/aggregateRating|"review"|Review/.test(JSON.stringify(ld)), 'no ratings or reviews until they exist');
  assert.match(html, /full[- ]color/i); assert.match(html, /grayscale/i);
  assert.match(html, /raised name and year/i);
  assert.ok(!/Made in Lehi|made in Lehi/.test(html));
  assert.match(html, new RegExp(`from <span data-ship-from>${SHIP_FROM}</span>`), 'ship-from is the constant');
  assert.ok(html.includes('Order by Sat, Dec 12 and pay your invoice by Mon, Dec 14 for Christmas in the lower 48.'), 'Lady Jaye B4 hero');
  const homeOn = withOrnamentHome(read('site/index.html'));
  assert.match(homeOn, /href="\/ornament\/">Holiday ornament<\/a>/);
  assert.match(homeOn, /id="ornament-promo"/);
});

test('builder copy: claims only what is true, raised option priced, review note, safe area', () => {
  const home = read('site/index.html');
  assert.ok(src.includes('UV-printed in full color on acrylic or white aluminum. Printed color wears faster than engraving on a busy collar. For years of collar abuse, pick stainless.'), 'Lady Jaye B1');
  assert.match(home, /Raised lettering and rim, built up in layers of UV ink\./, 'Lady Jaye B3');
  assert.match(home, /id="raisedPrice">\+\$3</);
  assert.match(home, /We check every upload by hand before you pay\. If we can't print it, you pay nothing, or get a full refund\./, 'Lady Jaye B6');
  assert.ok(!/We may decline artwork/.test(home));
  assert.match(home, /id="artAckTxt"/); assert.match(home, /id="photoAckTxt"/);
  assert.ok(src.includes('PRINT-SAFE AREA'));
  assert.ok(!/accept="[^"]*webp/.test(home) && !/accept="[^"]*webp/.test(ORN_HTML), 'copy says PNG, JPG or SVG, so the file pickers do too');
});
