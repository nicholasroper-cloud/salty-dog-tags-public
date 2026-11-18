// POST /api/relay — lets the Thirsty Beaches workers (station + tb-where) use two things this site already
// has set up, without copying the keys: the owner's phone alerts (sendOwner in _notify.js) and the Clover
// Hosted Checkout private key (CLOVER_ECOMM_TOKEN + CLOVER_MERCHANT_ID, same merchant as Thirsty Beaches).
//
// Auth: Authorization: Bearer <RELAY_KEY>, a random shared secret set on this Pages project and on both
// Workers by the one-time "Set up relay key" workflow in the thirsty-beaches-website repo.
// With RELAY_KEY unset (or too short to be the generated one) the endpoint answers 404, like any missing page.
//
// Body (JSON), by kind:
//   {kind:'ping'} -> {ok:true, pay, alerts}  is the key live, is card checkout on, how many alert channels (no budget used)
//   {kind:'notify', title, message, url?, priority?, source:'tb-station'|'tb-where'}
//       -> {ok:true, sent:n}  pushed to the same channels as order pings (Pushover, Twilio).
//          502 {error:'notify-failed'} when no channel took it, 503 {error:'no-channel'} when none is set.
//   {kind:'checkout', lineItems:[{name, price, unitQty, note?}], customer:{firstName}, redirectUrls:{success, failure},
//    tips?:{enabled}, merchantId?}
//       -> Clover's {href, checkoutSessionId, createdTime, expirationTime}
//          Hard limits: 1-30 line items, unitQty 1-20, price 1-10000 cents, total <= $200, return pages only on
//          https://station.thirstybeaches.com. Never Salty Dog's page branding (CLOVER_PAGE_CONFIG).
//   {kind:'sms', source:'tb-where', to:['+18015550123', ...], text}
//       -> {ok:true, sent, failed}  the Thirsty Beaches "we're open" text to its alert list (subscribers who
//          consented on thirstybeaches.com), through this site's Twilio account (TWILIO_SID + TWILIO_TOKEN +
//          TWILIO_FROM; NOTIFY_TO is not needed). Refused unless: 1-500 distinct E.164 numbers, text <= 400 chars
//          ending with "Reply STOP to opt out", at most 1 call per 10 min and 2000 numbers per UTC day (all
//          callers together). The caps are reserved in KV BEFORE anything is sent and fail closed if KV is down.
//          503 {error:'no-sms'} when Twilio isn't set up. Numbers are never logged or echoed back.
//
// Budgets (all callers together, per clock hour): 60 notify, 120 checkout. Counted only after auth.
// Never logs or returns the keys; Clover errors come back as a short code only.
import { json, payEnabled } from './_lib.js';
import { sendOwner, ownerChannels } from './_notify.js';

const MIN_KEY_LEN = 32;                 // the workflow makes 64 hex chars; anything shorter is a mistake
const MAX_BODY = 16000;
const NOTIFY_PER_HOUR = 60;
const CHECKOUT_PER_HOUR = 120;
const SOURCES = ['tb-station', 'tb-where'];
const RETURN_HOST = 'station.thirstybeaches.com';
const LIMITS = { items: 30, qty: 20, priceMin: 1, priceMax: 10000, total: 20000, name: 255, note: 250, firstName: 40 };
const CLOVER_TIMEOUT_MS = 8000;
const SMS_MAX_TO = 500;
const SMS_GAP_MS = 10 * 60 * 1000;
const SMS_PER_DAY = 2000;
const SMS_MAX_TEXT = 400;
const SMS_STOP = 'Reply STOP to opt out';
const SMS_PARALLEL = 6;
const E164 = /^\+[1-9]\d{7,14}$/;

const relayKey = (env) => {
  const k = typeof env.RELAY_KEY === 'string' ? env.RELAY_KEY.trim() : '';
  return k.length >= MIN_KEY_LEN ? k : '';
};

