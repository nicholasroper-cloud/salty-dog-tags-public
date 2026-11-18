// Smart QR tag alert engine (ADR section 4). One entry point per event, burst dedupe, caps, text cleaning, Resend email,
// Twilio SMS through the owner-alert Messaging Service (TAG_TWILIO_MSID, NOT the Thirsty Beaches marketing number).
//
// Rules this file enforces:
//  - A scan alerts once per 10 minute burst; a location alerts once per burst, then only if the finder moved > 250 m (max 3);
//    messages alert each (5 per tag per hour, then they queue for the digest).
//  - SMS: 12 per tag per day then email only plus one "alerts capped" notice; 500 SMS and 2,000 emails a day for the whole site.
//  - FAIL SOFT: a Twilio carrier or registration error is logged (a short code, never a number), the alert's sms row is marked
//    failed, and the email still goes out. Nothing here throws to its caller; a failed alert never fails a finder's request.
//  - Logs hold counts and short codes only. Never a phone number, email, coordinate, or message.
import { hit, peek } from './_ratelimit.js';
import { LIMITS, ALERT_FROM, smsReady, planAllows, smsFlag } from './_tagsettings.js';
import { rowId } from './_tagid.js';

export const RESEND_URL = 'https://api.resend.com/emails';
export const NEVER_MONEY = 'Never send money or read a code to a finder.';
export const SMS_STOP = 'Reply STOP to end alerts.';

/* ---------- text cleaning ---------- */
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// Control characters (C0, DEL, bidi overrides, zero width) out; whitespace collapsed.
export const stripControl = (s) => String(s == null ? '' : s).replace(/[\u0000-\u0008\u000b-\u001f\u007f​-‏‪-‮⁦-⁩﻿]/g, '').replace(/\s+/g, ' ').trim();
// Links removed from anything a stranger types or an owner writes: URLs, www., and bare domains with a common TLD.
const LINK_RE = /\b(?:https?:\/\/|ftp:\/\/|www\.)\S+|\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|net|org|io|co|us|me|ly|app|xyz|info|biz|gov|edu|ru|cn|tk|top|site|online|link|click|page|shop|store)(?:\/\S*)?\b/gi;
export const stripLinks = (s) => stripControl(s).replace(LINK_RE, '').replace(/\s+/g, ' ').trim();
export const cleanText = (s, max) => stripLinks(s).slice(0, max);
// Scam keywords (gift card, Zelle, Venmo, Cash App, code, wire, reward, shipping): the alert gains a warning line.
const SCAM_RE = /\b(gift\s*cards?|zelle|venmo|cash\s*app|paypal|bitcoin|crypto|wire|western\s*union|money\s*order|codes?|verification|reward|shipping|ship\s+it|send\s+money|fee|deposit)\b/i;
export const scamFlag = (s) => SCAM_RE.test(String(s || ''));
// SMS-safe: plain ASCII-ish text, links gone, cut to n characters (never mid-surrogate).
export const smsClean = (s, n = LIMITS.smsBodyMsgMax) => { const t = stripLinks(s); return t.length > n ? Array.from(t).slice(0, n - 1).join('') + '…' : t; };

