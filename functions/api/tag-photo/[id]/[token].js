// GET /api/tag-photo/<orderId>/<token> — the photo of the finished tag, as linked from the
// "Your tag shipped" email. Public on purpose (email clients and Gmail's image proxy fetch it with no
// cookies), but unguessable: <token> is 128 random bits stored on the order (shipPhoto.token) and a retake
// mints a new one. There is no index or listing route. A wrong id, wrong token or missing photo all get
// the same plain 404, so the URL can't be used to probe which order ids exist.
//
// Cacheable for a year: a given URL only ever maps to one photo (new photo = new token = new URL).
import { getPhoto } from '../../_lib.js';
import { SHIP_PHOTO_SLOT } from '../../ship.js';

const notFound = () => new Response('not found', { status: 404, headers: { 'content-type': 'text/plain', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' } });

function sameToken(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export async function onRequestGet({ params, env }) {
  const id = String(params.id || '');
  const token = String(params.token || '').replace(/\.jpe?g$/i, '').toLowerCase();
  if (!/^SDT-[A-Z0-9]{4}$/.test(id) || !/^[0-9a-f]{32}$/.test(token)) return notFound();
  const raw = await env.ORDERS.get('order:' + id);
  if (!raw) return notFound();
  let o; try { o = JSON.parse(raw); } catch { return notFound(); }
  if (!o.shipPhoto || !sameToken(o.shipPhoto.token, token)) return notFound();
  const found = await getPhoto(env, id, SHIP_PHOTO_SLOT);
  if (!found) return notFound();
  return new Response(found.bytes, {
    headers: {
      'content-type': found.mime || 'image/jpeg',
      'cache-control': 'public, max-age=31536000, immutable',
      'content-disposition': `inline; filename="${id}-tag.jpg"`,
      'x-robots-tag': 'noindex, noimageindex',
      'x-content-type-options': 'nosniff',
    },
  });
}

export const onRequestHead = onRequestGet;
