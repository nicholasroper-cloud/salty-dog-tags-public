// node --test tools/test/
// ORNAMENT_ENABLED = false (Nick, 2026-11-16: "not going to do ornaments as of now"): no page, no links anywhere, the server refuses the
// ornament kind. All ornament code stays; the other test files run it with the flag on in-process (ORNAMENTS_ON, _ornament.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, statSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { onRequestPost as place } from '../../functions/api/order.js';
import { ORNAMENT_ENABLED, ornamentsOn, FULLCOLOR_SHAPES, ACTIVE_SHAPES, FULLCOLOR_PRICE } from '../../functions/api/_lib.js';
import { read, ROOT } from '../lib/appdata.mjs';
import { mkJpeg, dataUrl } from './_images.mjs';

const walk = (dir, out = []) => { for (const e of readdirSync(dir)) { const p = join(dir, e); if (statSync(p).isDirectory()) walk(p, out); else if (/\.(html|md|txt|xml)$/.test(e)) out.push(p); } return out; };
const siteFiles = walk(join(ROOT, 'site'));
const kv = () => { const m = new Map(); return { get: async (k) => m.get(k)?.v ?? null, put: async (k, v) => { m.set(k, { v }); }, delete: async (k) => { m.delete(k); }, getWithMetadata: async (k) => ({ value: m.get(k)?.v ?? null, metadata: null }), _m: m }; };
const base = { name: 'Nick Roper', email: 'n@example.com', delivery: 'ship', street: '123 Main St', city: 'Lehi', state: 'FL', zip: '33601' };
const orn = { tier: 'acrylic', name: 'Whisky', year: '2026', qty: 1, art: 'design', style: 'bold' };
const post = (body, env = {}) => place({ request: new Request('https://x.test/api/order', { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.77' }, body: JSON.stringify(body) }), env: { ORDERS: kv(), ...env }, waitUntil() {} }).then(async (r) => ({ status: r.status, data: await r.json() }));

test('the master switch is off in both places and they agree', () => {
  assert.equal(ORNAMENT_ENABLED, false);
  assert.equal(/const ORNAMENT_ENABLED = (true|false)/.exec(read('site/app.js'))[1], String(ORNAMENT_ENABLED));
  assert.equal(ornamentsOn({}), false); assert.equal(ornamentsOn({ ORNAMENTS_ON: 'true' }), true);
});

test('no /ornament/ page, and nothing links to it: not in the sitemap, llms files, markdown map, nav, menu, footer or home promo', () => {
  assert.equal(existsSync(join(ROOT, 'site/ornament')), false);
  for (const f of ['site/sitemap.xml', 'site/llms.txt', 'site/llms-full.txt', 'functions/_md-map.js']) assert.ok(!/\/ornament\//.test(read(f)), f);
  const bad = siteFiles.filter((f) => !f.endsWith('orders.html') && /href="\/ornament\/"|ornament-promo|Holiday ornament|Holiday pet photo ornament/i.test(readFileSync(f, 'utf8')));
  assert.deepEqual(bad.map((f) => f.slice(ROOT.length + 1)), []);
  const home = read('site/index.html');
  assert.ok(!/ornament/i.test(home), 'the home page does not mention ornaments at all');
  assert.equal((home.match(/<!--sdt:orn-[a-z]+-->/g) || []).length, 4, 'the four marker pairs are still there so the flag can bring the links back');
  assert.ok(!/Dec 12|Christmas in the lower 48/.test(home), 'the holiday cutoff text lived on the ornament page and the promo card');
});

test('the server refuses the ornament kind with a 400 while the flag is off, and accepts it with the switch on', async () => {
  const off = await post({ ...base, ornaments: [orn] });
  assert.equal(off.status, 400); assert.match(off.data.error, /not available/);
  const on = await post({ ...base, ornaments: [orn] }, { ORNAMENTS_ON: 'true' });
  assert.equal(on.status, 200);
  const tagOnly = await post({ ...base, ornaments: [], tags: [{ shape: 'bone', size: 'medium', finish: 'fullcolor', font: 'block', qty: 1, front1: 'Built like', back1: 'W', back2: '801-336-2244', art: 'design', style: 'bold' }] });
  assert.equal(tagOnly.status, 200, 'full-color tags are unaffected');
});

test('client: the cart drops ornament lines and addOrnament refuses while the flag is off; the orders page still renders ornament orders', () => {
  const app = read('site/app.js');
  assert.match(app, /\(i\.kind !== 'ornament' \|\| ORNAMENT_ENABLED\)/);
  assert.match(app, /if \(!ORNAMENT_ENABLED\) return \{ ok: false, error: 'Ornaments are not available right now\.' \}/);
  const orders = read('site/orders.html');
  assert.ok(orders.includes('o.ornaments') && orders.includes('Holiday ornament'), 'an ornament order that already exists still shows');
});

test('full color: every active shape in every size (the O1 scans and masks the placed blank); the constant can still be trimmed', () => {
  for (const s of ACTIVE_SHAPES) assert.ok(FULLCOLOR_SHAPES.includes(s), s);
  assert.deepEqual(Object.keys(FULLCOLOR_PRICE).sort(), ['large', 'medium', 'small', 'xl']);
  for (const f of ['tools/README.md', 'functions/api/_lib.js', 'site/index.html', 'site/app.js']) assert.ok(!/printable blank|which blanks|in stock\)/i.test(read(f)), f + ' carries no blanks caveat');
  assert.match(read('site/orders.html'), /place the blank on the bed, run the camera scan, and align the art to the auto-mask\. The sheet's mm outline is a reference, not the mask\./);
});
