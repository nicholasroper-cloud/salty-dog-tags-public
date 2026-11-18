import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openState } from '../lib/state.mjs';
import { createLightBurn } from '../lib/lightburn.mjs';
import { createQueue } from '../lib/queue.mjs';
import { ApiError } from '../lib/api.mjs';
import { mockLightBurn, lbConfig } from './helpers.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const baseConfig = JSON.parse(await readFile(path.join(here, '..', 'config.json'), 'utf8'));
const fixtures = JSON.parse(await readFile(path.join(here, 'fixtures', 'tags.json'), 'utf8'));
const tag = (id) => structuredClone(fixtures.find((f) => f.id === id).tag);
const cleanups = [];
after(async () => { for (const c of cleanups.reverse()) await c(); });

let seq = 0;
const mkOrder = (id, over = {}) => ({ id, at: 1760000000000 + (seq++) * 1000, status: 'paid',
  customer: { name: 'Pat ' + id, email: 'pat@example.com', phone: '555-0100', address: '9 Elm St', note: 'hi', delivery: 'ship' },
  tags: [tag('f02')], prints: [], totals: { total: 12 }, ...over });

async function setup({ orders = [], lbHandler, config: cfgOver = {}, lbOver = {}, noLb = false, blockQueue = false, notes = false } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sdt-q-'));
  if (blockQueue) await writeFile(path.join(root, 'blocker'), 'x');   // a file where the queue parent should be
  const mock = await mockLightBurn(lbHandler);
  const config = { ...baseConfig, ...cfgOver, queueDir: path.join(root, blockQueue ? 'blocker/queue' : 'queue'), lightburn: { ...baseConfig.lightburn, ...lbConfig(mock, { minLoadGapMs: 5000, ...lbOver }).lightburn } };
  const lightburn = createLightBurn({ config, queueDir: config.queueDir });
  if (!noLb) await lightburn.start();
  const state = await openState(path.join(root, 'state.json'));
  const calls = { list: 0, setStatus: [], photo: [], notes: [] };
  const fake = { orders, listError: null, setStatusError: null };
  const api = {
    listOrders: async () => { calls.list++; if (fake.listError) throw fake.listError; return structuredClone(fake.orders); },
    setStatus: async (id, st) => { if (fake.setStatusError) throw fake.setStatusError; calls.setStatus.push([id, st]); return { ok: true }; },
    getPhoto: async (id, i) => { calls.photo.push([id, i]); return { bytes: await readFile(path.join(here, 'fixtures', 'demo-photo.jpg')), contentType: 'image/jpeg' }; }
  };
  const queue = createQueue({ config, state, api, lightburn, dataDir: path.join(root, 'data'), now: () => new Date('2026-10-16T18:00:00Z'), execFile: (bin, args, cb) => { calls.open = [bin, args]; cb(null); },
    notifyExec: notes ? (bin, args, opts, cb) => { calls.notes.push({ bin, args, opts }); cb(null); } : (bin, args, opts, cb) => cb(null) });   // never the real osascript, even when this file is run outside `npm test`
  cleanups.push(() => lightburn.close(), () => mock.close());
  return { root, mock, config, lightburn, state, api, queue, calls, fake };
}

test('poll picks paid orders with tags, oldest first; skips everything else; second poll is idempotent', async () => {
  const o1 = mkOrder('SDT-7KQ2'), o2 = mkOrder('SDT-2ABC');
  o1.at = 2000; o2.at = 1000;
  const skipped = [
    mkOrder('SDT-3DEF', { status: 'invoiced' }), mkOrder('SDT-4GHJ', { status: 'new' }), mkOrder('SDT-5KMN', { status: 'made' }),
    mkOrder('SDT-6PQR', { tags: [] }), mkOrder('SDT-7STU', { tags: undefined }),
    mkOrder('SDT-O0O0'), mkOrder('../../etc'), mkOrder('SDT-8VWX', { status: 'cancelled' })
  ];
  const t = await setup({ orders: [o1, ...skipped, o2], config: { autoLoad: false } });
  const r = await t.queue.poll();
  assert.deepEqual(r.picked, ['SDT-2ABC', 'SDT-7KQ2']);
  assert.deepEqual(Object.keys(t.state.jobs).sort(), ['SDT-2ABC', 'SDT-7KQ2']);
  assert.equal(t.state.job('SDT-7KQ2').status, 'queued');
  assert.equal(t.state.job('SDT-7KQ2').customerName, 'Pat SDT-7KQ2');
  assert.deepEqual((await readdir(t.config.queueDir)).filter((n) => n.startsWith('SDT-')).sort(), ['SDT-2ABC', 'SDT-7KQ2']);
  assert.deepEqual((await t.queue.poll()).picked, []);
  assert.equal(t.state.data.lastPoll.ok, true);
  assert.equal(t.state.data.lastPoll.orderCount, o1 ? 10 : 0);
});

