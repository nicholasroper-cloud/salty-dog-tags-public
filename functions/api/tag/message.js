// POST /api/tag/message { t, n, message, reply, website }: a finder writes to the family. One way only (finder to owner), a fixed template,
// no links, capped length. 5 per IP per hour, 3 per IP per tag per day. No API here takes an arbitrary To number.
import { json } from '../_lib.js';
import { guard } from '../_tagapi.js';
import { hit, ipHashOf } from '../_ratelimit.js';
import { onMessage, onUnclaimedMessage, cleanText } from '../_tagnotify.js';
import { LIMITS } from '../_tagsettings.js';

export async function onRequestPost({ request, env }) {
  const g = await guard(request, env);
  if (g.res) return g.res;
  if (g.body.website) return json({ ok: true, sent: true });            // honeypot
  const ip = await ipHashOf(env, request);
  const a = await hit(env, 'rl:msg:' + ip, LIMITS.rl.message[0], LIMITS.rl.message[1]);
  if (!a.ok) return json({ ok: false, error: 'rate' }, a.error ? 503 : 429);
  const b = await hit(env, `rl:msgtag:${ip}:${g.tag.id}`, LIMITS.rl.messageTag[0], LIMITS.rl.messageTag[1]);
  if (!b.ok) return json({ ok: false, error: 'rate' }, b.error ? 503 : 429);
  const message = cleanText(g.body.message, LIMITS.messageMax), reply = cleanText(g.body.reply, LIMITS.replyMax);
  if (message.length < 2) return json({ ok: false, error: 'Write a short message first. Links are not allowed.' }, 400);
  try {
    const r = g.tag.status === 'claimed' ? await onMessage(env, g.tag, { message, reply, ipHash: ip }) : await onUnclaimedMessage(env, g.tag, { message, reply, ipHash: ip });
    return json({ ok: true, sent: true, delivered: Boolean(r.alerted || r.forwarded) });
  } catch { return json({ ok: false, error: 'unavailable' }, 503); }
}
