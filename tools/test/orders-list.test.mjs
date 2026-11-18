// node --test tools/test/
// P-1 regression: the order rate-limit counter used to live at "order:<hash>", the same prefix as the order records,
// so GET /api/orders returned a bare number and the orders page threw.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { onRequestPost as place } from '../../functions/api/order.js';
import { onRequestGet as list } from '../../functions/api/orders.js';

function kv() {
  const m = new Map();
  return {
    get: async (k) => m.get(k) ?? null, put: async (k, v) => { m.set(k, v); }, delete: async (k) => { m.delete(k); },
    getWithMetadata: async (k) => ({ value: m.get(k) ?? null, metadata: null }),
    list: async ({ prefix = '' } = {}) => ({ keys: [...m.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true }),
    _m: m,
  };
}
const body = { name: 'Nick Roper', email: 'n@example.com', delivery: 'ship', street: '123 Main St', city: 'Lehi', state: 'UT', zip: '84043',
  tags: [{ shape: 'bone', size: 'medium', finish: 'red', font: 'block', icon: 'none', qty: 1, front1: 'Built like', front2: 'a loaf.', back1: 'Whisky', back2: '801-336-2244' }] };

test('rate-limit counters do not live under the order: prefix', async () => {
  const env = { ORDERS: kv(), ADMIN_KEY: 'k' };
  const res = await place({ request: new Request('https://x.test/api/order', { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.7' }, body: JSON.stringify(body) }), env, waitUntil() {} });
  assert.equal(res.status, 200);
  const keys = [...env.ORDERS._m.keys()];
  assert.ok(keys.some((k) => k.startsWith('rl:order:')), 'counter is under rl:order:');
  assert.ok(keys.filter((k) => k.startsWith('order:')).every((k) => /^order:SDT-/.test(k)), 'only real orders under order:');
});

test('GET /api/orders skips legacy bare-number counters and corrupt records', async () => {
  const env = { ORDERS: kv(), ADMIN_KEY: 'k' };
  await place({ request: new Request('https://x.test/api/order', { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.8' }, body: JSON.stringify(body) }), env, waitUntil() {} });
  env.ORDERS._m.set('order:0123456789abcdef01234567', '8'); // a counter written by the old code
  env.ORDERS._m.set('order:SDT-BAD1', '{not json');
  const r = await list({ request: new Request('https://x.test/api/orders', { headers: { authorization: 'Bearer k' } }), env });
  const data = await r.json();
  assert.equal(r.status, 200);
  assert.equal(data.orders.length, 1);
  assert.ok(data.orders.every((o) => o && typeof o === 'object' && /^SDT-/.test(o.id)));
});
