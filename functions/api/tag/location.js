// POST /api/tag/location { t, n, lat, lng, accuracy, place, consent }: the finder tapped "Share once" (consent sheet, then the
// browser's own prompt) or typed where they are. 6 per IP per tag per hour. Coordinates are kept 30 days, the consent version with them.
import { json } from '../_lib.js';
import { guard } from '../_tagapi.js';
import { hit, ipHashOf } from '../_ratelimit.js';
import { onLocation, cleanText } from '../_tagnotify.js';
import { LIMITS, LOC_CONSENT_VERSION } from '../_tagsettings.js';

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : NaN);
export async function onRequestPost({ request, env }) {
  const g = await guard(request, env);
  if (g.res) return g.res;
  const ip = await ipHashOf(env, request);
  const rl = await hit(env, `rl:loc:${ip}:${g.tag.id}`, LIMITS.rl.location[0], LIMITS.rl.location[1]);
  if (!rl.ok) return json({ ok: false, error: 'rate' }, rl.error ? 503 : 429);
  let lat = num(g.body.lat), lng = num(g.body.lng), accuracy = num(g.body.accuracy);
  const place = cleanText(g.body.place, LIMITS.placeMax);
  const hasLoc = Number.isFinite(lat) && Number.isFinite(lng);
  if (hasLoc) {
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return json({ ok: false, error: 'bad location' }, 400);
    if (g.body.consent !== LOC_CONSENT_VERSION) return json({ ok: false, error: 'consent required' }, 400);   // geolocation only after the consent sheet
    lat = Math.round(lat * 1e5) / 1e5; lng = Math.round(lng * 1e5) / 1e5;
    if (Number.isFinite(accuracy)) accuracy = Math.min(50000, Math.max(0, Math.round(accuracy)));
  } else if (!place) return json({ ok: false, error: 'nothing to send' }, 400);
  try {
    const r = await onLocation(env, g.tag, { lat: hasLoc ? lat : NaN, lng: hasLoc ? lng : NaN, accuracy, place, consentVer: hasLoc ? LOC_CONSENT_VERSION : null, ipHash: ip });
    return json({ ok: true, sent: true, alerted: Boolean(r.alerted) });
  } catch { return json({ ok: false, error: 'unavailable' }, 503); }
}
