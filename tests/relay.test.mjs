// node tests/relay.test.mjs — POST /api/relay (functions/api/relay.js) and the sendOwner refactor of _notify.js,
// with a fake KV and a stubbed fetch (no network). Nothing here talks to Clover, Pushover or Twilio.
import assert from 'node:assert/strict';
import { onRequestPost } from '../functions/api/relay.js';
import { notifyOrder, sendOwner } from '../functions/api/_notify.js';

const KEY = 'a'.repeat(64);
const SECRETS = [KEY, 'clover-private-token-XYZ', 'po-app-token', 'po-user-key', 'twilio-auth-token'];

function makeKV() {
  const m = new Map();
  return { _m: m, fail: false,
    async get(k) { if (this.fail) throw new Error('kv down'); return m.has(k) ? m.get(k) : null; },
    async put(k, v) { if (this.fail) throw new Error('kv down'); m.set(k, String(v)); } };
}
const logs = [];
for (const lvl of ['log', 'warn', 'error']) console[lvl] = (...a) => logs.push(a.map(String).join(' '));

let sent = [];
let reply = () => new Response('{}', { status: 200 });
globalThis.fetch = async (url, init = {}) => { sent.push({ url: String(url), init }); return reply(String(url), init); };

const baseEnv = () => ({ ORDERS: makeKV(), RELAY_KEY: KEY, CHECKOUT_LIVE: 'true', CLOVER_ECOMM_TOKEN: 'clover-private-token-XYZ', CLOVER_MERCHANT_ID: 'MQKMTFBRXFP21',
  CLOVER_PAGE_CONFIG: 'sdt-branding-page', PUSHOVER_TOKEN: 'po-app-token', PUSHOVER_USER: 'po-user-key' });
let env = baseEnv();
const responses = [];
async function call(body, { auth = 'Bearer ' + KEY, raw } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (auth != null) headers.Authorization = auth;
  const r = await onRequestPost({ request: new Request('https://saltydogtags.com/api/relay', { method: 'POST', headers, body: raw ?? JSON.stringify(body) }), env });
  const text = await r.text();
  responses.push(text);
  let j = null; try { j = JSON.parse(text); } catch {}
  return { status: r.status, json: j, text };
}

const cart = (x = {}) => ({ kind: 'checkout', merchantId: 'MQKMTFBRXFP21',
  lineItems: [{ name: 'Dirty Dr Pepper · Coconut, Lime', price: 650, unitQty: 1, note: 'KQ-ABCDEFGH · Nick' }, { name: 'Treats bag', price: 300, unitQty: 1 }],
  customer: { firstName: 'Nick' },
  redirectUrls: { success: 'https://station.thirstybeaches.com/r/ABCDEFGH?paid=1', failure: 'https://station.thirstybeaches.com/r/ABCDEFGH?failed=1' },
  tips: { enabled: false }, ...x });
const cloverOk = () => new Response(JSON.stringify({ href: 'https://www.clover.com/checkout/abc123', checkoutSessionId: 'abc123',
  createdTime: 1761400000000, expirationTime: 1761400900000, extra: 'dropped' }), { status: 200 });

/* --- key unset / too short -> 404, nothing else happens --- */
for (const k of [undefined, '', 'short-key']) {
  env = { ...baseEnv(), RELAY_KEY: k }; sent = [];
  const r = await call(cart());
  assert.equal(r.status, 404, 'unset key -> 404 ' + k);
  assert.ok(!/relay|unauthor/i.test(r.text));
  assert.equal(sent.length, 0);
}

/* --- auth --- */
env = baseEnv(); sent = [];
for (const auth of [null, '', 'Bearer', 'Bearer ', 'Basic ' + KEY, 'Bearer ' + KEY.slice(0, -1), 'Bearer ' + KEY + 'a', 'Bearer ' + 'b'.repeat(64), KEY]) {
  const r = await call(cart(), { auth });
  assert.equal(r.status, 401, 'auth ' + auth);
}
assert.equal(sent.length, 0, 'no outbound call without auth');
assert.equal(env.ORDERS._m.size, 0, 'unauthenticated calls never touch the budget');

