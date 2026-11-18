// Magic link and SMS code messages for the smart tag claim and sign-in flow.
import { sendAlertEmail } from './_tagnotify.js';
import { LIMITS } from './_tagsettings.js';

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const verifyUrl = (env, token) => `${String(env.SITE_URL || 'https://saltydogtags.com').replace(/\/+$/, '')}/api/auth/verify?token=${encodeURIComponent(token)}`;

export async function sendMagicLink(env, { email, token, purpose, dog }) {
  const link = verifyUrl(env, token);
  const mins = Math.round(LIMITS.loginTokenMs / 60000);
  const claim = purpose === 'claim';
  const subject = claim ? `Activate ${dog ? dog + "'s" : 'your'} tag` : 'Your Salty Dog Tags sign-in link';
  const lead = claim ? `Tap the button to activate ${dog ? dog + "'s" : 'your'} tag and set up alerts.` : 'Tap the button to sign in to your tags.';
  const text = `${lead}\n\n${link}\n\nThis link works once and expires in ${mins} minutes. If you did not ask for it, ignore this email: nothing happens unless the link is used.`;
  const html = `<div style="font:16px/1.5 system-ui,sans-serif;color:#111;max-width:34rem"><p>${esc(lead)}</p><p><a href="${esc(link)}" style="display:inline-block;padding:12px 22px;background:#e6007e;color:#fff;border-radius:999px;text-decoration:none;font-weight:700">${claim ? 'Activate my tag' : 'Sign in'}</a></p><p style="color:#555;font-size:14px">This link works once and expires in ${mins} minutes. If you did not ask for it, ignore this email: nothing happens unless the link is used.</p></div>`;
  return sendAlertEmail(env, { to: email, subject, html, text });
}
