// GET /api/scores — issue a short-lived, signed play token when a game starts.
// POST /api/scores — Salty Maze results. Keeps today's top 10 and hands out one FREE UPGRADE code per
// verified play token (score >= 500).
//
// Why the token: the score itself is client-reported and cannot be trusted. What the server can check is that
// a real play session happened: the token is minted here (rate limited per IP), signed with its own secret
// PLAY_SECRET (never ADMIN_KEY), must be at least 45 s and at most 6 h old when redeemed, and is single use
// (recorded the first time it is presented). On top of that, codes are capped per IP per day and per day overall,
// so a script that gets past every check can still only mint a bounded number of codes.
import { json, str, ipKey, rateLimitIp } from './_lib.js';
import { safeEqual, readObject, hmacHex } from './_security.js';

const ALPHA = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function code() { const b = new Uint8Array(4); crypto.getRandomValues(b); return 'SDT-UP-' + Array.from(b, (x) => ALPHA[x % ALPHA.length]).join(''); }

const b64url = (s) => btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function b64urlDecode(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return atob(s);
}
function randHex(bytes) {
  const b = new Uint8Array(bytes);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

const PLAY_MIN_MS = 45 * 1000;           // a real round of the maze takes longer than this
const PLAY_MAX_MS = 6 * 60 * 60 * 1000;  // stale tokens are not redeemable
const MINT_PER_IP_PER_HOUR = 20;         // starting a game mints one token; this is far above real play
const PRIZE_PER_IP_PER_DAY = 2;          // codes one network can win in a day
const PRIZE_PER_DAY_DEFAULT = 150;       // codes the whole site hands out in a UTC day (override: PRIZE_DAILY_CAP)

const playSecret = (env) => (typeof env.PLAY_SECRET === 'string' && env.PLAY_SECRET.trim().length >= 24 ? env.PLAY_SECRET.trim() : '');

export async function onRequestGet({ request, env }) {
  const secret = playSecret(env);
  if (!secret) return json({ error: 'not configured' }, 503); // fail closed: no PLAY_SECRET, no tokens, no prize codes
  const rl = await rateLimitIp(env, request, MINT_PER_IP_PER_HOUR, 3600, 'play:mint:');
  if (!rl.ok) return json({ error: 'slow down' }, 429, { 'retry-after': '600' });
  const payload = JSON.stringify({ id: randHex(12), iat: Date.now() });
  const sig = await hmacHex(secret, payload);
  return json({ token: b64url(payload) + '.' + sig });
}

// Returns the token id if it is well-formed, correctly signed, and within the play-time window; else null.
async function verifyToken(env, token) {
  const secret = playSecret(env);
  if (!secret || typeof token !== 'string' || !token || token.length > 400) return null;
  const dot = token.indexOf('.');
  if (dot < 0) return null;
  let payloadStr, payload;
  try { payloadStr = b64urlDecode(token.slice(0, dot)); payload = JSON.parse(payloadStr); } catch { return null; }
  if (!payload || typeof payload.id !== 'string' || !/^[0-9a-f]{16,40}$/.test(payload.id) || typeof payload.iat !== 'number') return null;
  const expect = await hmacHex(secret, payloadStr);
  if (!safeEqual(expect, String(token.slice(dot + 1)).toLowerCase())) return null;
  const age = Date.now() - payload.iat;
  if (age < PLAY_MIN_MS || age > PLAY_MAX_MS) return null;
  return payload.id;
}

export async function onRequestPost({ request, env }) {
  const parsed = await readObject(request);
  if (parsed.error) return json({ error: parsed.error }, parsed.status);
  const body = parsed.body;
  const score = Math.max(0, Math.min(999999, parseInt(body.score, 10) || 0));
  const who = str(body.who, 3).toUpperCase() || 'DOG';
  const day = new Date().toISOString().slice(0, 10); // server UTC date, so the client can't back/forward-date
  const key = 'scores:' + day;
  let top = []; try { top = JSON.parse((await env.ORDERS.get(key)) || '[]'); } catch {}

  const tokenId = await verifyToken(env, body.token);
  if (!tokenId) {
    // No valid session: nothing is recorded and nothing is minted.
    return json({ top, code: null, prize: score >= 500 ? 'no-token' : null });
  }
  // Single use. The marker is written BEFORE anything is awarded so a replay (or a second tab) finds it.
  // KV is eventually consistent, so two requests in the same instant can both pass; the IP and daily caps bound that.
  const usedKey = 'playused:' + tokenId;
  if (await env.ORDERS.get(usedKey)) return json({ top, code: null, prize: score >= 500 ? 'already-claimed' : null });
  await env.ORDERS.put(usedKey, '1', { expirationTtl: 60 * 60 * 8 });

  top.push({ who, score, at: Date.now() }); top.sort((a, b) => b.score - a.score); top = top.slice(0, 10);
  await env.ORDERS.put(key, JSON.stringify(top), { expirationTtl: 60 * 60 * 24 * 8 });

  let prize = null, c = null;
  if (score >= 500) {
    const ipk = 'prizeip:' + day + ':' + (await ipKey(env, request));
    const ipCount = parseInt((await env.ORDERS.get(ipk)) || '0', 10) || 0;
    const cap = Math.max(1, parseInt(env.PRIZE_DAILY_CAP, 10) || PRIZE_PER_DAY_DEFAULT);
    const dayKey = 'prizecount:' + day;
    const dayCount = parseInt((await env.ORDERS.get(dayKey)) || '0', 10) || 0;
    if (ipCount >= PRIZE_PER_IP_PER_DAY) prize = 'already-claimed';
    else if (dayCount >= cap) prize = 'sold-out';
    else {
      c = code();
      await env.ORDERS.put(ipk, String(ipCount + 1), { expirationTtl: 60 * 60 * 26 });
      await env.ORDERS.put(dayKey, String(dayCount + 1), { expirationTtl: 60 * 60 * 26 });
      await env.ORDERS.put('prize:' + c, JSON.stringify({ day, score, used: false, at: Date.now() }), { expirationTtl: 60 * 60 * 24 * 31 });
      prize = 'won';
    }
  }
  return json({ top, code: c, prize });
}
