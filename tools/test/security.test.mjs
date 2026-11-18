// node --test tools/test/
// Security fixes from the 2026-11-15 review: scores token, prints price trust, prize burn, webhook, CORS, secret compare.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { safeEqual, readObject, hmacHex, saltedIpHash } from '../../functions/api/_security.js';
import { isAdmin, payEnabled, corsHeaders, handlePreflight } from '../../functions/api/_lib.js';
import { onRequestGet as mint, onRequestPost as claim } from '../../functions/api/scores.js';
import { onRequestPost as order } from '../../functions/api/order.js';
import { onRequestPost as hook } from '../../functions/api/clover-webhook.js';
import { onRequestGet as config } from '../../functions/api/config.js';

function kv() { const m = new Map(); return { get: async (k) => m.get(k) ?? null, put: async (k, v) => { m.set(k, v); }, delete: async (k) => { m.delete(k); }, getWithMetadata: async (k) => ({ value: m.get(k) ?? null, metadata: null }), _m: m }; }
const SALT = 'test-salt-0123456789abcdef';
const SECRET = 'play-secret-0123456789abcdef-xyz';
const b64url = (s) => btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const req = (method, body, ip = '203.0.113.9', headers = {}) => new Request('https://x.test/api/x', { method, headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip, ...headers }, body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)) });
async function token(secret, ageMs, id = 'a1b2c3d4e5f60718293a4b5c') {
  const payload = JSON.stringify({ id, iat: Date.now() - ageMs });
  return b64url(payload) + '.' + (await hmacHex(secret, payload));
}

test('safeEqual: equal, different, different length, empty', () => {
  assert.equal(safeEqual('abc', 'abc'), true);
  assert.equal(safeEqual('abc', 'abd'), false);
  assert.equal(safeEqual('abc', 'abcd'), false);
  assert.equal(safeEqual('', ''), true);
  assert.equal(safeEqual('abc', undefined), false);
});

test('isAdmin: constant-time path still accepts the key and rejects everything else', () => {
  const env = { ADMIN_KEY: 'k'.repeat(24) };
  const r = (h) => new Request('https://x.test/', { headers: h });
  assert.equal(isAdmin(r({ authorization: 'Bearer ' + env.ADMIN_KEY }), env), true);
  assert.equal(isAdmin(r({ authorization: 'Bearer nope' }), env), false);
  assert.equal(isAdmin(r({}), env), false);
  assert.equal(isAdmin(r({ authorization: 'Bearer ' }), { ADMIN_KEY: '' }), false);
});

test('readObject: null, arrays, scalars and bad json are 400, not a thrown 500', async () => {
  for (const b of ['null', '[]', '5', '"x"', '{nope']) assert.equal((await readObject(req('POST', b))).status, 400, b);
  assert.deepEqual((await readObject(req('POST', '{"a":1}'))).body, { a: 1 });
  assert.equal((await readObject(req('POST', 'x'.repeat(50)), 10)).status, 413);
});

test('scores: no PLAY_SECRET means no tokens and no prize codes (fail closed), ADMIN_KEY is never used as a fallback', async () => {
  const env = { ORDERS: kv(), ADMIN_KEY: 'admin-key-should-not-sign-anything' };
  assert.equal((await mint({ request: req('GET'), env })).status, 503);
  const t = await token(env.ADMIN_KEY, 120000);
  const res = await claim({ request: req('POST', { score: 9000, token: t }), env });
  assert.equal((await res.json()).code, null);
});

test('scores: a token signed with ADMIN_KEY is rejected when PLAY_SECRET is the real secret', async () => {
  const env = { ORDERS: kv(), ADMIN_KEY: 'admin-key-0123456789abcdef-xyz', PLAY_SECRET: SECRET, IP_SALT: SALT };
  const bad = await token(env.ADMIN_KEY, 120000);
  assert.equal((await (await claim({ request: req('POST', { score: 9000, token: bad }), env })).json()).code, null);
});

