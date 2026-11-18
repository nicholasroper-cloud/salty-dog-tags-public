// Owner-only. GET /api/orders → every order, newest first. POST /api/orders {id,status} → update.
import { json, isAdmin, str, deletePhoto, price } from './_lib.js';
import { sendEmail, declineEmail } from './_email.js';
import { shipBlockers, markEngraved, markShipped, disableOrderTags } from './_tagdb.js';

const STATUSES = ['new', 'invoiced', 'paid', 'made', 'shipped', 'done', 'cancelled'];

export async function onRequestGet({ request, env }) {
  if (!isAdmin(request, env)) return json({ error: 'nope' }, 401);
  const out = [];
  let cursor;
  do {
    const page = await env.ORDERS.list({ prefix: 'order:', cursor });
    // Reads run in parallel batches: one sequential await per order was slow and tripped the subrequest cap sooner.
    for (let i = 0; i < page.keys.length; i += 25) {
      const vals = await Promise.all(page.keys.slice(i, i + 25).map((k) => env.ORDERS.get(k.name)));
      for (const v of vals) {
        if (!v) continue;
        try { const o = JSON.parse(v); if (!o || typeof o !== 'object' || !o.id) continue; /* counters written before the rl:order: rename are 'order:<hash>' keys holding a bare number */ delete o.ua; delete o.ip; out.push(o); } catch { /* skip a corrupt record */ }
      }
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  out.sort((a, b) => b.at - a.at);
  return json({ orders: out });
}

export async function onRequestPost({ request, env }) {
  if (!isAdmin(request, env)) return json({ error: 'nope' }, 401);
  let body; try { body = await request.json(); } catch { return json({ error: 'bad json' }, 400); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ error: 'bad json' }, 400);
  const id = str(body.id, 12);
  const raw = await env.ORDERS.get('order:' + id);
  if (!raw) return json({ error: 'no such order' }, 404);
  const o = JSON.parse(raw);
  // Decline an upload (Lady Jaye C1/B6): the image is deleted at once, the item is flagged, and the customer is emailed.
  // body.item is "t<n>" (tag n) or "o<n>" (ornament n). The rights record and the file's SHA-256 stay on the order.
  if (body.action === 'decline') {
    const m = /^([to])(\d{1,2})$/.exec(String(body.item || ''));
    const list = m && (m[1] === 't' ? o.tags : o.ornaments);
    const item = m && Array.isArray(list) ? list[+m[2]] : null;
    if (!item || !item.photo) return json({ error: 'no uploaded image on that item' }, 400);
    if (item.declined) return json({ error: 'already declined' }, 409);
    const index = m[1] === 't' ? +m[2] : item.photoIndex;
    const deleted = await deletePhoto(env, o.id, index);
    item.declined = { at: Date.now(), imageDeleted: deleted };
    const paid = ['paid', 'made', 'shipped', 'done'].includes(o.status) || (o.payment && o.payment.status === 'APPROVED');
    // What is left to make: everything not declined. order.totals is never rewritten (the payment webhook compares against it);
    // the recomputed figure goes in order.remaining so the invoice can be adjusted by hand.
    const tagsLeft = (o.tags || []).filter((x) => !x.declined), ornLeft = (o.ornaments || []).filter((x) => !x.declined);
    const left = tagsLeft.length + ornLeft.length;
    if (!paid && left === 0) o.status = 'cancelled'; // nothing left to make or invoice
    if (left) {
      const t = price(tagsLeft, o.prints || [], (o.customer && o.customer.delivery) || 'ship', Number(o.totals && o.totals.prize) > 0, ornLeft);
      o.remaining = { subtotal: t.subtotal, discount: t.discount, shipping: t.shipping, total: t.total, at: Date.now() };
    } else delete o.remaining;
    const what = m[1] === 't' ? `your ${item.shape || ''} tag`.replace('  ', ' ') : `your ${item.tier === 'stainless' ? 'engraved stainless' : 'printed acrylic'} ornament`;
    const mail = declineEmail(o, { what, paid: Boolean(paid), deleted, remaining: left ? o.remaining : null });
    const sent = await sendEmail(env, { to: o.customer && o.customer.email, ...mail, idempotencyKey: `sdt-decline-${o.id}-${body.item}`, tags: [{ name: 'kind', value: 'art_decline' }] });
    item.declined.emailed = Boolean(sent.ok);
    if (!sent.ok) item.declined.emailError = String(sent.error || '').slice(0, 160);
    o.updated = Date.now();
    await env.ORDERS.put('order:' + o.id, JSON.stringify(o));
    delete o.ua; delete o.ip;
    return json({ ok: true, order: o, emailed: Boolean(sent.ok), imageDeleted: deleted });
  }
  // Smart QR tags: "shipped" is blocked until every smart tag has passed QC (in-page decode AND the phone-camera scan). The owner can
  // override with smartOverride:true (the page asks first); the override and what it skipped are recorded on the order.
  if (['shipped', 'done'].includes(body.status) && !(o.shipped && o.shipped.at)) {
    const blockers = await shipBlockers(env, o);
    if (blockers.length && body.smartOverride !== true) return json({ error: 'Smart tags are not QC passed yet.', blockers, canOverride: true }, 409);
    if (blockers.length) o.smartOverride = { at: Date.now(), blockers };
  }
  const prevStatus = o.status;
  if (body.status && STATUSES.includes(body.status)) o.status = body.status;
  // Keep the tag rows in step (never fails the status change): cancel disables the QR, "made" (Mark engraved) marks tags engraved.
  if (o.status !== prevStatus) {
    try {
      if (o.status === 'cancelled') await disableOrderTags(env, o.id);
      else if (o.status === 'made') await markEngraved(env, o.id);
      else if (o.status === 'shipped' || o.status === 'done') await markShipped(env, o.id);
    } catch (e) { console.warn('tag status sync failed', o.id, String((e && e.message) || e).slice(0, 80)); }
  }
  // Picked "shipped" from the dropdown instead of the Mark shipped button: still stamp when.
  if (o.status === 'shipped' && !(o.shipped && o.shipped.at)) o.shipped = { ...(o.shipped || {}), at: Date.now(), tracking: (o.shipped && o.shipped.tracking) || '' };
  if (body.ownerNote != null) o.ownerNote = str(body.ownerNote, 500);
  o.updated = Date.now();
  await env.ORDERS.put('order:' + id, JSON.stringify(o));
  delete o.ua; delete o.ip;
  return json({ ok: true, order: o });
}
