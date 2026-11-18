// Owner-only (Bearer ADMIN_KEY). The "Your tag shipped" flow from /orders.html.
//
//   GET  /api/ship                                   -> { email: { configured, from, orderConfirm }, photoStore }
//   POST /api/ship { id, action:'photo', image }      -> store the photo of the finished tag (data URL, JPEG)
//   POST /api/ship { id, action:'ship', tracking, email:true|false }
//                                                    -> status 'shipped' + timestamp, then (maybe) the customer email
//   POST /api/ship { id, action:'resend' }           -> send the shipped email again (Nick tapped Resend)
//
// Order fields this writes:
//   shipPhoto: { token, at, bytes, mime }   token makes /api/tag-photo/<id>/<token> (the public, unguessable URL)
//   shipped:   { at, tracking }
//   shipEmail: { ok, at, to, id?, error?, sends, skipped? }
//
// Rule: the status change is saved BEFORE any email is attempted, and an email failure only ever lands
// in shipEmail. Nothing here returns an error because email failed.
import { json, isAdmin, str, storePhoto, hasR2Photos } from './_lib.js';
import { shipBlockers, markShipped } from './_tagdb.js';
import { emailEnabled, orderConfirmEnabled, emailFrom, siteUrl, sendEmail, shippedEmail, cleanTracking } from './_email.js';

export const SHIP_PHOTO_SLOT = 'shipped';      // photo key: R2 "<id>/shipped" or KV "photo:<id>:shipped"
export const SHIP_PHOTO_MAX_KV = 700_000;      // client aims for ~300 KB; KV values are cheap but not free
export const SHIP_PHOTO_MAX_R2 = 1_500_000;
const MAX_BODY = 2_500_000;
export const MAX_SENDS = 5;                    // shipped emails per order, including resends
export const RESEND_GAP_MS = 60_000;           // at least a minute between sends for the same order

const strip = (o) => { delete o.ua; delete o.ip; return o; };