test('scores: valid token wins one code, replay and second token from the same IP are refused, young tokens are refused', async () => {
  const env = { ORDERS: kv(), PLAY_SECRET: SECRET, IP_SALT: SALT };
  const minted = await (await mint({ request: req('GET'), env })).json();
  assert.ok(minted.token);
  // freshly minted token: too young
  assert.equal((await (await claim({ request: req('POST', { score: 9000, token: minted.token }), env })).json()).code, null);
  const t1 = await token(SECRET, 120000, 'aaaaaaaaaaaaaaaaaaaaaaaa');
  const w = await (await claim({ request: req('POST', { score: 9000, token: t1 }), env })).json();
  assert.match(w.code, /^SDT-UP-[A-Z2-9]{4}$/); assert.equal(w.prize, 'won');
  const replay = await (await claim({ request: req('POST', { score: 9000, token: t1 }), env })).json();
  assert.equal(replay.code, null); assert.equal(replay.prize, 'already-claimed');
  // a second win from the same IP is allowed once more, a third is not (cap 2/day/IP)
  const t2 = await token(SECRET, 120000, 'bbbbbbbbbbbbbbbbbbbbbbbb'), t3 = await token(SECRET, 120000, 'cccccccccccccccccccccccc');
  assert.equal((await (await claim({ request: req('POST', { score: 9000, token: t2 }), env })).json()).prize, 'won');
  assert.equal((await (await claim({ request: req('POST', { score: 9000, token: t3 }), env })).json()).prize, 'already-claimed');
  // a different network is a different budget
  assert.equal((await (await claim({ request: req('POST', { score: 9000, token: await token(SECRET, 120000, 'dddddddddddddddddddddddd') }, '198.51.100.7'), env })).json()).prize, 'won');
});

test('scores: daily site-wide cap, tampered token, null body', async () => {
  const env = { ORDERS: kv(), PLAY_SECRET: SECRET, IP_SALT: SALT, PRIZE_DAILY_CAP: '1' };
  assert.equal((await (await claim({ request: req('POST', { score: 9000, token: await token(SECRET, 120000, 'eeeeeeeeeeeeeeeeeeeeeeee') }, '192.0.2.1'), env })).json()).prize, 'won');
  assert.equal((await (await claim({ request: req('POST', { score: 9000, token: await token(SECRET, 120000, 'ffffffffffffffffffffffff') }, '192.0.2.2'), env })).json()).prize, 'sold-out');
  const t = await token(SECRET, 120000, '0123456789abcdef01234567');
  const tampered = t.slice(0, -2) + (t.endsWith('00') ? '11' : '00');
  assert.equal((await (await claim({ request: req('POST', { score: 9000, token: tampered }, '192.0.2.3'), env })).json()).code, null);
  assert.equal((await claim({ request: req('POST', 'null'), env })).status, 400);
});

test('scores: minting is capped per IP', async () => {
  const env = { ORDERS: kv(), PLAY_SECRET: SECRET, IP_SALT: SALT };
  let last;
  for (let i = 0; i < 21; i++) last = (await mint({ request: req('GET', undefined, '203.0.113.50'), env })).status;
  assert.equal(last, 429);
  assert.equal((await mint({ request: req('GET', undefined, '203.0.113.51'), env })).status, 200);
});

const goodTag = { shape: 'bone', size: 'medium', finish: 'stainless', font: 'block', icon: 'none', qty: 1, front1: 'Built like', front2: 'a loaf.', back1: 'Whisky', back2: '801-336-2244' };
const goodBody = { name: 'Nick Roper', email: 'n@example.com', delivery: 'ship', street: '123 Main St', city: 'Lehi', state: 'UT', zip: '84043', tags: [goodTag] };
const place = async (body, env, ip) => { const r = await order({ request: req('POST', body, ip), env, waitUntil() {} }); return { status: r.status, data: await r.json() }; };

test('order: prints are refused (client price is never trusted) and a null body is a 400', async () => {
  const env = { ORDERS: kv() };
  const r = await place({ ...goodBody, prints: [{ item: 'Free print', price: 0.01, qty: 20 }] }, env);
  assert.equal(r.status, 400); assert.match(r.data.error, /quoted by email/);
  assert.equal((await place('null', env)).status, 400);
  assert.equal((await place({ ...goodBody, tags: [null, goodTag] }, env)).status, 200);
});

test('order: ipHash is stored only when IP_SALT is set', async () => {
  const a = await place(goodBody, { ORDERS: kv() }); const kvA = kv();
  assert.equal(a.status, 200);
  const envB = { ORDERS: kv(), IP_SALT: SALT };
  const b = await place(goodBody, envB);
  assert.match(JSON.parse(envB.ORDERS._m.get('order:' + b.data.id)).ipHash, /^[0-9a-f]{24}$/);
  const envC = { ORDERS: kv() };
  const c = await place(goodBody, envC);
  assert.equal(JSON.parse(envC.ORDERS._m.get('order:' + c.data.id)).ipHash, undefined);
  assert.equal(await saltedIpHash({}, req('POST', {})), null);
});

