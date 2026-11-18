// node --test tools/test/  Smart QR tag: pricing, order-time eligibility and minting, D1-failure path, mint/qc/slip/health endpoints, ship gate.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { onRequestPost as place } from '../../functions/api/order.js';
import { onRequestPost as ownerPost } from '../../functions/api/orders.js';
import { onRequestPost as shipPost } from '../../functions/api/ship.js';
import { onRequestPost as mintPost } from '../../functions/api/tags/mint.js';
import { onRequestPost as qcPost } from '../../functions/api/tags/qc.js';
import { onRequestGet as slipGet } from '../../functions/api/tags/slip.js';
import { onRequestGet as healthGet } from '../../functions/api/tags/health.js';
import { onRequestGet as configGet } from '../../functions/api/config.js';
import { price, SMART_PRICE, SMART_LINE, checkoutLineItems, tagUnitBase } from '../../functions/api/_lib.js';
import { claimCode, ID_RE } from '../../functions/api/_tagid.js';
import { noteNativeScan, getTag } from '../../functions/api/_tagdb.js';
import { makeD1 } from './_d1.mjs';

function kv() {
  const m = new Map();
  return { get: async (k) => m.get(k) ?? null, delete: async (k) => { m.delete(k); }, put: async (k, v) => { m.set(k, v); }, getWithMetadata: async (k) => ({ value: m.get(k) ?? null, metadata: null }),
    list: async ({ prefix = '' } = {}) => ({ keys: [...m.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true }), _m: m };
}
const KEY = 'claim-key-0123456789abcdef-test';
const mkEnv = (over = {}) => ({ ORDERS: kv(), TAGDB: makeD1(), ADMIN_KEY: 'adminkey-0123456789abcdef', TAG_CLAIM_KEY: KEY, ...over });
let ipN = 10;
const base = { name: 'Nick Roper', email: 'n@example.com', delivery: 'ship', street: '123 Main St', city: 'Lehi', state: 'FL', zip: '33601' };
const tag = (over = {}) => ({ shape: 'military', size: 'large', finish: 'stainless', font: 'block', qty: 1, front1: 'BRUNO', back1: 'BRUNO', back2: '801-336-2244', smart: true, ...over });
async function post(body, env) {
  const res = await place({ request: new Request('https://x.test/api/order', { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': '198.51.100.' + (++ipN % 250) }, body: JSON.stringify({ ...base, ...body }) }), env, waitUntil() {} });
  return { status: res.status, data: await res.json() };
}
const admin = (url, body, method = 'POST') => new Request('https://x.test' + url, { method, headers: { authorization: 'Bearer adminkey-0123456789abcdef', 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
const savedOrder = (env, id) => JSON.parse(env.ORDERS._m.get('order:' + id));

test('price: the smart add-on is one-time per entry, outside the 15% multi-tag discount and the prize credit', () => {
  assert.equal(SMART_PRICE, 500); assert.equal(SMART_LINE, 'Scan-to-find QR with email alerts');
  const plain = { shape: 'military', size: 'large', finish: 'stainless', qty: 3, front: ['A'], back: ['B', '801-336-2244'] };
  const a = price([plain], [], 'ship', false), b = price([{ ...plain, smart: { id: null } }], [], 'ship', false);
  assert.equal(b.discount, a.discount, 'the discount does not see the add-on');
  assert.equal(+(b.subtotal - a.subtotal).toFixed(2), 5, 'one fee for the entry, not per copy');
  assert.equal(b.multi, true);
  const p = price([{ ...plain, qty: 1, smart: { id: 'X' } }], [], 'ship', true);
  assert.equal(p.prize, 4, 'prize credit is the finish premium only, unaffected by the add-on');
});

test('price: a free smart tag costs nothing extra and the Clover line items carry the fee as its own line', () => {
  const t = { shape: 'bone', size: 'medium', finish: 'black', qty: 2, front: ['A'], back: ['B', '801-336-2244'], smart: { id: 'ABCDEFGHJK' } };
  const items = checkoutLineItems({}, { tags: [t], prints: [], totals: { multi: false, prize: 0, shipping: 0 }, customer: { delivery: 'ship', state: 'FL' } });
  const line = items.find((i) => i.name === SMART_LINE);
  assert.ok(line); assert.equal(line.price, 500); assert.equal(line.unitQty, 1);
  assert.equal(items[0].price, Math.round(tagUnitBase(t) * 100), 'the base tag line is unchanged');
});

test('order: an eligible smart tag is mint-checked on the server, gets a random id, and is stored with its fixed geometry', async () => {
  const env = mkEnv();
  const r = await post({ tags: [tag()] }, env);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const o = savedOrder(env, r.data.id), s = o.tags[0].smart;
  assert.match(s.id, ID_RE); assert.equal(s.url, 'HTTPS://SALTYDOGTAGS.COM/T/' + s.id);
  assert.equal(s.ecl, 'Q'); assert.equal(s.v, 3); assert.ok(s.mm >= 0.5);
  assert.equal(r.data.totals.subtotal, +(tagUnitBase(o.tags[0]) + 5).toFixed(2));
  const row = await getTag(env, s.id);
  assert.equal(row.status, 'issued'); assert.equal(row.order_id, r.data.id); assert.equal(row.buyer_email, 'n@example.com'); assert.equal(row.payload, s.url);
});

test('order: the client only says smart:true; geometry or an id sent by the client is ignored', async () => {
  const env = mkEnv();
  const r = await post({ tags: [tag({ smart: { id: 'AAAAAAAAAA', mm: 0.1, x: 0, y: 0 } })] }, env);
  assert.equal(r.status, 200);
  assert.equal(savedOrder(env, r.data.id).tags[0].smart, undefined, 'smart must be exactly true to count');
  const r2 = await post({ tags: [tag({ smart: true, smartId: 'AAAAAAAAAA' })] }, env);
  assert.notEqual(savedOrder(env, r2.data.id).tags[0].smart.id, 'AAAAAAAAAA');
});

test('order: ineligible tags are refused with a 400 and a reason (size, shape, finish gate, text too long), and nothing is stored', async () => {
  const env = mkEnv();
  for (const [t, reason] of [[tag({ shape: 'round', finish: 'stainless' }), 'size'], [tag({ shape: 'paw', finish: 'black' }), 'size'], [tag({ finish: 'silver' }), 'finish-test'],
    [tag({ finish: 'rainbow' }), 'finish'], [tag({ shape: 'heart', back1: 'ABCDEFGHIJKLMNOPQRSTUVWX' }), 'text'], [tag({ shape: 'round', finish: 'brass' }), 'finish-test']]) {
    const r = await post({ tags: [t] }, env);
    assert.equal(r.status, 400, JSON.stringify(t)); assert.equal(r.data.reason, reason); assert.equal(r.data.field, 'smart');
  }
  assert.equal([...env.ORDERS._m.keys()].filter((k) => k.startsWith('order:')).length, 0);
});

test('order: smart is refused when D1 is not bound or SMART_ENABLED=false (the rollback switch); non-smart orders are untouched', async () => {
  for (const env of [mkEnv({ TAGDB: undefined }), mkEnv({ SMART_ENABLED: 'false' })]) {
    const r = await post({ tags: [tag()] }, env); assert.equal(r.status, 400); assert.match(r.data.error, /not available/);
    const ok = await post({ tags: [tag({ smart: false })] }, env); assert.equal(ok.status, 200);
  }
});

test('order: D1 down at order time never blocks the order; smart.id stays null and the mint button fixes it later (idempotent)', async () => {
  const env = mkEnv(); env.TAGDB.failNext(1);
  const r = await post({ tags: [tag()] }, env);
  assert.equal(r.status, 200, 'the order is saved');
  const o = savedOrder(env, r.data.id);
  assert.equal(o.tags[0].smart.id, null); assert.equal(o.totals.subtotal > 0, true);
  // D1 is back: mint
  const res = await mintPost({ request: admin('/api/tags/mint', { orderId: r.data.id }), env });
  const d = await res.json();
  assert.equal(res.status, 200); assert.equal(d.minted, 1); assert.match(d.order.tags[0].smart.id, ID_RE);
  assert.equal(savedOrder(env, r.data.id).tags[0].smart.id, d.order.tags[0].smart.id);
  const again = await (await mintPost({ request: admin('/api/tags/mint', { orderId: r.data.id }), env })).json();
  assert.equal(again.minted, 0, 'second tap mints nothing');
  assert.equal(again.order.tags[0].smart.id, d.order.tags[0].smart.id);
  assert.equal((await env.TAGDB.prepare('SELECT COUNT(*) c FROM tags').first('c')), 1);
});

test('mint endpoint: admin only, 503 without D1, 404 for no order, refuses a cancelled order', async () => {
  const env = mkEnv();
  assert.equal((await mintPost({ request: new Request('https://x.test/', { method: 'POST', body: '{}' }), env })).status, 401);
  assert.equal((await mintPost({ request: admin('/x', { orderId: 'SDT-NOPE' }), env })).status, 404);
  assert.equal((await mintPost({ request: admin('/x', { orderId: 'SDT-NOPE' }), env: mkEnv({ TAGDB: undefined }) })).status, 503);
  const r = await post({ tags: [tag()] }, env);
  await ownerPost({ request: admin('/api/orders', { id: r.data.id, status: 'cancelled' }), env });
  assert.equal((await mintPost({ request: admin('/x', { orderId: r.data.id }), env })).status, 409);
});

test('cancel disables the order\'s tags; Mark engraved (status made) marks them engraved', async () => {
  const env = mkEnv();
  const a = await post({ tags: [tag()] }, env), b = await post({ tags: [tag()] }, env);
  const ida = savedOrder(env, a.data.id).tags[0].smart.id, idb = savedOrder(env, b.data.id).tags[0].smart.id;
  await ownerPost({ request: admin('/api/orders', { id: a.data.id, status: 'cancelled' }), env });
  assert.equal((await getTag(env, ida)).status, 'disabled');
  await ownerPost({ request: admin('/api/orders', { id: b.data.id, status: 'made' }), env });
  const row = await getTag(env, idb); assert.equal(row.status, 'engraved'); assert.ok(row.engraved_at);
});

async function engravedOrder(env) {
  const r = await post({ tags: [tag()] }, env);
  await ownerPost({ request: admin('/api/orders', { id: r.data.id, status: 'made' }), env });
  return { oid: r.data.id, id: savedOrder(env, r.data.id).tags[0].smart.id };
}

test('QC: decoded text must equal the payload exactly; passing needs BOTH the in-page decode and the phone-camera beacon', async () => {
  const env = mkEnv(); const { id } = await engravedOrder(env);
  const qc = async (b) => { const r = await qcPost({ request: admin('/api/tags/qc', b), env }); return { status: r.status, d: await r.json() }; };
  assert.equal((await qc({ id, decodedText: 'HTTPS://EVIL.COM/T/' + id })).status, 422);
  assert.equal((await qc({ id, decodedText: 'HTTPS://SALTYDOGTAGS.COM/T/' + id.slice(0, 9) + 'Z' })).status, 422);
  let r = await qc({ id, decodedText: 'HTTPS://SALTYDOGTAGS.COM/T/' + id });
  assert.equal(r.d.status, 'engraved'); assert.equal(r.d.decoded, true); assert.equal(r.d.nativeScan, false, 'decode alone is not a pass');
  assert.equal(await noteNativeScan(env, await getTag(env, id)), true);
  assert.equal((await getTag(env, id)).status, 'qc_pass', 'the beacon completes the pass');
  assert.equal(await noteNativeScan(env, await getTag(env, id)), false, 'only the first beacon counts');
});

test('QC: beacon first then decode also passes; fail records the note; an unengraved tag cannot be QC\'d; unknown id is 404; auth required', async () => {
  const env = mkEnv(); const { id } = await engravedOrder(env);
  await noteNativeScan(env, await getTag(env, id));
  assert.equal((await getTag(env, id)).status, 'engraved');
  const ok = await (await qcPost({ request: admin('/x', { id, decodedText: 'HTTPS://SALTYDOGTAGS.COM/T/' + id }), env })).json();
  assert.equal(ok.status, 'qc_pass');
  const f = await (await qcPost({ request: admin('/x', { id, fail: true, note: 'soft edges' }), env })).json();
  assert.equal(f.status, 'qc_fail');
  assert.equal((await getTag(env, id)).qc_fail_note, 'soft edges');
  const env2 = mkEnv(); const issued = await post({ tags: [tag()] }, env2);
  const iid = savedOrder(env2, issued.data.id).tags[0].smart.id;
  assert.equal((await qcPost({ request: admin('/x', { id: iid, decodedText: 'x' }), env: env2 })).status, 409);
  assert.equal((await qcPost({ request: admin('/x', { id: 'ABCDEFGHJK', decodedText: 'x' }), env })).status, 404);
  assert.equal((await qcPost({ request: new Request('https://x.test/', { method: 'POST', body: '{}' }), env })).status, 401);
  assert.equal((await qcPost({ request: admin('/x', { id: 'bad', decodedText: 'x' }), env })).status, 400);
});

test('ship gate: shipped is blocked until every smart tag passes QC; the override is recorded; re-engrave resets', async () => {
  const env = mkEnv(); const { oid, id } = await engravedOrder(env);
  let r = await ownerPost({ request: admin('/api/orders', { id: oid, status: 'shipped' }), env });
  assert.equal(r.status, 409); let d = await r.json(); assert.equal(d.canOverride, true); assert.match(d.blockers[0], /scan check not done/);
  let s = await shipPost({ request: admin('/api/ship', { id: oid, action: 'ship', tracking: '', email: false }), env });
  assert.equal(s.status, 409);
  await qcPost({ request: admin('/x', { id, decodedText: 'HTTPS://SALTYDOGTAGS.COM/T/' + id }), env });
  d = await (await ownerPost({ request: admin('/api/orders', { id: oid, status: 'shipped' }), env })).json();
  assert.equal(d.ok, undefined); assert.match(d.blockers[0], /iPhone camera/);
  await noteNativeScan(env, await getTag(env, id));
  r = await ownerPost({ request: admin('/api/orders', { id: oid, status: 'shipped' }), env });
  assert.equal(r.status, 200);
  assert.equal((await getTag(env, id)).status, 'shipped');
  assert.equal(savedOrder(env, oid).smartOverride, undefined);
});

test('ship gate: override ships anyway and records what it skipped; a failed QC blocks with the re-engrave hint; no-id and D1-down block (fail closed)', async () => {
  const env = mkEnv(); const { oid, id } = await engravedOrder(env);
  await qcPost({ request: admin('/x', { id, fail: true, note: 'x' }), env });
  const bl = await (await ownerPost({ request: admin('/api/orders', { id: oid, status: 'shipped' }), env })).json();
  assert.match(bl.blockers[0], /QC failed/);
  const r = await ownerPost({ request: admin('/api/orders', { id: oid, status: 'shipped', smartOverride: true }), env });
  assert.equal(r.status, 200); assert.ok(savedOrder(env, oid).smartOverride.blockers.length);
  const down = mkEnv(); const { oid: o3 } = await engravedOrder(down);
  down.TAGDB.failNext(1);
  const r3 = await ownerPost({ request: admin('/api/orders', { id: o3, status: 'shipped' }), env: down });
  assert.equal(r3.status, 409); assert.match((await r3.json()).blockers[0], /unreachable/);
  const e4 = mkEnv(); e4.TAGDB.failNext(1);
  const r4 = await post({ tags: [tag()] }, e4);
  const noId = await ownerPost({ request: admin('/api/orders', { id: r4.data.id, status: 'shipped' }), env: e4 });
  assert.equal(noId.status, 409); assert.match((await noId.json()).blockers[0], /no QR id/);
});

test('ship gate: orders with no smart tags ship exactly as before', async () => {
  const env = mkEnv(); const r = await post({ tags: [tag({ smart: false })] }, env);
  assert.equal((await ownerPost({ request: admin('/api/orders', { id: r.data.id, status: 'shipped' }), env })).status, 200);
});

test('slip: claim code per tag from TAG_CLAIM_KEY, claim URL carries id and code, no key = 503, admin only, disabled tags omitted', async () => {
  const env = mkEnv(); const r = await post({ tags: [tag({ qty: 2 }), tag({ smart: false })] }, env);
  const id = savedOrder(env, r.data.id).tags[0].smart.id;
  const res = await slipGet({ request: admin('/api/tags/slip?order=' + r.data.id, null, 'GET'), env });
  const d = await res.json();
  assert.equal(d.slips.length, 1); const s = d.slips[0];
  assert.equal(s.id, id); assert.equal(s.dog, 'BRUNO'); assert.equal(s.qty, 2); assert.equal(s.code, await claimCode(KEY, id, 1));
  assert.equal(s.url, 'saltydogtags.com/t/' + id.toLowerCase());
  assert.equal(s.claimUrl, `https://saltydogtags.com/claim?t=${id}&c=${s.code.replace(/-/g, '')}`);
  assert.equal((await slipGet({ request: admin('/x?order=' + r.data.id, null, 'GET'), env: mkEnv({ ...env, TAG_CLAIM_KEY: '' }) })).status, 503);
  assert.equal((await slipGet({ request: new Request('https://x.test/?order=1'), env })).status, 401);
  await ownerPost({ request: admin('/api/orders', { id: r.data.id, status: 'cancelled' }), env });
  assert.equal((await (await slipGet({ request: admin('/x?order=' + r.data.id, null, 'GET'), env })).json()).slips.length, 0);
});

test('health: admin only; counts only; reports a stale purge and the canary', async () => {
  const env = mkEnv();
  assert.equal((await healthGet({ request: new Request('https://x.test/'), env })).status, 401);
  let d = await (await healthGet({ request: admin('/h', null, 'GET'), env })).json();
  assert.equal(d.db, true); assert.equal(d.purgeStale, true); assert.equal(d.ok, false); assert.equal(d.sms.flag, true);
  const now = Date.now();
  await env.TAGDB.prepare("INSERT INTO meta(k,v,at) VALUES('last_purge_at','x',?1),('canary','ok',?1)").bind(now).run();
  d = await (await healthGet({ request: admin('/h', null, 'GET'), env })).json();
  assert.equal(d.ok, true); assert.equal(d.canary.ok, true);
  assert.ok(!JSON.stringify(d).match(/@|\+1\d{10}/), 'no emails or phone numbers in health');
  assert.equal((await healthGet({ request: admin('/h', null, 'GET'), env: mkEnv({ TAGDB: undefined }) })).status, 503);
});

test('config: the builder learns about smart tags only when D1 is bound and SMART_ENABLED is not false', async () => {
  const on = await (await configGet({ env: mkEnv() })).json();
  assert.equal(on.smart.price, 500); assert.equal(on.smart.base, 'HTTPS://SALTYDOGTAGS.COM/T/'); assert.equal(on.smart.finishes.stainless, 'on'); assert.equal(on.smart.finishes.silver, 'test');
  assert.equal((await (await configGet({ env: mkEnv({ SMART_ENABLED: 'false' }) })).json()).smart, undefined);
  assert.equal((await (await configGet({ env: {} })).json()).smart, undefined);
  const custom = await (await configGet({ env: mkEnv({ TAG_BASE_URL: 'https://sdt.pet/t/' }) })).json();
  assert.equal(custom.smart.base, 'HTTPS://SDT.PET/T/');
});