/* --- body shape --- */
assert.equal((await call(null, { raw: 'not json' })).status, 400);
assert.equal((await call(null, { raw: '[1]' })).status, 400);
assert.equal((await call({ kind: 'nope' })).json.error, 'bad-kind');
assert.equal((await call(null, { raw: '{"kind":"notify","x":"' + 'y'.repeat(17000) + '"}' })).status, 413);

/* --- ping: key check for the setup workflow, spends no budget --- */
let pr = await call({ kind: 'ping' });
assert.equal(pr.status, 200); assert.deepEqual(pr.json, { ok: true, pay: true, alerts: 1 });
assert.equal((await call({ kind: 'ping' }, { auth: 'Bearer nope' })).status, 401);
assert.equal(env.ORDERS._m.size, 0); assert.equal(sent.length, 0);

/* --- checkout: happy path --- */
reply = (url) => url.includes('/invoicingcheckoutservice/') ? cloverOk() : new Response('{}');
sent = [];
let r = await call(cart());
assert.equal(r.status, 200, r.text);
assert.deepEqual(r.json, { href: 'https://www.clover.com/checkout/abc123', checkoutSessionId: 'abc123', createdTime: 1761400000000, expirationTime: 1761400900000 });
assert.equal(sent.length, 1);
assert.equal(sent[0].url, 'https://api.clover.com/invoicingcheckoutservice/v1/checkouts');
assert.equal(sent[0].init.method, 'POST');
assert.equal(sent[0].init.headers.authorization, 'Bearer clover-private-token-XYZ');
assert.equal(sent[0].init.headers['X-Clover-Merchant-Id'], 'MQKMTFBRXFP21');
let cb = JSON.parse(sent[0].init.body);
assert.deepEqual(cb, { customer: { firstName: 'Nick' }, shoppingCart: { lineItems: [
  { name: 'Dirty Dr Pepper · Coconut, Lime', price: 650, unitQty: 1, note: 'KQ-ABCDEFGH · Nick' }, { name: 'Treats bag', price: 300, unitQty: 1 }] },
  redirectUrls: { success: 'https://station.thirstybeaches.com/r/ABCDEFGH?paid=1', failure: 'https://station.thirstybeaches.com/r/ABCDEFGH?failed=1' },
  tips: { enabled: false } });
assert.ok(!('pageConfigUuid' in cb), 'never Salty Dog branding on a Thirsty Beaches checkout');
// extra fields are dropped, not forwarded
sent = [];
r = await call(cart({ lineItems: [{ name: 'X', price: 100, unitQty: 2, taxRates: [{ rate: 1 }], discount: 99 }], customer: { firstName: 'A', email: 'x@y.z' }, shoppingCart: { evil: 1 } }));
assert.equal(r.status, 200);
cb = JSON.parse(sent[0].init.body);
assert.deepEqual(cb.shoppingCart.lineItems, [{ name: 'X', price: 100, unitQty: 2 }]);
assert.deepEqual(cb.customer, { firstName: 'A' });
// no customer / no tips is fine
sent = [];
r = await call(cart({ customer: undefined, tips: undefined }));
assert.equal(r.status, 200);
cb = JSON.parse(sent[0].init.body);
assert.equal(cb.customer.firstName, 'Kiosk'); assert.ok(!('tips' in cb));
// sandbox base like createCheckout
env.CLOVER_API_BASE = 'https://apisandbox.dev.clover.com'; sent = [];
await call(cart());
assert.equal(sent[0].url, 'https://apisandbox.dev.clover.com/invoicingcheckoutservice/v1/checkouts');
delete env.CLOVER_API_BASE;

