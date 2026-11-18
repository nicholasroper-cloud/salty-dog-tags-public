// node --test tools/test/
// Round 2 (Flint review CR-001..017 and Lady Jaye B1..B6, C1, C4, C8, C9): claims, SVG render-cost limits, raster inspection,
// pay-after-review, retention and decline, emails, dates, policy text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sanitizeSvg, cleanCss } from '../../functions/api/_svg.js';
import { inspectRaster, MAX_SIDE_PX } from '../../functions/api/_raster.js';
import { onRequestPost as place } from '../../functions/api/order.js';
import { onRequestPost as ownerPost } from '../../functions/api/orders.js';
import {
  price, tagUnitBase, canPayOnline, checkoutLineItems, PHOTO_TTL_SECONDS, ART_ACK_VERSION, ART_ACK_TEXT, MAX_ORNAMENT_LINES, RAISED_NOTE, sha256Hex, own, SIZES,
} from '../../functions/api/_lib.js';
import { orderConfirmEmail, shippedEmail, declineEmail } from '../../functions/api/_email.js';
import { read, ROOT } from '../lib/appdata.mjs';
import { mkPng, mkJpeg, mkWebp, dataUrl } from './_images.mjs';
import { ORN_HTML, withOrnamentHome } from './_ornament.mjs';

