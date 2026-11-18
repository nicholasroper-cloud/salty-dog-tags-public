// Owner sessions and magic links for the smart tag dashboard (ADR section 2). No passwords.
//  - Session cookie: random 32 bytes, stored only as a SHA-256 hash in D1; HttpOnly, Secure, SameSite=Lax; 30 days sliding.
//  - Magic link token: 32 random bytes, stored only as a hash, good once, 15 minutes. Opening the link (GET) only shows a button;
//    the POST from that button is what uses the token up, because mail scanners open links on their own.
//  - Every POST must pass originOk() (CSRF): Origin must be this site.
import { randomToken, sha256Hex } from './_tagid.js';
import { LIMITS } from './_tagsettings.js';

export const COOKIE = 'sdt_s';
const DAY = 24 * 3600 * 1000;

export function readCookie(request, name = COOKIE) {
  const h = request.headers.get('cookie') || '';
  for (const part of h.split(';')) { const i = part.indexOf('='); if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim(); }
  return '';
}
export const sessionCookie = (token, maxAgeSec = LIMITS.sessionMs / 1000) => `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSec}`;
export const clearCookie = () => `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;

export const siteOrigin = (env, request) => { try { return new URL(env.SITE_URL || request.url).origin; } catch { return new URL(request.url).origin; } };
// CSRF: a state-changing request must come from this site. A real Origin header must match. Under Referrer-Policy: no-referrer (which our
// owner pages use on purpose) browsers send "Origin: null" on form posts, so a missing or null Origin is accepted ONLY with
// Sec-Fetch-Site: same-origin, which a cross-site page cannot forge. Fail closed otherwise.
export function originOk(request, env) {
  const o = request.headers.get('origin');
  const allowed = new Set([siteOrigin(env, request), new URL(request.url).origin]);
  if (env.SITE_URL) { try { allowed.add(new URL(env.SITE_URL).origin); } catch { /* ignore */ } }
  if (o && o !== 'null') return allowed.has(o);
  return request.headers.get('sec-fetch-site') === 'same-origin';
}

export async function createSession(env, ownerId, now = Date.now()) {
  const token = randomToken(32);
  await env.TAGDB.prepare('INSERT INTO sessions(id_hash, owner_id, created_at, expires_at) VALUES(?1,?2,?3,?4)').bind(await sha256Hex(token), ownerId, now, now + LIMITS.sessionMs).run();
  return { token, cookie: sessionCookie(token) };
}
// Returns { owner_id, id_hash } or null. Extends the expiry (sliding) at most once a day.
export async function getSession(env, request, now = Date.now()) {
  const tok = readCookie(request);
  if (!tok || tok.length < 20 || tok.length > 100) return null;
  try {
    const h = await sha256Hex(tok);
    const s = await env.TAGDB.prepare('SELECT * FROM sessions WHERE id_hash = ?1 AND expires_at > ?2').bind(h, now).first();
    if (!s) return null;
    if (s.expires_at - now < LIMITS.sessionMs - DAY) await env.TAGDB.prepare('UPDATE sessions SET expires_at = ?2 WHERE id_hash = ?1').bind(h, now + LIMITS.sessionMs).run();
    return { owner_id: s.owner_id, id_hash: h };
  } catch { return null; }
}
export async function endSession(env, request) {
  const tok = readCookie(request);
  if (tok) { try { await env.TAGDB.prepare('DELETE FROM sessions WHERE id_hash = ?1').bind(await sha256Hex(tok)).run(); } catch { /* cookie is cleared anyway */ } }
}

export async function createLoginToken(env, { email, purpose, tagId = null }, now = Date.now()) {
  const token = randomToken(32);
  await env.TAGDB.prepare('INSERT INTO login_tokens(id_hash, email, purpose, tag_id, expires_at) VALUES(?1,?2,?3,?4,?5)').bind(await sha256Hex(token), email, purpose, tagId, now + LIMITS.loginTokenMs).run();
  return token;
}
// Looks at a token without using it (the GET that shows the button).
export async function peekLoginToken(env, token, now = Date.now()) {
  if (typeof token !== 'string' || token.length < 30 || token.length > 100) return null;
  return env.TAGDB.prepare('SELECT * FROM login_tokens WHERE id_hash = ?1 AND used_at IS NULL AND expires_at > ?2').bind(await sha256Hex(token), now).first();
}
// Uses a token up, once. Atomic: two simultaneous POSTs cannot both win.
export async function consumeLoginToken(env, token, now = Date.now()) {
  if (typeof token !== 'string' || token.length < 30 || token.length > 100) return null;
  return env.TAGDB.prepare('UPDATE login_tokens SET used_at = ?2 WHERE id_hash = ?1 AND used_at IS NULL AND expires_at > ?2 RETURNING *').bind(await sha256Hex(token), now).first();
}