async function sha256(s) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
}
// Constant time: both sides are hashed to 32 bytes first, so neither the length nor the first wrong
// character changes how long the comparison takes.
async function keyOk(request, key) {
  const h = request.headers.get('Authorization') || '';
  const got = h.startsWith('Bearer ') ? h.slice(7).trim() : '';
  const [a, b] = await Promise.all([sha256(got), sha256(key)]);
  let d = got.length ? 0 : 1;
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}

// One counter per kind per clock hour, shared by every caller (KV, so roughly, not exactly).
// failOpen: notify keeps working if KV hiccups; checkout (real money) refuses instead.
async function overBudget(env, kind, limit, failOpen) {
  const key = 'relay:rl:' + kind + ':' + Math.floor(Date.now() / 3600000);
  try {
    const n = parseInt((await env.ORDERS.get(key)) || '0', 10) || 0;
    if (n >= limit) return true;
    await env.ORDERS.put(key, String(n + 1), { expirationTtl: 7200 });
    return false;
  } catch {
    return !failOpen;
  }
}

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const clean = (v, keepNewlines) => String(v)
  .replace(keepNewlines ? /[\u0000-\u0009\u000b-\u001f\u007f]/g : /[\u0000-\u001f\u007f]/g, ' ')
  .trim();

function httpsUrl(raw, host) {
  if (typeof raw !== 'string' || raw.length > 500) return null;
  let u; try { u = new URL(raw); } catch { return null; }
  if (u.protocol !== 'https:' || u.username || u.password || u.port) return null;
  if (host && u.hostname !== host) return null;
  return u.href;
}

/* ---------- kind: notify ---------- */
async function relayNotify(env, b) {
  if (!SOURCES.includes(b.source)) return json({ error: 'bad-source' }, 400);
  if (typeof b.title !== 'string' || typeof b.message !== 'string') return json({ error: 'bad-message' }, 400);
  const title = clean(b.title, false), message = clean(b.message, true);
  if (!title || title.length > 120 || !message || message.length > 1000) return json({ error: 'bad-message' }, 400);
  let url = null;
  if (b.url != null && b.url !== '') { url = httpsUrl(b.url); if (!url) return json({ error: 'bad-url' }, 400); }
  if (b.priority != null && !['low', 'normal', 'high'].includes(b.priority)) return json({ error: 'bad-priority' }, 400);
  const channels = ownerChannels(env);
  if (!channels.length) return json({ error: 'no-channel' }, 503);
  if (await overBudget(env, 'notify', NOTIFY_PER_HOUR, true)) return json({ error: 'rate-limited' }, 429);
  const priority = b.priority === 'high' ? '1' : b.priority === 'low' ? '-1' : '0';
  const errs = await sendOwner(env, { title, body: message, url, urlTitle: 'Open', priority, smsMax: 480 });
  if (errs.length) console.warn('relay notify', b.source, errs.join(' | '));
  const sent = channels.length - errs.length;
  if (sent <= 0) return json({ error: 'notify-failed' }, 502);
  return json({ ok: true, sent });
}

/* ---------- kind: sms (Thirsty Beaches alert list) ---------- */
const smsReady = (env) => !!(env.TWILIO_SID && env.TWILIO_TOKEN && env.TWILIO_FROM);

// 1 call per 10 min + 2000 numbers per UTC day, for every caller together. Reserved before sending (a retry after
// a timeout can't double-text anyone), and refused if KV can't be read or written: these go to customers.
async function smsBudget(env, n) {
  const now = Date.now();
  const dayKey = 'relay:sms:day:' + new Date(now).toISOString().slice(0, 10);
  try {
    const last = parseInt((await env.ORDERS.get('relay:sms:last')) || '0', 10) || 0;
    if (now - last < SMS_GAP_MS) return { error: 'too-soon', retryMin: Math.ceil((SMS_GAP_MS - (now - last)) / 60000) };
    const used = parseInt((await env.ORDERS.get(dayKey)) || '0', 10) || 0;
    if (used + n > SMS_PER_DAY) return { error: 'daily-cap', left: Math.max(0, SMS_PER_DAY - used) };
    await env.ORDERS.put('relay:sms:last', String(now), { expirationTtl: 3600 });
    await env.ORDERS.put(dayKey, String(used + n), { expirationTtl: 2 * 86400 });
    return null;
  } catch {
    return { error: 'budget-unavailable' };
  }
}

