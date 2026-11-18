// GET /api/tags/health (admin; Breaker polls it). Counts only: never a phone number, email, coordinate, or message.
import { json, isAdmin } from '../_lib.js';
import { hasDb, smartEnabled, smsFlag, smsReady } from '../_tagsettings.js';

const DAY = 24 * 3600 * 1000;
export async function onRequestGet({ request, env }) {
  if (!isAdmin(request, env)) return json({ error: 'nope' }, 401);
  const out = { ok: false, db: hasDb(env), smartEnabled: smartEnabled(env), sms: { flag: smsFlag(env), ready: smsReady(env) }, now: Date.now() };
  if (!hasDb(env)) return json(out, 503);
  const since = Date.now() - DAY;
  try {
    const q = (sql, ...a) => env.TAGDB.prepare(sql).bind(...a);
    const [scans, alerts, tags, metaRows, pending] = await Promise.all([
      q("SELECT COUNT(*) AS n FROM scans WHERE at > ?1 AND by_owner = 0", since).first(),
      q("SELECT channel, status, COUNT(*) AS n FROM alerts WHERE at > ?1 GROUP BY channel, status", since).all(),
      q("SELECT status, COUNT(*) AS n FROM tags GROUP BY status").all(),
      q("SELECT k, v, at FROM meta WHERE k IN ('last_purge_at','last_retry_at','canary')").all(),
      q("SELECT COUNT(*) AS n FROM alerts WHERE status = 'failed' AND at > ?1", Date.now() - 2 * 3600 * 1000).first()
    ]);
    const meta = {}; for (const r of metaRows.results) meta[r.k] = { v: r.v, at: r.at };
    out.scans24h = scans.n;
    out.alerts24h = {}; for (const r of alerts.results) (out.alerts24h[r.channel] ||= {})[r.status] = r.n;
    out.tags = {}; for (const r of tags.results) out.tags[r.status] = r.n;
    out.failedLast2h = pending.n;
    out.lastPurgeAt = (meta.last_purge_at && meta.last_purge_at.at) || null;
    out.lastRetryAt = (meta.last_retry_at && meta.last_retry_at.at) || null;
    out.canary = meta.canary ? { ok: meta.canary.v === 'ok', at: meta.canary.at } : null;
    out.purgeStale = !out.lastPurgeAt || Date.now() - out.lastPurgeAt > 48 * 3600 * 1000;
    out.ok = !out.purgeStale && (!out.canary || out.canary.ok);
  } catch { out.error = 'database error'; return json(out, 502); }
  return json(out);
}
