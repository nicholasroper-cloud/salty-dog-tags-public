// node --test tools/test/
// Server-side order validation: phone, address, line length, pickup flag, shape availability, tax by state.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { phoneProblem, parseAddress, lineProblem, taxApplies, formatAddress, price, checkoutLineItems, PICKUP_ENABLED, US_STATES } from '../../functions/api/_lib.js';
import { onRequestPost } from '../../functions/api/order.js';

test('phoneProblem: needs 10 digits and rejects 555-01xx', () => {
  assert.equal(phoneProblem('801-336-2244'), '');
  assert.equal(phoneProblem('(435) 674-9921'), '');
  assert.equal(phoneProblem('+1 435 674 9921'), '');
  assert.match(phoneProblem(''), /phone/i);
  assert.match(phoneProblem('674-9921'), /10 digits/);
  assert.match(phoneProblem('435-555-0123'), /sample/);
  assert.match(phoneProblem('(801) 555-0100'), /sample/);
  assert.match(phoneProblem('1-801-555-0199'), /sample/);
  assert.equal(phoneProblem('801-555-1234'), ''); // 555 exchange but not the reserved 01xx block
});

test('lineProblem: 24 chars max', () => {
  assert.equal(lineProblem(['Yes, I lick my own junk.']), ''); // exactly 24
  assert.match(lineProblem(['Never seen a fucking sheep.']), /24/); // 27
  assert.equal(lineProblem(['', 'ok']), '');
});

test('parseAddress: each field validated, formatted string produced', () => {
  const good = { street: '123 Main St', addr2: 'Apt 4', city: 'Lehi', state: 'ut', zip: '84043' };
  const r = parseAddress(good);
  assert.equal(r.ok, true);
  assert.equal(r.formatted, '123 Main St, Apt 4, Lehi, UT 84043');
  assert.equal(parseAddress({ ...good, addr2: '' }).formatted, '123 Main St, Lehi, UT 84043');
  assert.equal(parseAddress({ ...good, zip: '84043-1234' }).ok, true);
  for (const [k, v, field] of [['street', '', 'street'], ['city', '', 'city'], ['city', '12345', 'city'], ['state', 'ZZ', 'state'], ['state', '', 'state'], ['zip', '8404', 'zip'], ['zip', 'abcde', 'zip'], ['zip', '84043-12', 'zip']]) {
    const bad = parseAddress({ ...good, [k]: v });
    assert.equal(bad.ok, false, `${k}=${v}`); assert.equal(bad.field, field);
  }
  assert.ok(US_STATES.length >= 51 && US_STATES.includes("DC")); // 50 states + DC, plus territories and military codes
  const stale = parseAddress({ address: '123 Main St, Lehi UT 84043' });
  assert.equal(stale.ok, false); assert.match(stale.error, /Refresh/);
  assert.equal(formatAddress({ line1: 'a', line2: '', city: 'b', state: 'UT', zip: '84043' }), 'a, b, UT 84043');
});

test('tax: Utah only when shipping state is UT', () => {
  assert.equal(taxApplies({ delivery: 'ship', state: 'UT' }), true);
  assert.equal(taxApplies({ delivery: 'ship', state: 'FL' }), false);
  assert.equal(taxApplies({ delivery: 'ship', address: '1 Main, Provo, UT 84601' }), true); // legacy stored order
  assert.equal(taxApplies({ delivery: 'ship', address: '1 Main, Tampa, FL 33601' }), false);
  const order = (state) => ({ customer: { name: 'A B', email: 'a@b.co', delivery: 'ship', state }, tags: [{ shape: 'bone', size: 'medium', finish: 'red', qty: 1, front: ['x'], back: ['y'] }], prints: [], totals: { multi: false, prize: 0, shipping: 4.5 } });
  assert.ok(checkoutLineItems({}, order('UT'))[0].taxRates.length === 1);
  assert.deepEqual(checkoutLineItems({}, order('FL'))[0].taxRates, []);
});

test('price: unchanged tiers', () => {
  const t = (shape, size, finish) => ({ shape, size, finish, qty: 1 });
  assert.equal(price([t('round', 'small', 'red')], [], 'ship').subtotal, 12);
  assert.equal(price([t('bone', 'medium', 'red')], [], 'ship').subtotal, 14);
  assert.equal(price([t('bone', 'large', 'polished')], [], 'ship').subtotal, 22);
  assert.equal(price([t('military', 'large', 'black')], [], 'ship').shipping, 4.5);
});

