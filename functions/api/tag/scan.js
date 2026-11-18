// POST /api/tag/scan { t, n }: the finder page's beacon. This is the ONLY thing that counts a scan, so a link preview or a crawler
// that only fetches the HTML never alerts anyone. Fires only when the page is visible and at least 1 s old (t.js), carries the nonce the
// page itself was issued, and is not from a known bot. 20 per IP per hour; at most one counted per IP per tag per 10 minutes.
import { json } from '../_lib.js';
import { guard, isBot } from '../_tagapi.js';
import { hit, ipHashOf } from '../_ratelimit.js';
import { onScan } from '../_tagnotify.js';
import { purgeTag } from '../_tagpurge.js';
import { noteNativeScan } from '../_tagdb.js';
import { getSession } from '../_session.js';
import { LIMITS } from '../_tagsettings.js';

export async function onRequestPost({ request, env }) {
  const g = await guard(request, env);
  if (g.res) return g.res;
  if (isBot(request.headers.get('user-agent'))) return json({ ok: true, counted: false });
  const ip = await ipHashOf(env, request);
  const [a, b] = LIMITS.rl.scanIp, [c, d] = LIMITS.rl.scanIpTag;
  const ipRl = await hit(env, 'rl:scan:' + ip, a, b);
  if (!ipRl.ok) return json({ ok: ipRl.error ? false : true, counted: false }, ipRl.error ? 503 : 429);
  const per = await hit(env, `rl:scantag:${ip}:${g.tag.id}`, c, d);
  if (!per.ok) return json({ ok: true, counted: false });
  try {
    const sess = await getSession(env, request);
    const byOwner = Boolean(sess && g.tag.owner_id && sess.owner_id === g.tag.owner_id);   // the owner's own scans count but never alert
    // The phone-camera QC check: a beacon from an engraved, unshipped tag.
    if (!byOwner) { try { await noteNativeScan(env, g.tag); } catch { /* QC marker is best effort */ } }
    const r = await onScan(env, g.tag, { ipHash: ip, byOwner });
    try { await purgeTag(env, g.tag.id); } catch { /* the daily purge catches it */ }   // each new scan also purges that tag's expired rows
    return json({ ok: true, counted: true, alerted: Boolean(r.alerted) });
  } catch (e) { console.warn('scan failed', String((e && e.message) || e).slice(0, 80)); return json({ ok: false, error: 'unavailable' }, 503); }
}