/* --- checkout: hard limits (each refused before any Clover call) --- */
const li = (n, x = {}) => Array.from({ length: n }, () => ({ name: 'Soda', price: 100, unitQty: 1, ...x }));
const bad = [
  [{ lineItems: [] }, 'bad-line-items'],
  [{ lineItems: li(31) }, 'bad-line-items'],
  [{ lineItems: 'x' }, 'bad-line-items'],
  [{ lineItems: li(1, { price: 0 }) }, 'bad-price'],
  [{ lineItems: li(1, { price: -500 }) }, 'bad-price'],
  [{ lineItems: li(1, { price: 10001 }) }, 'bad-price'],
  [{ lineItems: li(1, { price: 1.5 }) }, 'bad-price'],
  [{ lineItems: li(1, { price: '100' }) }, 'bad-price'],
  [{ lineItems: li(1, { unitQty: 0 }) }, 'bad-qty'],
  [{ lineItems: li(1, { unitQty: 21 }) }, 'bad-qty'],
  [{ lineItems: li(1, { unitQty: 2.5 }) }, 'bad-qty'],
  [{ lineItems: li(3, { price: 10000 }) }, 'over-limit'],                       // $300
  [{ lineItems: li(1, { price: 10000, unitQty: 3 }) }, 'over-limit'],
  [{ lineItems: li(1, { name: '' }) }, 'bad-line-item'],
  [{ lineItems: li(1, { name: 'x'.repeat(256) }) }, 'bad-line-item'],
  [{ lineItems: li(1, { name: 5 }) }, 'bad-line-item'],
  [{ lineItems: li(1, { note: 'x'.repeat(251) }) }, 'bad-line-item'],
  [{ lineItems: [null] }, 'bad-line-item'],
  [{ customer: 'x' }, 'bad-customer'],
  [{ customer: { firstName: 7 } }, 'bad-customer'],
  [{ redirectUrls: undefined }, 'bad-redirect'],
  [{ redirectUrls: { success: 'https://station.thirstybeaches.com/r/A' } }, 'bad-redirect'],
  [{ redirectUrls: { success: 'http://station.thirstybeaches.com/r/A', failure: 'https://station.thirstybeaches.com/r/A' } }, 'bad-redirect'],
  [{ redirectUrls: { success: 'https://evil.com/r/A', failure: 'https://station.thirstybeaches.com/r/A' } }, 'bad-redirect'],
  [{ redirectUrls: { success: 'https://station.thirstybeaches.com.evil.com/', failure: 'https://station.thirstybeaches.com/r/A' } }, 'bad-redirect'],
  [{ redirectUrls: { success: 'https://evil.com@station.thirstybeaches.com/', failure: 'https://station.thirstybeaches.com/r/A' } }, 'bad-redirect'],
  [{ redirectUrls: { success: 'https://station.thirstybeaches.com:8443/', failure: 'https://station.thirstybeaches.com/r/A' } }, 'bad-redirect'],
  [{ redirectUrls: { success: 'https://saltydogtags.com/thanks.html', failure: 'https://station.thirstybeaches.com/r/A' } }, 'bad-redirect'],
  [{ redirectUrls: { success: 'javascript:alert(1)', failure: 'https://station.thirstybeaches.com/r/A' } }, 'bad-redirect'],
  [{ tips: true }, 'bad-tips'],
  [{ tips: { enabled: 'yes' } }, 'bad-tips'],
  [{ merchantId: 'SOMEONEELSE' }, 'merchant-mismatch'],
];
sent = [];
for (const [x, err] of bad) {
  const res = await call(cart(x));
  assert.equal(res.json && res.json.error, err, JSON.stringify(x).slice(0, 120));
  assert.equal(res.status, err === 'merchant-mismatch' ? 409 : 400);
}
assert.equal(sent.length, 0, 'no Clover call for any refused cart');
// edges that are allowed: exactly $200, 30 items, qty 20, price 1 and 10000
for (const x of [{ lineItems: li(2, { price: 10000 }) }, { lineItems: li(30) }, { lineItems: li(1, { unitQty: 20 }) }, { lineItems: li(1, { price: 1 }) }]) {
  assert.equal((await call(cart(x))).status, 200, JSON.stringify(x).slice(0, 80));
}