/* ---- full handler, with an in-memory KV ---- */
function kv() { const m = new Map(); return { get: async (k) => m.get(k) ?? null, put: async (k, v) => { m.set(k, v); }, getWithMetadata: async (k) => ({ value: m.get(k) ?? null, metadata: null }), _m: m }; }
const goodTag = { shape: 'bone', size: 'medium', finish: 'red', font: 'block', icon: 'none', qty: 1, front1: 'Built like', front2: 'a loaf.', back1: 'Whisky', back2: '801-336-2244' };
const goodBody = { name: 'Nick Roper', email: 'n@example.com', delivery: 'ship', street: '123 Main St', city: 'Lehi', state: 'UT', zip: '84043', tags: [goodTag] };
async function post(body, env = {}) {
  const e = { ORDERS: kv(), ...env };
  const res = await onRequestPost({ request: new Request('https://x.test/api/order', { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.9', 'user-agent': 'UA-secret' }, body: JSON.stringify(body) }), env: e, waitUntil() {} });
  return { status: res.status, data: await res.json(), env: e };
}

test('order: happy path stores formatted address, state, hashed ip, no user agent', async () => {
  const { status, data, env } = await post(goodBody, { IP_SALT: 'test-salt-0123456789abcdef' });
  assert.equal(status, 200, JSON.stringify(data));
  const order = JSON.parse(env.ORDERS._m.get('order:' + data.id));
  assert.equal(order.customer.address, '123 Main St, Lehi, UT 84043');
  assert.equal(order.customer.state, 'UT');
  assert.equal(order.ua, undefined);
  assert.equal(order.ip, undefined);
  assert.match(order.ipHash, /^[0-9a-f]{24}$/);
  assert.ok(!JSON.stringify(order).includes('203.0.113.9') && !JSON.stringify(order).includes('UA-secret'));
});

test('order: stale client with the sample 555 phone is rejected', async () => {
  const { status, data } = await post({ ...goodBody, tags: [{ ...goodTag, back2: '435-555-0123' }] });
  assert.equal(status, 400); assert.match(data.error, /sample/);
});
test('order: missing or short phone and missing dog name are rejected', async () => {
  assert.equal((await post({ ...goodBody, tags: [{ ...goodTag, back2: '' }] })).status, 400);
  assert.equal((await post({ ...goodBody, tags: [{ ...goodTag, back2: '674-9921' }] })).status, 400);
  assert.equal((await post({ ...goodBody, tags: [{ ...goodTag, back1: '' }] })).status, 400);
});
test('order: line over 24 characters is rejected, not truncated', async () => {
  const r = await post({ ...goodBody, tags: [{ ...goodTag, front2: 'Never seen a fucking sheep.' }] });
  assert.equal(r.status, 400); assert.match(r.data.error, /24/);
  const ok = await post({ ...goodBody, tags: [{ ...goodTag, front2: 'Yes, I lick my own junk.' }] });
  assert.equal(ok.status, 200);
});
test('order: pickup is refused while PICKUP_ENABLED is false', async () => {
  assert.equal(PICKUP_ENABLED, false);
  const r = await post({ ...goodBody, delivery: 'pickup' });
  assert.equal(r.status, 400); assert.match(r.data.error, /pickup/i);
});
test('order: hidden shapes are refused', async () => {
  for (const shape of ['hydrant', 'fish', 'cat', 'star', 'house']) {
    const r = await post({ ...goodBody, tags: [{ ...goodTag, shape }] });
    assert.equal(r.status, 400, shape); assert.match(r.data.error, /shape/);
  }
});
test('order: address fields are validated server-side', async () => {
  assert.equal((await post({ ...goodBody, zip: '1234' })).status, 400);
  assert.equal((await post({ ...goodBody, state: 'XX' })).status, 400);
  assert.equal((await post({ ...goodBody, street: '' })).status, 400);
  const stale = await post({ name: 'A B', email: 'a@b.co', delivery: 'ship', address: '1 Main St, Lehi UT 84043', tags: [goodTag] });
  assert.equal(stale.status, 400); assert.match(stale.data.error, /Refresh/);
});
