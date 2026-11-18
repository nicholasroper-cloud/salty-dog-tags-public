// POST /api/roast-feedback  { rid, vote:'fire'|'meh'|'toofar', custom?:{idx,up,replace?}, notes?, note? }
//   custom.replace with up:false -> also writes a NEW custom line in that slot and returns it as `line`
//   (max REWRITES per roast; the roast record is updated so later votes refer to the new line).
//   -> stores fb:<rid> (one per roast, overwrite ok, custom votes merge) and keeps the rolling fb:learn list
//      that roast.js feeds back into the system prompt. No photos, no IPs: roast text only.
// GET (Bearer ADMIN_KEY) -> last 100 feedback rows joined with roast text, counts, and fb:learn.
import { json, str, corsHeaders, handlePreflight, rateLimitIp, isAdmin } from './_lib.js';
import { rewriteCustom } from './_roastkit.js';

export const onRequestOptions = ({ request, env }) => handlePreflight(request, env);

const VOTES = ['fire', 'meh', 'toofar'];
const TTL = 90 * 86400;
const LIM = { landed: 12, flat: 8, toofar: 8, dud: 8 };
const REWRITES = 4; // new lines per roast; after that the page says "Roast again"
const lineOf = (c) => [c && c.l1, c && c.l2, c && c.l3].filter((x) => typeof x === 'string' && x.trim()).join(' / ');
const snip = (s, n) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);

function bump(list, item, max) { // newest first, deduped, capped
  return [item].concat(list.filter((x) => x !== item)).slice(0, max);
}