test('invoiced orders become eligible only when configured', async () => {
  const t = await setup({ orders: [mkOrder('SDT-3DEF', { status: 'invoiced' })], config: { eligibleStatuses: ['paid', 'invoiced'], autoLoad: false } });
  assert.deepEqual((await t.queue.poll()).picked, ['SDT-3DEF']);
});

test('snapshot is PII-stripped on disk; state.json holds name only', async () => {
  const t = await setup({ orders: [mkOrder('SDT-7KQ2')], config: { autoLoad: false } });
  await t.queue.poll();
  const snap = await readFile(path.join(t.root, 'data', 'SDT-7KQ2.json'), 'utf8');
  const st = await readFile(path.join(t.root, 'state.json'), 'utf8');
  for (const s of ['pat@example.com', '555-0100', '9 Elm St']) { assert.ok(!snap.includes(s)); assert.ok(!st.includes(s)); }
  assert.ok(snap.includes('Pat SDT-7KQ2'));
});

test('photo orders download via the API and land as manual jobs', async () => {
  const p = tag('f07'); p.photo = true; p.front = []; p.back = ['CALL 555'];
  const t = await setup({ orders: [mkOrder('SDT-7KQ2', { tags: [p] })], config: { autoLoad: false } });
  await t.queue.poll();
  assert.deepEqual(t.calls.photo, [['SDT-7KQ2', 0]]);
  assert.equal(t.state.job('SDT-7KQ2').status, 'manual');
});

const GOOD_PHOTO = await readFile(path.join(here, '..', '..', 'site', 'assets', 'whisky-tag-real.jpg'));
const photoOrder = (id) => mkOrder(id, { tags: [{ ...tag('f07'), shape: 'bone', finish: 'polished', icon: 'none', photo: true, front: [], back: ['WHISKY'], qty: 3 }] });

test('a real-sized photo order generates automatically; the halftone variant loads by name and by path', async () => {
  const t = await setup({ orders: [photoOrder('SDT-7KQ2')], config: { autoLoad: false } });
  t.api.getPhoto = async () => ({ bytes: GOOD_PHOTO, contentType: 'image/jpeg' });
  await t.queue.poll();
  assert.equal(t.state.job('SDT-7KQ2').status, 'queued');
  const half = 'SDT-7KQ2-tag1-front-halftone.lbrn2';
  const r = await t.queue.loadForOperator({ orderId: 'SDT-7KQ2', file: half });
  assert.equal(r.ok, true);
  assert.ok(t.mock.received.some((c) => c.startsWith('FORCELOAD:') && c.endsWith(half)));
  assert.equal(t.state.data.lastLoaded.file, half);
  await new Promise((res) => setTimeout(res, 5100));   // minLoadGapMs
  const byPath = await t.queue.loadForOperator({ path: path.join(t.config.queueDir, 'SDT-7KQ2', half), verb: 'LOADFILE' });
  assert.equal(byPath.ok, true);
  assert.equal(t.state.data.lastLoaded.orderId, 'SDT-7KQ2', 'the CLI path form still records which order was loaded');
  assert.equal((await t.queue.loadForOperator({ orderId: 'SDT-7KQ2', file: 'SDT-7KQ2-tag1-front-halftone.svg' })).ok, false);
  assert.equal((await t.queue.loadForOperator({ orderId: 'SDT-7KQ2', file: 'SDT-7KQ2-tag1-back-halftone.lbrn2' })).ok, false);
  assert.deepEqual(await t.queue.reveal({ orderId: 'SDT-7KQ2', file: half }), { ok: true });
});

