// POST /api/tag/claim { t, c, email }: the owner proves they hold the packing slip (tag id + 60 bit claim code) and gives an email.
// A valid code sends a magic link. The claim completes only when the link is used (api/auth/verify), so a typo'd email can never
// end up owning a tag. 10 per IP per hour; 5 wrong codes on one tag in a day lock claiming for that tag and page Nick.
import { json, EMAIL_RE, str } from '../_lib.js';
import { readObject } from '../_security.js';
import { normalizeTagId, claimCodeOk } from '../_tagid.js';
import { getTag } from '../_tagdb.js';
import { hasDb, LIMITS } from '../_tagsettings.js';
import { originOk, createLoginToken } from '../_session.js';
import { hit, peek, ipHashOf } from '../_ratelimit.js';
import { sendMagicLink } from '../_tagmail.js';
import { sendOwner } from '../_notify.js';

const BAD = 'That tag id and code do not match. Check the code on your packing slip.';
const day = () => new Date().toISOString().slice(0, 10);

export async function onRequestPost({ request, env }) {
  if (!hasDb(env)) return json({ ok: false, error: 'Tag activation is not available right now.' }, 503);
  if (!originOk(request, env)) return json({ ok: false, error: 'origin' }, 403);
  const parsed = await readObject(request, 2000);
  if (parsed.error) return json({ ok: false, error: parsed.error }, parsed.status);
  const b = parsed.body;
  const ip = await ipHashOf(env, request);
  const rl = await hit(env, 'rl:claim:' + ip, LIMITS.rl.claim[0], LIMITS.rl.claim[1]);
  if (!rl.ok) return json({ ok: false, error: rl.error ? 'Try again in a moment.' : 'Too many tries. Please wait a while.' }, rl.error ? 503 : 429);
  const id = normalizeTagId(b.t), email = str(b.email, 120).toLowerCase();
  if (!EMAIL_RE.test(email)) return json({ ok: false, error: 'Enter a real email, like you@example.com.', field: 'email' }, 400);
  if (!id) return json({ ok: false, error: BAD }, 400);
  let tag;
  try { tag = await getTag(env, id); } catch { return json({ ok: false, error: 'Try again in a moment.' }, 503); }
  // locked after 5 wrong codes today (unknown ids burn the caller's own IP budget instead, so ids cannot be probed)
  const failKey = `claimfail:${id}:${day()}`;
  if (tag && (await peek(env, failKey)) >= LIMITS.claimFailLock) return json({ ok: false, error: 'Activation is locked for this tag today. Email hello@saltydogtags.com and we will sort it out.' }, 429);
  const ok = tag && tag.status !== 'disabled' && (await claimCodeOk(env.TAG_CLAIM_KEY, id, tag.claim_ver, b.c));
  if (!ok) {
    if (tag) {
      const f = await hit(env, failKey, 1e9, 86400);
      if (f.n === LIMITS.claimFailLock) await sendOwner(env, { title: 'Smart tag claim locked', body: `5 wrong claim codes on one tag today (${id.slice(0, 4)}...). Possible guessing.`, priority: '1' });
    }
    return json({ ok: false, error: BAD }, 400);
  }
  if (tag.status === 'claimed') return json({ ok: false, error: 'This tag is already activated. Sign in at saltydogtags.com/my.', claimed: true }, 409);
  const e = await hit(env, 'rl:authemail:' + email, LIMITS.rl.authEmail[0], LIMITS.rl.authEmail[1]);
  if (!e.ok) return json({ ok: false, error: 'We already sent you links. Check your inbox (and spam), or try again in an hour.' }, 429);
  try {
    const token = await createLoginToken(env, { email, purpose: 'claim', tagId: id });
    const r = await sendMagicLink(env, { email, token, purpose: 'claim', dog: tag.dog_name });
    if (!r.ok) return json({ ok: false, error: 'We could not send the email. Try again, or email hello@saltydogtags.com.' }, 502);
  } catch { return json({ ok: false, error: 'Try again in a moment.' }, 503); }
  return json({ ok: true, message: 'Check your email for the activation link. It works once and expires in 15 minutes.' });
}