export const fmtWhen = (at, tz) => {
  try { return new Intl.DateTimeFormat('en-US', { timeZone: tz || 'America/Denver', weekday: 'short', hour: 'numeric', minute: '2-digit', month: 'short', day: 'numeric', timeZoneName: 'short' }).format(new Date(at)); }
  catch { return new Date(at).toISOString(); }
};
export const mapLinks = (lat, lng, name) => ({
  apple: `https://maps.apple.com/?ll=${lat.toFixed(5)},${lng.toFixed(5)}&q=${encodeURIComponent(String(name || 'Found dog').slice(0, 30))}`,
  google: `https://www.google.com/maps/search/?api=1&query=${lat.toFixed(5)},${lng.toFixed(5)}`
});
export function distanceM(a, b) {   // haversine
  const R = 6371000, r = (d) => d * Math.PI / 180, dLat = r(b.lat - a.lat), dLng = r(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/* ---------- message builder ---------- */
// ctx: { kind: scan|location|message|test|capped|digest|unclaimed, dog, at, tz, count, lat, lng, accuracy, place, message, reply, siteUrl, items }
export function buildAlert(ctx) {
  const dog = stripControl(ctx.dog || 'Your dog').slice(0, 40) || 'Your dog';
  const when = fmtWhen(ctx.at || Date.now(), ctx.tz);
  const site = String(ctx.siteUrl || 'https://saltydogtags.com').replace(/\/+$/, '');
  const link = `${site}/my`;
  const scam = scamFlag(ctx.message) || scamFlag(ctx.reply) || scamFlag(ctx.place);
  const hasLoc = Number.isFinite(ctx.lat) && Number.isFinite(ctx.lng);
  const maps = hasLoc ? mapLinks(ctx.lat, ctx.lng, dog) : null;
  const within = hasLoc && Number.isFinite(ctx.accuracy) ? ` (within ${Math.max(5, Math.round(ctx.accuracy))} m)` : '';
  let subject, lines = [], sms;
  if (ctx.kind === 'scan') {
    subject = `${dog}'s tag was scanned`;
    lines.push(`${dog}'s tag was scanned ${when}.`);
    if (ctx.count > 1) lines.push(`${ctx.count} scans so far.`);
    lines.push('Someone is looking at the page right now. If they share a location or send a message, you will get another alert.');
    sms = `${dog}'s tag was scanned ${when}.`;
  } else if (ctx.kind === 'location') {
    subject = `Location shared for ${dog}`;
    if (hasLoc) lines.push(`Someone shared a location for ${dog} ${when}${within}.`, `Apple Maps: ${maps.apple}`, `Google Maps: ${maps.google}`);
    if (ctx.place) lines.push(`They typed: "${cleanText(ctx.place, LIMITS.placeMax)}"`);
    sms = hasLoc ? `${dog} was found. Location${within}: ${maps.apple}` : `${dog} was found. They typed: "${smsClean(ctx.place, 80)}"`;
  } else if (ctx.kind === 'message') {
    subject = `Message about ${dog}`;
    lines.push(`A finder sent you a message about ${dog} ${when}:`, `"${cleanText(ctx.message, LIMITS.messageMax)}"`);
    if (ctx.reply) lines.push(`How to reach them: "${cleanText(ctx.reply, LIMITS.replyMax)}"`);
    sms = `Message about ${dog}: "${smsClean(ctx.message)}"${ctx.reply ? ` Reach them: "${smsClean(ctx.reply, 40)}"` : ''}`;
  } else if (ctx.kind === 'digest') {
    subject = `${ctx.items.length} more messages about ${dog}`;
    lines.push(`${ctx.items.length} more finder messages came in for ${dog} (we cap alerts at ${LIMITS.msgPerTagHour} an hour):`);
    for (const it of ctx.items) lines.push(`- ${fmtWhen(it.at, ctx.tz)}: "${cleanText(it.message, LIMITS.messageMax)}"${it.reply ? ` (reach them: "${cleanText(it.reply, LIMITS.replyMax)}")` : ''}`);
    sms = null;
  } else if (ctx.kind === 'capped') {
    subject = `Text alerts paused for ${dog} today`;
    lines.push(`${dog}'s tag hit today's limit of ${LIMITS.smsPerTagDay} text alerts. Alerts keep coming by email, and you can see everything at ${link}.`);
    sms = null;
  } else if (ctx.kind === 'test') {
    subject = `Test alert for ${dog}`;
    lines.push(`This is a test alert for ${dog}'s tag. If you got this, alerts work.`);
    sms = `Test alert for ${dog}'s tag. Alerts work.`;
  } else if (ctx.kind === 'unclaimed') {
    subject = `Someone looked at the tag for ${dog}, which is not set up yet`;
    lines.push(`A finder opened the page for a Salty Dog Tags tag that has not been activated yet and left this message:`, `"${cleanText(ctx.message, LIMITS.messageMax)}"`);
    if (ctx.reply) lines.push(`How to reach them: "${cleanText(ctx.reply, LIMITS.replyMax)}"`);
    lines.push(`Activate the tag with the code on your packing slip at ${site}/claim so alerts reach your phone.`);
    sms = null;
  } else { subject = `Salty Dog Tags: ${dog}`; lines.push(`Update for ${dog}.`); sms = null; }
  if (scam) lines.push('Careful: this message mentions money, codes, or shipping, which is how scams start. Do not pay anyone or read out a code.');
  const foot = NEVER_MONEY;
  const text = [...lines, '', `Everything about this tag: ${link}`, foot].join('\n');
  const html = `<div style="font:16px/1.5 system-ui,sans-serif;color:#111;max-width:34rem">${lines.map((l) => `<p style="margin:0 0 .7em">${esc(l).replace(/(https:\/\/[^\s<]+)/g, '<a href="$1">$1</a>')}</p>`).join('')}<p style="margin:1em 0 .4em"><a href="${esc(link)}">Open your dashboard</a></p><p style="color:#555;font-size:14px;margin:.4em 0">${esc(foot)}</p></div>`;
  const smsBody = sms ? [sms, scam ? 'Warning: mentions money or codes. Do not pay.' : '', NEVER_MONEY, SMS_STOP].filter(Boolean).join(' ') : null;
  return { subject, text, html, sms: smsBody };
}

/* ---------- transports (fail soft: always return, never throw) ---------- */
const SEND_TIMEOUT_MS = 8000;
export async function sendAlertEmail(env, { to, subject, html, text, idempotencyKey }) {
  if (!(typeof env.RESEND_API_KEY === 'string' && env.RESEND_API_KEY.trim())) return { ok: false, code: 'email-not-configured' };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(to || ''))) return { ok: false, code: 'email-bad-address' };
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), SEND_TIMEOUT_MS);
  try {
    const body = { from: ALERT_FROM, to: [String(to).toLowerCase()], subject: String(subject).slice(0, 150), html, text, tags: [{ name: 'kind', value: 'tag_alert' }] };
    const rt = String(env.EMAIL_REPLY_TO || '').trim();
    if (rt) body.reply_to = rt;   // hello@ only once Email Routing exists; unset means no reply-to
    const headers = { authorization: 'Bearer ' + env.RESEND_API_KEY.trim(), 'content-type': 'application/json' };
    if (idempotencyKey) headers['Idempotency-Key'] = String(idempotencyKey).slice(0, 256);
    const r = await fetch(RESEND_URL, { method: 'POST', signal: ctl.signal, headers, body: JSON.stringify(body) });
    const txt = await r.text(); let d = null; try { d = JSON.parse(txt); } catch { /* not json */ }
    if (!r.ok) return { ok: false, code: 'resend-' + r.status };
    return { ok: true, id: (d && d.id) || '' };
  } catch (e) { return { ok: false, code: e && e.name === 'AbortError' ? 'resend-timeout' : 'resend-network' }; }
  finally { clearTimeout(timer); }
}