/* --- checkout: Clover failures come back as short codes, nothing verbatim, no token --- */
reply = () => new Response(JSON.stringify({ message: 'Invalid token clover-private-token-XYZ for merchant', details: 'secret stuff' }), { status: 401 });
r = await call(cart());
assert.equal(r.status, 502); assert.deepEqual(r.json, { error: 'clover-error', status: 401 });
reply = () => new Response('<html>oops</html>', { status: 200 });
r = await call(cart()); assert.equal(r.status, 502); assert.deepEqual(r.json, { error: 'clover-bad-reply' });
reply = () => new Response(JSON.stringify({ href: 'https://evil.com/pay', checkoutSessionId: 'x' }), { status: 200 });
r = await call(cart()); assert.deepEqual(r.json, { error: 'clover-bad-reply' });
reply = () => new Response(JSON.stringify({ href: 'https://www.clover.com/pay' }), { status: 200 });
r = await call(cart()); assert.deepEqual(r.json, { error: 'clover-bad-reply' });
reply = () => { throw new TypeError('network down'); };
r = await call(cart()); assert.deepEqual(r.json, { error: 'clover-unreachable' });
reply = () => { const e = new Error('aborted'); e.name = 'AbortError'; throw e; };
r = await call(cart()); assert.deepEqual(r.json, { error: 'clover-timeout' });
reply = (url) => url.includes('/invoicingcheckoutservice/') ? cloverOk() : new Response('{}');

/* --- checkout: pay off on this site --- */
env.CLOVER_ECOMM_TOKEN = ''; sent = [];
r = await call(cart()); assert.equal(r.status, 503); assert.equal(r.json.error, 'pay-off'); assert.equal(sent.length, 0);
env.CLOVER_ECOMM_TOKEN = 'clover-private-token-XYZ';

/* --- checkout budget: 120 per hour for everybody, fails closed when KV is down --- */
env = baseEnv();
const realNow = Date.now; let now = Date.parse('2026-10-25T18:10:00Z'); Date.now = () => now;
for (let i = 0; i < 120; i++) assert.equal((await call(cart())).status, 200);
r = await call(cart()); assert.equal(r.status, 429); assert.equal(r.json.error, 'rate-limited');
// refused carts and bad auth don't spend it; a new hour resets it
now += 3600e3;
assert.equal((await call(cart())).status, 200);
env.ORDERS.fail = true; sent = [];
r = await call(cart()); assert.equal(r.status, 429); assert.equal(sent.length, 0, 'KV down: no checkout');
env.ORDERS.fail = false;