test('generation failure -> error, retried on later polls up to 3 attempts, then left alone', async () => {
  const t = await setup({ orders: [mkOrder('SDT-7KQ2')], config: { autoLoad: false } });
  // break font loading for this queue only
  const broken = createQueue({ config: t.config, state: t.state, api: t.api, lightburn: t.lightburn, dataDir: path.join(t.root, 'data'),
    fontOpts: { dir: path.join(t.root, 'nofonts'), fetchImpl: async () => { throw new Error('offline'); } } });
  await broken.poll();
  assert.equal(t.state.job('SDT-7KQ2').status, 'error');
  assert.equal(t.state.job('SDT-7KQ2').attempts, 1);
  assert.match(t.state.job('SDT-7KQ2').error, /fonts unavailable: offline/);
  await broken.poll(); await broken.poll();
  assert.equal(t.state.job('SDT-7KQ2').attempts, 3);
  assert.deepEqual((await broken.poll()).picked, []);
  // a manual Regenerate resets it
  assert.equal((await t.queue.regenerate('SDT-7KQ2')).ok, true);
  assert.equal(t.state.job('SDT-7KQ2').status, 'queued');
});

test('error job recovers on the next poll when the cause is fixed', async () => {
  const t = await setup({ orders: [mkOrder('SDT-7KQ2')], config: { autoLoad: false } });
  t.state.failed('SDT-7KQ2', 'boom', { dir: path.join(t.config.queueDir, 'SDT-7KQ2'), orderAt: 1, customerName: 'x', remoteStatus: 'paid' });
  assert.deepEqual((await t.queue.poll()).picked, ['SDT-7KQ2']);
  assert.equal(t.state.job('SDT-7KQ2').status, 'queued');
});

test('remote sync: made/shipped/done -> done(remote); cancelled -> banner only; absent -> missing banner', async () => {
  const t = await setup({ orders: [mkOrder('SDT-7KQ2'), mkOrder('SDT-2ABC'), mkOrder('SDT-3DEF')], config: { autoLoad: false } });
  await t.queue.poll();
  t.fake.orders = [mkOrder('SDT-7KQ2', { status: 'made' }), mkOrder('SDT-2ABC', { status: 'cancelled' })];   // 3DEF vanished
  await t.queue.poll();
  assert.equal(t.state.job('SDT-7KQ2').status, 'done');
  assert.equal(t.state.job('SDT-7KQ2').doneSource, 'remote');
  assert.equal(t.state.job('SDT-2ABC').status, 'queued');
  assert.equal(t.state.job('SDT-2ABC').remoteStatus, 'cancelled');
  assert.equal(t.state.job('SDT-3DEF').remoteMissing, true);
  const b = t.queue.banners();
  assert.ok(b.some((x) => x.includes('SDT-2ABC') && /cancelled/.test(x)));
  assert.ok(b.some((x) => x.includes('SDT-3DEF') && /no longer in the order list/.test(x)));
});

test('done orders are never regenerated even when remote is still paid', async () => {
  const t = await setup({ orders: [mkOrder('SDT-7KQ2')], config: { autoLoad: false } });
  await t.queue.poll();
  t.state.engraved('SDT-7KQ2');
  assert.deepEqual((await t.queue.poll()).picked, []);
});

test('API failure: no state change, failures counted, interval backs off; AUTH shows the key banner', async () => {
  const t = await setup({ orders: [mkOrder('SDT-7KQ2')], config: { autoLoad: false } });
  t.fake.listError = new ApiError('HTTP_503', 'HTTP 503', 503);
  const r = await t.queue.poll();
  assert.equal(r.ok, false);
  assert.deepEqual(t.state.jobs, {});
  assert.equal(t.queue.rt.failures, 1);
  assert.equal(t.queue.kv().intervalS, 600);
  t.fake.listError = new ApiError('AUTH', 'admin key rejected (401)', 401);
  await t.queue.poll();
  assert.ok(t.queue.banners().some((b) => /Admin key rejected/.test(b)));
  t.fake.listError = null;
  assert.equal((await t.queue.poll()).ok, true);
  assert.equal(t.queue.rt.failures, 0);
});

test('queue folder not writable: nothing is picked, banner shown, nothing marked generated', async () => {
  const t = await setup({ orders: [mkOrder('SDT-7KQ2')], config: { autoLoad: false }, blockQueue: true });
  const r = await t.queue.poll();
  assert.deepEqual(r.picked, []);
  assert.deepEqual(t.state.jobs, {});
  assert.equal(t.queue.health().queueWritable, false);
  assert.ok(t.queue.banners().some((b) => /Cannot write to the queue folder/.test(b)));
});