test('order: prize code burns once, concurrent use fails, and used vs invalid read the same', async () => {
  const env = { ORDERS: kv(), IP_SALT: SALT };
  env.ORDERS._m.set('prize:SDT-UP-ABCD', JSON.stringify({ used: false }));
  const first = await place({ ...goodBody, prize: 'SDT-UP-ABCD' }, env);
  assert.equal(first.status, 200, JSON.stringify(first.data));
  assert.ok(env.ORDERS._m.get('prizeclaim:SDT-UP-ABCD'));
  const again = await place({ ...goodBody, prize: 'SDT-UP-ABCD' }, env);
  const unknown = await place({ ...goodBody, prize: 'SDT-UP-ZZZZ' }, env);
  const malformed = await place({ ...goodBody, prize: 'nope' }, env);
  assert.equal(again.status, 400);
  assert.equal(again.data.error, unknown.data.error);
  assert.equal(again.data.error, malformed.data.error);
  // a claim key alone (an in-flight redemption) blocks a second order even before the record flips to used
  env.ORDERS._m.set('prize:SDT-UP-WXYZ', JSON.stringify({ used: false }));
  env.ORDERS._m.set('prizeclaim:SDT-UP-WXYZ', 'SDT-OTHER');
  assert.equal((await place({ ...goodBody, prize: 'SDT-UP-WXYZ' }, env)).status, 400);
});

test('order: code guessing is rate limited per IP', async () => {
  const env = { ORDERS: kv(), IP_SALT: SALT };
  let last; for (let i = 0; i < 14; i++) last = await place({ ...goodBody, prize: 'SDT-UP-AAA' + (i % 9) }, env, '203.0.113.77');
  assert.equal(last.status, 429);
});

test('payEnabled / config: needs CHECKOUT_LIVE=true on top of the Clover secrets', async () => {
  const base = { CLOVER_ECOMM_TOKEN: 't', CLOVER_MERCHANT_ID: 'm' };
  assert.equal(payEnabled(base), false);
  assert.equal(payEnabled({ ...base, CHECKOUT_LIVE: 'false' }), false);
  assert.equal(payEnabled({ ...base, CHECKOUT_LIVE: 'true' }), true);
  assert.equal(payEnabled({ CHECKOUT_LIVE: 'true' }), false);
  assert.deepEqual(await (await config({ env: base })).json(), { pay: false });
  assert.deepEqual(await (await config({ env: { ...base, CHECKOUT_LIVE: 'true' } })).json(), { pay: true });
});

test('CORS: exact origins only, no pages.dev wildcard', () => {
  const r = (o) => new Request('https://saltydogtags.com/api/roast', { headers: o ? { origin: o } : {} });
  assert.equal(corsHeaders(r('https://saltydogtags.com'), {})['Access-Control-Allow-Origin'], 'https://saltydogtags.com');
  assert.equal(corsHeaders(r('https://www.saltydogtags.com'), {})['Access-Control-Allow-Origin'], 'https://www.saltydogtags.com');
  for (const bad of ['https://evil.pages.dev', 'https://salty-dog-tags.pages.dev', 'http://saltydogtags.com', 'https://saltydogtags.com.evil.test', 'null']) assert.deepEqual(corsHeaders(r(bad), {}), {}, bad);
  assert.equal(handlePreflight(r('https://evil.pages.dev'), {}).status, 403);
  assert.equal(handlePreflight(r('https://saltydogtags.com'), {}).status, 204);
  assert.equal(corsHeaders(r('https://preview.example.test'), { ALLOWED_ORIGINS: 'https://preview.example.test' })['Access-Control-Allow-Origin'], 'https://preview.example.test');
});

/* ---- webhook ---- */
const WH = 'wh-secret-0123456789';
async function webhook(env, payload) {
  const raw = JSON.stringify(payload), t = String(Math.floor(Date.now() / 1000));
  const sig = await hmacHex(WH, t + '.' + raw);
  const sent = [];
  const r = await hook({ request: new Request('https://x.test/api/clover-webhook', { method: 'POST', headers: { 'Clover-Signature': `t=${t},v1=${sig}` }, body: raw }), env, waitUntil: (p) => sent.push(p) });
  await Promise.all(sent);
  return r.json();
}
function seed(status = 'new', total = 14) {
  const env = { ORDERS: kv(), CLOVER_WEBHOOK_SECRET: WH };
  env.ORDERS._m.set('cs:SESS1', 'SDT-TEST');
  env.ORDERS._m.set('order:SDT-TEST', JSON.stringify({ id: 'SDT-TEST', status, tags: [], customer: { name: 'A', email: 'a@b.co' }, totals: { total } }));
  return env;
}
const ord = (env) => JSON.parse(env.ORDERS._m.get('order:SDT-TEST'));

