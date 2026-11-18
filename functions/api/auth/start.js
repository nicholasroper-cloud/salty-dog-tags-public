// POST /api/auth/start { email }: sign in to /my with a magic link. The reply is IDENTICAL whether or not the email has an account.
// 3 per email and 10 per IP per hour.
import { json, EMAIL_RE, str } from '../_lib.js';
import { readObject } from '../_security.js';
import { hasDb, LIMITS } from '../_tagsettings.js';
import { originOk, createLoginToken } from '../_session.js';
import { hit, ipHashOf } from '../_ratelimit.js';
import { sendMagicLink } from '../_tagmail.js';

const SAME = { ok: true, message: 'If that email has tags on it, a sign-in link is on its way. It works once and expires in 15 minutes.' };

export async function onRequestPost({ request, env }) {
  if (!hasDb(env)) return json({ ok: false, error: 'Sign-in is not available right now.' }, 503);
  if (!originOk(request, env)) return json({ ok: false, error: 'origin' }, 403);
  const parsed = await readObject(request, 1000);
  if (parsed.error) return json({ ok: false, error: parsed.error }, parsed.status);
  const email = str(parsed.body.email, 120).toLowerCase();
  if (!EMAIL_RE.test(email)) return json({ ok: false, error: 'Enter a real email, like you@example.com.', field: 'email' }, 400);
  const ip = await ipHashOf(env, request);
  const a = await hit(env, 'rl:authip:' + ip, LIMITS.rl.authIp[0], LIMITS.rl.authIp[1]);
  const b = await hit(env, 'rl:authemail:' + email, LIMITS.rl.authEmail[0], LIMITS.rl.authEmail[1]);
  if (!a.ok || !b.ok) return json(SAME);            // over the limit looks the same as success: no signal about who has an account
  try {
    const owner = await env.TAGDB.prepare('SELECT id FROM owners WHERE email = ?1').bind(email).first();
    if (owner) { const token = await createLoginToken(env, { email, purpose: 'login' }); await sendMagicLink(env, { email, token, purpose: 'login' }); }
  } catch { /* identical reply */ }
  return json(SAME);
}
