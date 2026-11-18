// GET /api/wall/img?id=<id> -> the entry's jpeg, long cache.
export async function onRequestGet({ request, env }) {
  const id = new URL(request.url).searchParams.get('id') || '';
  if (!/^[a-z0-9]{4,20}$/.test(id)) return new Response('bad id', { status: 400 });
  const b64 = await env.ORDERS.get('wallimg:' + id);
  if (!b64) return new Response('not found', { status: 404, headers: { 'cache-control': 'no-store' } });
  const bin = atob(b64), u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return new Response(u, { headers: { 'content-type': 'image/jpeg', 'cache-control': 'public, max-age=3600' } });
}