export async function onRequestPost({ request, env }) {
  const extra = corsHeaders(request, env);
  if (!env.ORDERS) return json({ error: 'storage not configured' }, 503, extra);
  let body;
  try {
    const raw = await request.text();
    if (raw.length > 4000) return json({ error: 'too big' }, 413, extra);
    body = JSON.parse(raw);
  } catch { return json({ error: 'bad json' }, 400, extra); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ error: 'bad json' }, 400, extra);
  const rid = str(body.rid, 20);
  if (!/^[A-Za-z0-9]{6,20}$/.test(rid)) return json({ error: 'bad rid' }, 400, extra);
  const vote = body.vote == null ? null : String(body.vote);
  if (vote !== null && !VOTES.includes(vote)) return json({ error: 'bad vote' }, 400, extra);
  const cv = body.custom && typeof body.custom === 'object' ? body.custom : null;
  if (!vote && !cv) return json({ error: 'nothing to record' }, 400, extra);

  // Own counter: votes must not eat into the visitor's 5 roasts an hour (that budget is 'ai:ip:').
  const limited = await rateLimitIp(env, request, 30, 3600, 'fb:ip:');
  if (!limited.ok) return json({ error: 'Too many requests. Try again in a bit.' }, 429, extra);

  const roastRaw = await env.ORDERS.get('roast:' + rid);
  if (!roastRaw) return json({ error: 'unknown roast' }, 404, extra);
  let roast; try { roast = JSON.parse(roastRaw); } catch { return json({ error: 'unknown roast' }, 404, extra); }

  let fb = {};
  try { fb = JSON.parse((await env.ORDERS.get('fb:' + rid)) || '{}') || {}; } catch { fb = {}; }
  let learn = { landed: [], flat: [], toofar: [], dud: [] };
  try { const l = JSON.parse((await env.ORDERS.get('fb:learn')) || 'null'); if (l) learn = { landed: l.landed || [], flat: l.flat || [], toofar: l.toofar || [], dud: l.dud || [] }; } catch {}

  const prev = fb.vote;
  fb.rid = rid; fb.at = Date.now();
  fb.custom = fb.custom || {};
  if (vote) {
    fb.vote = vote;
    const opener = snip(roast.roast, 70), far = snip(roast.roast, 110);
    // a changed vote retracts the earlier one's learn entry
    if (prev === 'meh' && vote !== 'meh') learn.flat = learn.flat.filter((x) => x !== opener);
    if (prev === 'toofar' && vote !== 'toofar') learn.toofar = learn.toofar.filter((x) => x !== far);
    if (vote === 'meh' && opener) learn.flat = bump(learn.flat, opener, LIM.flat);
    if (vote === 'toofar' && far) learn.toofar = bump(learn.toofar, far, LIM.toofar);
  }
  if (cv) {
    const idx = Number(cv.idx);
    const c = Array.isArray(roast.customs) ? roast.customs[idx] : null;
    if (!Number.isInteger(idx) || !c) return json({ error: 'bad custom idx' }, 400, extra);
    const line = lineOf(c);
    const up = Boolean(cv.up);
    fb.custom[idx] = up;
    if (up) { learn.landed = bump(learn.landed, line, LIM.landed); learn.dud = learn.dud.filter((x) => x !== line); }
    else { learn.landed = learn.landed.filter((x) => x !== line); learn.dud = bump(learn.dud, line, LIM.dud); }
  }
  if (body.note != null) fb.note = str(body.note, 140);

  await env.ORDERS.put('fb:' + rid, JSON.stringify(fb), { expirationTtl: TTL, metadata: { at: fb.at, vote: fb.vote || null } });
  await env.ORDERS.put('fb:learn', JSON.stringify(learn));

  // Thumbs down + replace: write a fresh line for that slot. The vote above is already saved either way.
  if (cv && !cv.up && cv.replace) {
    const idx = Number(cv.idx);
    const done = Number(roast.rewrites) || 0;
    if (done >= REWRITES) return json({ ok: true, line: null, reason: 'limit' }, 200, extra);
    const line = await rewriteCustom(env, roast, idx, str(body.notes, 300));
    if (!line) return json({ ok: true, line: null, reason: 'failed' }, 200, extra);
    roast.rejected = (Array.isArray(roast.rejected) ? roast.rejected : []).concat([roast.customs[idx]]).slice(-10);
    roast.customs[idx] = line;
    roast.rewrites = done + 1;
    try { await env.ORDERS.put('roast:' + rid, JSON.stringify(roast), { expirationTtl: 90 * 86400 }); } catch {}
    // The new line has not been rated yet.
    delete fb.custom[idx];
    try { await env.ORDERS.put('fb:' + rid, JSON.stringify(fb), { expirationTtl: TTL, metadata: { at: fb.at, vote: fb.vote || null } }); } catch {}
    return json({ ok: true, line, left: REWRITES - roast.rewrites }, 200, extra);
  }
  return json({ ok: true }, 200, extra);
}

export async function onRequestGet({ request, env }) {
  if (!isAdmin(request, env)) return json({ error: 'unauthorized' }, 401);
  if (!env.ORDERS) return json({ error: 'storage not configured' }, 503);
  const keys = []; let cursor;
  for (let i = 0; i < 5; i++) {
    const r = await env.ORDERS.list({ prefix: 'fb:', cursor });
    keys.push(...r.keys.filter((k) => k.name !== 'fb:learn'));
    if (r.list_complete) break;
    cursor = r.cursor;
  }
  const counts = { fire: 0, meh: 0, toofar: 0 };
  for (const k of keys) { const v = k.metadata && k.metadata.vote; if (counts[v] != null) counts[v]++; }
  keys.sort((a, b) => ((b.metadata && b.metadata.at) || 0) - ((a.metadata && a.metadata.at) || 0));
  const rows = (await Promise.all(keys.slice(0, 100).map(async (k) => {
    try {
      const rid = k.name.slice(3);
      const fb = JSON.parse(await env.ORDERS.get(k.name));
      const roast = JSON.parse((await env.ORDERS.get('roast:' + rid)) || 'null');
      return { ...fb, roast: roast || null };
    } catch { return null; }
  }))).filter(Boolean);
  let learn = null;
  try { learn = JSON.parse((await env.ORDERS.get('fb:learn')) || 'null'); } catch {}
  return json({ counts, rows, learn }, 200);
}
