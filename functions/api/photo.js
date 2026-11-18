// GET /api/photo?id=ORDERID&t=0 — owner-only. Returns the raw image for a photo-engraving tag.
// Bearer admin auth, same as /api/orders. Never cached publicly: it's a customer's uploaded photo.
import { isAdmin, getPhoto } from './_lib.js';

export async function onRequestGet({ request, env }) {
  if (!isAdmin(request, env)) return new Response('nope', { status: 401 });
  const url = new URL(request.url);
  const id = (url.searchParams.get('id') || '').slice(0, 12);
  const t = parseInt(url.searchParams.get('t'), 10);
  if (!id || !Number.isInteger(t) || t < 0) return new Response('bad request', { status: 400 });
  const found = await getPhoto(env, id, t);
  if (!found) return new Response('not found', { status: 404 });
  return new Response(found.bytes, {
    // An uploaded SVG is sanitized before storage; these headers are the second wall if one ever slipped through:
    // no script, no sub-resources, no sniffing, and a sandbox if it is opened as a document.
    headers: { 'content-type': found.mime, 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox" },
  });
}
