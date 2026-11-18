// POST /api/clover-webhook — Clover Hosted Checkout payment notifications.
// Verifies the Clover-Signature header (t=<ts>,v1=<hmac>) = HMAC-SHA256(secret, `${t}.${rawBody}`).
import { json } from './_lib.js';
import { safeEqual as safeEq, hmacHex } from './_security.js';
import { notifyOrder } from './_notify.js';

// Clover's docs show the payload as labeled fields; be forgiving about key casing, and about
// payloads that nest the fields one level down inside data/object/payment.
function getCI(o, name) {
  if (!o || typeof o !== 'object') return undefined;
  for (const k of Object.keys(o)) if (k.toLowerCase() === name.toLowerCase()) return o[k];
  return undefined;
}
const NEST_KEYS = ['data', 'object', 'payment'];
function pick(o, ...names) {
  for (const n of names) { const v = getCI(o, n); if (v !== undefined) return v; }
  for (const nk of NEST_KEYS) {
    const inner = getCI(o, nk);
    if (inner && typeof inner === 'object') {
      for (const n of names) { const v = getCI(inner, n); if (v !== undefined) return v; }
    }
  }
  return undefined;
}

export async function onRequestPost({ request, env, waitUntil }) {
  const raw = await request.text();
  const sigHeader = request.headers.get('Clover-Signature') || '';
  if (env.CLOVER_WEBHOOK_SECRET) {
    const t = (/t=([^,]+)/.exec(sigHeader) || [])[1];
    const v1 = (/v1=([0-9a-f]+)/i.exec(sigHeader) || [])[1];
    if (!t || !v1) return json({ error: 'no signature' }, 401);
    const expect = await hmacHex(env.CLOVER_WEBHOOK_SECRET, t + '.' + raw);
    if (!safeEq(expect.toLowerCase(), v1.toLowerCase())) return json({ error: 'bad signature' }, 401);
    // t is unix seconds (Stripe-style); be forgiving of a sender that uses unix milliseconds.
    let tNum = Number(t);
    if (!Number.isFinite(tNum)) return json({ error: 'bad signature' }, 401);
    if (tNum > 1e12) tNum = tNum / 1000;
    if (Math.abs(Date.now() / 1000 - tNum) > 300) return json({ error: 'stale signature' }, 401);
  } else {
    return json({ error: 'webhook secret not configured' }, 503);
  }

  let p; try { p = JSON.parse(raw); } catch { return json({ error: 'bad json' }, 400); }
  if (!p || typeof p !== 'object' || Array.isArray(p)) return json({ error: 'bad json' }, 400);
  // 'data'/'object'/'payment' are container keys for pick()'s one-level recursion, not field names —
  // don't list them here or a nested payload would match the container itself instead of the field inside it.
  const sessionId = String(pick(p, 'checkoutSessionId', 'checkoutSession') || '');
  const status = String(pick(p, 'status') || '').toUpperCase();
  const type = String(pick(p, 'type') || '');
  const paymentId = String(pick(p, 'id', 'paymentId') || '');
  const message = String(pick(p, 'message') || '').slice(0, 200);
  const amountRaw = pick(p, 'amount', 'total');
  const amountCents = Number.isFinite(Number(amountRaw)) && amountRaw !== '' && amountRaw !== null ? Math.round(Number(amountRaw)) : null;

  // keep every webhook for debugging (30 days)
  await env.ORDERS.put('wh:' + Date.now() + ':' + (sessionId || 'x'), raw.slice(0, 4000), { expirationTtl: 60 * 60 * 24 * 30 });

  const orderId = sessionId ? await env.ORDERS.get('cs:' + sessionId) : null;
  if (!orderId) {
    // count misses so a spike (e.g. a payload shape Clover changed) is visible without reading every 'wh:' entry
    await env.ORDERS.put('whmiss:' + Date.now(), raw.slice(0, 4000), { expirationTtl: 60 * 60 * 24 * 30 });
    return json({ ok: true, note: 'no matching order' });
  }
  const rawOrder = await env.ORDERS.get('order:' + orderId);
  if (!rawOrder) return json({ ok: true, note: 'order missing' });
  const order = JSON.parse(rawOrder);

  // Only a payment event can mark an order paid. Refund, void and other event types are recorded for the owner and
  // otherwise ignored (a refund event can carry status APPROVED too, and must never read as a payment).
  const isPayment = type === '' || /payment|sale|charge/i.test(type);
  if (!isPayment) {
    order.events = [...(order.events || []).slice(-9), { type, status, id: paymentId, at: Date.now() }];
    order.updated = Date.now();
    await env.ORDERS.put('order:' + orderId, JSON.stringify(order));
    return json({ ok: true, note: 'not a payment event' });
  }

  // Amount check. The order total is dollars before tax; Clover adds Utah sales tax on top for Utah ships, so the
  // paid amount must be at least the total and at most total + 12% (+2 cents of rounding). If Clover sent no amount
  // we cannot compare and the order is marked paid with amountChecked:false so the owner can see that.
  const expectCents = Math.round((order.totals && order.totals.total || 0) * 100);
  // The payload's unit is not documented to us (cents vs dollars): accept either reading, reject when neither fits.
  const inRange = (c) => c >= expectCents && c <= Math.ceil(expectCents * 1.12) + 2;
  const amountOk = amountCents === null ? null : (inRange(amountCents) || inRange(Math.round(Number(amountRaw) * 100)));

  if (order.status === 'cancelled' || order.status === 'done') {
    // Money arrived on an order that is already closed (the customer paid inside the 15-minute session after the
    // owner cancelled, or after it shipped). Record it on the order and tell the owner; never drop it silently.
    if (status === 'APPROVED') {
      order.latePayments = [...(order.latePayments || []).slice(-9), { status, type, id: paymentId, amountCents, at: Date.now(), sessionId }];
      order.updated = Date.now();
      await env.ORDERS.put('order:' + orderId, JSON.stringify(order));
      notifyOrder({ waitUntil }, env, order, 'late');
    }
    return json({ ok: true, note: 'order closed' });
  }

  order.payment = { status, type, id: paymentId, message, amountCents, amountChecked: amountOk !== null, at: Date.now(), sessionId };
  const approved = status === 'APPROVED';
  if (approved && amountOk === false) {
    // Approved, but not for what the order costs: do not mark paid. The owner decides.
    // payment.status becomes REVIEW (not APPROVED) so /api/pay never tells the customer "Already paid" and the orders
    // page does not show a card APPROVED badge; Clover's own value is kept in payment.clover.
    order.payment.clover = order.payment.status;
    order.payment.status = 'REVIEW';
    order.payment.amountMismatch = { expectCents, amountCents };
    order.updated = Date.now();
    await env.ORDERS.put('order:' + orderId, JSON.stringify(order));
    notifyOrder({ waitUntil }, env, order, 'check');
    return json({ ok: true, note: 'amount mismatch' });
  }
  const justPaid = approved && ['new', 'invoiced'].includes(order.status);
  if (justPaid) order.status = 'paid';
  order.updated = Date.now();
  await env.ORDERS.put('order:' + orderId, JSON.stringify(order));
  if (justPaid) notifyOrder({ waitUntil }, env, order, 'paid');
  return json({ ok: true });
}
