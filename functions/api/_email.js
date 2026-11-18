// Customer email for Salty Dog Tags, sent through Resend's HTTP API (no SDK).
//
// Completely dormant until the RESEND_API_KEY Pages secret exists (README, "Turning on customer email").
// Optional secrets: EMAIL_FROM (default "Salty Dog Tags <hello@saltydogtags.com>"), EMAIL_REPLY_TO
// (default hello@saltydogtags.com), EMAIL_ORDER_CONFIRM ("true" turns on the "Your order is in" email,
// default off), SITE_URL (default https://saltydogtags.com, used for the photo link).
//
// sendEmail() never throws: it returns { ok, id } or { ok:false, error }. Callers save that on the order
// so the owner page can show it. Nothing here may ever fail a status change or an order.

export const RESEND_URL = 'https://api.resend.com/emails';
const DEFAULT_FROM = 'Salty Dog Tags <hello@saltydogtags.com>';
const DEFAULT_REPLY_TO = 'hello@saltydogtags.com';
const SEND_TIMEOUT_MS = 8000;

// Whole-site safety net: no more than this many emails in one UTC day, whatever happens.
export const DAILY_CAP = 150;
// The order-confirmation email goes to whatever address a stranger typed, so it also gets a per-address cap.
export const CONFIRM_PER_ADDRESS_PER_DAY = 3;

export const emailEnabled = (env) => typeof env.RESEND_API_KEY === 'string' && env.RESEND_API_KEY.trim().length > 0;
export const orderConfirmEnabled = (env) => emailEnabled(env) && String(env.EMAIL_ORDER_CONFIRM || '').trim().toLowerCase() === 'true';
export const emailFrom = (env) => String(env.EMAIL_FROM || '').trim() || DEFAULT_FROM;
export const siteUrl = (env) => String(env.SITE_URL || 'https://saltydogtags.com').replace(/\/+$/, '');

/* ---------- small helpers ---------- */
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const oneLine = (s, max = 120) => String(s == null ? '' : s).replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const today = () => new Date().toISOString().slice(0, 10);

async function sha(input) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('').slice(0, 24);
}

// KV counter. Not atomic (KV isn't), which is fine for a safety net. Fails closed: a KV error means no send.
async function bump(env, key, limit, ttl) {
  try {
    const n = parseInt((await env.ORDERS.get(key)) || '0', 10) || 0;
    if (n >= limit) return false;
    await env.ORDERS.put(key, String(n + 1), { expirationTtl: ttl });
    return true;
  } catch { return false; }
}

/* ---------- USPS tracking numbers ----------
   Loose on purpose: we only want to catch typos and pasted junk, not police USPS's numbering.
   Accepts (spaces and dashes ignored, case ignored):
     - 20 to 22 digits                       IMpb / Click-N-Ship / Pirate Ship labels (9400 1..., 9205 5..., 9361...)
     - 420 + ZIP(5 or 9) + 20-22 digits      what a barcode scanner reads off the label; the routing prefix is dropped
     - 2 letters + 9 digits + "US"           Priority Mail Express / international (EC123456789US)
     - 10 digits                              older domestic labels
   Returns { ok, number } with the cleaned number, or { ok:false, error }. Empty is fine (no tracking). */
export function cleanTracking(raw) {
  const s = String(raw == null ? '' : raw).toUpperCase().replace(/[\s-]+/g, '');
  if (!s) return { ok: true, number: '' };
  let m;
  if ((m = /^420\d{5}(\d{20,22})$/.exec(s)) || (m = /^420\d{9}(\d{20,22})$/.exec(s))) return { ok: true, number: m[1] };
  if (/^\d{20,22}$/.test(s) || /^[A-Z]{2}\d{9}US$/.test(s) || /^\d{10}$/.test(s)) return { ok: true, number: s };
  return { ok: false, error: "That doesn't look like a USPS tracking number (usually 20 to 22 digits starting 9, or like EC123456789US)." };
}
export const trackingUrl = (n) => 'https://tools.usps.com/go/TrackConfirmAction?tLabels=' + encodeURIComponent(n);

