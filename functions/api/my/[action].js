// The owner dashboard API (/api/my/<action>). Cookie session required; every POST passes the Origin check.
//   GET  me                         the owner, their tags, contacts, recent activity
//   POST tag      {id, dog_name, message, show_phone, pause}
//   POST contact  {tag_id, slot, label, phone, email, sms_on, email_on, consent:{ver, checked}}
//   POST sms-send {contact_id}      slot 1: a 6 digit code to type here. slot 2: a "Reply YES" text that the person answers themselves.
//   POST sms-verify {contact_id, code}
//   POST test     {tag_id}          send a test alert to the owner's own contacts
//   POST pin      {scan_id, keep}   keep a scan past 30 days (max 20 per tag)
//   POST release  {tag_id}          give the tag back: unclaimed again, claim code retired (claim_ver + 1)
//   POST delete-account             hard delete now; tags go back to unclaimed
//   POST settings {tz, marketing_optin}   ;   POST signout
import { json, str } from '../_lib.js';
import { readObject } from '../_security.js';
import { hasDb, LIMITS, smsFlag, smsReady, planAllows, SMS_CONSENT_TEXT, SMS_CONSENT_VERSION, consentHash } from '../_tagsettings.js';
import { originOk, getSession, endSession, clearCookie } from '../_session.js';
import { hit, ipHashOf } from '../_ratelimit.js';
import { cleanText, sendAlertSms, sendTestAlert, stripControl } from '../_tagnotify.js';
import { rowId, randomToken, sha256Hex } from '../_tagid.js';

export const MARKETING_TEXT = 'Send me occasional Salty Dog Tags news and offers by email. I can unsubscribe any time. (Wording pending Lady Jaye review.)';
const FOREVER = 4102444800000;   // alerts "off": 2100-01-01

// US numbers: 10 digits (or 11 starting with 1) become +1..., anything else must already be +E.164. Returns '' when invalid.
export function toE164(raw) {
  const s = String(raw || '').trim();
  if (/^\+[1-9]\d{7,14}$/.test(s.replace(/[\s().-]/g, ''))) return s.replace(/[\s().-]/g, '');
  const d = s.replace(/\D/g, '');
  if (d.length === 10 && !/^[01]/.test(d)) return '+1' + d;
  if (d.length === 11 && d[0] === '1' && !/^[01]/.test(d.slice(1))) return '+' + d;
  return '';
}
const isTz = (tz) => { try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; } };
const clean = (s, n) => stripControl(s).slice(0, n);

async function ownedTag(env, ownerId, id) {
  const t = await env.TAGDB.prepare('SELECT * FROM tags WHERE id = ?1 AND owner_id = ?2').bind(String(id || ''), ownerId).first();
  return t || null;
}
async function ownedContact(env, ownerId, id) {
  return env.TAGDB.prepare('SELECT * FROM contacts WHERE id = ?1 AND owner_id = ?2').bind(String(id || ''), ownerId).first();
}
async function releaseTag(env, tagId) {
  await env.TAGDB.batch([
    env.TAGDB.prepare('DELETE FROM contacts WHERE tag_id = ?1').bind(tagId),
    env.TAGDB.prepare('DELETE FROM scans WHERE tag_id = ?1').bind(tagId),
    env.TAGDB.prepare("UPDATE tags SET owner_id = NULL, status = 'shipped', claim_ver = claim_ver + 1, dog_name = NULL, message = NULL, show_phone = 0, alerts_paused_until = NULL, claimed_at = NULL, burst_id = NULL, burst_at = NULL, burst_loc_alerts = 0, burst_lat = NULL, burst_lng = NULL WHERE id = ?1").bind(tagId)
  ]);
}

