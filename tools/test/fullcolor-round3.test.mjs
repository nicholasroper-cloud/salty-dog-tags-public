// node --test tools/test/
// Round 3 (Flint recheck R-1..R-5): filter and group-depth render cost, pay.js wording, partial decline, hasCustomerImage, server-side 18+ flag.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeSvg, cleanCss, dashBad } from '../../functions/api/_svg.js';
import { onRequestPost as place } from '../../functions/api/order.js';
import { onRequestPost as pay } from '../../functions/api/pay.js';
import { onRequestPost as ownerPost } from '../../functions/api/orders.js';
import { hasCustomerImage, canPayOnline, adultText, ADULT_WORDS_RE, price } from '../../functions/api/_lib.js';
import { declineEmail } from '../../functions/api/_email.js';
import { SAYINGS } from '../../functions/api/_sayings.js';
import { mkJpeg, dataUrl } from './_images.mjs';

function kv({ failPhotoDelete = false } = {}) {
  const m = new Map();
  return {
    get: async (k) => m.get(k)?.v ?? null,
    delete: async (k) => { if (failPhotoDelete && k.startsWith('photo:')) throw new Error('kv down'); m.delete(k); },
    put: async (k, v, o) => { m.set(k, { v, meta: o && o.metadata, ttl: o && o.expirationTtl }); },
    getWithMetadata: async (k) => ({ value: m.get(k)?.v ?? null, metadata: m.get(k)?.meta ?? null }),
    list: async ({ prefix = '' } = {}) => ({ keys: [...m.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true }),
    _m: m,
  };
}
let ipN = 40;
async function post(body, env = {}, orders = kv()) {
  const e = { ORDERS: orders, ORNAMENTS_ON: 'true', ...env };
  const res = await place({ request: new Request('https://x.test/api/order', { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': '192.0.2.' + (++ipN % 250) }, body: JSON.stringify(body) }), env: e, waitUntil() {} });
  return { status: res.status, data: await res.json(), env: e };
}
const owner = (env, body) => ownerPost({ request: new Request('https://x.test/api/orders', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer adminkey' }, body: JSON.stringify(body) }), env: { ADMIN_KEY: 'adminkey', ...env } }).then(async (r) => ({ status: r.status, data: await r.json() }));
const jpeg = dataUrl('image/jpeg', mkJpeg(800, 600));
const base = { name: 'Nick Roper', email: 'n@example.com', delivery: 'ship', street: '123 Main St', city: 'Lehi', state: 'FL', zip: '33601' };
const fcTag = (extra = {}) => ({ shape: 'bone', size: 'medium', finish: 'fullcolor', font: 'block', qty: 1, front1: 'Built like', front2: 'a loaf.', back1: 'Whisky', back2: '801-336-2244', art: 'design', style: 'bold', ...extra });
const upTag = (extra = {}) => fcTag({ art: 'upload', style: undefined, photoImage: jpeg, ack: true, ...extra });
const orn = (extra = {}) => ({ tier: 'acrylic', name: 'Whisky', year: '2026', qty: 1, art: 'design', style: 'bold', ...extra });
const stored = (env, id) => JSON.parse(env.ORDERS._m.get('order:' + id).v);

/* ---------- R-1 ---------- */
test('R-1: the 2000-nested-filter payload (66 KB) is refused, not accepted', () => {
  const src = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">' + '<g style="filter:blur(30px)">'.repeat(2000) + '<rect width="10" height="10"/>' + '</g>'.repeat(2000) + '</svg>';
  assert.ok(src.length > 60000);
  const r = sanitizeSvg(src);
  assert.equal(r.ok, false);
  assert.match(r.error, /too complex/);
});
test('R-1: group nesting is capped at 16 and the total at 500', () => {
  const nest = (n) => '<svg viewBox="0 0 10 10">' + '<g>'.repeat(n) + '<rect width="1" height="1"/>' + '</g>'.repeat(n) + '</svg>';
  assert.equal(sanitizeSvg(nest(16)).ok, true);
  assert.equal(sanitizeSvg(nest(17)).ok, false);
  assert.equal(sanitizeSvg('<svg viewBox="0 0 10 10">' + '<g><rect width="1" height="1"/></g>'.repeat(500) + '</svg>').ok, true);
  assert.equal(sanitizeSvg('<svg viewBox="0 0 10 10">' + '<g><rect width="1" height="1"/></g>'.repeat(501) + '</svg>').ok, false);
  assert.equal(sanitizeSvg('<svg viewBox="0 0 10 10">' + '<g/>'.repeat(501) + '<rect/></svg>').ok, false);
});
test('R-1: filter is not an allowed CSS property (attribute, style attribute, style block, backdrop and webkit forms)', () => {
  const r = sanitizeSvg('<svg viewBox="0 0 10 10"><style>.a{filter:blur(9px);fill:red}.b{-webkit-filter:blur(5px)}.c{backdrop-filter:blur(3px);stroke:blue}</style><rect class="a" style="filter:blur(30px);fill:green" filter="url(#f)" width="1" height="1"/></svg>');
  assert.equal(r.ok, true);
  assert.ok(!/filter/i.test(r.svg), r.svg);
  assert.ok(r.svg.includes('fill:red') && r.svg.includes('fill:green') && r.svg.includes('stroke:blue'), 'the rest of the style stays');
  assert.equal(cleanCss('.a{filter: blur(2px); fill:red}'), '.a{ fill:red}');
});
test('R-1: tiny stroke-dasharray values are dropped (attribute and CSS), normal dashes stay', () => {
  assert.equal(dashBad('0.00001 0.00001'), true); assert.equal(dashBad('0.05'), true);
  assert.equal(dashBad('4 2'), false); assert.equal(dashBad('0.1 0.1'), false); assert.equal(dashBad('0 6'), false);
  const r = sanitizeSvg('<svg viewBox="0 0 10 10"><style>.a{stroke-dasharray:0.00001 0.00001;fill:red}</style><rect stroke-dasharray="0.00001 0.00001" width="1" height="1"/><rect class="a" style="stroke-dasharray:0.0001" stroke-dasharray="4 2" width="1" height="1"/></svg>');
  assert.equal(r.ok, true);
  assert.ok(!/0\.0000?1|0\.0001/.test(r.svg), r.svg);
  assert.ok(r.svg.includes('stroke-dasharray="4 2"') && r.svg.includes('fill:red'));
});

/* ---------- R-2 ---------- */
test('R-2: /api/pay on an image order says the art is checked first', async () => {
  const live = { CLOVER_ECOMM_TOKEN: 't', CLOVER_MERCHANT_ID: 'm', CHECKOUT_LIVE: 'true' };
  const up = await post({ ...base, tags: [upTag()] }, live);
  assert.equal(up.status, 200);
  const r = await pay({ request: new Request('https://x.test/api/pay', { method: 'POST', body: JSON.stringify({ id: up.data.id, email: base.email }) }), env: up.env });
  assert.equal(r.status, 409);
  assert.equal((await r.json()).error, 'We check your artwork first, then email you an invoice.');
});

/* ---------- R-4 ---------- */
test('R-4: hasCustomerImage keys on photo, art:upload and style:photo, for tags and ornaments', () => {
  const none = { prints: [], tags: [{ art: 'design', style: 'bold' }], ornaments: [{ art: 'design', style: 'bold' }] };
  assert.equal(hasCustomerImage(none), false); assert.equal(canPayOnline(none), true);
  for (const o of [{ tags: [{ art: 'upload' }] }, { tags: [{ style: 'photo' }] }, { tags: [{ photo: true }] }, { ornaments: [{ art: 'upload' }] }, { ornaments: [{ style: 'photo' }] }, { ornaments: [{ photo: true }] }]) {
    const order = { prints: [], tags: [], ornaments: [], ...o };
    assert.equal(hasCustomerImage(order), true, JSON.stringify(o)); assert.equal(canPayOnline(order), false);
  }
});

/* ---------- R-3 ---------- */
test('R-3: declineEmail wording follows the deletion result and the items that remain', () => {
  const o = { id: 'SDT-ABCD', customer: { name: 'Nick Roper' } };
  const t = (p) => declineEmail(o, { what: 'your bone tag', ...p }).text;
  assert.match(t({ deleted: true }), /we have deleted the file/);
  assert.match(t({ deleted: false }), /we are deleting the file/); assert.ok(!/we have deleted the file/.test(t({ deleted: false })));
  assert.match(t({ paid: false }), /Your invoice is cancelled and nothing is charged/);
  const left = t({ paid: false, remaining: { total: 24 } });
  assert.ok(!/invoice is cancelled/.test(left)); assert.match(left, /taken that item off your order/); assert.match(left, /\$24\.00 before tax/);
  const paidLeft = t({ paid: true, remaining: { total: 24 } });
  assert.match(paidLeft, /rest of your order goes ahead/); assert.ok(!/invoice is cancelled/.test(paidLeft));
});
test('R-3: a partial decline leaves the order open, stores the remaining total, and emails accordingly; a failed delete is reported', async () => {
  const sent = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => { sent.push(JSON.parse(init.body)); return new Response(JSON.stringify({ id: 'em' }), { status: 200 }); };
  try {
    const r = await post({ ...base, tags: [upTag()], ornaments: [orn()] }, { RESEND_API_KEY: 're_x' });
    const id = r.data.id, env = { ...r.env, RESEND_API_KEY: 're_x' };
    const before = stored(env, id).totals;
    const d = await owner(env, { id, action: 'decline', item: 't0' });
    assert.equal(d.status, 200);
    const o = stored(env, id);
    assert.notEqual(o.status, 'cancelled', 'an ornament is still on the order');
    assert.deepEqual(o.totals, before, 'order.totals is not rewritten');
    assert.equal(o.remaining.subtotal, 24); assert.equal(o.remaining.total, price([], [], 'ship', false, [{ tier: 'acrylic', qty: 1 }]).total);
    assert.match(sent[0].text, /taken that item off your order/); assert.ok(!/invoice is cancelled/.test(sent[0].text));
    assert.match(sent[0].text, /we have deleted the file/);
    // second order: the delete fails
    const bad = await post({ ...base, tags: [upTag()] }, { RESEND_API_KEY: 're_x' }, kv({ failPhotoDelete: true }));
    const d2 = await owner({ ...bad.env, RESEND_API_KEY: 're_x' }, { id: bad.data.id, action: 'decline', item: 't0' });
    assert.equal(d2.data.imageDeleted, false);
    assert.match(sent[1].text, /we are deleting the file/);
    assert.equal(stored(bad.env, bad.data.id).tags[0].declined.imageDeleted, false);
  } finally { globalThis.fetch = realFetch; }
});

/* ---------- R-5 ---------- */
test('R-5: typed profanity sets adult:true on the server; the client flag still works; innocent words do not trip it', async () => {
  const cat = SAYINGS.filter((x) => x.x).map((x) => x.l.join(' ').toLowerCase()).join(' | ');
  for (const w of ['fuck', 'shit', 'bitch', 'asshole', 'dick', 'cock', 'piss', 'bastard', 'slut']) assert.ok(cat.includes(w), `"${w}" must come from the 18+ catalog`);
  assert.equal(adultText(['Zero fucks.', 'Zero balls.']), true);
  assert.equal(adultText(['Holy sh1t', 'my dog']), true);
  assert.equal(adultText(["Mom's a bitch"]), true);
  assert.equal(adultText(['Cockblocker.', 'Professional.']), true, 'an exact 18+ catalog saying');
  assert.equal(adultText(['NOT', 'LOST.', 'ON A BENDER']), false);
  for (const clean of ['Cocker spaniel', 'Scunthorpe Classic', 'Assistant to the manager', 'Dickens fan', 'Built like a loaf', 'Class clown', 'Bass player']) assert.equal(adultText([clean]), false, clean);
  assert.ok(ADULT_WORDS_RE.test('FUCK'));
  const typed = await post({ ...base, tags: [fcTag({ front1: 'Zero fucks.', front2: 'Full chaos.' })] });
  assert.equal(stored(typed.env, typed.data.id).tags[0].adult, true);
  const clean = await post({ ...base, tags: [fcTag()] });
  assert.equal(stored(clean.env, clean.data.id).tags[0].adult, undefined);
  const client = await post({ ...base, tags: [fcTag({ adult: true })] });
  assert.equal(stored(client.env, client.data.id).tags[0].adult, true);
  const name = await post({ ...base, ornaments: [orn({ name: 'Shithead' })] });
  assert.equal(stored(name.env, name.data.id).ornaments[0].adult, true);
  const plainOrn = await post({ ...base, ornaments: [orn()] });
  assert.equal(stored(plainOrn.env, plainOrn.data.id).ornaments[0].adult, undefined);
});