/* ---------- Resend ---------- */
// msg: { to, subject, html, text, idempotencyKey?, tags? }. Never throws.
export async function sendEmail(env, msg) {
  if (!emailEnabled(env)) return { ok: false, error: 'not-configured' };
  const to = oneLine(msg.to, 120).toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return { ok: false, error: 'no valid customer email' };
  if (!(await bump(env, 'email:day:' + today(), DAILY_CAP, 60 * 60 * 26))) return { ok: false, error: 'daily email cap reached (' + DAILY_CAP + ')' };
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), SEND_TIMEOUT_MS);
  try {
    const headers = { authorization: 'Bearer ' + env.RESEND_API_KEY.trim(), 'content-type': 'application/json' };
    // Resend drops a second request with the same key for 24h, so a double-tap can't double-send.
    if (msg.idempotencyKey) headers['Idempotency-Key'] = String(msg.idempotencyKey).slice(0, 256);
    const r = await fetch(RESEND_URL, {
      method: 'POST',
      signal: ctl.signal,
      headers,
      body: JSON.stringify({
        from: emailFrom(env),
        to: [to],
        reply_to: String(env.EMAIL_REPLY_TO || '').trim() || DEFAULT_REPLY_TO,
        subject: oneLine(msg.subject, 150),
        html: msg.html,
        text: msg.text,
        tags: msg.tags,
      }),
    });
    const body = await r.text();
    let data = null; try { data = JSON.parse(body); } catch {}
    if (!r.ok) return { ok: false, error: 'Resend ' + r.status + ': ' + oneLine((data && (data.message || data.name)) || body, 200) };
    return { ok: true, id: (data && data.id) || '' };
  } catch (e) {
    return { ok: false, error: e && e.name === 'AbortError' ? 'Resend timed out' : 'send failed: ' + oneLine(e && e.message, 160) };
  } finally {
    clearTimeout(timer);
  }
}

