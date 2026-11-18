// GET /api/tags/slip?order=SDT-XXXX (admin). Everything the packing-slip print view needs for each smart tag: dog name, tag URL,
// claim code, claim QR link. The claim code is recomputed from TAG_CLAIM_KEY each time (never stored). No key = no codes (fail closed).
import { json, isAdmin, str } from '../_lib.js';
import { claimCode, tagDisplayUrl } from '../_tagid.js';
import { getTag } from '../_tagdb.js';
import { hasDb } from '../_tagsettings.js';

export async function onRequestGet({ request, env }) {
  if (!isAdmin(request, env)) return json({ error: 'nope' }, 401);
  const orderId = str(new URL(request.url).searchParams.get('order'), 12);
  if (!env.TAGDB || !hasDb(env)) return json({ error: 'The tag database is not connected.' }, 503);
  if (typeof env.TAG_CLAIM_KEY !== 'string' || env.TAG_CLAIM_KEY.length < 16) return json({ error: 'TAG_CLAIM_KEY is not set, so claim codes cannot be made.' }, 503);
  const raw = await env.ORDERS.get('order:' + orderId);
  if (!raw) return json({ error: 'no such order' }, 404);
  const o = JSON.parse(raw);
  const site = String(env.SITE_URL || 'https://saltydogtags.com').replace(/\/+$/, '');
  const slips = [];
  for (let i = 0; i < (o.tags || []).length; i++) {
    const t = o.tags[i];
    if (!t.smart || !t.smart.id || t.declined) continue;
    let row = null; try { row = await getTag(env, t.smart.id); } catch { return json({ error: 'tag database error, try again' }, 502); }
    if (!row || row.status === 'disabled') continue;
    const code = await claimCode(env.TAG_CLAIM_KEY, row.id, row.claim_ver);
    slips.push({
      index: i, id: row.id, dog: (t.back && t.back[0]) || '', qty: t.qty || 1, status: row.status,
      url: tagDisplayUrl(row.id, env), code,
      claimUrl: `${site}/claim?t=${encodeURIComponent(row.id)}&c=${encodeURIComponent(code.replace(/-/g, ''))}`
    });
  }
  return json({ orderId: o.id, customer: (o.customer && o.customer.name) || '', slips });
}