function newToken() {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

export const photoUrlFor = (env, order) =>
  order.shipPhoto && order.shipPhoto.token ? `${siteUrl(env)}/api/tag-photo/${encodeURIComponent(order.id)}/${order.shipPhoto.token}` : '';

async function load(env, id) {
  const raw = await env.ORDERS.get('order:' + id);
  return raw ? JSON.parse(raw) : null;
}
const save = (env, o) => env.ORDERS.put('order:' + o.id, JSON.stringify(o));

export async function onRequestGet({ request, env }) {
  if (!isAdmin(request, env)) return json({ error: 'nope' }, 401);
  return json({
    email: { configured: emailEnabled(env), from: emailEnabled(env) ? emailFrom(env) : null, orderConfirm: orderConfirmEnabled(env) },
    photoStore: hasR2Photos(env) ? 'r2' : 'kv',
  });
}

// Records a "didn't send" on the order, unless an earlier send already went out (that one stays the headline).
async function recordSkip(env, id, why) {
  const o = await load(env, id);
  if (!o) return null;
  if (!(o.shipEmail && o.shipEmail.ok)) {
    o.shipEmail = { ...(o.shipEmail || {}), ok: false, skipped: true, error: why, at: Date.now() };
    try { await save(env, o); } catch {}
  }
  return o;
}

// Sends (or skips) the shipped email and records the result on the order. Never throws.
async function deliver(env, id, { force }) {
  let o = await load(env, id);
  if (!o) return { ok: false, error: 'order vanished' };
  const prev = o.shipEmail || {};
  const sends = prev.sends || 0;
  if (!force && prev.ok) return { ok: true, skipped: true, note: 'already sent, tap Resend to send again', order: strip(o) };
  let why = '';
  if (!emailEnabled(env)) why = 'Email not set up yet (see README)';
  else if (sends >= MAX_SENDS) why = `already sent ${sends} times for this order, that's the limit`;
  else if (prev.ok && prev.at && Date.now() - prev.at < RESEND_GAP_MS) why = 'just sent, wait a minute before resending';
  if (why) {
    o = (await recordSkip(env, id, why)) || o;
    return { ok: false, skipped: true, error: why, order: strip(o) };
  }
  let r;
  try {
    const msg = shippedEmail(o, { photoUrl: photoUrlFor(env, o), tracking: (o.shipped && o.shipped.tracking) || '' });
    r = await sendEmail(env, {
      to: o.customer && o.customer.email,
      ...msg,
      idempotencyKey: `sdt-shipped-${o.id}-${sends + 1}`,
      tags: [{ name: 'kind', value: 'shipped' }],
    });
  } catch (e) {
    r = { ok: false, error: 'could not build email: ' + String(e && e.message).slice(0, 160) };
  }
  // Re-read so we never clobber a change that landed while Resend was thinking.
  o = (await load(env, id)) || o;
  o.shipEmail = { ok: r.ok, at: Date.now(), to: o.customer && o.customer.email, id: r.id || undefined, error: r.ok ? undefined : r.error, sends: sends + 1 };
  o.updated = Date.now();
  try { await save(env, o); } catch (e) { console.warn('could not record ship email result', id, e && e.message); }
  return { ...r, order: strip(o) };
}

export async function onRequestPost({ request, env }) {
  if (!isAdmin(request, env)) return json({ error: 'nope' }, 401);
  const raw = await request.text();
  if (raw.length > MAX_BODY) return json({ error: 'Photo too big. Try again, the page shrinks it first.' }, 413);
  let body; try { body = JSON.parse(raw); } catch { return json({ error: 'bad json' }, 400); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ error: 'bad json' }, 400);
  const id = str(body.id, 12);
  const o = await load(env, id);
  if (!o) return json({ error: 'no such order' }, 404);

  if (body.action === 'photo') {
    const img = String(body.image || '');
    if (!/^data:image\/jpeg;base64,/.test(img)) return json({ error: 'Send a JPEG (the page converts it).' }, 400);
    const approx = Math.floor(((img.length - img.indexOf(',') - 1) * 3) / 4);
    const cap = hasR2Photos(env) ? SHIP_PHOTO_MAX_R2 : SHIP_PHOTO_MAX_KV;
    if (approx > cap) return json({ error: `Photo is ${Math.round(approx / 1000)} KB, max ${Math.round(cap / 1000)} KB.` }, 413);
    const res = await storePhoto(env, id, SHIP_PHOTO_SLOT, img);
    if (res.error) return json({ error: res.error }, 400);
    // New token every time: a retake gets a new URL, so no cache anywhere can serve the old photo for it.
    o.shipPhoto = { token: newToken(), at: Date.now(), bytes: res.bytes, mime: res.mime };
    o.updated = Date.now();
    await save(env, o);
    return json({ ok: true, order: strip(o), photoUrl: photoUrlFor(env, o) });
  }

  if (body.action === 'ship') {
    if (o.status === 'cancelled') return json({ error: 'That order is cancelled.' }, 409);
    const t = cleanTracking(body.tracking);
    if (!t.ok) return json({ error: t.error, field: 'tracking' }, 400);
    const first = !o.shipped || !o.shipped.at;
    if (first) {   // smart tags must be QC passed before the first ship (override recorded on the order)
      const blockers = await shipBlockers(env, o);
      if (blockers.length && body.smartOverride !== true) return json({ error: 'Smart tags are not QC passed yet.', blockers, canOverride: true }, 409);
      if (blockers.length) o.smartOverride = { at: Date.now(), blockers };
    }
    o.shipped = { ...(o.shipped || {}), at: first ? Date.now() : o.shipped.at, tracking: t.number || (o.shipped && o.shipped.tracking) || '' };
    if (o.status !== 'done') o.status = 'shipped';
    o.updated = Date.now();
    await save(env, o); // status is final here, whatever email does next
    if (first) { try { await markShipped(env, o.id); } catch (e) { console.warn('tag ship sync failed', o.id); } }
    if (body.email !== true) {
      // Toggle off, or just fixing the tracking on an order that already shipped: no email, and a
      // tracking fix leaves the email record alone.
      const why = 'not sent (email toggle was off)';
      const after = first ? ((await recordSkip(env, id, why)) || o) : o;
      return json({ ok: true, order: strip(after), email: { ok: false, skipped: true, error: first ? why : 'tracking updated, no email' } });
    }
    const e = await deliver(env, id, { force: false });
    const { order, ...email } = e;
    return json({ ok: true, order: order || strip(o), email });
  }

  if (body.action === 'resend') {
    if (!o.shipped || !o.shipped.at) return json({ error: 'Mark it shipped first.' }, 409);
    const e = await deliver(env, id, { force: true });
    const { order, ...email } = e;
    return json({ ok: true, order: order || strip(o), email });
  }

  return json({ error: 'unknown action' }, 400);
}