/* --- notify --- */
env = baseEnv(); sent = []; reply = () => new Response('{"status":1}');
const note = (x = {}) => ({ kind: 'notify', source: 'tb-station', title: 'Down: saltydogtags.com', message: 'HTTP 503\nsince 9:05 am', url: 'https://saltydogtags.com/', priority: 'high', ...x });
r = await call(note());
assert.equal(r.status, 200, r.text); assert.deepEqual(r.json, { ok: true, sent: 1 });
assert.equal(sent.length, 1);
assert.equal(sent[0].url, 'https://api.pushover.net/1/messages.json');
let f = Object.fromEntries(sent[0].init.body);
assert.deepEqual(f, { token: 'po-app-token', user: 'po-user-key', title: 'Down: saltydogtags.com', message: 'HTTP 503\nsince 9:05 am', priority: '1', url: 'https://saltydogtags.com/', url_title: 'Open' });
sent = [];
await call(note({ priority: undefined, url: undefined, source: 'tb-where' }));
f = Object.fromEntries(sent[0].init.body);
assert.equal(f.priority, '0'); assert.ok(!('url' in f)); assert.ok(!('sound' in f));
sent = []; await call(note({ priority: 'low' })); assert.equal(Object.fromEntries(sent[0].init.body).priority, '-1');
// both channels
env.TWILIO_SID = 'AC123'; env.TWILIO_TOKEN = 'twilio-auth-token'; env.TWILIO_FROM = '+15550001111'; env.NOTIFY_TO = '+14358170000';
sent = [];
r = await call(note({ message: 'x'.repeat(1000) }));
assert.deepEqual(r.json, { ok: true, sent: 2 });
const tw = sent.find(s => s.url.includes('twilio'));
assert.equal(tw.url, 'https://api.twilio.com/2010-04-01/Accounts/AC123/Messages.json');
assert.equal(Object.fromEntries(tw.init.body).Body.length, 480, 'relay texts are capped at 3 segments');
// one channel down -> still ok (sent 1); all down -> 502
reply = (url) => new Response('nope', { status: url.includes('twilio') ? 500 : 200 });
r = await call(note()); assert.deepEqual(r.json, { ok: true, sent: 1 });
reply = () => new Response('nope', { status: 500 });
r = await call(note()); assert.equal(r.status, 502); assert.deepEqual(r.json, { error: 'notify-failed' });
reply = () => { throw new TypeError('network'); };
r = await call(note()); assert.equal(r.status, 502);
reply = () => new Response('{"status":1}');
// no channel configured
const env2 = env; env = { ORDERS: makeKV(), RELAY_KEY: KEY, NTFY_TOPIC: 'some-topic' }; sent = [];
r = await call(note()); assert.equal(r.status, 503); assert.deepEqual(r.json, { error: 'no-channel' }); assert.equal(sent.length, 0, 'ntfy is not a relay channel');
env = env2;
// validation
sent = [];
for (const [x, err] of [
  [{ source: 'someone' }, 'bad-source'], [{ source: undefined }, 'bad-source'],
  [{ title: '' }, 'bad-message'], [{ title: 'x'.repeat(121) }, 'bad-message'], [{ title: 5 }, 'bad-message'],
  [{ message: '' }, 'bad-message'], [{ message: 'x'.repeat(1001) }, 'bad-message'], [{ message: undefined }, 'bad-message'],
  [{ url: 'http://x.com' }, 'bad-url'], [{ url: 'javascript:alert(1)' }, 'bad-url'], [{ url: 'https://u:p@x.com/' }, 'bad-url'], [{ url: 7 }, 'bad-url'],
  [{ priority: 'urgent' }, 'bad-priority'],
]) {
  const res = await call(note(x));
  assert.equal(res.status, 400, JSON.stringify(x)); assert.equal(res.json.error, err, JSON.stringify(x));
}
assert.equal(sent.length, 0);
// control characters are flattened (title one line; message keeps newlines)
sent = []; await call(note({ title: 'A\nB\u0007C', message: 'L1\nL2\u0000' }));
f = Object.fromEntries(sent.find(s => s.url.includes('pushover')).init.body);
assert.equal(f.title, 'A B C'); assert.equal(f.message, 'L1\nL2');

/* --- notify budget: 60 per hour, keeps working when KV is down --- */
env = baseEnv(); now = Date.parse('2026-10-25T19:00:00Z');
reply = (url) => url.includes('/invoicingcheckoutservice/') ? cloverOk() : new Response('{"status":1}');
for (let i = 0; i < 60; i++) assert.equal((await call(note())).status, 200);
r = await call(note()); assert.equal(r.status, 429);
assert.equal((await call(cart())).status, 200, 'separate budget from checkout');
now += 3600e3; assert.equal((await call(note())).status, 200);
env.ORDERS.fail = true; assert.equal((await call(note())).status, 200, 'notify fails open on KV errors');
Date.now = realNow;

/* --- notifyOrder still sends exactly what it did before the refactor --- */
env = { ...baseEnv(), TWILIO_SID: 'AC1', TWILIO_TOKEN: 'twilio-auth-token', TWILIO_FROM: '+1555', NOTIFY_TO: '+1435' };
sent = []; reply = () => new Response('{}');
const order = { id: 'SDT-7K3Q', totals: { total: 16 }, payment: null, customer: { name: 'Jane Doe', delivery: 'ship' },
  tags: [{ shape: 'bone', finish: 'black', size: 'medium', qty: 1, front: ['Built like', 'a loaf.'], back: [] }] };
