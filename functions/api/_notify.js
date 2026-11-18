// Owner notifications for new / paid orders (and, through sendOwner, the Thirsty Beaches relay).
// Channels, all optional, all configured only through Pages secrets:
//   PUSHOVER_TOKEN + PUSHOVER_USER  -> Pushover app push (what notifyOrder and sendOwner use).
//   NTFY_TOPIC                      -> push to the ntfy app (free). Code kept below, but not called.
//   TWILIO_SID + TWILIO_TOKEN + TWILIO_FROM + NOTIFY_TO -> real SMS via Twilio.
// Never throws; a failed ping must never fail an order.
// Also sends the optional customer "Your order is in" email on 'new' (only when EMAIL_ORDER_CONFIRM=true
// and RESEND_API_KEY exist; see _email.js). Hooked here so order.js didn't need to change.
import { maybeSendOrderConfirm } from './_email.js';

const money = (n) => '$' + Number(n || 0).toFixed(2);

export function orderSummary(order, event) {
  const tags = order.tags || [];
  const n = tags.reduce((s, t) => s + (t.qty || 1), 0);
  const first = tags[0] || {};
  const line = first.photo ? 'photo tag' : (first.front || []).join(' / ') || (first.back || []).join(' / ');
  const head = event === 'paid' ? 'PAID'
    : event === 'late' ? 'PAYMENT ON A CLOSED ORDER (refund or reopen it)'
    : event === 'check' ? 'PAYMENT AMOUNT DOES NOT MATCH (check it)'
    : (order.payment ? 'NEW (card pending)' : 'NEW (invoice)');
  const who = order.customer?.name || '?';
  const where = order.customer?.delivery === 'pickup' ? 'pickup' : 'ship';
  const title = `Salty Dog ${head} ${money(order.totals?.total)} · ${who}`;
  const orn = (order.ornaments || []).reduce((s2, o) => s2 + (o.qty || 1), 0);
  const ornPart = orn ? `${orn} ornament${orn === 1 ? '' : 's'} (${[...new Set(order.ornaments.map((o) => o.tier))].join('+')})` : '';
  const tagPart = n ? `${n} tag${n === 1 ? '' : 's'} · ${first.shape || ''} ${first.finish || ''} ${first.size || ''}\n"${line}"` : '';
  const body = `${[tagPart, ornPart].filter(Boolean).join('\n')}\n${where} · #${order.id}`;
  return { title, body };
}

async function ntfy(env, { title, body, order }) {
  if (!env.NTFY_TOPIC) return;
  // accept "topic", "ntfy.sh/topic" or "https://ntfy.sh/topic" as pasted from the app
  const topic = String(env.NTFY_TOPIC).trim().replace(/^https?:\/\//, '').replace(/^ntfy\.sh\//, '').replace(/^\/+/, '');
  // JSON publish: header values can't carry UTF-8 (the "·" in titles), the JSON body can.
  const r = await fetch('https://ntfy.sh/', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ topic, title, message: body, priority: 4, tags: ['dog'], click: 'https://saltydogtags.com/orders.html#' + order.id }),
  });
  if (!r.ok) throw new Error('ntfy ' + r.status + ' ' + (await r.text()).slice(0, 120));
}

// Pushover: PUSHOVER_TOKEN (app token) + PUSHOVER_USER (user key). $5 one-time app, no per-IP quota.
// msg = { title, body, url?, urlTitle?, priority? ('-1'|'0'|'1'), sound?, smsMax? }
async function pushover(env, { title, body, url, urlTitle, priority = '1', sound }) {
  if (!(env.PUSHOVER_TOKEN && env.PUSHOVER_USER)) return;
  const form = new URLSearchParams({ token: env.PUSHOVER_TOKEN, user: env.PUSHOVER_USER, title, message: body, priority });
  if (url) { form.set('url', url); form.set('url_title', urlTitle || 'Open'); }
  if (sound) form.set('sound', sound);
  const r = await fetch('https://api.pushover.net/1/messages.json', { method: 'POST', body: form });
  if (!r.ok) throw new Error('pushover ' + r.status + ' ' + (await r.text()).slice(0, 120));
}

async function twilio(env, { title, body, smsMax }) {
  if (!(env.TWILIO_SID && env.TWILIO_TOKEN && env.TWILIO_FROM && env.NOTIFY_TO)) return;
  const auth = btoa(env.TWILIO_SID + ':' + env.TWILIO_TOKEN);
  const text = title + '\n' + body;
  const form = new URLSearchParams({ To: env.NOTIFY_TO, From: env.TWILIO_FROM, Body: smsMax ? text.slice(0, smsMax) : text });
  const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_SID}/Messages.json`, {
    method: 'POST', headers: { Authorization: 'Basic ' + auth }, body: form,
  });
  if (!r.ok) throw new Error('twilio ' + r.status);
}

// The owner's phone channels (Pushover push, Twilio text). ntfy is deliberately not one of them: order
// pings never used it (ntfy.sh limits requests per IP, and Cloudflare's IPs are shared), so the relay
// (relay.js) doesn't either.
export const ownerChannels = (env) => [
  env.PUSHOVER_TOKEN && env.PUSHOVER_USER && 'pushover',
  env.TWILIO_SID && env.TWILIO_TOKEN && env.TWILIO_FROM && env.NOTIFY_TO && 'sms',
].filter(Boolean);

// Sends one message to every configured owner channel. Never throws; returns the channel errors
// (empty = everything configured got it). Used by notifyOrder and by the Thirsty Beaches relay.
export async function sendOwner(env, msg) {
  const rs = await Promise.allSettled([pushover(env, msg), twilio(env, msg)]);
  return rs.filter((r) => r.status === 'rejected').map((r) => String(r.reason).slice(0, 200));
}

export function notifyOrder(ctx, env, order, event) {
  const msg = { ...orderSummary(order, event), url: 'https://saltydogtags.com/orders.html#' + order.id, urlTitle: 'Open orders',
    priority: '1', sound: 'cashregister' };
  const jobs = [sendOwner(env, msg)];
  if (event === 'new' && order.customer && order.customer.email) jobs.push(maybeSendOrderConfirm(env, order));
  const run = Promise.allSettled(jobs).then((rs) => {
    const errs = [...(rs[0].status === 'fulfilled' ? rs[0].value : [String(rs[0].reason).slice(0, 200)]),
      ...rs.slice(1).filter((r) => r.status === 'rejected').map((r) => String(r.reason).slice(0, 200))];
    if (errs.length) console.warn('notify failed', errs.join(' | '));
    return errs;
  });
  if (ctx && ctx.waitUntil) ctx.waitUntil(run); else return run;
}
