// POST /api/tag-sms-inbound: Twilio inbound webhook for the owner-alert Messaging Service (TAG_TWILIO_MSID).
// Set it as the "Incoming messages: Send a webhook" URL on that Messaging Service (README, "Before the first text").
//   STOP words  -> contacts.sms_stopped_at = now for that number (email keeps flowing); Twilio also sends its own STOP reply.
//   START words -> clears sms_stopped_at.
//   HELP        -> a plain help reply.
//   YES         -> confirms a contact-2 number that was sent the "Reply YES" text (sms_verified_at).
// The request is trusted ONLY if X-Twilio-Signature verifies under TWILIO_TOKEN. No token, bad signature: 403 and nothing changes.
import { hasDb } from './_tagsettings.js';
import { safeEqual } from './_security.js';

export const STOP_RE = /^\s*(stop|stopall|unsubscribe|cancel|end|quit|revoke|optout)\s*[.!]?\s*$/i;
// A longer message that starts with STOP ("STOP texting me") still counts: carriers expect the keyword honored in the first word.
export const PLAIN_STOP_RE = /^\s*(stop|stopall|unsubscribe|cancel|quit)\b/i;
export const START_RE = /^\s*(start|unstop|yes start)\s*[.!]?\s*$/i;
export const HELP_RE = /^\s*(help|info)\s*[.!]?\s*$/i;
export const YES_RE = /^\s*(yes|y|confirm)\s*[.!]?\s*$/i;

const xml = (body) => new Response(`<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`, { status: 200, headers: { 'content-type': 'text/xml; charset=utf-8', 'cache-control': 'no-store' } });
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

// Twilio's signature: base64(HMAC-SHA1(token, fullUrl + each POST param name+value sorted by name)).
export async function twilioSigOk(token, url, params, sig) {
  if (!token || !sig) return false;
  const keys = [...params.keys()].sort();
  let data = url;
  for (const k of keys) for (const v of params.getAll(k)) data += k + v;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(token), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data)));
  return safeEqual(btoa(String.fromCharCode(...mac)), sig);
}

export async function onRequestPost({ request, env }) {
  if (!env.TWILIO_TOKEN) return new Response('not configured', { status: 403 });
  const raw = await request.text();
  if (raw.length > 5000) return new Response('too big', { status: 413 });
  const params = new URLSearchParams(raw);
  // Twilio signs the URL it called; behind Cloudflare that is the public URL, so use SITE_URL when set.
  const base = String(env.SITE_URL || new URL(request.url).origin).replace(/\/+$/, '');
  const url = base + new URL(request.url).pathname;
  if (!(await twilioSigOk(env.TWILIO_TOKEN, url, params, request.headers.get('x-twilio-signature')))) return new Response('bad signature', { status: 403 });
  if (!hasDb(env)) return xml('');
  const from = String(params.get('From') || '').trim(), body = String(params.get('Body') || '');
  if (!/^\+[1-9]\d{7,14}$/.test(from)) return xml('');
  const now = Date.now();
  try {
    if (STOP_RE.test(body) || PLAIN_STOP_RE.test(body)) {
      const r = await env.TAGDB.prepare('UPDATE contacts SET sms_stopped_at = ?2, sms_on = 0 WHERE phone_e164 = ?1').bind(from, now).run();
      console.log('tag sms STOP handled, contacts', r.meta.changes);   // a count, never the number
      return xml('');            // Twilio's own advanced opt-out sends the STOP confirmation
    }
    if (START_RE.test(body)) {
      await env.TAGDB.prepare('UPDATE contacts SET sms_stopped_at = NULL WHERE phone_e164 = ?1').bind(from).run();
      return xml('<Message>Salty Dog Tags alerts are back on. Reply STOP to end them.</Message>');
    }
    if (HELP_RE.test(body)) return xml('<Message>Salty Dog Tags alerts: you get a text when a tag you set up is scanned or someone messages you. Manage it at saltydogtags.com/my or email hello@saltydogtags.com. Reply STOP to end alerts.</Message>');
    if (YES_RE.test(body)) {
      const r = await env.TAGDB.prepare('UPDATE contacts SET sms_verified_at = ?2, sms_pending_at = NULL WHERE phone_e164 = ?1 AND sms_pending_at IS NOT NULL AND sms_stopped_at IS NULL').bind(from, now).run();
      return xml(r.meta.changes ? `<Message>${esc('You are set. Salty Dog Tags will text you when the tag is scanned. Reply STOP to end alerts.')}</Message>` : '');
    }
  } catch { return xml(''); }
  return xml('');
}