test('Q7 auto-load: a new queued job is loaded with LOADFILE (never FORCELOAD) when autoLoad is on', async () => {
  const t = await setup({ orders: [mkOrder('SDT-7KQ2')] });
  const r = await t.queue.poll();
  assert.equal(r.autoLoaded.ok, true);
  assert.ok(t.mock.received.some((c) => c.startsWith('LOADFILE:') && c.includes('SDT-7KQ2-tag1-front.lbrn2')));
  assert.ok(!t.mock.received.some((c) => c.startsWith('FORCELOAD')));
  assert.equal(t.state.job('SDT-7KQ2').status, 'loaded');
  assert.equal(t.state.data.lastLoaded.orderId, 'SDT-7KQ2');
});

test('Q7 auto-load is off when autoLoad is false; and never for manual jobs or while the laser is busy', async () => {
  const off = await setup({ orders: [mkOrder('SDT-7KQ2')], config: { autoLoad: false } });
  await off.queue.poll();
  assert.equal(off.mock.received.filter((c) => /LOAD/.test(c)).length, 0);
  assert.equal(off.state.job('SDT-7KQ2').status, 'queued');

  const bad = tag('f02'); bad.shape = 'fish';
  const man = await setup({ orders: [mkOrder('SDT-7KQ2', { tags: [bad] })] });
  const r = await man.queue.poll();
  assert.equal(r.autoLoaded, null);
  assert.equal(man.mock.received.filter((c) => /LOAD/.test(c)).length, 0);

  const busy = await setup({ orders: [mkOrder('SDT-7KQ2')], lbHandler: (c) => (c === 'PING' ? 'OK' : c === 'STATUS' ? '!' : 'OK') });
  const rb = await busy.queue.poll();
  assert.equal(rb.autoLoaded.ok, false); assert.equal(rb.autoLoaded.code, 'LASER_BUSY');
  assert.equal(busy.mock.received.filter((c) => /LOAD/.test(c)).length, 0);
});

test('Q7 auto-load skips when another load happened in the last 5 s', async () => {
  const t = await setup({ orders: [mkOrder('SDT-7KQ2'), mkOrder('SDT-2ABC')] });
  assert.equal((await t.lightburn.loadFile(path.join(t.config.queueDir, 'SDT-7KQ2', 'x.lbrn2'))).code, 'BAD_PATH');
  await t.queue.poll();                      // loads the oldest picked job
  const loads = t.mock.received.filter((c) => c.startsWith('LOADFILE:')).length;
  assert.equal(loads, 1);
  t.fake.orders.push(mkOrder('SDT-3DEF'));
  const r = await t.queue.poll();
  assert.equal(r.autoLoaded.code, 'RECENT_LOAD');
  assert.equal(t.mock.received.filter((c) => c.startsWith('LOADFILE:')).length, 1);
});

test('operator load with verb LOADFILE (demo-photo via the service) never sends FORCELOAD', async () => {
  const t = await setup({ orders: [mkOrder('SDT-7KQ2')], config: { autoLoad: false } });
  await t.queue.poll();
  const r = await t.queue.loadForOperator({ orderId: 'SDT-7KQ2', file: 'SDT-7KQ2-tag1-front.lbrn2', verb: 'LOADFILE' });
  assert.equal(r.ok, true);
  assert.ok(t.mock.received.some((c) => c.startsWith('LOADFILE:')));
  assert.ok(!t.mock.received.some((c) => c.startsWith('FORCELOAD')));
  assert.deepEqual(t.queue.health().caps, ['load-verb']);
});

test('operator load uses FORCELOAD; busy laser needs force; bad names rejected', async () => {
  let busy = true;
  const t = await setup({ orders: [mkOrder('SDT-7KQ2')], config: { autoLoad: false }, lbHandler: (c) => (c === 'PING' ? 'OK' : c === 'STATUS' ? (busy ? '!' : 'OK') : 'OK') });
  await t.queue.poll();
  const req = { orderId: 'SDT-7KQ2', file: 'SDT-7KQ2-tag1-front.lbrn2' };
  const r1 = await t.queue.loadForOperator(req);
  assert.equal(r1.code, 'LASER_BUSY');
  assert.equal(t.mock.received.filter((c) => c.startsWith('FORCELOAD')).length, 0);
  const r2 = await t.queue.loadForOperator({ ...req, force: true });
  assert.equal(r2.ok, true);
  assert.ok(t.mock.received.some((c) => c.startsWith('FORCELOAD:') && c.endsWith('SDT-7KQ2-tag1-front.lbrn2')));
  assert.equal(t.state.job('SDT-7KQ2').status, 'loaded');
  for (const bad of [{ orderId: 'SDT-7KQ2', file: '../job.json' }, { orderId: 'SDT-7KQ2', file: 'SDT-2ABC-tag1-front.lbrn2' }, { orderId: '../x', file: 'a.lbrn2' }, { orderId: 'SDT-7KQ2', file: 'SDT-7KQ2-tag1-front.svg' }]) {
    assert.equal((await t.queue.loadForOperator(bad)).ok, false, JSON.stringify(bad));
  }
  busy = false;
});

