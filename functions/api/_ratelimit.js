// Rate limits and daily caps for the smart tag routes. Counters live in D1 (KV writes are scarce and shared with orders);
// a tiny in-memory "speed bump" per isolate absorbs a hot loop before it ever reaches the database.
// Everything fails CLOSED: if D1 cannot count, the caller is told no (except where a caller passes failOpen for a read-only page).
import { ipKey } from './_lib.js';
import { hasDb } from './_tagsettings.js';

const bumps = new Map();
// At most `limit` calls per `ms` for `key` in this isolate. Cheap, approximate, and only a first line of defense.
export function speedBump(key, limit = 120, ms = 60_000, now = Date.now()) {
  const b = bumps.get(key);
  if (!b || now - b.t0 > ms) { bumps.set(key, { t0: now, n: 1 }); if (bumps.size > 5000) bumps.clear(); return true; }
  b.n++;
  return b.n <= limit;
}
export const _resetSpeedBumps = () => bumps.clear();

// One counted hit. Returns { ok, n } (ok false once n exceeds `limit` in the window) or { ok:false, error:true } when D1 failed.
export async function hit(env, key, limit, windowSec, now = Date.now()) {
  if (!hasDb(env)) return { ok: false, error: true };
  try {
    const exp = now + windowSec * 1000;
    const row = await env.TAGDB.prepare(
      `INSERT INTO counters(k, n, expires_at) VALUES(?1, 1, ?2)
       ON CONFLICT(k) DO UPDATE SET n = CASE WHEN expires_at <= ?3 THEN 1 ELSE n + 1 END, expires_at = CASE WHEN expires_at <= ?3 THEN ?2 ELSE expires_at END
       RETURNING n`).bind(key, exp, now).first();
    const n = row ? row.n : 1;
    return { ok: n <= limit, n };
  } catch { return { ok: false, error: true }; }
}
// Reads a counter without counting.
export async function peek(env, key, now = Date.now()) {
  try {
    const r = await env.TAGDB.prepare('SELECT n FROM counters WHERE k = ?1 AND expires_at > ?2').bind(key, now).first();
    return r ? r.n : 0;
  } catch { return 0; }
}
export async function ipHashOf(env, request) { return ipKey(env, request); }
export const rl = async (env, request, name, [limit, win], extra = '') => hit(env, `rl:${name}:${await ipKey(env, request)}${extra ? ':' + extra : ''}`, limit, win);
export async function purgeCounters(env, now = Date.now()) {
  const r = await env.TAGDB.prepare('DELETE FROM counters WHERE expires_at <= ?1').bind(now).run();
  return r.meta.changes;
}