let errs = await notifyOrder(null, env, order, 'paid');
assert.deepEqual(errs, []);
const po = sent.find(s => s.url.includes('pushover'));
assert.equal(po.init.body.toString(), new URLSearchParams({ token: 'po-app-token', user: 'po-user-key', title: 'Salty Dog PAID $16.00 · Jane Doe',
  message: '1 tag · bone black medium\n"Built like / a loaf."\nship · #SDT-7K3Q', priority: '1',
  url: 'https://saltydogtags.com/orders.html#SDT-7K3Q', url_title: 'Open orders', sound: 'cashregister' }).toString());
const t2 = sent.find(s => s.url.includes('twilio'));
assert.equal(t2.init.body.toString(), new URLSearchParams({ To: '+1435', From: '+1555', Body: 'Salty Dog PAID $16.00 · Jane Doe\n1 tag · bone black medium\n"Built like / a loaf."\nship · #SDT-7K3Q' }).toString());
assert.equal(t2.init.headers.Authorization, 'Basic ' + btoa('AC1:twilio-auth-token'));
reply = (url) => new Response('bad', { status: url.includes('pushover') ? 400 : 200 });
errs = await notifyOrder(null, env, order, 'new');
assert.equal(errs.length, 1); assert.match(errs[0], /pushover 400/);
// waitUntil form
const waits = []; notifyOrder({ waitUntil: (p) => waits.push(p) }, env, order, 'new'); assert.equal(waits.length, 1); await waits[0];
assert.deepEqual(await sendOwner({}, { title: 't', body: 'b' }), [], 'no channels: nothing sent, no errors');