/* ---------- harness ---------- */
function kv() {
  const m = new Map();
  return {
    get: async (k) => m.get(k)?.v ?? null, delete: async (k) => { m.delete(k); },
    put: async (k, v, o) => { m.set(k, { v, meta: o && o.metadata, ttl: o && o.expirationTtl }); },
    getWithMetadata: async (k) => ({ value: m.get(k)?.v ?? null, metadata: m.get(k)?.meta ?? null }),
    list: async ({ prefix = '' } = {}) => ({ keys: [...m.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true }),
    _m: m,
  };
}
let ipN = 100;
async function post(body, env = {}) {
  const e = { ORDERS: kv(), ORNAMENTS_ON: 'true', ...env };
  const res = await place({ request: new Request('https://x.test/api/order', { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': '198.51.100.' + (++ipN % 250) }, body: JSON.stringify(body) }), env: e, waitUntil() {} });
  return { status: res.status, data: await res.json(), env: e };
}
const owner = (env, body) => ownerPost({ request: new Request('https://x.test/api/orders', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer adminkey' }, body: JSON.stringify(body) }), env: { ADMIN_KEY: 'adminkey', ...env } }).then(async (r) => ({ status: r.status, data: await r.json() }));
const jpeg = dataUrl('image/jpeg', mkJpeg(800, 600));
const base = { name: 'Nick Roper', email: 'n@example.com', delivery: 'ship', street: '123 Main St', city: 'Lehi', state: 'FL', zip: '33601' };
const fcTag = (extra = {}) => ({ shape: 'bone', size: 'medium', finish: 'fullcolor', font: 'block', qty: 1, front1: 'Built like', front2: 'a loaf.', back1: 'Whisky', back2: '801-336-2244', art: 'design', style: 'bold', ...extra });
const orn = (extra = {}) => ({ tier: 'acrylic', name: 'Whisky', year: '2026', qty: 1, art: 'design', style: 'photo', photoImage: jpeg, ack: true, ...extra });
const stored = (env, id) => JSON.parse(env.ORDERS._m.get('order:' + id).v);

/* ---------- CR-001: no placeholders, no untrue claims ---------- */
const TEXT = /\.(html|md|txt|xml|js|mjs|json|css|toml)$/i;
const walk = (dir, out = []) => { for (const e of readdirSync(dir)) { const p = join(dir, e); if (statSync(p).isDirectory()) { if (!['node_modules', '.git'].includes(e)) walk(p, out); } else if (TEXT.test(e)) out.push(p); } return out; };
const files = ['site', 'functions', 'tools', 'laser/lib', 'laser/ui'].flatMap((d) => { try { return walk(join(ROOT, d)); } catch { return []; } });
const MARK = '\\[\\[' + 'CONFIRM';

test('no placeholder marker anywhere in site/, functions/, tools/ or laser/ (this file only builds the pattern)', () => {
  const bad = files.filter((f) => !f.endsWith('.test.mjs') && new RegExp(MARK).test(readFileSync(f, 'utf8')));
  assert.deepEqual(bad.map((f) => f.slice(ROOT.length + 1)), []);
});

test('untested durability claims are gone from page copy, builder, server notes and layout notes (until the wear test is done)', () => {
  const claims = /wear-tested|sealed|protective rim|varnish|clear-coat/i;
  const scope = files.filter((f) => /site\/(index\.html|app\.js|ornament|orders\.html|tag-layout\.js)|site\/ornament\/|functions\/api\/_lib\.js|functions\/api\/_email\.js|tools\/build-ornament\.mjs/.test(f) && !/\.md$/.test(f));
  const bad = scope.filter((f) => claims.test(readFileSync(f, 'utf8')));
  assert.deepEqual(bad.map((f) => f.slice(ROOT.length + 1)), []);
  assert.equal(RAISED_NOTE, 'Raised lettering and rim, built up in layers of UV ink.', 'Lady Jaye B3, also what the Clover line note says');
});

test('ornament bullet says what the print really is (Lady Jaye B2)', () => {
  assert.ok(ORN_HTML.includes('Full-color photo printed in UV ink, with a white layer underneath so it pops on clear acrylic'));
});

/* ---------- CR-002: SVG render cost ---------- */
const nestedUse = (levels, fan) => {
  let s = '<defs><g id="L0"><rect width="1" height="1"/></g>';
  for (let i = 1; i <= levels; i++) s += `<g id="L${i}">${`<use href="#L${i - 1}"/>`.repeat(fan)}</g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">${s}</defs><use href="#L${levels}"/></svg>`;
};
test('SVG recursion payload (10 levels x 10 <use>) loses every <use>: nothing can expand', () => {
  const src = nestedUse(10, 10);
  assert.ok(src.length < 3000);
  const r = sanitizeSvg(src);
  assert.ok(!r.ok || !/<use|<symbol/.test(r.svg), 'no <use> survives');
  assert.ok(!r.ok || (r.svg.match(/<g/g) || []).length < 20);
});
test('SVG: <pattern> is dropped, mask and clipPath are capped and cannot reference each other', () => {
  assert.ok(!/<pattern/.test(sanitizeSvg('<svg viewBox="0 0 1 1"><pattern id="p"><rect width="1" height="1"/></pattern><rect fill="url(#p)" width="1" height="1"/></svg>').svg));
  const deep = '<svg viewBox="0 0 1 1"><mask id="a"><mask id="b"><mask id="c"><rect/></mask></mask></mask><rect width="1" height="1"/></svg>';
  assert.equal(sanitizeSvg(deep).ok, false, 'three levels of mask nesting is refused');
  const many = '<svg viewBox="0 0 1 1">' + Array.from({ length: 13 }, (_, i) => `<clipPath id="c${i}"><rect/></clipPath>`).join('') + '<rect width="1" height="1"/></svg>';
  assert.equal(sanitizeSvg(many).ok, false, 'more than 12 masks or clip paths is refused');
  const chained = sanitizeSvg('<svg viewBox="0 0 1 1"><clipPath id="a" clip-path="url(#b)"><rect clip-path="url(#b)" mask="url(#b)" style="fill:url(#b)"/></clipPath><clipPath id="b"><rect/></clipPath><rect clip-path="url(#a)" width="1" height="1"/></svg>');
  assert.equal(chained.ok, true);
  const inside = chained.svg.slice(chained.svg.indexOf('<clipPath id="a"'), chained.svg.indexOf('</clipPath>') + 11);
  assert.ok(!/url\(/.test(inside), 'references inside a clip path are removed');
  assert.ok(/clip-path="url\(#a\)"/.test(chained.svg), 'a plain use of a clip path outside stays');
});
test('SVG: embedded raster images are inspected like uploads and capped in number', () => {
  const bomb = dataUrl('image/png', mkPng(50000, 50000));
  const r = sanitizeSvg(`<svg viewBox="0 0 1 1"><image href="${bomb}" width="1" height="1"/><rect width="1" height="1"/></svg>`);
  assert.ok(r.ok && !/<image/.test(r.svg), 'a decompression-bomb image inside an SVG is dropped');
  const ten = '<svg viewBox="0 0 1 1">' + `<image href="${dataUrl('image/png', mkPng(2, 2))}" width="1" height="1"/>`.repeat(9) + '<rect/></svg>';
  assert.equal(sanitizeSvg(ten).ok, false);
});
test('orders page: SVG thumbnails are click-to-load, never decoded on page load', () => {
  const html = read('site/orders.html');
  assert.match(html, /data-svg="1"/); assert.match(html, /data-loadsvg/);
  assert.match(html, /if\(img\.dataset\.svg&&!photoCache\[[^\]]+\]\)continue;/);
});

/* ---------- CR-003: sizes are own properties, totals are real numbers ---------- */
test('size and tier lookups are own-property only; NaN totals are refused', async () => {
  assert.equal(own(SIZES, 'constructor'), undefined); assert.equal(own(SIZES, '__proto__'), undefined); assert.equal(own(SIZES, 'medium'), 14);
  assert.equal(tagUnitBase({ size: 'constructor', finish: 'red' }), 14);
  for (const size of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
    const r = await post({ ...base, tags: [{ shape: 'bone', size, finish: 'red', font: 'block', qty: 1, front1: 'a', back1: 'W', back2: '801-336-2244' }] });
    assert.equal(r.status, 200, size);
    assert.equal(r.data.totals.subtotal, 14, size + ' falls back to medium');
    assert.ok(Number.isFinite(r.data.totals.total));
    assert.equal(stored(r.env, r.data.id).tags[0].size, 'medium');
    const fc = await post({ ...base, tags: [fcTag({ size })] });
    assert.equal(fc.data.totals.subtotal, 14, 'full color: ' + size);
  }
  assert.ok(Number.isFinite(price([{ shape: 'bone', size: 'constructor', finish: 'red', qty: 1 }], [], 'ship').total));
});

/* ---------- CR-004: CSS escapes and non-url loaders ---------- */
test('style content with escapes, at-rules, image-set and src() is dropped; xmlns is pinned', () => {
  for (const css of ['a{background:u\\72l(https://evil.test/p.png)}', '@\\69mport "https://evil.test/a.css";', 'a{background:image-set("https://evil.test/p.png" 1x)}', 'a{background:-webkit-image-set(url(x) 1x)}', 'a{content:src(https://evil.test/x)}', '@font-face{src:url(https://evil.test/f.woff)}']) assert.equal(cleanCss(css), '', css);
  assert.equal(cleanCss('.a{fill:red;stroke:#fff}'), '.a{fill:red;stroke:#fff}');
  const r = sanitizeSvg('<svg viewBox="0 0 1 1" xmlns="http://www.w3.org/1999/xhtml" xmlns:xlink="http://evil.test/x"><style>.a{background:u\\72l(https://evil.test/p.png)}</style><rect style="background:image-set(&quot;https://evil.test/p.png&quot; 1x)" width="1" height="1"/><g xmlns="urn:evil"/></svg>');
  assert.equal(r.ok, true);
  assert.ok(!/evil/.test(r.svg));
  assert.ok(r.svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"'));
});

/* ---------- CR-005: raster inspection ---------- */
test('inspectRaster: verifies signatures, reads sizes, caps 12k px and 40 MP', () => {
  assert.deepEqual(inspectRaster(mkPng(640, 480)), { ok: true, mime: 'image/png', w: 640, h: 480 });
  assert.deepEqual(inspectRaster(mkJpeg(800, 600)), { ok: true, mime: 'image/jpeg', w: 800, h: 600 });
  for (const kind of ['VP8X', 'VP8L', 'VP8 ']) assert.deepEqual(inspectRaster(mkWebp(300, 200, kind)), { ok: true, mime: 'image/webp', w: 300, h: 200 }, kind);
  assert.equal(inspectRaster(mkPng(MAX_SIDE_PX, 3000)).ok, true);
  assert.equal(inspectRaster(mkPng(MAX_SIDE_PX + 1, 10)).ok, false, 'over 12k px a side');
  assert.equal(inspectRaster(mkPng(8000, 6000)).ok, false, '48 MP is over 40 MP');
  assert.equal(inspectRaster(mkPng(50000, 50000)).ok, false, 'the 304 KB bomb');
  assert.equal(inspectRaster(mkPng(0, 10)).ok, false);
  assert.equal(inspectRaster(Buffer.from('<html><body>not an image</body></html>')).ok, false);
  assert.equal(inspectRaster(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')).ok, false);
  assert.equal(inspectRaster(new Uint8Array(0)).ok, false);
  assert.equal(inspectRaster(Buffer.from([0xff, 0xd8, 0xff, 0xd9])).ok, false, 'a JPEG with no frame header');
});
test('order: HTML or SVG bytes labelled as a JPEG or PNG are refused, a bomb is refused, the detected type wins', async () => {
  for (const [mime, bytes] of [['image/jpeg', Buffer.from('<html>hi</html>')], ['image/png', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')], ['image/png', mkPng(50000, 50000)]]) {
    const r = await post({ ...base, tags: [fcTag({ art: 'upload', style: undefined, photoImage: dataUrl(mime, bytes), ack: true })] });
    assert.equal(r.status, 400, mime);
    assert.ok(![...r.env.ORDERS._m.keys()].some((k) => k.startsWith('photo:')));
  }
  const mislabeled = await post({ ...base, tags: [fcTag({ art: 'upload', style: undefined, photoImage: dataUrl('image/jpeg', mkPng(400, 300)), ack: true })] });
  assert.equal(mislabeled.status, 200);
  const t = stored(mislabeled.env, mislabeled.data.id).tags[0];
  assert.equal(t.photoMime, 'image/png'); assert.deepEqual(t.photoPx, [400, 300]);
});

/* ---------- CR-009 / CR-016 ---------- */
test('ornament lines over the cap are a 400, not silently dropped', async () => {
  const six = Array.from({ length: MAX_ORNAMENT_LINES + 1 }, (_, i) => orn({ name: 'Dog' + i }));
  assert.equal((await post({ ...base, ornaments: six })).status, 400);
  const five = Array.from({ length: MAX_ORNAMENT_LINES }, (_, i) => orn({ name: 'Dog' + i }));
  const ok = await post({ ...base, ornaments: five });
  assert.equal(ok.status, 200); assert.equal(stored(ok.env, ok.data.id).ornaments.length, MAX_ORNAMENT_LINES);
});
test('the engraved stainless photo tag needs the rights tick too, and keeps the record (CR-016)', async () => {
  const photoTag = { shape: 'bone', size: 'large', finish: 'polished', font: 'block', qty: 1, photo: true, photoImage: jpeg, back1: 'Whisky', back2: '801-336-2244' };
  const no = await post({ ...base, tags: [photoTag] });
  assert.equal(no.status, 400); assert.equal(no.data.field, 'artAck');
  const yes = await post({ ...base, tags: [{ ...photoTag, ack: true }] });
  assert.equal(yes.status, 200, JSON.stringify(yes.data));
  const t = stored(yes.env, yes.data.id).tags[0];
  assert.equal(t.ack.ownRights, true); assert.equal(t.ack.v, ART_ACK_VERSION);
});

/* ---------- B5, C1: wording version, hash of the file, TTL ---------- */
test('every stored image carries ack.v, the wording hash, the file SHA-256, a 120-day TTL and an expiry', async () => {
  const buf = mkPng(500, 400);
  const r = await post({ ...base, tags: [fcTag({ art: 'upload', style: undefined, photoImage: dataUrl('image/png', buf), ack: true })], ornaments: [orn()] });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const o = stored(r.env, r.data.id);
  assert.equal(o.tags[0].photoSha256, await sha256Hex(buf));
  assert.equal(o.tags[0].ack.h, (await sha256Hex(ART_ACK_TEXT)).slice(0, 16));
  for (const key of [`photo:${r.data.id}:0`, `photo:${r.data.id}:100`]) assert.equal(r.env.ORDERS._m.get(key).ttl, PHOTO_TTL_SECONDS);
  assert.equal(PHOTO_TTL_SECONDS, 120 * 86400);
  assert.ok(Math.abs(o.tags[0].photoExpiresAt - (Date.now() + PHOTO_TTL_SECONDS * 1000)) < 60000);
  assert.match(o.ornaments[0].photoSha256, /^[0-9a-f]{64}$/); assert.equal(o.ornaments[0].ack.v, ART_ACK_VERSION);
});

/* ---------- B6: no card checkout before review ---------- */
test('canPayOnline is false for any order that carries a customer image', () => {
  const plain = { prints: [], tags: [{ photo: false }], ornaments: [{ photo: false, art: 'design' }] };
  assert.equal(canPayOnline(plain), true);
  assert.equal(canPayOnline({ ...plain, tags: [{ photo: true, art: 'upload' }] }), false);
  assert.equal(canPayOnline({ ...plain, ornaments: [{ photo: true, art: 'upload' }] }), false);
  assert.equal(canPayOnline({ ...plain, ornaments: [{ tier: 'stainless', art: 'upload' }] }), false);
  assert.equal(canPayOnline({ ...plain, tags: [{ finish: 'polished', photo: true }] }), false, 'the engraved photo tag too');
});
test('with card checkout live, an order with an upload is saved for review (no Clover session); a plain order still gets one', async () => {
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => { calls.push(String(url)); return new Response(JSON.stringify({ href: 'https://pay.test/x', checkoutSessionId: 'cs1' }), { status: 200 }); };
  try {
    const live = { CLOVER_ECOMM_TOKEN: 't', CLOVER_MERCHANT_ID: 'm', CHECKOUT_LIVE: 'true' };
    const up = await post({ ...base, tags: [fcTag({ art: 'upload', style: undefined, photoImage: jpeg, ack: true })] }, live);
    assert.equal(up.status, 200); assert.equal(up.data.mode, 'invoice'); assert.equal(up.data.payUrl, null);
    assert.equal(calls.length, 0, 'no checkout session was created');
    const plain = await post({ ...base, tags: [fcTag()] }, live);
    assert.equal(plain.data.mode, 'card'); assert.equal(calls.length, 1);
  } finally { globalThis.fetch = realFetch; }
});

/* ---------- C1: decline ---------- */
test('owner Decline: image deleted at once, item flagged, ack and SHA stay, customer emailed with the policy wording, unpaid sole item cancels the order', async () => {
  const r = await post({ ...base, tags: [fcTag({ art: 'upload', style: undefined, photoImage: jpeg, ack: true })] });
  const id = r.data.id; const env = r.env;
  assert.ok(env.ORDERS._m.has(`photo:${id}:0`));
  const sent = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => { sent.push(JSON.parse(init.body)); return new Response(JSON.stringify({ id: 'em_1' }), { status: 200 }); };
  try {
    const bad = await owner(env, { id, action: 'decline', item: 'o0' });
    assert.equal(bad.status, 400);
    const d = await owner({ ...env, RESEND_API_KEY: 're_test' }, { id, action: 'decline', item: 't0' });
    assert.equal(d.status, 200); assert.equal(d.data.emailed, true); assert.equal(d.data.imageDeleted, true);
    assert.ok(!env.ORDERS._m.has(`photo:${id}:0`), 'the image is gone');
    const o = stored(env, id);
    assert.ok(o.tags[0].declined.at > 0); assert.equal(o.tags[0].ack.ownRights, true); assert.match(o.tags[0].photoSha256, /^[0-9a-f]{64}$/);
    assert.equal(o.status, 'cancelled');
    assert.equal(sent.length, 1);
    assert.match(sent[0].subject, /About your artwork/); assert.match(sent[0].text, /Your invoice is cancelled and nothing is charged/);
    assert.match(sent[0].text, /We never print declined art/);
    const again = await owner({ ...env, RESEND_API_KEY: 're_test' }, { id, action: 'decline', item: 't0' });
    assert.equal(again.status, 409);
  } finally { globalThis.fetch = realFetch; }
  const unauth = await ownerPost({ request: new Request('https://x.test/api/orders', { method: 'POST', body: '{}' }), env: { ORDERS: kv(), ADMIN_KEY: 'adminkey' } });
  assert.equal(unauth.status, 401);
});
test('declineEmail: unpaid and paid wording', () => {
  const o = { id: 'SDT-ABCD', customer: { name: 'Nick Roper' } };
  assert.match(declineEmail(o, { what: 'your bone tag', paid: false }).text, /invoice is cancelled and nothing is charged/);
  assert.match(declineEmail(o, { what: 'your bone tag', paid: true }).text, /refund the declined item, plus its share of shipping and tax, to your card within 3 business days/);
});

/* ---------- C4: 18+ ---------- */
test('adult:true is recorded on a tag only when the client says 18+ wording is on it', async () => {
  const a = await post({ ...base, tags: [fcTag({ adult: true })] });
  assert.equal(stored(a.env, a.data.id).tags[0].adult, true);
  for (const adult of [false, 'true', 1, undefined]) { const b = await post({ ...base, tags: [fcTag({ adult })] }); assert.equal(stored(b.env, b.data.id).tags[0].adult, undefined); }
});

/* ---------- CR-006: emails ---------- */
test('confirmation and shipped emails are ornament-aware; classic engraved orders keep their copy', () => {
  const ornOnly = { id: 'SDT-ORNA', customer: { name: 'A B', email: 'a@b.co', delivery: 'ship' }, tags: [], prints: [], ornaments: [{ tier: 'acrylic', name: 'Whisky', year: '2026', qty: 1, photo: true }], totals: { total: 24 } };
  const c = orderConfirmEmail(ornOnly), s = shippedEmail(ornOnly, { photoUrl: '', tracking: '' });
  for (const [label, m] of [['confirm', c], ['shipped', s]]) {
    assert.ok(!/laser|mis-engrave|Typo on the tag|engraved|On the tag/i.test(m.text.replace('Holiday pet photo ornament, full-color printed acrylic', '')), label + ': ' + m.text);
    assert.match(m.text, /ornament/i);
  }
  assert.match(c.text, /check it by hand before the invoice goes out/);
  assert.ok(!/On the tag/.test(s.html), 'no empty "On the tag" block');
  assert.match(s.text, /If we misprint it, we remake it free/);
  const classic = { id: 'SDT-CLAS', customer: { name: 'A B', email: 'a@b.co', delivery: 'ship' }, tags: [{ shape: 'bone', size: 'medium', finish: 'red', qty: 1, front: ['x'], back: ['Whisky'] }], prints: [], totals: { total: 14 } };
  assert.match(orderConfirmEmail(classic).text, /Typo on the tag\? Reply now, before the laser gets to it\./);
  assert.match(shippedEmail(classic, {}).text, /We engraved it/);
  const mixed = { ...classic, ornaments: ornOnly.ornaments };
  assert.ok(!/Typo on the tag/.test(orderConfirmEmail(mixed).text));
});

/* ---------- CR-011 ---------- */
test('Clover note says what the art is, per path and style', () => {
  const note = (t) => checkoutLineItems({}, { customer: { name: 'A B', email: 'a@b.co', delivery: 'ship', state: 'FL' }, tags: [{ shape: 'bone', size: 'medium', finish: 'fullcolor', qty: 1, front: ['x'], back: ['y'], ...t }], prints: [], totals: { multi: false, prize: 0, shipping: 0 } })[0].note;
  assert.match(note({ art: 'design', style: 'bold' }), /bold type style/); assert.ok(!/photo on front/i.test(note({ art: 'design', style: 'bold' })));
  assert.match(note({ art: 'design', style: 'synthwave' }), /synthwave style/);
  assert.match(note({ art: 'design', style: 'mascot' }), /bulldog mascot style/);
  assert.match(note({ art: 'design', style: 'photo', photo: true }), /photo \+ saying/);
  assert.match(note({ art: 'upload', photo: true }), /customer image or artwork/);
});

/* ---------- CR-008 + B4: dates ---------- */
test('every Dec 12 on the site is the full Lady Jaye wording; hero and FAQ are verbatim; Dec 4 / 14 / 16 / 17 as written', () => {
  const html = ORN_HTML, home = withOrnamentHome(read('site/index.html'));
  const HERO = 'Order by Sat, Dec 12 and pay your invoice by Mon, Dec 14 for Christmas in the lower 48.';
  assert.ok(html.includes(HERO) && home.includes(HERO));
  assert.ok(html.includes("Order by Sat, Dec 12 and pay your invoice by Mon, Dec 14, and we ship by Wed, Dec 16, ahead of USPS's Dec 17 Ground Advantage date for Christmas delivery in the lower 48. USPS sets delivery, so we can't promise a day. Alaska and Hawaii take 10+ days: order by Fri, Dec 4. Put your deadline in the order notes."));
  for (const f of files.filter((x) => /site\//.test(x) && !/\.xml$/.test(x))) {
    for (const m of readFileSync(f, 'utf8').matchAll(/.{0,12}Dec 12/g)) assert.ok(/Sat, Dec 12$/.test(m[0]), `${f.slice(ROOT.length + 1)}: bare "Dec 12": ${m[0]}`);
  }
  assert.match(read('site/app.js'), /const ORNAMENT_CUTOFF = 'Sat, Dec 12';/);
});

/* ---------- B5 / B6 / C8 / C9 / C1: policy and privacy text ---------- */
test('policies and privacy carry the Lady Jaye text, linked from the rights tick', () => {
  const pol = read('tools/content/policies.md'), priv = read('tools/content/privacy.md'), page = read('site/policies/index.html');
  assert.match(pol, /\{#artwork\}/); assert.match(page, /id="artwork"/);
  for (const t of [
    "**Your order is accepted** once you've paid and we've approved any uploaded art. If we decline it (see Artwork), you pay nothing or get a full refund. You must be 18 or older to order, or have a parent or guardian order for you.",
    'Every tag and ornament is made just for you, so no returns.',
    "**Full-color printed tags.** Printed color isn't as tough as engraving.",
    '**Gifts.** The buyer is our customer for the invoice, approvals and remakes.',
    "**What you can send:** photos you took, art you made, or images whose owner gave you permission to have them printed.",
    '**People in photos:** fine, if everyone shown agreed to be on it. For anyone under 18, a parent or guardian must agree.',
    '**You keep ownership.**', '**Your promise:** ticking the artwork box confirms the rules above.', '**What we decline:** we check every upload by hand.', '**If we decline:** we email you within 2 business days.',
    '**Rights complaints:**', '**How long we keep images:** uploaded images are deleted within 120 days of your order, and declined images within 7 days.',
  ]) assert.ok(pol.includes(t), t.slice(0, 50));
  assert.ok(priv.includes("Uploaded photos and artwork (tags and ornaments): deleted within 120 days of your order; declined uploads within 7 days. We keep your rights confirmation, its time, and a file fingerprint for 3 years. If you ship a gift, we use the recipient's name and address only to deliver it."));
  assert.match(pol, /Last updated: November 17, 2026/); assert.match(priv, /Effective date: November 16, 2026/);
  const app = read('site/app.js');
  assert.ok(app.includes("I took this photo or made this art, or I have permission from whoever did to have it printed. It has no logos, team names or characters I don't have rights to, and everyone in it agreed (a parent or guardian for kids). I agree to the [artwork terms](/policies/#artwork)."));
});

/* ---------- CR-017: neutral checkout copy ---------- */
test('checkout copy does not say engraved for an ornament-only cart', () => {
  const home = read('site/index.html');
  assert.ok(!/Engraved in Lehi, Utah and shipped USPS/.test(home));
  assert.match(home, /Shipped USPS from Lehi, Utah/);
  assert.ok(!/We start engraving/.test(home) && !/We start engraving/.test(read('site/app.js')));
});

/* ---------- laser queue (CR-007) is tested in laser/test/generate.test.mjs ---------- */