async function relaySms(env, b) {
  if (b.source !== 'tb-where') return json({ error: 'bad-source' }, 400);
  if (!Array.isArray(b.to) || b.to.length < 1) return json({ error: 'bad-to' }, 400);
  if (b.to.length > SMS_MAX_TO) return json({ error: 'too-many', max: SMS_MAX_TO }, 400);
  if (!b.to.every((n) => typeof n === 'string' && E164.test(n))) return json({ error: 'bad-to' }, 400);
  const to = [...new Set(b.to)];
  if (typeof b.text !== 'string') return json({ error: 'bad-text' }, 400);
  const text = clean(b.text, true);
  if (!text || text.length > SMS_MAX_TEXT) return json({ error: 'bad-text' }, 400);
  if (!text.endsWith(SMS_STOP)) return json({ error: 'needs-stop-line' }, 400);
  if (!smsReady(env)) return json({ error: 'no-sms' }, 503);
  const cap = await smsBudget(env, to.length);
  if (cap) return json(cap, cap.error === 'budget-unavailable' ? 503 : 429);
  const auth = 'Basic ' + btoa(env.TWILIO_SID + ':' + env.TWILIO_TOKEN);
  const api = `https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_SID}/Messages.json`;
  let sent = 0, failed = 0, next = 0;
  const codes = {};
  async function worker() {
    while (next < to.length) {
      const n = to[next++];
      try {
        const r = await fetch(api, { method: 'POST', headers: { Authorization: auth }, body: new URLSearchParams({ To: n, From: env.TWILIO_FROM, Body: text }) });
        if (r.ok) sent++;
        else { failed++; codes[r.status] = (codes[r.status] || 0) + 1; }
      } catch { failed++; codes.net = (codes.net || 0) + 1; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(SMS_PARALLEL, to.length) }, worker));
  console.log('relay sms', b.source, 'sent', sent, 'failed', failed, JSON.stringify(codes));   // counts only, never numbers
  return json({ ok: true, sent, failed });
}

/* ---------- kind: checkout ---------- */
function checkoutBody(b, env) {
  if (!Array.isArray(b.lineItems) || b.lineItems.length < 1 || b.lineItems.length > LIMITS.items) return { error: 'bad-line-items' };
  const lineItems = [];
  let total = 0;
  for (const li of b.lineItems) {
    if (!isObj(li) || typeof li.name !== 'string') return { error: 'bad-line-item' };
    const name = clean(li.name, false);
    if (!name || name.length > LIMITS.name) return { error: 'bad-line-item' };
    if (!Number.isInteger(li.price) || li.price < LIMITS.priceMin || li.price > LIMITS.priceMax) return { error: 'bad-price' };
    if (!Number.isInteger(li.unitQty) || li.unitQty < 1 || li.unitQty > LIMITS.qty) return { error: 'bad-qty' };
    const out = { name, price: li.price, unitQty: li.unitQty };
    if (li.note != null) {
      if (typeof li.note !== 'string') return { error: 'bad-line-item' };
      const note = clean(li.note, false);
      if (note.length > LIMITS.note) return { error: 'bad-line-item' };
      if (note) out.note = note;
    }
    total += li.price * li.unitQty;
    lineItems.push(out);
  }
  if (total > LIMITS.total) return { error: 'over-limit' };
  if (b.customer != null && !isObj(b.customer)) return { error: 'bad-customer' };
  const fn = b.customer && b.customer.firstName;
  if (fn != null && typeof fn !== 'string') return { error: 'bad-customer' };
  const firstName = clean(fn || '', false).slice(0, LIMITS.firstName) || 'Kiosk';
  if (!isObj(b.redirectUrls)) return { error: 'bad-redirect' };
  const success = httpsUrl(b.redirectUrls.success, RETURN_HOST), failure = httpsUrl(b.redirectUrls.failure, RETURN_HOST);
  if (!success || !failure) return { error: 'bad-redirect' };
  if (b.tips != null && !(isObj(b.tips) && typeof b.tips.enabled === 'boolean')) return { error: 'bad-tips' };
  if (b.merchantId != null && String(b.merchantId).trim() !== String(env.CLOVER_MERCHANT_ID).trim()) return { error: 'merchant-mismatch', status: 409 };
  const body = { customer: { firstName }, shoppingCart: { lineItems }, redirectUrls: { success, failure } };
  if (b.tips) body.tips = { enabled: b.tips.enabled };
  return { body, total };
}

