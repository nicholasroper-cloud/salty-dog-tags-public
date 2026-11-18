// POST /api/pay {id, email} — makes a fresh Clover checkout link for an unpaid order
// (sessions expire after 15 minutes). Email must match the order so the id alone isn't enough.
import { json, str, payEnabled, canPayOnline, createCheckout, hasCustomerImage } from './_lib.js';

export async function onRequestPost({ request, env }) {
  if (!payEnabled(env)) return json({ error: 'Card payment is not switched on yet. We will email you an invoice.' }, 409);
  let body; try { body = await request.json(); } catch { return json({ error: 'bad json' }, 400); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ error: 'bad json' }, 400);
  const id = str(body.id, 12).toUpperCase();
  const email = str(body.email, 120).toLowerCase();
  const raw = await env.ORDERS.get('order:' + id);
  const notFound = () => json({ error: 'No such order for that email.' }, 404);
  if (!raw) return notFound();
  const order = JSON.parse(raw);
  if (order.customer.email !== email) return notFound(); // don't reveal whether the id exists vs. the email is wrong
  if (['paid', 'made', 'shipped', 'done'].includes(order.status) || (order.payment && order.payment.status === 'APPROVED')) return json({ error: 'Already paid. Thank you.' }, 409);
  if (order.status === 'cancelled') return json({ error: 'This order was cancelled.' }, 409);
  if (!canPayOnline(order)) return json({ error: hasCustomerImage(order) ? 'We check your artwork first, then email you an invoice.' : 'This order has a custom item that needs a quote first.' }, 409);
  try {
    const cs = await createCheckout(env, order);
    order.checkout = cs; order.payment = { status: 'pending' }; delete order.payError;
    await env.ORDERS.put('cs:' + cs.id, id, { expirationTtl: 60 * 60 * 24 * 30 });
    await env.ORDERS.put('order:' + id, JSON.stringify(order));
    return json({ ok: true, payUrl: cs.href });
  } catch (e) {
    return json({ error: 'Could not start checkout: ' + String(e.message || e).slice(0, 200) }, 502);
  }
}
