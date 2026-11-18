// POST /api/tags/mint { orderId } (admin). Mints the QR id for every smart entry of the order that has none. Idempotent: running it
// twice returns the same ids. This is the "Mint QR id" button on the orders page, for orders saved while D1 was down.
import { json, isAdmin, str } from '../_lib.js';
import { mintOrderTags } from '../_tagdb.js';
import { hasDb, smartEnabled } from '../_tagsettings.js';

export async function onRequestPost({ request, env }) {
  if (!isAdmin(request, env)) return json({ error: 'nope' }, 401);
  let body; try { body = await request.json(); } catch { return json({ error: 'bad json' }, 400); }
  if (!body || typeof body !== 'object') return json({ error: 'bad json' }, 400);
  if (!hasDb(env)) return json({ error: 'The tag database is not connected yet (README: Smart QR tag setup).' }, 503);
  if (!smartEnabled(env)) return json({ error: 'Smart tags are switched off (SMART_ENABLED=false).' }, 503);
  const id = str(body.orderId, 12);
  const raw = await env.ORDERS.get('order:' + id);
  if (!raw) return json({ error: 'no such order' }, 404);
  const o = JSON.parse(raw);
  if (o.status === 'cancelled') return json({ error: 'That order is cancelled.' }, 409);
  const r = await mintOrderTags(env, o);
  if (r.minted) { o.updated = Date.now(); await env.ORDERS.put('order:' + o.id, JSON.stringify(o)); }
  delete o.ua; delete o.ip;
  return json({ ok: r.failed === 0, ...r, order: o }, r.failed ? 502 : 200);
}