async function relayCheckout(env, b) {
  if (!payEnabled(env)) return json({ error: 'pay-off' }, 503);
  const c = checkoutBody(b, env);
  if (c.error) return json({ error: c.error }, c.status || 400);
  if (await overBudget(env, 'checkout', CHECKOUT_PER_HOUR, false)) return json({ error: 'rate-limited' }, 429);
  // Same call as createCheckout in _lib.js (endpoint, headers), with the caller's validated cart.
  const base = env.CLOVER_API_BASE || 'https://api.clover.com';
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), CLOVER_TIMEOUT_MS);
  let r, data;
  try {
    r = await fetch(base + '/invoicingcheckoutservice/v1/checkouts', {
      method: 'POST',
      signal: ctl.signal,
      headers: { accept: 'application/json', 'content-type': 'application/json', 'X-Clover-Merchant-Id': env.CLOVER_MERCHANT_ID, authorization: 'Bearer ' + env.CLOVER_ECOMM_TOKEN },
      body: JSON.stringify(c.body),
    });
    const text = await r.text();
    try { data = JSON.parse(text); } catch { data = null; }
  } catch (e) {
    const timeout = e && e.name === 'AbortError';
    console.warn('relay checkout', timeout ? 'clover timeout' : 'clover unreachable');
    return json({ error: timeout ? 'clover-timeout' : 'clover-unreachable' }, 502);
  } finally {
    clearTimeout(timer);
  }
  if (!r.ok) {
    console.warn('relay checkout clover', r.status);       // status only: Clover's error text could echo request details
    return json({ error: 'clover-error', status: r.status }, 502);
  }
  const href = data && httpsUrl(data.href);
  const host = href ? new URL(href).hostname : '';
  if (!href || !(host === 'clover.com' || host.endsWith('.clover.com')) || typeof data.checkoutSessionId !== 'string' || !data.checkoutSessionId) {
    console.warn('relay checkout clover: unexpected reply');
    return json({ error: 'clover-bad-reply' }, 502);
  }
  console.log('relay checkout', data.checkoutSessionId, c.total, c.body.shoppingCart.lineItems.length);
  return json({ href: data.href, checkoutSessionId: data.checkoutSessionId, createdTime: data.createdTime, expirationTime: data.expirationTime });
}

export async function onRequestPost({ request, env }) {
  const key = relayKey(env);
  if (!key) return new Response('Not found', { status: 404 });
  if (!(await keyOk(request, key))) return json({ error: 'unauthorized' }, 401);
  const raw = await request.text();
  if (raw.length > MAX_BODY) return json({ error: 'too-large' }, 413);
  let b; try { b = JSON.parse(raw); } catch { return json({ error: 'bad-json' }, 400); }
  if (!b || typeof b !== 'object' || Array.isArray(b)) return json({ error: 'bad-json' }, 400);
  if (!isObj(b)) return json({ error: 'bad-json' }, 400);
  if (b.kind === 'notify') return relayNotify(env, b);
  if (b.kind === 'checkout') return relayCheckout(env, b);
  if (b.kind === 'sms') return relaySms(env, b);
  if (b.kind === 'ping') return json({ ok: true, pay: payEnabled(env), alerts: ownerChannels(env).length });
  return json({ error: 'bad-kind' }, 400);
}