test('operator load by absolute path (CLI) is confined to the queue folder', async () => {
  const t = await setup({ orders: [mkOrder('SDT-7KQ2')], config: { autoLoad: false } });
  await t.queue.poll();
  const ok = await t.queue.loadForOperator({ path: path.join(t.config.queueDir, 'SDT-7KQ2', 'SDT-7KQ2-tag1-front.lbrn2') });
  assert.equal(ok.ok, true);
  assert.equal((await t.queue.loadForOperator({ path: '/etc/hosts' })).code, 'BAD_PATH');
});

test('Mark engraved: prints need confirmation; POSTs made; marks done; demo does not POST', async () => {
  const withPrints = mkOrder('SDT-7KQ2', { prints: [{ item: 'Benchy', qty: 1 }] });
  const t = await setup({ orders: [withPrints, mkOrder('SDT-2ABC')], config: { autoLoad: false } });
  await t.queue.poll();
  const r1 = await t.queue.engraved('SDT-7KQ2');
  assert.equal(r1.code, 'HAS_PRINTS'); assert.deepEqual(r1.prints, ['1x Benchy']);
  assert.equal(t.calls.setStatus.length, 0);
  assert.equal(t.state.job('SDT-7KQ2').status, 'queued');
  assert.equal((await t.queue.engraved('SDT-7KQ2', { confirmPrints: true })).ok, true);
  assert.deepEqual(t.calls.setStatus, [['SDT-7KQ2', 'made']]);
  assert.equal(t.state.job('SDT-7KQ2').status, 'done'); assert.equal(t.state.job('SDT-7KQ2').doneSource, 'ui');
  assert.equal((await t.queue.engraved('SDT-7KQ2', { confirmPrints: true })).code, 'NOT_OPEN');
  await t.queue.demo();
  assert.equal((await t.queue.engraved('SDT-DEMO')).ok, true);
  assert.equal(t.calls.setStatus.length, 1, 'no POST for demo');
});

test('Mark engraved: a failed POST leaves the job open', async () => {
  const t = await setup({ orders: [mkOrder('SDT-7KQ2')], config: { autoLoad: false } });
  await t.queue.poll();
  t.fake.setStatusError = new ApiError('HTTP_500', 'HTTP 500', 500);
  const r = await t.queue.engraved('SDT-7KQ2');
  assert.equal(r.ok, false);
  assert.equal(t.state.job('SDT-7KQ2').status, 'queued');
});

test('Q7 after-engraved: loads the next queued job with LOADFILE; off when disabled', async () => {
  const t = await setup({ orders: [mkOrder('SDT-7KQ2'), mkOrder('SDT-2ABC')], config: { autoLoad: true }, lbOver: { minLoadGapMs: 1 } });
  t.config.autoLoad = false; await t.queue.poll(); t.config.autoLoad = true;   // generate both without auto-loading
  const r = await t.queue.engraved('SDT-7KQ2');
  assert.equal(r.ok, true);
  assert.equal(r.autoLoaded.orderId, 'SDT-2ABC'); assert.equal(r.autoLoaded.ok, true);
  assert.ok(t.mock.received.some((c) => c.startsWith('LOADFILE:') && c.includes('SDT-2ABC-tag1-front')));
  assert.ok(!t.mock.received.some((c) => c.startsWith('FORCELOAD')));

  const off = await setup({ orders: [mkOrder('SDT-7KQ2'), mkOrder('SDT-2ABC')], config: { autoLoad: false }, lbOver: { minLoadGapMs: 1 } });
  await off.queue.poll();
  const r2 = await off.queue.engraved('SDT-7KQ2');
  assert.equal(r2.autoLoaded, undefined);
  const off2 = await setup({ orders: [mkOrder('SDT-7KQ2'), mkOrder('SDT-2ABC')], config: { autoLoad: true, autoLoadAfterEngraved: false }, lbOver: { minLoadGapMs: 1 } });
  off2.config.autoLoad = false; await off2.queue.poll(); off2.config.autoLoad = true;
  assert.equal((await off2.queue.engraved('SDT-7KQ2')).autoLoaded, undefined);
});