// Twilio Messaging Service send. Errors come back as a short code: 'twilio-<http>-<twilio error code>', for example
// twilio-400-30034 (unregistered 10DLC) or twilio-400-21610 (recipient replied STOP). Never the body, never the number.
export async function sendAlertSms(env, { to, body }) {
  if (!smsReady(env)) return { ok: false, code: 'sms-not-ready' };
  if (!/^\+[1-9]\d{7,14}$/.test(String(to || ''))) return { ok: false, code: 'sms-bad-number' };
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), SEND_TIMEOUT_MS);
  try {
    const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_SID}/Messages.json`, {
      method: 'POST', signal: ctl.signal,
      headers: { Authorization: 'Basic ' + btoa(env.TWILIO_SID + ':' + env.TWILIO_TOKEN) },
      body: new URLSearchParams({ To: to, MessagingServiceSid: env.TAG_TWILIO_MSID, Body: body })
    });
    const txt = await r.text(); let d = null; try { d = JSON.parse(txt); } catch { /* not json */ }
    if (!r.ok) return { ok: false, code: `twilio-${r.status}${d && d.code ? '-' + d.code : ''}` };
    return { ok: true, id: (d && d.sid) || '' };
  } catch (e) { return { ok: false, code: e && e.name === 'AbortError' ? 'twilio-timeout' : 'twilio-network' }; }
  finally { clearTimeout(timer); }
}

/* ---------- caps ---------- */
const day = (now) => new Date(now).toISOString().slice(0, 10);
// Reserve one send against a daily counter. Fails closed (false) when D1 cannot count.
async function reserve(env, key, limit, now) { const r = await hit(env, key, limit, 26 * 3600, now); return Boolean(r.ok); }

/* ---------- the dispatcher ---------- */
async function contactsFor(env, tag) {
  const r = await env.TAGDB.prepare('SELECT * FROM contacts WHERE tag_id = ?1 ORDER BY slot').bind(tag.id).all();
  return r.results;
}
async function ownerOf(env, tag) { return tag.owner_id ? env.TAGDB.prepare('SELECT * FROM owners WHERE id = ?1').bind(tag.owner_id).first() : null; }

async function record(env, a, now) {
  await env.TAGDB.prepare('INSERT INTO alerts(id, scan_id, tag_id, contact_id, channel, kind, status, tries, at, last_try_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)')
    .bind(a.id, a.scan_id || null, a.tag_id, a.contact_id || null, a.channel, a.kind, a.status, a.tries || 0, now, a.tries ? now : null).run();
}
async function settle(env, id, r, now) {
  await env.TAGDB.prepare('UPDATE alerts SET status = ?2, provider_id = ?3, error_code = ?4, tries = tries + 1, last_try_at = ?5 WHERE id = ?1')
    .bind(id, r.ok ? 'sent' : 'failed', r.id || null, r.ok ? null : r.code, now).run();
}

// Sends one alert event (already decided: the caller did the burst/message limiting) to every eligible contact of a claimed tag.
// Returns { sent:{email,sms}, failed:{email,sms}, capped:{...} }. Never throws.
export async function dispatch(env, tag, { kind, scanId = null, scan = null, count = 1, forceSms = true, skipCaps = false }, now = Date.now()) {
  const out = { sent: { email: 0, sms: 0 }, failed: { email: 0, sms: 0 }, capped: { email: 0, sms: 0 } };
  try {
    if (!tag.owner_id) return out;
    const owner = await ownerOf(env, tag);
    if (!owner) return out;
    const contacts = await contactsFor(env, tag);
    const ctx = { kind, dog: tag.dog_name, at: scan ? scan.at : now, tz: owner.tz, count, siteUrl: env.SITE_URL,
      lat: scan && scan.lat != null ? scan.lat : NaN, lng: scan && scan.lng != null ? scan.lng : NaN, accuracy: scan ? scan.accuracy_m : NaN,
      place: scan && scan.place_text, message: scan && scan.message, reply: scan && scan.finder_reply };
    const msg = buildAlert(ctx);
    let cappedNoticeSent = false;
    for (const c of contacts) {
      if (c.slot === 2 && !planAllows(tag, 'contact2', env, now)) continue;
      // ---- email (independent of SMS: an SMS failure never blocks it) ----
      if (c.email_on && c.email) {
        const aid = rowId();
        if (!skipCaps && !(await reserve(env, `cap:email:${day(now)}`, LIMITS.emailGlobalDay, now))) { await record(env, { id: aid, scan_id: scanId, tag_id: tag.id, contact_id: c.id, channel: 'email', kind, status: 'capped' }, now); out.capped.email++; }
        else {
          await record(env, { id: aid, scan_id: scanId, tag_id: tag.id, contact_id: c.id, channel: 'email', kind, status: 'queued' }, now);
          const r = await sendAlertEmail(env, { to: c.email, subject: msg.subject, html: msg.html, text: msg.text, idempotencyKey: aid });
          await settle(env, aid, r, now); r.ok ? out.sent.email++ : out.failed.email++;
          if (!r.ok) console.warn('alert email failed', r.code);
        }
      }
      // ---- sms ----
      const smsOk = msg.sms && smsFlag(env) && c.sms_on && c.phone_e164 && c.sms_verified_at && !c.sms_stopped_at && planAllows(tag, 'sms', env, now);
      if (smsOk) {
        const aid = rowId();
        const tagOk = skipCaps || await reserve(env, `cap:sms:tag:${tag.id}:${day(now)}`, LIMITS.smsPerTagDay, now);
        const globalOk = tagOk && (skipCaps || await reserve(env, `cap:sms:${day(now)}`, LIMITS.smsGlobalDay, now));
        if (!tagOk || !globalOk) {
          await record(env, { id: aid, scan_id: scanId, tag_id: tag.id, contact_id: c.id, channel: 'sms', kind, status: 'capped' }, now); out.capped.sms++;
          // per-tag cap: ONE notice by email (not per scan), so the owner knows texts stopped for the day
          if (!tagOk && !cappedNoticeSent && c.email_on && c.email && await reserve(env, `cap:notice:${tag.id}:${day(now)}`, 1, now)) {
            cappedNoticeSent = true;
            const n = buildAlert({ ...ctx, kind: 'capped' });
            const nid = rowId();
            await record(env, { id: nid, scan_id: scanId, tag_id: tag.id, contact_id: c.id, channel: 'email', kind: 'capped', status: 'queued' }, now);
            await settle(env, nid, await sendAlertEmail(env, { to: c.email, subject: n.subject, html: n.html, text: n.text, idempotencyKey: nid }), now);
          }
        } else {
          await record(env, { id: aid, scan_id: scanId, tag_id: tag.id, contact_id: c.id, channel: 'sms', kind, status: 'queued' }, now);
          const r = await sendAlertSms(env, { to: c.phone_e164, body: msg.sms });
          await settle(env, aid, r, now); r.ok ? out.sent.sms++ : out.failed.sms++;
          if (!r.ok) console.warn('alert sms failed', r.code);   // carrier or registration error: logged as a code, email already went out above
        }
      }
    }
  } catch (e) { console.warn('dispatch error', String((e && e.message) || e).slice(0, 80)); }
  return out;
}

/* ---------- events (called by the finder routes) ---------- */
const paused = (tag, now) => tag.alerts_paused_until && tag.alerts_paused_until > now;

// A counted scan (the page's own beacon). Opens or extends the burst; only the first scan of a burst alerts.
export async function onScan(env, tag, { ipHash = null, byOwner = false }, now = Date.now()) {
  const scanId = rowId();
  // Bursts belong to claimed tags only: scans of an unclaimed tag (QC, the customer poking at it) must not leave a burst open that
  // swallows the owner's first real alert after activation.
  const claimed = tag.status === 'claimed';
  let newBurst = false, burstId = claimed ? tag.burst_id : null;
  if (claimed && (!tag.burst_id || !tag.burst_at || now - tag.burst_at >= LIMITS.burstMs)) { newBurst = true; burstId = rowId(); }
  await env.TAGDB.prepare('INSERT INTO scans(id, tag_id, at, burst_id, kind, by_owner, ip_hash) VALUES(?1,?2,?3,?4,?5,?6,?7)').bind(scanId, tag.id, now, burstId, 'scan', byOwner ? 1 : 0, ipHash).run();
  if (byOwner) return { scanId, alerted: false, reason: 'owner' };
  if (newBurst) await env.TAGDB.prepare('UPDATE tags SET burst_id = ?2, burst_at = ?3, burst_loc_alerts = 0, burst_lat = NULL, burst_lng = NULL WHERE id = ?1').bind(tag.id, burstId, now).run();
  if (tag.status !== 'claimed' || paused(tag, now)) return { scanId, alerted: false, reason: tag.status !== 'claimed' ? 'unclaimed' : 'paused' };
  if (!newBurst) return { scanId, alerted: false, reason: 'burst' };
  const n = await env.TAGDB.prepare("SELECT COUNT(*) AS n FROM scans WHERE tag_id = ?1 AND kind = 'scan' AND by_owner = 0").bind(tag.id).first('n');
  const scan = { at: now };
  const r = await dispatch(env, tag, { kind: 'scan', scanId, scan, count: n }, now);
  return { scanId, alerted: true, ...r };
}

// A shared location (or a typed place). First location in a burst alerts; later ones only when the finder moved > 250 m, max 3.
export async function onLocation(env, tag, { lat, lng, accuracy, place, consentVer, ipHash = null }, now = Date.now()) {
  const scanId = rowId();
  const burstId = tag.burst_id && tag.burst_at && now - tag.burst_at < LIMITS.burstMs ? tag.burst_id : rowId();
  const hasLoc = Number.isFinite(lat) && Number.isFinite(lng);
  await env.TAGDB.prepare('INSERT INTO scans(id, tag_id, at, burst_id, kind, lat, lng, accuracy_m, place_text, loc_consent_ver, ip_hash) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)')
    .bind(scanId, tag.id, now, burstId, 'location', hasLoc ? lat : null, hasLoc ? lng : null, Number.isFinite(accuracy) ? accuracy : null, place || null, consentVer || null, ipHash).run();
  if (tag.status !== 'claimed' || paused(tag, now)) return { scanId, alerted: false };
  let alert = false;
  const inBurst = burstId === tag.burst_id;
  const count = inBurst ? tag.burst_loc_alerts : 0;
  if (count === 0) alert = true;
  else if (count < LIMITS.locPerBurst && hasLoc && tag.burst_lat != null && distanceM({ lat: tag.burst_lat, lng: tag.burst_lng }, { lat, lng }) > LIMITS.locMoveM) alert = true;
  if (!alert) return { scanId, alerted: false, reason: 'dedupe' };
  await env.TAGDB.prepare('UPDATE tags SET burst_id = ?2, burst_at = COALESCE(burst_at, ?3), burst_loc_alerts = ?4, burst_lat = ?5, burst_lng = ?6 WHERE id = ?1').bind(tag.id, burstId, now, count + 1, hasLoc ? lat : tag.burst_lat, hasLoc ? lng : tag.burst_lng).run();
  const r = await dispatch(env, tag, { kind: 'location', scanId, scan: { at: now, lat: hasLoc ? lat : null, lng: hasLoc ? lng : null, accuracy_m: accuracy, place_text: place } }, now);
  return { scanId, alerted: true, ...r };
}

// A finder message. Each alerts, up to 5 per tag per hour; the rest queue for the email digest.
export async function onMessage(env, tag, { message, reply, ipHash = null }, now = Date.now()) {
  const scanId = rowId();
  const clean = cleanText(message, LIMITS.messageMax), cleanReply = cleanText(reply, LIMITS.replyMax);
  await env.TAGDB.prepare('INSERT INTO scans(id, tag_id, at, burst_id, kind, message, finder_reply, ip_hash) VALUES(?1,?2,?3,?4,?5,?6,?7,?8)').bind(scanId, tag.id, now, tag.burst_id || null, 'message', clean, cleanReply || null, ipHash).run();
  if (tag.status !== 'claimed' || paused(tag, now)) return { scanId, alerted: false };
  const within = await reserve(env, `cap:msg:${tag.id}:${Math.floor(now / 3600000)}`, LIMITS.msgPerTagHour, now);
  const scan = { at: now, message: clean, finder_reply: cleanReply };
  if (!within) {
    const contacts = (await contactsFor(env, tag)).filter((c) => c.email_on && c.email);
    for (const c of contacts) await record(env, { id: rowId(), scan_id: scanId, tag_id: tag.id, contact_id: c.id, channel: 'email', kind: 'digest', status: 'queued' }, now);
    return { scanId, alerted: false, reason: 'digest' };
  }
  const r = await dispatch(env, tag, { kind: 'message', scanId, scan }, now);
  return { scanId, alerted: true, ...r };
}

// Unclaimed tag: forward the finder's message to the buyer's order email, at most one per tag per 24 hours, with an activation nudge.
export async function onUnclaimedMessage(env, tag, { message, reply, ipHash = null }, now = Date.now()) {
  const scanId = rowId();
  const clean = cleanText(message, LIMITS.messageMax), cleanReply = cleanText(reply, LIMITS.replyMax);
  await env.TAGDB.prepare('INSERT INTO scans(id, tag_id, at, kind, message, finder_reply, ip_hash) VALUES(?1,?2,?3,?4,?5,?6,?7)').bind(scanId, tag.id, now, 'message', clean, cleanReply || null, ipHash).run();
  if (!tag.buyer_email) return { scanId, forwarded: false, reason: 'no-email' };
  if (tag.unclaimed_notified_at && now - tag.unclaimed_notified_at < LIMITS.unclaimedForwardMs) return { scanId, forwarded: false, reason: 'rate' };
  if (!(await reserve(env, `cap:email:${day(now)}`, LIMITS.emailGlobalDay, now))) return { scanId, forwarded: false, reason: 'cap' };
  await env.TAGDB.prepare('UPDATE tags SET unclaimed_notified_at = ?2 WHERE id = ?1').bind(tag.id, now).run();
  const m = buildAlert({ kind: 'unclaimed', dog: 'a dog', at: now, message: clean, reply: cleanReply, siteUrl: env.SITE_URL });
  const aid = rowId();
  await record(env, { id: aid, scan_id: scanId, tag_id: tag.id, channel: 'email', kind: 'unclaimed', status: 'queued' }, now);
  const r = await sendAlertEmail(env, { to: tag.buyer_email, subject: m.subject, html: m.html, text: m.text, idempotencyKey: aid });
  await settle(env, aid, r, now);
  return { scanId, forwarded: r.ok };
}

// "Send a test alert" from the dashboard: to the owner's own contacts, 3 per tag per hour, not counted against the SMS day cap.
export async function sendTestAlert(env, tag, now = Date.now()) {
  const ok = await hit(env, `test:${tag.id}`, LIMITS.testAlertsPerTagHour, 3600, now);
  if (!ok.ok) return { ok: false, error: ok.error ? 'busy' : 'rate' };
  const r = await dispatch(env, tag, { kind: 'test', scan: { at: now }, skipCaps: false }, now);
  return { ok: true, ...r };
}

/* ---------- cron: retry and digest ---------- */
// Re-sends failed alerts from the last 2 hours (3 tries total). The message is rebuilt from the scan row, never stored in the alert.
export async function retryFailed(env, now = Date.now()) {
  const out = { retried: 0, sent: 0, failed: 0 };
  const rows = (await env.TAGDB.prepare("SELECT * FROM alerts WHERE status = 'failed' AND at > ?1 AND kind != 'digest' AND tries < ?2 AND (last_try_at IS NULL OR last_try_at < ?3) LIMIT 100")
    .bind(now - LIMITS.retryWindowMs, LIMITS.retryMaxTries, now - 5 * 60 * 1000).all()).results;
  for (const a of rows) {
    try {
      const tag = await env.TAGDB.prepare('SELECT * FROM tags WHERE id = ?1').bind(a.tag_id).first();
      const c = a.contact_id ? await env.TAGDB.prepare('SELECT * FROM contacts WHERE id = ?1').bind(a.contact_id).first() : null;
      const owner = tag && tag.owner_id ? await ownerOf(env, tag) : null;
      const scan = a.scan_id ? await env.TAGDB.prepare('SELECT * FROM scans WHERE id = ?1').bind(a.scan_id).first() : null;
      if (!tag || !c || (a.channel === 'sms' && (c.sms_stopped_at || !c.sms_verified_at))) { await env.TAGDB.prepare("UPDATE alerts SET tries = 99 WHERE id = ?1").bind(a.id).run(); continue; }
      const m = buildAlert({ kind: a.kind, dog: tag.dog_name, at: scan ? scan.at : a.at, tz: owner && owner.tz, count: 1, siteUrl: env.SITE_URL,
        lat: scan && scan.lat != null ? scan.lat : NaN, lng: scan && scan.lng != null ? scan.lng : NaN, accuracy: scan ? scan.accuracy_m : NaN, place: scan && scan.place_text, message: scan && scan.message, reply: scan && scan.finder_reply });
      out.retried++;
      const r = a.channel === 'sms' ? await sendAlertSms(env, { to: c.phone_e164, body: m.sms || '' }) : await sendAlertEmail(env, { to: c.email, subject: m.subject, html: m.html, text: m.text, idempotencyKey: a.id });
      await settle(env, a.id, r, now); r.ok ? out.sent++ : out.failed++;
    } catch { out.failed++; }
  }
  return out;
}

// One email per tag and contact for messages that were over the hourly cap.
export async function sendDigests(env, now = Date.now()) {
  const out = { digests: 0 };
  const rows = (await env.TAGDB.prepare("SELECT * FROM alerts WHERE kind = 'digest' AND status = 'queued' AND channel = 'email' LIMIT 200").all()).results;
  const groups = new Map();
  for (const a of rows) { const k = a.tag_id + '|' + a.contact_id; (groups.get(k) || groups.set(k, []).get(k)).push(a); }
  for (const list of groups.values()) {
    const first = list[0];
    try {
      const tag = await env.TAGDB.prepare('SELECT * FROM tags WHERE id = ?1').bind(first.tag_id).first();
      const c = await env.TAGDB.prepare('SELECT * FROM contacts WHERE id = ?1').bind(first.contact_id).first();
      const owner = tag && tag.owner_id ? await ownerOf(env, tag) : null;
      if (!tag || !c || !c.email) { for (const a of list) await env.TAGDB.prepare("UPDATE alerts SET status = 'failed', tries = 99, error_code = 'digest-no-target' WHERE id = ?1").bind(a.id).run(); continue; }
      const items = [];
      for (const a of list) { const s = await env.TAGDB.prepare('SELECT at, message, finder_reply FROM scans WHERE id = ?1').bind(a.scan_id).first(); if (s) items.push({ at: s.at, message: s.message, reply: s.finder_reply }); }
      const m = buildAlert({ kind: 'digest', dog: tag.dog_name, tz: owner && owner.tz, items, siteUrl: env.SITE_URL });
      const r = await sendAlertEmail(env, { to: c.email, subject: m.subject, html: m.html, text: m.text, idempotencyKey: 'digest-' + first.id });
      for (const a of list) await env.TAGDB.prepare("UPDATE alerts SET status = ?2, error_code = ?3, tries = tries + 1, last_try_at = ?4 WHERE id = ?1").bind(a.id, r.ok ? 'sent' : 'failed', r.ok ? null : r.code, now).run();
      if (r.ok) out.digests++;
    } catch { /* leave queued, the next run tries again */ }
  }
  return out;
}

export { peek };