test('webhook: approved payment of the right amount marks the order paid', async () => {
  const env = seed(); await webhook(env, { checkoutSessionId: 'SESS1', status: 'APPROVED', type: 'PAYMENT', id: 'P1', amount: 1400 });
  assert.equal(ord(env).status, 'paid'); assert.equal(ord(env).payment.amountChecked, true);
});
test('webhook: amount with Utah tax, and a dollar-unit amount, are both accepted', async () => {
  const a = seed(); await webhook(a, { checkoutSessionId: 'SESS1', status: 'APPROVED', type: 'PAYMENT', amount: 1503 }); assert.equal(ord(a).status, 'paid');
  const b = seed(); await webhook(b, { checkoutSessionId: 'SESS1', status: 'APPROVED', type: 'PAYMENT', amount: 14.0 }); assert.equal(ord(b).status, 'paid');
});
test('webhook: wrong amount is not marked paid and is flagged', async () => {
  const env = seed(); const r = await webhook(env, { checkoutSessionId: 'SESS1', status: 'APPROVED', type: 'PAYMENT', amount: 100 });
  assert.equal(r.note, 'amount mismatch'); assert.equal(ord(env).status, 'new'); assert.deepEqual(ord(env).payment.amountMismatch, { expectCents: 1400, amountCents: 100 });
});
test('webhook: refund or void events never mark an order paid', async () => {
  for (const type of ['REFUND', 'VOID']) { const env = seed(); const r = await webhook(env, { checkoutSessionId: 'SESS1', status: 'APPROVED', type, amount: 1400 }); assert.equal(r.note, 'not a payment event'); assert.equal(ord(env).status, 'new'); assert.equal(ord(env).events[0].type, type); }
});
test('webhook: a payment landing on a cancelled or done order is recorded on the order and the owner is told', async () => {
  for (const st of ['cancelled', 'done']) {
    const env = seed(st); const calls = [];
    const orig = globalThis.fetch; globalThis.fetch = async (u, o) => { calls.push(String(o && o.body)); return new Response('{}', { status: 200 }); };
    env.PUSHOVER_TOKEN = 'tok'; env.PUSHOVER_USER = 'usr';
    try { const r = await webhook(env, { checkoutSessionId: 'SESS1', status: 'APPROVED', type: 'PAYMENT', id: 'P9', amount: 1400 }); assert.equal(r.note, 'order closed'); } finally { globalThis.fetch = orig; }
    assert.equal(ord(env).status, st); assert.equal(ord(env).latePayments.length, 1); assert.equal(ord(env).latePayments[0].id, 'P9');
    assert.ok(calls.some((c) => /PAYMENT\+ON\+A\+CLOSED\+ORDER|PAYMENT%20ON|CLOSED/i.test(c)), 'owner notified: ' + calls.join('|'));
  }
});
test('webhook: bad signature and null body are rejected, not 500', async () => {
  const env = seed();
  const bad = await hook({ request: new Request('https://x.test/', { method: 'POST', headers: { 'Clover-Signature': 't=1,v1=abc' }, body: '{}' }), env, waitUntil() {} });
  assert.equal(bad.status, 401);
  const r = await webhook(env, null).catch((e) => e); // signed "null"
  assert.equal(r.error, 'bad json');
});

test('order: one network can create 10 orders an hour, then gets 429 (every order pings the owner)', async () => {
  const env = { ORDERS: kv(), IP_SALT: SALT };
  let last; for (let i = 0; i < 11; i++) last = await place(goodBody, env, '203.0.113.88');
  assert.equal(last.status, 429);
  assert.equal((await place(goodBody, env, '203.0.113.89')).status, 200, 'another network is unaffected');
});

test('webhook: an amount mismatch stores payment.status REVIEW (never APPROVED) so /api/pay cannot say Already paid', async () => {
  const env = seed(); await webhook(env, { checkoutSessionId: 'SESS1', status: 'APPROVED', type: 'PAYMENT', amount: 100 });
  assert.equal(ord(env).payment.status, 'REVIEW'); assert.equal(ord(env).payment.clover, 'APPROVED');
  const { onRequestPost: pay } = await import('../../functions/api/pay.js');
  const e2 = { ...env, CLOVER_ECOMM_TOKEN: 't', CLOVER_MERCHANT_ID: 'm', CHECKOUT_LIVE: 'true' };
  const raw = JSON.parse(env.ORDERS._m.get('order:SDT-TEST')); raw.customer.email = 'a@b.co'; raw.prints = []; env.ORDERS._m.set('order:SDT-TEST', JSON.stringify(raw));
  const realFetch = globalThis.fetch; globalThis.fetch = async () => new Response('{"message":"nope"}', { status: 500 });
  try { const r = await pay({ request: req('POST', { id: 'SDT-TEST', email: 'a@b.co' }), env: e2 }); const d = await r.json(); assert.ok(!/Already paid/.test(d.error || ''), JSON.stringify(d)); } finally { globalThis.fetch = realFetch; }
});