/* --- sms: the Thirsty Beaches "we're open" text to its alert list (every Twilio call stubbed, nothing sent) --- */
{
  const STOP = 'Reply STOP to opt out';
  const text = 'Thirsty Beaches: we’re open at Lehi Costco.\n' + STOP;
  const nums = (n, from = 1000) => Array.from({ length: n }, (_, i) => '+1801555' + String(from + i).padStart(4, '0'));
  const sms = (x = {}) => ({ kind: 'sms', source: 'tb-where', to: nums(3), text, ...x });
  const twEnv = () => ({ ...baseEnv(), TWILIO_SID: 'AC1', TWILIO_TOKEN: 'twilio-auth-token', TWILIO_FROM: '+18015550000' });
  const twCalls = () => sent.filter(s => s.url.includes('api.twilio.com'));
  const realNow2 = Date.now; let t = Date.parse('2026-10-25T20:00:00Z'); Date.now = () => t;
  const later = () => { t += 10 * 60 * 1000 + 1; };
  reply = () => new Response('{"sid":"SM1"}', { status: 201 });

  // auth first: no key -> 401, nothing sent, no budget touched
  env = twEnv(); sent = [];
  assert.equal((await call(sms(), { auth: 'Bearer nope' })).status, 401);
  assert.equal(twCalls().length, 0); assert.equal(env.ORDERS._m.size, 0);

  // shape: refused before any budget or send
  for (const [b, err] of [
    [sms({ source: 'tb-station' }), 'bad-source'], [sms({ source: undefined }), 'bad-source'],
    [sms({ to: [] }), 'bad-to'], [sms({ to: '+18015551000' }), 'bad-to'], [sms({ to: ['8015551000'] }), 'bad-to'],
    [sms({ to: ['+1801555100'.padEnd(17, '0')] }), 'bad-to'], [sms({ to: [42] }), 'bad-to'],
    [sms({ to: nums(501) }), 'too-many'],
    [sms({ text: 'We are open' }), 'needs-stop-line'], [sms({ text: STOP + ' now' }), 'needs-stop-line'],
    [sms({ text: 'x'.repeat(400) + STOP }), 'bad-text'], [sms({ text: 5 }), 'bad-text'], [sms({ text: '   ' }), 'bad-text'],
  ]) {
    const r = await call(b);
    assert.equal(r.status, 400, err); assert.equal(r.json.error, err);
  }
  assert.equal(twCalls().length, 0); assert.equal(env.ORDERS._m.size, 0);

  // no Twilio set up -> 503 no-sms (NOTIFY_TO alone is not enough, and not needed)
  env = baseEnv(); sent = [];
  let r = await call(sms()); assert.equal(r.status, 503); assert.equal(r.json.error, 'no-sms');

  // happy path: one Twilio message per distinct number, from SDT's number, exact text
  env = twEnv(); sent = [];
  r = await call(sms({ to: [...nums(3), '+18015551000'] }));
  assert.equal(r.status, 200, r.text); assert.deepEqual(r.json, { ok: true, sent: 3, failed: 0 });
  assert.equal(twCalls().length, 3, 'duplicates texted once');
  for (const c of twCalls()) {
    assert.equal(c.url, 'https://api.twilio.com/2010-04-01/Accounts/AC1/Messages.json');
    assert.equal(c.init.headers.Authorization, 'Basic ' + btoa('AC1:twilio-auth-token'));
    const f = Object.fromEntries(c.init.body); assert.equal(f.From, '+18015550000'); assert.equal(f.Body, text);
  }
  assert.deepEqual(twCalls().map(c => Object.fromEntries(c.init.body).To).sort(), nums(3));
  assert.ok(!r.text.includes('+1801'), 'numbers never echoed');

  // 1 call per 10 min
  r = await call(sms()); assert.equal(r.status, 429); assert.equal(r.json.error, 'too-soon');
  later();

  // per-number failures are counted, never thrown
  sent = [];
  reply = (url) => url.includes('twilio') && sent.length % 2 ? new Response('{"code":21610}', { status: 400 }) : new Response('{}', { status: 201 });
  r = await call(sms({ to: nums(4, 2000) }));
  assert.equal(r.status, 200); assert.equal(r.json.sent + r.json.failed, 4); assert.ok(r.json.failed >= 1);
  later();
  reply = () => { throw new TypeError('network'); };
  r = await call(sms({ to: nums(2, 3000) })); assert.deepEqual(r.json, { ok: true, sent: 0, failed: 2 });
  later();
  reply = () => new Response('{}', { status: 201 });

  // 2000 numbers per UTC day: 500 + 500 + 500 + 491 used so far = 1991 + 9 more ok, then 1 more refused
  env = twEnv(); sent = [];
  for (const n of [500, 500, 500, 491]) { r = await call(sms({ to: nums(n) })); assert.equal(r.status, 200, String(n)); later(); }
  r = await call(sms({ to: nums(10) })); assert.equal(r.status, 429); assert.equal(r.json.error, 'daily-cap'); assert.equal(r.json.left, 9);
  later();
  r = await call(sms({ to: nums(9) })); assert.equal(r.status, 200);
  later();
  r = await call(sms({ to: nums(1) })); assert.equal(r.json.error, 'daily-cap');
  t = Date.parse('2026-10-26T00:00:30Z');
  r = await call(sms({ to: nums(1) })); assert.equal(r.status, 200, 'new UTC day, new budget');
  assert.equal(twCalls().length, 2000 + 1);

  // KV down -> refuse (fail closed: these go to customers)
  later(); env.ORDERS.fail = true; sent = [];
  r = await call(sms()); assert.equal(r.status, 503); assert.equal(r.json.error, 'budget-unavailable'); assert.equal(twCalls().length, 0);

  // ping is unchanged
  env = twEnv(); assert.equal((await call({ kind: 'ping' })).status, 200);
  for (const l of logs) assert.ok(!/\+1801555\d{4}/.test(l), 'a number in a log line: ' + l);
  Date.now = realNow2;
}

/* --- no secret ever in a response or a log line --- */
for (const s of SECRETS) {
  for (const t of responses) assert.ok(!t.includes(s), 'secret in a response: ' + s.slice(0, 6));
  for (const l of logs) assert.ok(!l.includes(s), 'secret in a log: ' + s.slice(0, 6) + ' :: ' + l);
}
process.stdout.write(`relay tests ok (${responses.length} requests, ${logs.length} log lines)\n`);