test('after-engraved skips cancelled and manual jobs; does nothing if LightBurn is down', async () => {
  const t = await setup({ orders: [mkOrder('SDT-7KQ2'), mkOrder('SDT-2ABC')], config: { autoLoad: false }, lbOver: { minLoadGapMs: 1 } });
  await t.queue.poll();
  t.state.remote('SDT-2ABC', 'cancelled');
  t.config.autoLoad = true;
  assert.equal((await t.queue.engraved('SDT-7KQ2')).autoLoaded, undefined);
  const down = await setup({ orders: [mkOrder('SDT-7KQ2'), mkOrder('SDT-2ABC')], config: { autoLoad: false }, noLb: true });
  await down.queue.poll();
  down.config.autoLoad = true;
  const r = await down.queue.engraved('SDT-7KQ2');
  assert.equal(r.autoLoaded.ok, false);
  assert.equal(down.state.job('SDT-2ABC').status, 'queued');
});

test('regenerate: cancelled refused; API down falls back to the snapshot with a warning; demo works offline', async () => {
  const t = await setup({ orders: [mkOrder('SDT-7KQ2')], config: { autoLoad: false } });
  await t.queue.poll();
  const first = await readdir(path.join(t.config.queueDir, 'SDT-7KQ2'));
  t.fake.listError = new ApiError('NETWORK', 'network error', undefined);
  const r = await t.queue.regenerate('SDT-7KQ2');
  assert.equal(r.ok, true);
  assert.ok(r.warnings.some((w) => /snapshot/.test(w)));
  assert.ok((await readdir(path.join(t.config.queueDir, 'SDT-7KQ2'))).includes('old'));
  assert.ok(first.length > 0);
  t.fake.listError = null;
  t.fake.orders = [mkOrder('SDT-7KQ2', { status: 'cancelled' })];
  assert.equal((await t.queue.regenerate('SDT-7KQ2')).code, 'CANCELLED');
  assert.equal((await t.queue.regenerate('../etc')).code, 'BAD_ID');
  t.fake.orders = [mkOrder('SDT-7KQ2', { status: 'invoiced' })];
  const warn = await t.queue.regenerate('SDT-7KQ2');
  assert.ok(warn.warnings.some((w) => /not paid/.test(w)));
});

test('demo: both orders generated through the real path, flagged demo, ignored by remote sync', async () => {
  const t = await setup({ orders: [], config: { autoLoad: false } });
  const r = await t.queue.demo();
  assert.equal(r.ok, true);
  assert.equal(t.state.job('SDT-DEMO').status, 'queued');
  assert.equal(t.state.job('SDT-OOPS').status, 'manual');
  assert.equal(t.state.job('SDT-DEMO').demo, true);
  await t.queue.poll();   // API list is empty; demo jobs must not be flagged missing
  assert.equal(t.state.job('SDT-DEMO').remoteMissing, false);
  const again = await t.queue.demo();
  assert.equal(again.ok, true);
  assert.ok((await readdir(path.join(t.config.queueDir, 'SDT-DEMO'))).includes('old'));
});

test('views: open jobs oldest first, done limited to 20, no dir leaked', async () => {
  const t = await setup({ orders: [], config: { autoLoad: false } });
  for (let i = 0; i < 25; i++) {
    const id = `SDT-${'ABCDEFGHJKMNPQRSTUVWXYZ'[i]}2${'3'}${'4'}`;
    t.state.generated(id, { mode: 'queued', dir: '/x', orderAt: i, customerName: 'n', remoteStatus: 'paid' });
    t.state.engraved(id);
  }
  t.state.generated('SDT-7KQ2', { mode: 'queued', dir: '/secret/dir', orderAt: 5, customerName: 'n', remoteStatus: 'paid' });
  const v = await t.queue.views();
  assert.equal(v.jobs.filter((j) => j.status === 'done').length, 20);
  assert.equal(v.jobs.filter((j) => j.status !== 'done').length, 1);
  assert.ok(!JSON.stringify(v).includes('/secret/dir'));
});

