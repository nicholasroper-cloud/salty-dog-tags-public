// Wall of Shame. GET public (approved entries, cached 60s). POST/DELETE admin only.
// KV (ORDERS): wall:<id> entry JSON, wall:index JSON array of ids (newest first), wallimg:<id> base64 jpeg.
import { json, isAdmin, str } from './_lib.js';

const MAX_BODY = 420 * 1024;      // raw request body
const MAX_IMG_BYTES = 300 * 1024; // decoded jpeg
const MAX_ENTRIES = 300;
const ALPHA = 'abcdefghjkmnpqrstuvwxyz23456789';
const newId = () => { const b = new Uint8Array(8); crypto.getRandomValues(b); return Array.from(b, (x) => ALPHA[x % ALPHA.length]).join(''); };
const readIndex = async (env) => { try { const v = await env.ORDERS.get('wall:index', 'json'); return Array.isArray(v) ? v : []; } catch { return []; } };

export async function onRequestGet({ env }) {
  const ids = (await readIndex(env)).slice(0, MAX_ENTRIES);
  const rows = await Promise.all(ids.map((id) => env.ORDERS.get('wall:' + id, 'json').catch(() => null)));
  const entries = rows.filter((e) => e && e.approved !== false).map((e) => ({
    id: e.id, name: e.name, breed: e.breed, roast: e.roast, line1: e.line1, line2: e.line2,
    image: '/api/wall/img?id=' + e.id, city: e.city, date: e.date,
  }));
  return json({ entries }, 200, { 'cache-control': 'public, max-age=60' });
}

export async function onRequestPost({ request, env }) {
  if (!isAdmin(request, env)) return json({ error: 'unauthorized' }, 401);
  const len = Number(request.headers.get('content-length') || 0);
  if (len > MAX_BODY) return json({ error: 'payload too large (max 400KB)' }, 413);
  const raw = await request.text();
  if (raw.length > MAX_BODY) return json({ error: 'payload too large (max 400KB)' }, 413);
  let b; try { b = JSON.parse(raw); } catch { return json({ error: 'bad json' }, 400); }
  if (!b || typeof b !== 'object' || Array.isArray(b)) return json({ error: 'bad json' }, 400);
  if (b.consent !== true) return json({ error: 'consent required' }, 400);
  const name = str(b.name, 40), roast = str(b.roast, 280);
  if (!name || !roast) return json({ error: 'name and roast required' }, 400);
  let img = String(b.image || '').replace(/^data:image\/jpeg;base64,/, '').replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/]+=*$/.test(img) || !img.startsWith('/9j/')) return json({ error: 'image must be base64 jpeg' }, 400);
  if (Math.floor(img.length * 3 / 4) > MAX_IMG_BYTES) return json({ error: 'image too large (max 300KB)' }, 413);
  const id = newId(), now = new Date().toISOString();
  const entry = {
    id, name, breed: str(b.breed, 40), roast, line1: str(b.line1, 30), line2: str(b.line2, 30), city: str(b.city, 60),
    date: now.slice(0, 10), approved: true, consent: true, consentAt: now,
  };
  await env.ORDERS.put('wallimg:' + id, img);
  await env.ORDERS.put('wall:' + id, JSON.stringify(entry));
  const idx = await readIndex(env);
  await env.ORDERS.put('wall:index', JSON.stringify([id, ...idx.filter((x) => x !== id)]));
  return json({ ok: true, entry });
}

export async function onRequestDelete({ request, env }) {
  if (!isAdmin(request, env)) return json({ error: 'unauthorized' }, 401);
  const id = str(new URL(request.url).searchParams.get('id'), 20);
  if (!/^[a-z0-9]+$/.test(id)) return json({ error: 'bad id' }, 400);
  await env.ORDERS.delete('wall:' + id);
  await env.ORDERS.delete('wallimg:' + id);
  // Drop the cached image at this edge so a consent removal takes effect here immediately; other edges expire within an hour.
  try { await caches.default.delete(new URL('/api/wall/img?id=' + id, request.url).toString()); } catch {}
  const idx = await readIndex(env);
  await env.ORDERS.put('wall:index', JSON.stringify(idx.filter((x) => x !== id)));
  return json({ ok: true });
}