/* ---------- what's on the tag ---------- */
// Dog name = first back line (that's how the builder lays it out: name, phone, ...).
export function tagFacts(order) {
  const tags = Array.isArray(order.tags) ? order.tags : [];
  const list = tags.map((t) => ({
    saying: t.photo ? '' : (t.front || []).filter(Boolean).join(' / '),
    photo: Boolean(t.photo),
    name: ((t.back || [])[0] || '').trim(),
    qty: t.qty || 1,
  }));
  const raw = (list.find((t) => t.name) || {}).name || '';
  // Tags are usually typed in caps ("WINSTON"); in a sentence that reads like shouting, so soften it.
  const dog = raw && raw === raw.toUpperCase() && /[A-Z]/.test(raw)
    ? raw.toLowerCase().replace(/(^|[\s'-])([a-z])/g, (m, a, b) => a + b.toUpperCase())
    : raw;
  return { list, dog };
}

/* ---------- shared layout ----------
   Table layout + inline styles so it survives Gmail/Outlook. Light by default (most clients), with a
   prefers-color-scheme block for Apple Mail / iOS Mail, and colors picked so a forced inversion
   (Gmail app, Outlook) still reads: dark ink on near-white, a magenta that inverts to a readable green-teal,
   and the header band is real dark so the "inverted" version just gets lighter, not illegible. */
const C = { void: '#09010F', ink: '#1A0B33', mute: '#5B4E6E', page: '#F4EEF7', card: '#FFFFFF', line: '#E7DDEE', magenta: '#D4157F', foam: '#FFF4FA', soft: '#FBF6FD' };
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Archivo,Helvetica,Arial,sans-serif";
const DISPLAY = "Bungee,Impact,'Arial Black',Helvetica,Arial,sans-serif";

function layout({ title, preheader, bodyHtml, footNote }) {
  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${esc(title)}</title>
<style>
  body{margin:0;padding:0;-webkit-text-size-adjust:100%}
  a{color:${C.magenta}}
  @media (max-width:600px){ .px{padding-left:20px !important;padding-right:20px !important} .h1{font-size:26px !important} }
  @media (prefers-color-scheme: dark){
    .bg{background:#0E0418 !important}
    .card{background:#180A2C !important;border-color:#2E1A4A !important}
    .ink{color:#FFF4FA !important}
    .mute{color:#CFC3DD !important}
    .soft{background:#22113B !important;border-color:#3A2458 !important}
    .lnk{color:#FF62BD !important}
    .btn{background:#FF3CAC !important}
    .btn-a{color:#09010F !important}
    .rule{border-color:#2E1A4A !important}
  }
</style>
</head>
<body class="bg" style="margin:0;padding:0;background:${C.page}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${esc(preheader)}&#8199;&#847;&#8199;&#847;&#8199;&#847;&#8199;&#847;&#8199;&#847;&#8199;&#847;</div>
<table role="presentation" class="bg" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.page}">
<tr><td align="center" style="padding:24px 12px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px">
    <tr><td style="background:${C.void};border-radius:18px 18px 0 0;padding:18px 28px" class="px">
      <a href="https://saltydogtags.com/" style="text-decoration:none;font-family:${DISPLAY};font-size:20px;letter-spacing:1px;color:#FFF4FA">SALTY <span style="color:#FF3CAC">DOG</span> TAGS</a>
    </td></tr>
    <tr><td class="card px" style="background:${C.card};border:1px solid ${C.line};border-top:0;border-radius:0 0 18px 18px;padding:28px 28px 24px;font-family:${FONT};color:${C.ink}">
${bodyHtml}
    </td></tr>
    <tr><td class="mute px" style="padding:16px 28px;font-family:${FONT};font-size:12px;line-height:1.5;color:${C.mute};text-align:center">
      ${footNote}<br>Salty Dog Tags &middot; Lehi, Utah &middot; <a class="lnk" href="https://saltydogtags.com/" style="color:${C.magenta}">saltydogtags.com</a>
    </td></tr>
  </table>
</td></tr>
</table>
</body>
</html>`;
}

const PROMISE_LINE = 'We mis-engrave it, we remake it free. Chewed or lost, first replacement is $5.';
const PRINT_PROMISE_LINE = 'If we misprint it, we remake it free.';

// What the order is, for wording. Classic engraved-tag orders keep their original copy word for word; anything with an
// ornament or a printed full-color tag gets neutral wording (Flint CR-006: "laser" and "mis-engrave" are wrong for UV prints).
function kindOf(order, list) {
  const qty = (a) => (a || []).reduce((n, x) => n + (x.qty || 1), 0);
  const tagN = qty(list), ornN = qty(order.ornaments);
  const fc = (order.tags || []).some((t) => t.finish === 'fullcolor');
  const engraved = tagN > 0 && ornN === 0 && !fc;
  const singular = tagN > 0 && ornN === 0 ? 'tag' : tagN === 0 && ornN > 0 ? 'ornament' : 'item';
  const count = tagN + ornN;
  return { engraved, count, singular, plural: singular + 's', many: count > 1, hasImage: (order.tags || []).some((t) => t.photo) || (order.ornaments || []).some((o) => o.photo) };
}
const ornName = (o) => `Holiday pet photo ornament, ${o.tier === 'stainless' ? 'engraved stainless bone' : 'full-color printed acrylic'} (${o.name}, ${o.year})`;
const ornRowsHtml = (order) => (order.ornaments || []).map((o) => `<tr><td class="ink rule" style="padding:6px 0;border-bottom:1px solid ${C.line};font-family:${FONT};font-size:15px;color:${C.ink}"><strong>${esc(ornName(o))}</strong>${o.qty > 1 ? ' &times;' + o.qty : ''}</td></tr>`).join('');

function promiseBox(engraved = true) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:22px 0 0">
  <tr><td class="soft" style="background:${C.soft};border:1px solid ${C.line};border-radius:12px;padding:14px 16px;font-family:${FONT}">
    <p class="ink" style="margin:0 0 4px;font-family:${DISPLAY};font-size:13px;letter-spacing:1px;color:${C.ink}">THE BULLDOG PROMISE</p>
    <p class="mute" style="margin:0;font-size:14px;line-height:1.5;color:${C.mute}">${esc(engraved ? PROMISE_LINE : PRINT_PROMISE_LINE)}</p>
  </td></tr></table>`;
}

function tagRows(list) {
  return list.map((t) => {
    const front = t.photo ? 'Your dog&rsquo;s photo' : (t.saying ? '&ldquo;' + esc(t.saying) + '&rdquo;' : '(blank front)');
    return `<tr><td class="ink rule" style="padding:6px 0;border-bottom:1px solid ${C.line};font-family:${FONT};font-size:15px;line-height:1.45;color:${C.ink}">
      <strong>${front}</strong>${t.qty > 1 ? ' &times;' + t.qty : ''}${t.name ? `<br><span class="mute" style="font-size:13px;color:${C.mute}">Back: ${esc(t.name)}</span>` : ''}
    </td></tr>`;
  }).join('');
}

/* ---------- "Your tag shipped" ---------- */
// photoUrl: absolute URL to /api/tag-photo/<id>/<token>, or '' if Nick never added one.
export function shippedEmail(order, { photoUrl = '', tracking = '' } = {}) {
  const { list, dog } = tagFacts(order);
  const K = kindOf(order, list);
  const pickup = order.customer && order.customer.delivery === 'pickup';
  const many = K.many;
  const it = many ? K.plural : K.singular;
  const made = K.engraved ? 'engraved' : 'made';
  const who = dog || 'your dog';
  const smartNote = (order.tags || []).some((t) => t.smart && t.smart.id && !t.declined);   // QR tag in the order: point at the packing slip, never print the code
  const subject = pickup ? `Your ${it} ${many ? 'are' : 'is'} ready 🐾` : `Your ${it} shipped 🐾`;
  const headline = pickup ? 'Ready for pickup.' : 'It&rsquo;s in the mail.';
  const preheader = photoUrl
    ? `Here's a photo of the exact ${it}. ${dog ? dog + ' can stop pacing.' : 'No surprises.'}`
    : `${many ? 'They\'re' : 'It\'s'} on the way. ${dog ? dog + ' can stop pacing.' : ''}`;
  const lead = photoUrl
    ? `Here&rsquo;s the exact ${it} we ${made} for ${esc(who)}, photographed right before ${many ? 'they' : 'it'} went in the envelope. Like we promised: no surprises. Except maybe the look on ${esc(who)}&rsquo;s face.`
    : `We ${made} ${many ? 'them' : 'it'}, checked ${many ? 'them' : 'it'} twice, and handed ${many ? 'them' : 'it'} to USPS. ${esc(dog || 'Your dog')} is now legally famous.`;
  const pickupLead = `${K.engraved ? 'Engraved' : 'Made'}, checked twice, and waiting for you at the trailer. Bring ${esc(who)} if you want; we have treats and opinions.`;

  const photo = photoUrl ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:18px 0 6px">
  <tr><td align="center"><a href="${esc(photoUrl)}" style="text-decoration:none"><img src="${esc(photoUrl)}" width="504" alt="Photo of your ${made} ${it}${dog ? ' for ' + esc(dog) : ''}" style="display:block;width:100%;max-width:504px;height:auto;border:0;border-radius:12px;background:${C.soft}"></a></td></tr>
  <tr><td class="mute" align="center" style="padding-top:6px;font-family:${FONT};font-size:12px;color:${C.mute}">Tap the photo for full size.</td></tr></table>` : '';

  const track = !pickup && tracking ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:22px 0 4px">
  <tr><td class="btn" style="background:${C.magenta};border-radius:999px"><a class="btn-a" href="${esc(trackingUrl(tracking))}" style="display:inline-block;padding:13px 24px;font-family:${FONT};font-size:15px;font-weight:700;color:#FFFFFF;text-decoration:none">Track it with USPS</a></td></tr></table>
  <p class="mute" style="margin:6px 0 0;font-size:13px;color:${C.mute}">USPS tracking: <a class="lnk" href="${esc(trackingUrl(tracking))}" style="color:${C.magenta};font-family:'DM Mono',Menlo,Consolas,monospace">${esc(tracking)}</a></p>`
    : (!pickup ? `<p class="mute" style="margin:18px 0 0;font-size:14px;line-height:1.5;color:${C.mute}">USPS has it now. Most ${K.plural} land in 2 to 5 days.</p>` : '');

  const bodyHtml = `
      <h1 class="ink h1" style="margin:0 0 10px;font-family:${DISPLAY};font-weight:400;font-size:30px;line-height:1.1;color:${C.ink}">${headline}</h1>
      <p class="ink" style="margin:0;font-size:16px;line-height:1.55;color:${C.ink}">${pickup ? pickupLead : lead}</p>
      ${photo}
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:14px 0 0">
        <tr><td class="mute" style="padding:0 0 4px;font-family:'DM Mono',Menlo,Consolas,monospace;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:${C.mute}">${K.engraved ? 'On the ' + it : 'In the box'}</td></tr>
        ${tagRows(list)}${ornRowsHtml(order)}
      </table>
      ${track}
      ${promiseBox(K.engraved)}
      ${smartNote ? `<p class="ink" style="margin:20px 0 0;font-size:15px;line-height:1.55;color:${C.ink}"><b>Your tag has a scan-to-find QR.</b> To switch on the alerts, follow the three steps on the packing slip in the box and enter the code printed there. The code is not in this email on purpose, so a gift stays safe. Activate at <a class="lnk" href="https://saltydogtags.com/claim" style="color:${C.magenta}">saltydogtags.com/claim</a>.</p>` : ''}
      <p class="ink" style="margin:20px 0 0;font-size:15px;line-height:1.55;color:${C.ink}">Something look off? Reply to this email with a photo and we&rsquo;ll fix it.</p>
      <p class="ink" style="margin:14px 0 0;font-size:15px;line-height:1.55;color:${C.ink}">Stay salty,<br>Nick and the seven bulldogs</p>`;

  const html = layout({ title: subject, preheader, bodyHtml, footNote: `Order ${esc(order.id)}` });

  const text = [
    pickup ? 'Ready for pickup.' : "It's in the mail.",
    '',
    pickup ? `${K.engraved ? 'Engraved' : 'Made'}, checked twice, and waiting for you at the trailer. Bring ${who} if you want.`
      : photoUrl ? `Here's the exact ${it} we ${made} for ${who}, photographed right before ${many ? 'they' : 'it'} went in the envelope. No surprises.`
        : `We ${made} ${many ? 'them' : 'it'}, checked ${many ? 'them' : 'it'} twice, and handed ${many ? 'them' : 'it'} to USPS.`,
    photoUrl ? `\nPhoto of your ${it}: ${photoUrl}` : '',
    '',
    K.engraved ? `On the ${it}:` : 'In the box:',
    ...(order.ornaments || []).map((o) => `- ${ornName(o)}${o.qty > 1 ? ' x' + o.qty : ''}`),
    ...list.map((t) => `- ${t.photo ? "Your dog's photo" : (t.saying ? '"' + t.saying + '"' : '(blank front)')}${t.qty > 1 ? ' x' + t.qty : ''}${t.name ? ' (back: ' + t.name + ')' : ''}`),
    '',
    !pickup && tracking ? `USPS tracking: ${tracking}\n${trackingUrl(tracking)}` : (!pickup ? `USPS has it now. Most ${K.plural} land in 2 to 5 days.` : ''),
    '',
    'The Bulldog Promise: ' + (K.engraved ? PROMISE_LINE : PRINT_PROMISE_LINE),
    '',
    smartNote ? 'Your tag has a scan-to-find QR. Activate it with the code on your packing slip (the code is not in this email, so a gift stays safe): https://saltydogtags.com/claim\n' : '',
    "Something look off? Reply to this email with a photo and we'll fix it.",
    '',
    'Stay salty,',
    'Nick and the seven bulldogs',
    '',
    `Order ${order.id} - Salty Dog Tags, Lehi, Utah - https://saltydogtags.com/`,
  ].filter((l, i, a) => !(l === '' && a[i - 1] === '')).join('\n');

  return { subject, html, text };
}

/* ---------- "We can't print that image" (the owner's Decline action, Lady Jaye C1/B6) ---------- */
// what: short description of the declined item. paid: the order has been paid (refund wording) or not (invoice cancelled wording).
// deleted: the image was really removed (otherwise the wording says we are deleting it). remaining: { total } when other items stay on the order.
export function declineEmail(order, { what = 'your item', paid = false, deleted = true, remaining = null } = {}) {
  const subject = `About your artwork (order ${order.id})`;
  const first = String((order.customer && order.customer.name) || '').split(' ')[0] || 'there';
  const money = (n) => '$' + Number(n || 0).toFixed(2);
  const body = remaining
    ? (paid
      ? 'We refund the declined item, plus its share of shipping and tax, to your card within 3 business days. The rest of your order goes ahead as planned, or reply to cancel the whole order for a full refund.'
      : `We've taken that item off your order. The rest of your order stays, and your invoice will be for the remaining items (${money(remaining.total)} before tax). You can also send new art or pick one of our house styles: just reply to this email.`)
    : (paid
      ? 'We refund the declined item, plus its share of shipping and tax, to your card within 3 business days. Or reply to cancel the whole order for a full refund.'
      : 'Your invoice is cancelled and nothing is charged. You can send new art or pick one of our house styles: just reply to this email.');
  const para = [
    `Hi ${first}, we can't print the image on ${what}.`,
    body,
    `We never print declined art, and ${deleted ? 'we have deleted the file' : 'we are deleting the file'}. Declining isn't an accusation, and we don't have to give legal reasons. If you think we got it wrong, reply and tell us.`,
  ];
  const html = layout({ title: subject, preheader: "We can't print that image. You pay nothing for it.", footNote: `Order ${esc(order.id)}`, bodyHtml: `
      <h1 class="ink h1" style="margin:0 0 10px;font-family:${DISPLAY};font-weight:400;font-size:30px;line-height:1.1;color:${C.ink}">About your artwork.</h1>
      ${para.map((t) => `<p class="ink" style="margin:0 0 12px;font-size:16px;line-height:1.55;color:${C.ink}">${esc(t)}</p>`).join('')}
      <p class="ink" style="margin:14px 0 0;font-size:15px;line-height:1.55;color:${C.ink}">The rules are in our <a class="lnk" href="https://saltydogtags.com/policies/#artwork" style="color:${C.magenta}">artwork terms</a>.<br>Nick and the seven bulldogs</p>` });
  const text = [...para, '', 'Artwork terms: https://saltydogtags.com/policies/#artwork', '', 'Nick and the seven bulldogs'].join('\n');
  return { subject, html, text };
}

/* ---------- "Your order is in" (optional, EMAIL_ORDER_CONFIRM=true) ---------- */
export function orderConfirmEmail(order) {
  const { list, dog } = tagFacts(order);
  const K = kindOf(order, list);
  const many = K.many;
  const it = many ? K.plural : K.singular;
  const money = (n) => '$' + Number(n || 0).toFixed(2);
  const subject = `Your order is in 🐾 (${order.id})`;
  const preheader = `Order ${order.id}. We'll send a photo of the exact ${it} before it ships.`;
  const ornTxt = ornName;
  const ornaments = ornRowsHtml(order);
  const review = K.hasImage ? 'Because your order has your own image, we check it by hand before the invoice goes out. If we cannot print it, you pay nothing.' : '';
  const prints = (order.prints || []).map((p) => `<tr><td class="ink rule" style="padding:6px 0;border-bottom:1px solid ${C.line};font-family:${FONT};font-size:15px;color:${C.ink}"><strong>${esc(p.item)}</strong>${p.qty > 1 ? ' &times;' + p.qty : ''}</td></tr>`).join('');
  const bodyHtml = `
      <h1 class="ink h1" style="margin:0 0 10px;font-family:${DISPLAY};font-weight:400;font-size:30px;line-height:1.1;color:${C.ink}">Your order is in.</h1>
      <p class="ink" style="margin:0;font-size:16px;line-height:1.55;color:${C.ink}">Order <strong>${esc(order.id)}</strong>. ${K.engraved ? 'The laser is warming up' : 'We have it'}${dog ? ' and ' + esc(dog) + ' has been informed' : ''}. Before your ${it} ship${many ? '' : 's'}, we&rsquo;ll email you a photo of the exact ${it}. No surprises.</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:16px 0 0">
        <tr><td class="mute" style="padding:0 0 4px;font-family:'DM Mono',Menlo,Consolas,monospace;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:${C.mute}">What you ordered</td></tr>
        ${tagRows(list)}${ornaments}${prints}
        <tr><td class="ink" style="padding:8px 0 0;font-family:${FONT};font-size:15px;color:${C.ink}">Total <strong>${money(order.totals && order.totals.total)}</strong> plus any tax</td></tr>
      </table>
      ${promiseBox(K.engraved)}
      ${review ? `<p class="ink" style="margin:20px 0 0;font-size:15px;line-height:1.55;color:${C.ink}">${esc(review)}</p>` : ''}
      <p class="ink" style="margin:20px 0 0;font-size:15px;line-height:1.55;color:${C.ink}">${K.engraved ? 'Typo on the tag? Reply now, before the laser gets to it.' : 'Typo in the name, year or text? Reply now, before we make it.'}</p>
      <p class="ink" style="margin:14px 0 0;font-size:15px;line-height:1.55;color:${C.ink}">Stay salty,<br>Nick and the seven bulldogs</p>`;
  const html = layout({ title: subject, preheader, bodyHtml, footNote: `Order ${esc(order.id)}` });
  const text = [
    'Your order is in.',
    '',
    `Order ${order.id}. Before your ${it} ship${many ? '' : 's'}, we'll email you a photo of the exact ${it}.`,
    '',
    'What you ordered:',
    ...list.map((t) => `- ${t.photo ? "Your dog's photo" : (t.saying ? '"' + t.saying + '"' : '(blank front)')}${t.qty > 1 ? ' x' + t.qty : ''}${t.name ? ' (back: ' + t.name + ')' : ''}`),
    ...(order.ornaments || []).map((o) => `- ${ornTxt(o)}${o.qty > 1 ? ' x' + o.qty : ''}`),
    ...(order.prints || []).map((p) => `- ${p.item}${p.qty > 1 ? ' x' + p.qty : ''}`),
    `Total ${money(order.totals && order.totals.total)} plus any tax`,
    '',
    'The Bulldog Promise: ' + (K.engraved ? PROMISE_LINE : PRINT_PROMISE_LINE),
    '',
    ...(review ? [review, ''] : []),
    K.engraved ? 'Typo on the tag? Reply now, before the laser gets to it.' : 'Typo in the name, year or text? Reply now, before we make it.',
    '',
    'Stay salty,',
    'Nick and the seven bulldogs',
  ].join('\n');
  return { subject, html, text };
}

// Called from notifyOrder on 'new'. Off unless EMAIL_ORDER_CONFIRM=true. Per-address cap so the order
// form can't be used to spam someone. Result is only logged (writing it back to the order here would
// race the Clover webhook's update of the same KV key).
export async function maybeSendOrderConfirm(env, order) {
  if (!orderConfirmEnabled(env)) return { ok: false, error: 'off' };
  const to = order && order.customer && order.customer.email;
  if (!to || !order.id) return { ok: false, error: 'no email' };
  if (!(await bump(env, 'email:to:' + (await sha(String(to).toLowerCase())) + ':' + today(), CONFIRM_PER_ADDRESS_PER_DAY, 60 * 60 * 26))) {
    return { ok: false, error: 'per-address cap' };
  }
  const m = orderConfirmEmail(order);
  const res = await sendEmail(env, { to, ...m, idempotencyKey: 'sdt-confirm-' + order.id, tags: [{ name: 'kind', value: 'order_confirm' }] });
  if (!res.ok) console.warn('order confirm email failed', order.id, res.error);
  return res;
}