test('reveal validates ids and files, runs open -R without a shell', async () => {
  const t = await setup({ orders: [], config: { autoLoad: false } });
  assert.equal((await t.queue.reveal({ orderId: 'SDT-7KQ2' })).ok, true);
  assert.deepEqual(t.calls.open, ['/usr/bin/open', ['-R', path.join(t.config.queueDir, 'SDT-7KQ2')]]);
  assert.equal((await t.queue.reveal({ orderId: '../x' })).ok, false);
  assert.equal((await t.queue.reveal({ orderId: 'SDT-7KQ2', file: '../../etc/passwd' })).ok, false);
  assert.equal((await t.queue.reveal({ orderId: 'SDT-7KQ2', file: 'SDT-2ABC-tag1-front.lbrn2' })).ok, false);
});

test('R6: the admin key never reaches state.json, job.json, or the lbrn2 files', async () => {
  const t = await setup({ orders: [mkOrder('SDT-7KQ2')], config: { autoLoad: false } });
  await t.queue.poll();
  const dir = path.join(t.config.queueDir, 'SDT-7KQ2');
  const key = (await readFile(path.join(here, '..', '..', '.admin-key'), 'utf8').catch(() => '')).trim();
  if (key.length === 32) {
    for (const f of await readdir(dir)) if (!(await readdir(dir, { withFileTypes: true })).find((e) => e.name === f).isDirectory()) assert.ok(!(await readFile(path.join(dir, f), 'utf8')).includes(key));
    assert.ok(!(await readFile(path.join(t.root, 'state.json'), 'utf8')).includes(key));
  }
});

test('S1: demo jobs are never auto-loaded, and never jump ahead of real orders after Mark engraved', async () => {
  const t = await setup({ orders: [mkOrder('SDT-7KQ2'), mkOrder('SDT-2ABC')], config: { autoLoad: false }, lbOver: { minLoadGapMs: 1 } });
  await t.queue.demo();                 // demo orders have the oldest `at`, so they sort first
  await t.queue.poll();                 // two real jobs
  t.config.autoLoad = true;
  assert.equal(t.state.job('SDT-DEMO').status, 'queued');
  const r = await t.queue.engraved('SDT-7KQ2');
  assert.equal(r.ok, true);
  assert.equal(r.autoLoaded.orderId, 'SDT-2ABC', 'the next REAL order loads, not SDT-DEMO');
  assert.ok(t.mock.received.every((c) => !c.includes('SDT-DEMO')));
  assert.equal((await t.queue.autoLoadJob('SDT-DEMO', 'test')).code, 'NOT_ELIGIBLE');
  assert.equal(t.state.job('SDT-DEMO').status, 'queued');
});

test('S1: with only a demo job left, nothing auto-loads', async () => {
  const t = await setup({ orders: [mkOrder('SDT-7KQ2')], config: { autoLoad: false }, lbOver: { minLoadGapMs: 1 } });
  await t.queue.demo();
  await t.queue.poll();
  t.config.autoLoad = true;
  const r = await t.queue.engraved('SDT-7KQ2');
  assert.equal(r.ok, true);
  assert.equal(r.autoLoaded, undefined);
  assert.equal(t.mock.received.filter((c) => /LOAD/.test(c)).length, 0);
});

test('S1: a new demo job generated by a poll path is not auto-loaded either', async () => {
  const t = await setup({ orders: [], config: { autoLoad: true } });
  await t.queue.demo();
  assert.equal(t.mock.received.filter((c) => /LOAD/.test(c)).length, 0);
});

test('S1/S2: queue.poll({auto:false}) generates but never loads; operator can still load a demo file explicitly', async () => {
  const t = await setup({ orders: [mkOrder('SDT-7KQ2')], config: { autoLoad: true } });
  const r = await t.queue.poll({ auto: false });
  assert.equal(r.autoLoaded, null);
  assert.equal(t.mock.received.filter((c) => /LOAD/.test(c)).length, 0);
  await t.queue.demo();
  const ex = await t.queue.loadForOperator({ orderId: 'SDT-DEMO', file: 'SDT-DEMO-tag1-front.lbrn2', force: true });
  assert.equal(ex.ok, true);
  assert.ok(t.mock.received.some((c) => c.startsWith('FORCELOAD:') && c.includes('SDT-DEMO')));
});