export async function onRequest({ request, env, params }) {
  if (!hasDb(env)) return json({ error: 'unavailable' }, 503);
  const action = Array.isArray(params.action) ? params.action[0] : params.action;
  const isGet = request.method === 'GET';
  if (!isGet && request.method !== 'POST') return json({ error: 'method' }, 405, { allow: 'GET, POST' });
  if (!isGet && !originOk(request, env)) return json({ error: 'origin' }, 403);
  const sess = await getSession(env, request);
  if (!sess) return json({ error: 'signed-out' }, 401);
  const ownerId = sess.owner_id;
  let body = {};
  if (!isGet) { const p = await readObject(request, 4000); if (p.error) return json({ error: p.error }, p.status); body = p.body; }
  const now = Date.now();
  try {
    if (isGet && action === 'me') {
      const owner = await env.TAGDB.prepare('SELECT id, email, tz, marketing_optin FROM owners WHERE id = ?1').bind(ownerId).first();
      if (!owner) return json({ error: 'signed-out' }, 401);
      const tags = (await env.TAGDB.prepare('SELECT id, status, dog_name, message, show_phone, alerts_paused_until, plan, claimed_at FROM tags WHERE owner_id = ?1 ORDER BY claimed_at').bind(ownerId).all()).results;
      for (const t of tags) {
        t.contacts = (await env.TAGDB.prepare('SELECT id, slot, label, phone_e164, email, sms_on, email_on, sms_verified_at, sms_pending_at, sms_stopped_at FROM contacts WHERE tag_id = ?1 ORDER BY slot').bind(t.id).all()).results;
        t.activity = (await env.TAGDB.prepare("SELECT id, at, kind, lat, lng, accuracy_m, place_text, message, finder_reply, keep FROM scans WHERE tag_id = ?1 AND by_owner = 0 ORDER BY at DESC LIMIT 30").bind(t.id).all()).results;
        t.scanCount = await env.TAGDB.prepare("SELECT COUNT(*) AS n FROM scans WHERE tag_id = ?1 AND kind = 'scan' AND by_owner = 0").bind(t.id).first('n');
        t.paused = t.alerts_paused_until && t.alerts_paused_until > now ? t.alerts_paused_until : null;
        t.smsAllowed = planAllows(t, 'sms', env, now);
      }
      return json({ owner: { ...owner, marketing_text: MARKETING_TEXT }, tags, sms: { enabled: smsFlag(env), ready: smsReady(env), version: SMS_CONSENT_VERSION, text: SMS_CONSENT_TEXT } }, 200, { 'cache-control': 'no-store' });
    }
    if (isGet) return json({ error: 'not found' }, 404);

    if (action === 'signout') { await endSession(env, request); return json({ ok: true }, 200, { 'set-cookie': clearCookie() }); }

    if (action === 'settings') {
      if (body.tz != null) { if (!isTz(String(body.tz))) return json({ error: 'Unknown time zone.' }, 400); await env.TAGDB.prepare('UPDATE owners SET tz = ?2 WHERE id = ?1').bind(ownerId, String(body.tz)).run(); }
      if (body.marketing_optin != null) await env.TAGDB.prepare('UPDATE owners SET marketing_optin = ?2 WHERE id = ?1').bind(ownerId, body.marketing_optin === true ? 1 : 0).run();
      return json({ ok: true });
    }

    if (action === 'tag') {
      const t = await ownedTag(env, ownerId, body.id); if (!t) return json({ error: 'not your tag' }, 404);
      const sets = [], args = [];
      if (body.dog_name != null) { sets.push('dog_name = ?'); args.push(clean(body.dog_name, 40) || null); }
      if (body.message != null) { sets.push('message = ?'); args.push(cleanText(body.message, LIMITS.ownerMsgMax) || null); }   // links removed, 200 chars
      if (body.show_phone != null) { sets.push('show_phone = ?'); args.push(body.show_phone === true ? 1 : 0); }
      if (body.pause != null) {
        const until = body.pause === '1h' ? now + 3600e3 : body.pause === '24h' ? now + 86400e3 : body.pause === 'off' ? FOREVER : body.pause === 'none' ? null : undefined;
        if (until === undefined) return json({ error: 'bad pause' }, 400);
        sets.push('alerts_paused_until = ?'); args.push(until);
      }
      if (!sets.length) return json({ ok: true });
      await env.TAGDB.prepare(`UPDATE tags SET ${sets.join(', ')} WHERE id = ?`).bind(...args, t.id).run();
      return json({ ok: true });
    }

    if (action === 'contact') {
      const t = await ownedTag(env, ownerId, body.tag_id); if (!t) return json({ error: 'not your tag' }, 404);
      const slot = body.slot === 2 ? 2 : 1;
      if (slot === 2 && !planAllows(t, 'contact2', env, now)) return json({ error: 'A second contact is not on your plan.' }, 403);
      const email = String(body.email || '').trim().toLowerCase();
      if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: 'That email does not look right.' }, 400);
      const rawPhone = String(body.phone || '').trim();
      const phone = rawPhone ? toE164(rawPhone) : '';
      if (rawPhone && !phone) return json({ error: 'Use a full US phone number with area code, or a number starting with +.' }, 400);
      const smsOn = body.sms_on === true && Boolean(phone), emailOn = body.email_on !== false && Boolean(email);
      if (!phone && !email) return json({ error: 'Add a phone or an email for this contact.' }, 400);
      const old = await env.TAGDB.prepare('SELECT * FROM contacts WHERE tag_id = ?1 AND slot = ?2').bind(t.id, slot).first();
      let consentVer = old ? old.sms_consent_ver : null, consentHash_ = old ? old.sms_consent_hash : null, consentAt = old ? old.sms_consent_at : null;
      if (smsOn) {
        if (!smsFlag(env)) return json({ error: 'Text alerts are switched off right now. Email alerts still work.' }, 400);
        const c = body.consent || {};
        // A ticked box with the CURRENT versioned wording. Without it, texting stays off (fail closed).
        if (!(c.checked === true && c.ver === SMS_CONSENT_VERSION)) return json({ error: 'Tick the box to agree to text alerts.', field: 'consent' }, 400);
        if (!old || old.sms_consent_ver !== SMS_CONSENT_VERSION || !old.sms_consent_at) { consentVer = SMS_CONSENT_VERSION; consentHash_ = await consentHash(SMS_CONSENT_TEXT); consentAt = now; }
      }
      const phoneChanged = !old || old.phone_e164 !== (phone || null);
      const label = clean(body.label, 30) || (slot === 1 ? 'Me' : 'Family');
      if (old) {
        await env.TAGDB.prepare(`UPDATE contacts SET label=?2, phone_e164=?3, email=?4, sms_on=?5, email_on=?6, sms_consent_ver=?7, sms_consent_hash=?8, sms_consent_at=?9,
            sms_verified_at = CASE WHEN ?10 THEN NULL ELSE sms_verified_at END, sms_pending_at = CASE WHEN ?10 THEN NULL ELSE sms_pending_at END, sms_stopped_at = CASE WHEN ?10 THEN NULL ELSE sms_stopped_at END WHERE id = ?1`)
          .bind(old.id, label, phone || null, email || null, smsOn ? 1 : 0, emailOn ? 1 : 0, consentVer, consentHash_, consentAt, phoneChanged ? 1 : 0).run();
      } else {
        await env.TAGDB.prepare('INSERT INTO contacts(id, owner_id, tag_id, slot, label, phone_e164, email, sms_on, email_on, sms_consent_ver, sms_consent_hash, sms_consent_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)')
          .bind(rowId(), ownerId, t.id, slot, label, phone || null, email || null, smsOn ? 1 : 0, emailOn ? 1 : 0, consentVer, consentHash_, consentAt).run();
      }
      return json({ ok: true });
    }

    if (action === 'sms-send') {
      const c = await ownedContact(env, ownerId, body.contact_id);
      if (!c || !c.phone_e164 || !c.sms_on) return json({ error: 'Turn on text alerts for that contact first.' }, 400);
      if (!smsReady(env)) return json({ error: 'Text alerts are not ready yet. Email alerts still work.' }, 503);
      if (c.sms_stopped_at) return json({ error: 'That number replied STOP. Reply START from that phone to turn texts back on.' }, 409);
      const rl = await hit(env, 'rl:smssend:' + c.id, LIMITS.rl.smsSend[0], LIMITS.rl.smsSend[1]);
      const ipRl = await hit(env, 'rl:smssendip:' + (await ipHashOf(env, request)), 10, 3600);
      if (!rl.ok || !ipRl.ok) return json({ error: 'Too many codes. Try again later.' }, 429);
      const tag = await env.TAGDB.prepare('SELECT dog_name FROM tags WHERE id = ?1').bind(c.tag_id).first();
      const dog = (tag && tag.dog_name) || 'your dog';
      let r;
      if (c.slot === 2) {
        await env.TAGDB.prepare('UPDATE contacts SET sms_pending_at = ?2 WHERE id = ?1').bind(c.id, now).run();
        r = await sendAlertSms(env, { to: c.phone_e164, body: `Salty Dog Tags: someone added you to get text alerts when ${dog}'s tag is scanned. Reply YES to turn them on. Reply STOP to end alerts.` });
      } else {
        const code = String(100000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 900000));
        await env.TAGDB.prepare('INSERT INTO sms_codes(contact_id, code_hash, expires_at, tries) VALUES(?1,?2,?3,0) ON CONFLICT(contact_id) DO UPDATE SET code_hash = ?2, expires_at = ?3, tries = 0').bind(c.id, await sha256Hex(c.id + ':' + code), now + LIMITS.smsCodeMs).run();
        r = await sendAlertSms(env, { to: c.phone_e164, body: `Salty Dog Tags code: ${code}. It expires in 10 minutes. Reply STOP to end alerts.` });
      }
      if (!r.ok) return json({ error: 'We could not send the text (' + r.code + '). Email alerts still work.', code: r.code }, 502);
      return json({ ok: true, mode: c.slot === 2 ? 'yes' : 'code' });
    }

    if (action === 'sms-verify') {
      const c = await ownedContact(env, ownerId, body.contact_id);
      if (!c) return json({ error: 'not found' }, 404);
      const row = await env.TAGDB.prepare('SELECT * FROM sms_codes WHERE contact_id = ?1').bind(c.id).first();
      const code = String(body.code || '').replace(/\D/g, '');
      if (!row || row.expires_at < now || row.tries >= LIMITS.smsCodeTries) return json({ error: 'That code expired. Send a new one.' }, 400);
      await env.TAGDB.prepare('UPDATE sms_codes SET tries = tries + 1 WHERE contact_id = ?1').bind(c.id).run();
      if (code.length !== 6 || (await sha256Hex(c.id + ':' + code)) !== row.code_hash) return json({ error: 'That code is not right.' }, 400);
      await env.TAGDB.batch([
        env.TAGDB.prepare('UPDATE contacts SET sms_verified_at = ?2, sms_pending_at = NULL WHERE id = ?1').bind(c.id, now),
        env.TAGDB.prepare('DELETE FROM sms_codes WHERE contact_id = ?1').bind(c.id)
      ]);
      return json({ ok: true });
    }

    if (action === 'test') {
      const t = await ownedTag(env, ownerId, body.tag_id); if (!t) return json({ error: 'not your tag' }, 404);
      const r = await sendTestAlert(env, t, now);
      if (!r.ok) return json({ error: r.error === 'rate' ? 'That is 3 test alerts this hour. Try again later.' : 'Try again in a moment.' }, r.error === 'rate' ? 429 : 503);
      return json({ ok: true, sent: r.sent, failed: r.failed, capped: r.capped });
    }

    if (action === 'pin') {
      const s = await env.TAGDB.prepare('SELECT s.id, s.tag_id FROM scans s JOIN tags t ON t.id = s.tag_id WHERE s.id = ?1 AND t.owner_id = ?2').bind(String(body.scan_id || ''), ownerId).first();
      if (!s) return json({ error: 'not found' }, 404);
      if (body.keep === true) {
        const n = await env.TAGDB.prepare('SELECT COUNT(*) AS n FROM scans WHERE tag_id = ?1 AND keep = 1').bind(s.tag_id).first('n');
        if (n >= LIMITS.pinsPerTag) return json({ error: `You can keep ${LIMITS.pinsPerTag} items per tag.` }, 409);
      }
      await env.TAGDB.prepare('UPDATE scans SET keep = ?2 WHERE id = ?1').bind(s.id, body.keep === true ? 1 : 0).run();
      return json({ ok: true });
    }

    if (action === 'release') {
      const t = await ownedTag(env, ownerId, body.tag_id); if (!t) return json({ error: 'not your tag' }, 404);
      await releaseTag(env, t.id);
      return json({ ok: true });
    }

    if (action === 'delete-account') {
      if (body.confirm !== 'DELETE') return json({ error: 'Type DELETE to confirm.' }, 400);
      const ids = (await env.TAGDB.prepare('SELECT id FROM tags WHERE owner_id = ?1').bind(ownerId).all()).results;
      for (const t of ids) await releaseTag(env, t.id);
      await env.TAGDB.batch([
        env.TAGDB.prepare('DELETE FROM sessions WHERE owner_id = ?1').bind(ownerId),
        env.TAGDB.prepare('DELETE FROM contacts WHERE owner_id = ?1').bind(ownerId),
        env.TAGDB.prepare('DELETE FROM owners WHERE id = ?1').bind(ownerId)
      ]);
      return json({ ok: true }, 200, { 'set-cookie': clearCookie() });
    }
    return json({ error: 'not found' }, 404);
  } catch (e) { console.warn('my/' + action + ' failed', String((e && e.message) || e).slice(0, 80)); return json({ error: 'Try again in a moment.' }, 503); }
}
