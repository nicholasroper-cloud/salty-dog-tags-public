// Retention (ADR section 5). Runs daily from worker-sdt-tag-cron, and per tag on every counted scan. Only deletes; migrations never do.
//   scans (with any location, message, finder contact)  30 days unless the owner kept them (keep = 1)
//   scans.ip_hash                                       nulled after 24 h
//   alerts                                              30 days
//   tokens, sessions, counters, sms codes               when used or expired
import { LIMITS } from './_tagsettings.js';

export async function purgeTag(env, tagId, now = Date.now()) {
  const r = await env.TAGDB.prepare('DELETE FROM scans WHERE tag_id = ?1 AND keep = 0 AND at < ?2').bind(tagId, now - LIMITS.scanKeepMs).run();
  return r.meta.changes;
}

export async function purgeAll(env, now = Date.now()) {
  const run = async (sql, ...a) => (await env.TAGDB.prepare(sql).bind(...a).run()).meta.changes;
  const out = {};
  out.scans = await run('DELETE FROM scans WHERE keep = 0 AND at < ?1', now - LIMITS.scanKeepMs);
  out.ipHashes = await run('UPDATE scans SET ip_hash = NULL WHERE ip_hash IS NOT NULL AND at < ?1', now - LIMITS.ipHashKeepMs);
  out.alerts = await run('DELETE FROM alerts WHERE at < ?1', now - LIMITS.alertKeepMs);
  out.loginTokens = await run('DELETE FROM login_tokens WHERE used_at IS NOT NULL OR expires_at < ?1', now);
  out.sessions = await run('DELETE FROM sessions WHERE expires_at < ?1', now);
  out.counters = await run('DELETE FROM counters WHERE expires_at < ?1', now);
  out.smsCodes = await run('DELETE FROM sms_codes WHERE expires_at < ?1', now);
  await env.TAGDB.prepare("INSERT INTO meta(k, v, at) VALUES('last_purge_at', 'ok', ?1) ON CONFLICT(k) DO UPDATE SET v = 'ok', at = ?1").bind(now).run();
  return out;
}

// The daily canary: the upper case QR path must still reach the finder page. A removed Transform Rule turns it into a static 404.
export async function runCanary(env, fetchImpl = fetch, now = Date.now()) {
  const site = String(env.SITE_URL || 'https://saltydogtags.com').replace(/\/+$/, '');
  const id = String(env.CANARY_ID || 'CANARY0000').toUpperCase();
  let ok = false, why = '';
  try {
    const r = await fetchImpl(`${site}/T/${id}`, { redirect: 'manual', headers: { 'user-agent': 'sdt-tag-canary/1' } });
    ok = r.status === 200 && r.headers.get('x-sdt-finder') === '1';
    if (!ok) why = `status ${r.status}${r.headers.get('x-sdt-finder') === '1' ? '' : ', no finder header'}`;
  } catch (e) { why = 'network'; }
  await env.TAGDB.prepare("INSERT INTO meta(k, v, at) VALUES('canary', ?1, ?2) ON CONFLICT(k) DO UPDATE SET v = ?1, at = ?2").bind(ok ? 'ok' : 'fail', now).run();
  if (!ok && env.PUSHOVER_TOKEN && env.PUSHOVER_USER) {
    try {
      await fetchImpl('https://api.pushover.net/1/messages.json', { method: 'POST', body: new URLSearchParams({ token: env.PUSHOVER_TOKEN, user: env.PUSHOVER_USER, title: 'Smart tag canary FAILED', message: `The /T/ rewrite rule may be gone (${why}). QR codes on shipped tags will not open the finder page until it is restored. See README.`, priority: '1' }) });
    } catch { /* the meta row still says fail; Breaker sees it in /api/tags/health */ }
  }
  return { ok, why };
}