test('N4: demo --load logs which file was loaded', async () => {
  const { log } = await import('../lib/log.mjs');
  const t = await setup({ orders: [], config: { autoLoad: false } });
  const r = await t.queue.demo({ load: true });
  assert.equal(r.loaded.ok, true);
  assert.ok(log.recent().some((l) => /load ok SDT-DEMO-tag1-front\.lbrn2/.test(l)));
  assert.ok(t.mock.received.some((c) => c.startsWith('LOADFILE:') && c.includes('SDT-DEMO-tag1-front')));
});

// ---- notifications (Feature 2) ----
const bodies = (t) => t.calls.notes.map((n) => n.args[n.args.indexOf('--') + 1]);

test('notify: an auto-loaded job announces tag, side, and qty', async () => {
  const o = mkOrder('SDT-7KQ2'); o.tags[0].qty = 2;
  const t = await setup({ orders: [o], notes: true });
  await t.queue.poll();
  assert.deepEqual(bodies(t), ['SDT-7KQ2 tag1 front loaded in LightBurn. Check outline, Frame, Start (qty 2).']);
  const n = t.calls.notes[0];
  assert.equal(n.bin, '/usr/bin/osascript');
  assert.deepEqual(n.args.slice(0, 6), ['-e', 'on run argv', '-e', 'display notification (item 1 of argv) with title (item 2 of argv)', '-e', 'end run']);
  assert.equal(n.args.at(-1), 'Salty Dog Tags');
  assert.equal(n.opts.timeout, 3000);
  assert.equal((await t.queue.poll()).picked.length, 0);
  assert.equal(t.calls.notes.length, 1, 'a poll with nothing new says nothing');
});

test('notify: a new job that is not auto-loaded says why (manual, LightBurn down, auto-load off)', async () => {
  const bad = tag('f02'); bad.shape = 'hydrant';
  const man = await setup({ orders: [mkOrder('SDT-7KQ2', { tags: [bad] })], notes: true });
  await man.queue.poll();
  assert.deepEqual(bodies(man), ['SDT-7KQ2 ready (manual: No laser outline for shape "hydrant" yet. Lay it out by hand.)']);

  const down = await setup({ orders: [mkOrder('SDT-7KQ2')], notes: true, lbHandler: () => null });
  await down.queue.poll();
  assert.deepEqual(bodies(down), ['SDT-7KQ2 ready, LightBurn not responding']);

  const off = await setup({ orders: [mkOrder('SDT-7KQ2')], config: { autoLoad: false }, notes: true });
  await off.queue.poll();
  assert.deepEqual(bodies(off), ['SDT-7KQ2 ready, auto-load is off']);
});

test('notify: a generation error announces itself with the attempt count', async () => {
  const t = await setup({ orders: [mkOrder('SDT-7KQ2')], config: { autoLoad: false }, notes: true });
  const broken = createQueue({ config: t.config, state: t.state, api: t.api, lightburn: t.lightburn, dataDir: path.join(t.root, 'data'),
    notifyExec: (bin, args, opts, cb) => { t.calls.notes.push({ bin, args, opts }); cb(null); },
    fontOpts: { dir: path.join(t.root, 'nofonts'), fetchImpl: async () => { throw new Error('offline'); } } });
  await broken.poll();
  assert.deepEqual(bodies(t), ['SDT-7KQ2 failed to generate: fonts unavailable: offline (attempt 1 of 3)']);
});

test('notify: never for demo orders, regenerate, or when notify is false; a backlog collapses to a summary', async () => {
  const t = await setup({ orders: [mkOrder('SDT-7KQ2')], notes: true, config: { autoLoad: false } });
  await t.queue.demo();
  await t.queue.regenerate('SDT-DEMO');
  assert.equal(t.calls.notes.length, 0);
  const quiet = await setup({ orders: [mkOrder('SDT-7KQ2')], notes: true, config: { notify: false } });
  await quiet.queue.poll();
  assert.equal(quiet.calls.notes.length, 0);
  const ids = ['SDT-2ABC', 'SDT-3DEF', 'SDT-4GHJ', 'SDT-5KMN', 'SDT-6PQR', 'SDT-7STU', 'SDT-8VWX'];
  const many = await setup({ orders: ids.map((id) => mkOrder(id)), notes: true, config: { autoLoad: false } });
  await many.queue.poll();
  assert.equal(many.calls.notes.length, 6);
  assert.equal(bodies(many).at(-1), '2 more orders need attention. Open the queue page.');
});
