// GET /t/<id>: the public finder page. A Cloudflare Transform Rule rewrites /T/* (the upper case QR payload) to /t/*; this route only ever
// sees lower case paths. Never a 404: unknown, disabled, and D1-down ids all get the same generic page.
// Page rules (ADR 3): no cookies, no analytics, CSP default-src 'self', noindex, Referrer-Policy no-referrer.
import { normalizeTagId, scanNonce } from '../api/_tagid.js';
import { getTag } from '../api/_tagdb.js';
import { hasDb } from '../api/_tagsettings.js';
import { hit, speedBump } from '../api/_ratelimit.js';
import { ipKey } from '../api/_lib.js';
import { genericPage, unclaimedPage, claimedPage, rateLimitedPage, pageHeaders } from '../api/_tagpage.js';

const html = (body, status = 200, extra) => new Response(body, { status, headers: pageHeaders(extra) });
const cacheKey = (id, request) => new Request(new URL(`/__sdt_profile/${id}`, request.url).toString());

async function readCachedProfile(id, request) {
  try { if (typeof caches === 'undefined') return null; const r = await caches.default.match(cacheKey(id, request)); return r ? await r.json() : null; } catch { return null; }
}
async function writeCachedProfile(id, request, p) {
  try { if (typeof caches === 'undefined') return; await caches.default.put(cacheKey(id, request), new Response(JSON.stringify(p), { headers: { 'cache-control': 'max-age=300', 'content-type': 'application/json' } })); } catch { /* best effort */ }
}

export async function onRequest({ request, env, params }) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('method not allowed', { status: 405, headers: { allow: 'GET, HEAD' } });
  const id = normalizeTagId(Array.isArray(params.id) ? params.id[0] : params.id);
  const miss = async () => {
    // Every unknown or disabled id counts against the caller: 30 per IP hash per hour, then a 429 page.
    const r = hasDb(env) ? await hit(env, 'rl:miss:' + (await ipKey(env, request)), 30, 3600) : { ok: true };
    return r.ok || r.error ? html(genericPage()) : html(rateLimitedPage(), 429, { 'retry-after': '3600' });
  };
  if (!id) return miss();
  if (!speedBump('t:' + (request.headers.get('cf-connecting-ip') || '-'), 240, 60_000)) return html(rateLimitedPage(), 429, { 'retry-after': '60' });
  let tag = null, dbDown = false;
  try { tag = hasDb(env) ? await getTag(env, id) : null; dbDown = !hasDb(env); } catch { dbDown = true; }
  if (dbDown) {
    const p = await readCachedProfile(id, request);   // 5 minute copy of the public profile, so a D1 blip does not blank a lost dog's page
    return html(p ? claimedPage({ id, nonce: '', dog: p.dog, message: p.message, phone: p.phone, beacon: false }) : genericPage());
  }
  if (!tag || tag.status === 'disabled') return miss();
  const nonce = await scanNonce(env.TAG_CLAIM_KEY, id);
  if (tag.status === 'claimed') {
    let phone = '';
    if (tag.show_phone) {
      try { const c = await env.TAGDB.prepare('SELECT phone_e164 FROM contacts WHERE tag_id = ?1 AND phone_e164 IS NOT NULL ORDER BY slot LIMIT 1').bind(id).first(); phone = (c && c.phone_e164) || ''; } catch { phone = ''; }
    }
    const profile = { dog: tag.dog_name, message: tag.message, phone };
    await writeCachedProfile(id, request, profile);
    return html(claimedPage({ id, nonce, ...profile, beacon: Boolean(nonce) }));
  }
  return html(unclaimedPage({ id, nonce }));
}
