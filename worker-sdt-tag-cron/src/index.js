// worker-sdt-tag-cron: the smart QR tag's scheduled jobs. Pages Functions have no cron triggers, so this small Worker shares the D1 database.
//   every 15 min  retry alerts that failed in the last 2 hours, send queued message digests
//   daily         purge expired data (30 day scans, 24 h ip hashes, tokens, counters) and run the /T/ canary
// GET /health (Bearer ADMIN_KEY not needed: it returns nothing but "ok" and the times) lets Breaker see the worker is alive.
import { retryFailed, sendDigests } from '../../functions/api/_tagnotify.js';
import { purgeAll, runCanary } from '../../functions/api/_tagpurge.js';

export async function runJobs(env, cron, now = Date.now()) {
  const out = {};
  out.retry = await retryFailed(env, now);
  out.digests = await sendDigests(env, now);
  await env.TAGDB.prepare("INSERT INTO meta(k, v, at) VALUES('last_retry_at', 'ok', ?1) ON CONFLICT(k) DO UPDATE SET v = 'ok', at = ?1").bind(now).run();
  if (cron === '17 9 * * *' || cron === 'daily') {
    out.purge = await purgeAll(env, now);
    out.canary = await runCanary(env, fetch, now);
  }
  return out;
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runJobs(env, event.cron).then((o) => console.log('tag cron', JSON.stringify({ retry: o.retry, digests: o.digests, purge: o.purge, canary: o.canary && o.canary.ok }))).catch((e) => console.warn('tag cron failed', String((e && e.message) || e).slice(0, 100))));
  },
  async fetch(request, env) {
    const r = await env.TAGDB.prepare("SELECT k, at FROM meta WHERE k IN ('last_purge_at','last_retry_at')").all().catch(() => ({ results: [] }));
    const m = {}; for (const x of r.results) m[x.k] = x.at;
    return new Response(JSON.stringify({ ok: true, lastPurgeAt: m.last_purge_at || null, lastRetryAt: m.last_retry_at || null }), { headers: { 'content-type': 'application/json' } });
  }
};
