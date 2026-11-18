// GET  /api/auth/verify?token=...  shows a page with ONE button. It does not use the token up: mail scanners and link previewers
//                                  open links on their own, and they must not be able to burn or complete a claim.
// POST /api/auth/verify (form or JSON, token=...)  uses the token (once, atomically), signs the owner in (session cookie), and for a
//                                  claim link completes the claim. Origin must be this site.
import { rowId } from '../_tagid.js';
import { hasDb } from '../_tagsettings.js';
import { originOk, peekLoginToken, consumeLoginToken, createSession } from '../_session.js';
import { pageHeaders } from '../_tagpage.js';

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const page = (title, body, status = 200) => new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)}</title><link rel="stylesheet" href="/t.css?v=1"></head><body><main class="f">${body}<p class="f__brand">Salty Dog Tags</p></main></body></html>`, { status, headers: pageHeaders({ 'referrer-policy': 'same-origin' }) });
const expired = () => page('Link expired', '<h1>That link has expired</h1><p class="f__lead">Sign-in links work once and last 15 minutes.</p><a class="f__btn f__btn--solid" href="/my">Get a new link</a>', 410);

export async function onRequestGet({ request, env }) {
  if (!hasDb(env)) return page('Unavailable', '<h1>Not available right now</h1><p class="f__lead">Please try again in a little while.</p>', 503);
  const token = new URL(request.url).searchParams.get('token') || '';
  let row = null; try { row = await peekLoginToken(env, token); } catch { return page('Unavailable', '<h1>Try again in a moment</h1>', 503); }
  if (!row) return expired();
  const claim = row.purpose === 'claim';
  return page(claim ? 'Activate your tag' : 'Sign in',
    `<h1>${claim ? 'Activate your tag' : 'Sign in'}</h1><p class="f__lead">${claim ? 'One tap and your tag is yours.' : 'One tap and you are signed in.'}</p>
<form method="post" action="/api/auth/verify"><input type="hidden" name="token" value="${esc(token)}"><button class="f__btn f__btn--solid" type="submit">${claim ? 'Activate my tag' : 'Sign in'}</button></form>`);
}

async function dogNameFor(env, tag) {
  try { const raw = await env.ORDERS.get('order:' + tag.order_id); const o = raw && JSON.parse(raw); const t = o && o.tags && o.tags[tag.tag_index]; return (t && t.back && String(t.back[0] || '').trim().slice(0, 40)) || null; } catch { return null; }
}

export async function onRequestPost({ request, env }) {
  if (!hasDb(env)) return page('Unavailable', '<h1>Not available right now</h1>', 503);
  if (!originOk(request, env)) return new Response('forbidden', { status: 403 });
  let token = '';
  const ct = request.headers.get('content-type') || '';
  try { token = ct.includes('json') ? String((await request.json()).token || '') : String(new URLSearchParams(await request.text()).get('token') || ''); } catch { token = ''; }
  const now = Date.now();
  let row = null;
  try { row = await consumeLoginToken(env, token, now); } catch { return page('Unavailable', '<h1>Try again in a moment</h1>', 503); }
  if (!row) return expired();
  try {
    let owner = await env.TAGDB.prepare('SELECT * FROM owners WHERE email = ?1').bind(row.email).first();
    if (!owner) {
      if (row.purpose !== 'claim') return expired();   // sign-in links are only sent to existing owners
      const id = rowId();
      await env.TAGDB.prepare('INSERT OR IGNORE INTO owners(id, email, created_at, last_login_at) VALUES(?1,?2,?3,?3)').bind(id, row.email, now).run();
      owner = await env.TAGDB.prepare('SELECT * FROM owners WHERE email = ?1').bind(row.email).first();
    }
    let claimed = null;
    if (row.purpose === 'claim' && row.tag_id) {
      const tag = await env.TAGDB.prepare('SELECT * FROM tags WHERE id = ?1').bind(row.tag_id).first();
      const dog = tag ? await dogNameFor(env, tag) : null;
      // Atomic: only an unclaimed, enabled tag can be claimed, and only once.
      const r = await env.TAGDB.prepare("UPDATE tags SET owner_id = ?2, status = 'claimed', claimed_at = ?3, dog_name = COALESCE(dog_name, ?4), buyer_email = NULL, burst_id = NULL, burst_at = NULL, burst_loc_alerts = 0 WHERE id = ?1 AND owner_id IS NULL AND status NOT IN ('claimed','disabled')").bind(row.tag_id, owner.id, now, dog).run();
      if (!r.meta.changes) return page('Already activated', '<h1>This tag is already activated</h1><p class="f__lead">Sign in at saltydogtags.com/my to manage it.</p><a class="f__btn f__btn--solid" href="/my">Go to my tags</a>', 409);
      claimed = row.tag_id;
      // the owner's email is the first alert contact (email on, text off until they add and verify a phone)
      await env.TAGDB.prepare('INSERT OR IGNORE INTO contacts(id, owner_id, tag_id, slot, label, email, email_on, sms_on) VALUES(?1,?2,?3,1,?4,?5,1,0)').bind(rowId(), owner.id, row.tag_id, 'Me', owner.email).run();
    }
    await env.TAGDB.prepare('UPDATE owners SET last_login_at = ?2 WHERE id = ?1').bind(owner.id, now).run();
    const s = await createSession(env, owner.id, now);
    return new Response(null, { status: 303, headers: { location: claimed ? `/my?claimed=${encodeURIComponent(claimed)}` : '/my', 'set-cookie': s.cookie, 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' } });
  } catch (e) { console.warn('verify failed', String((e && e.message) || e).slice(0, 80)); return page('Unavailable', '<h1>Try again in a moment</h1>', 503); }
}
