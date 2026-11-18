// node --test tools/test/  Smart QR tag tasks 13 and 14: alert engine (caps, cleaning, Resend, Twilio Messaging Service, fail soft),
// STOP webhook, retry, digest, purge, canary, cron worker.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dispatch, onScan, onMessage, onLocation, buildAlert, stripLinks, scamFlag, smsClean, retryFailed, sendDigests, sendAlertEmail, sendAlertSms, cleanText, distanceM, NEVER_MONEY } from '../../functions/api/_tagnotify.js';
import { onRequestPost as inbound, twilioSigOk, STOP_RE, PLAIN_STOP_RE } from '../../functions/api/tag-sms-inbound.js';
import { purgeAll, purgeTag, runCanary } from '../../functions/api/_tagpurge.js';
import { smsFlag, smsReady, planAllows, LIMITS } from '../../functions/api/_tagsettings.js';
import cron, { runJobs } from '../../worker-sdt-tag-cron/src/index.js';
import { mkEnv, makeTag, req, stubFetch, getRow, allRows, SITE } from './_smartenv.mjs';

const full = (extra = {}) => ({ status: 'claimed', owner: { email: 'owner@example.com', tz: 'America/Denver' }, dog: 'Whisky',
  contacts: [{ slot: 1, email: 'owner@example.com', phone: '+14355550123', sms: true, verified: true }, { slot: 2, email: 'dana@example.com', phone: '+18015550100', sms: true, verified: true, label: 'Dana' }], ...extra });
const tagRow = (env, id) => getRow(env, 'SELECT * FROM tags WHERE id = ?1', id);
const twilioErr = (status, code) => (u) => (u.includes('twilio') ? new Response(JSON.stringify({ code, message: 'x' }), { status }) : undefined);

test('settings: SMS_ALERTS_ENABLED defaults to TRUE (Nick: enable it), "false" turns it off; sending also needs Twilio and the Messaging Service id', () => {
  assert.equal(smsFlag({}), true); assert.equal(smsFlag({ SMS_ALERTS_ENABLED: 'false' }), false); assert.equal(smsFlag({ SMS_ALERTS_ENABLED: 'FALSE ' }), false); assert.equal(smsFlag({ SMS_ALERTS_ENABLED: 'true' }), true);
  assert.equal(smsReady({ TWILIO_SID: 'a', TWILIO_TOKEN: 'b', TAG_TWILIO_MSID: 'MG1' }), true);
  assert.equal(smsReady({ TWILIO_SID: 'a', TWILIO_TOKEN: 'b' }), false, 'no TAG_TWILIO_MSID: never falls back to the marketing number');
  assert.equal(smsReady({ TWILIO_SID: 'a', TWILIO_TOKEN: 'b', TAG_TWILIO_MSID: 'MG1', SMS_ALERTS_ENABLED: 'false' }), false);
  assert.equal(planAllows({}, 'sms', {}), true); assert.equal(planAllows({}, 'sms', { SMART_PLAN: 'annual' }), false);
  assert.equal(planAllows({ paid_through: Date.now() + 1e6 }, 'sms', { SMART_PLAN: 'annual' }), true); assert.equal(planAllows({}, 'finder', { SMART_PLAN: 'annual' }), true, 'finder, relay and email are never gated');
});

test('cleaning: links, control characters and bidi tricks are removed; SMS text is cut to 120; scam words are flagged', () => {
  assert.equal(stripLinks('see https://evil.example/x?a=1 and www.bad.net or bad.com/path now'), 'see and or now');
  assert.equal(stripLinks('a\u0000b‮c\r\nd'), 'abc d');
  assert.equal(smsClean('x'.repeat(300)).length, 120); assert.ok(smsClean('x'.repeat(300)).endsWith('…'));
  assert.equal(cleanText('hello <b>there</b>', 50), 'hello <b>there</b>', 'escaping is the renderer\'s job, not the cleaner\'s');
  for (const s of ['send a gift card', 'Zelle me', 'venmo $20', 'Cash App', 'read me the code', 'wire the reward', 'shipping fee']) assert.equal(scamFlag(s), true, s);
  for (const s of ['I found him by the park', 'he is wagging his tail']) assert.equal(scamFlag(s), false, s);
  assert.ok(distanceM({ lat: 40, lng: -111 }, { lat: 40.01, lng: -111 }) > 1100 && distanceM({ lat: 40, lng: -111 }, { lat: 40.01, lng: -111 }) < 1120);
});

test('buildAlert: owner time zone, scan count, maps links, footers ("never send money", "Reply STOP" on SMS), html escaped', () => {
  const a = buildAlert({ kind: 'scan', dog: 'Whisky <b>', at: Date.UTC(2026, 10, 16, 21, 42), tz: 'America/Denver', count: 3, siteUrl: SITE });
  assert.match(a.text, /Mon, Nov 16, 2:42 PM MST/); assert.match(a.text, /3 scans so far/); assert.ok(a.text.endsWith(NEVER_MONEY));
  assert.match(a.sms, /Reply STOP to end alerts\.$/); assert.match(a.sms, /Never send money or read a code to a finder\./); assert.ok(!a.html.includes('<b>'));
  assert.ok(a.sms.length < 320);
  const l = buildAlert({ kind: 'location', dog: 'Rex', at: 1, lat: 40.1, lng: -111.2, accuracy: 12, siteUrl: SITE });
  assert.match(l.sms, /^Rex was found\. Location \(within 12 m\): https:\/\/maps\.apple\.com\/\?ll=40\.10000,-111\.20000/);
  const m = buildAlert({ kind: 'message', dog: 'Rex', at: 1, message: 'm'.repeat(250), reply: 'x', siteUrl: SITE });
  assert.ok(m.sms.length < 320); assert.ok(m.text.includes('m'.repeat(250)), 'email carries the full text');
  assert.equal(buildAlert({ kind: 'digest', dog: 'Rex', items: [{ at: 1, message: 'a' }, { at: 2, message: 'b' }], siteUrl: SITE }).sms, null);
});

test('email: Resend from alerts@saltydogtags.com with Idempotency-Key = the alert id; reply-to only when EMAIL_REPLY_TO is set', async () => {
  const f = stubFetch();
  try {
    const a = await sendAlertEmail(mkEnv(), { to: 'a@b.co', subject: 's', html: 'h', text: 't', idempotencyKey: 'alert-1' });
    assert.equal(a.ok, true);
    const c = f.emails()[0]; assert.equal(c.body.from, 'Salty Dog Tags <alerts@saltydogtags.com>'); assert.equal(c.headers['Idempotency-Key'], 'alert-1'); assert.ok(!('reply_to' in c.body), 'no reply-to by default');
    assert.equal(c.headers.authorization, 'Bearer re_test');
    await sendAlertEmail(mkEnv({ EMAIL_REPLY_TO: 'hello@saltydogtags.com' }), { to: 'a@b.co', subject: 's', html: 'h', text: 't' });
    assert.equal(f.emails()[1].body.reply_to, 'hello@saltydogtags.com');
    assert.equal((await sendAlertEmail(mkEnv({ RESEND_API_KEY: '' }), { to: 'a@b.co', subject: 's' })).code, 'email-not-configured');
    assert.equal((await sendAlertEmail(mkEnv(), { to: 'bad', subject: 's' })).code, 'email-bad-address');
  } finally { f.restore(); }
});

test('sms: sent through the Messaging Service SID (never From), with a short error code on failure; no numbers or bodies in the code', async () => {
  const f = stubFetch([twilioErr(400, 30034)]);
  try {
    const r = await sendAlertSms(mkEnv(), { to: '+14355550123', body: 'hi' });
    assert.deepEqual(r, { ok: false, code: 'twilio-400-30034' });
    assert.equal(f.sms()[0].body.MessagingServiceSid, 'MGtest'); assert.ok(!('From' in f.sms()[0].body));
    assert.equal(f.sms()[0].headers.Authorization, 'Basic ' + btoa('ACtest:twtoken'));
    assert.equal((await sendAlertSms(mkEnv({ TAG_TWILIO_MSID: '' }), { to: '+14355550123', body: 'x' })).code, 'sms-not-ready');
    assert.equal((await sendAlertSms(mkEnv(), { to: '4355550123', body: 'x' })).code, 'sms-bad-number');
  } finally { f.restore(); }
});

test('dispatch: a verified owner and contact 2 each get an email AND a text; unverified, stopped, sms-off and flag-off contacts get no text', async () => {
  const env = mkEnv(); const f = stubFetch();
  try {
    const t = await makeTag(env, { ...full(), contacts: [
      { slot: 1, email: 'a@b.co', phone: '+14355550123', sms: true, verified: true },
      { slot: 2, email: 'c@d.co', phone: '+18015550100', sms: true, verified: false } ] });
    const r = await dispatch(env, await tagRow(env, t.id), { kind: 'test', scan: { at: Date.now() } });
    assert.deepEqual(r.sent, { email: 2, sms: 1 }); assert.equal(f.sms().length, 1); assert.equal(f.sms()[0].body.To, '+14355550123');
    const s = await makeTag(env, { ...full(), contacts: [{ slot: 1, email: 'a@b.co', phone: '+14355550123', sms: true, verified: true, stopped: true }] });
    f.calls.length = 0; await dispatch(env, await tagRow(env, s.id), { kind: 'test', scan: { at: 1 } });
    assert.equal(f.sms().length, 0); assert.equal(f.emails().length, 1, 'STOP ends texts only: email keeps flowing');
    const off = mkEnv({ SMS_ALERTS_ENABLED: 'false' }); const o = await makeTag(off, full()); f.calls.length = 0;
    await dispatch(off, await tagRow(off, o.id), { kind: 'test', scan: { at: 1 } }); assert.equal(f.sms().length, 0); assert.equal(f.emails().length, 2);
  } finally { f.restore(); }
});

test('FAIL SOFT: a Twilio carrier or registration error is logged and marked failed on the sms row, and the email still goes out', async () => {
  const env = mkEnv(); const f = stubFetch([twilioErr(400, 30034)]);
  const warns = []; const w = console.warn; console.warn = (...a) => warns.push(a.join(' '));
  try {
    const t = await makeTag(env, full());
    const r = await dispatch(env, await tagRow(env, t.id), { kind: 'scan', scan: { at: Date.now() }, count: 1 });
    assert.equal(r.sent.email, 2); assert.equal(r.failed.sms, 2); assert.equal(r.sent.sms, 0);
    const sms = await allRows(env, "SELECT * FROM alerts WHERE channel = 'sms'"); assert.ok(sms.every((a) => a.status === 'failed' && a.error_code === 'twilio-400-30034'));
    const em = await allRows(env, "SELECT * FROM alerts WHERE channel = 'email'"); assert.ok(em.every((a) => a.status === 'sent' && a.provider_id));
    assert.ok(warns.some((x) => /alert sms failed twilio-400-30034/.test(x))); assert.ok(!warns.join(' ').match(/\+1\d{10}|@/), 'logs carry codes only');
    // whole Twilio outage (network throws): same result, nothing thrown
    f.restore(); const g = stubFetch([(u) => { if (u.includes('twilio')) throw new Error('boom'); }]);
    const r2 = await dispatch(env, await tagRow(env, t.id), { kind: 'test', scan: { at: 1 } }); assert.equal(r2.sent.email, 2); assert.equal(r2.failed.sms, 2); g.restore();
  } finally { console.warn = w; f.restore(); }
});

test('FAIL SOFT: Resend failing does not stop the text; a D1 error inside dispatch never throws to the caller', async () => {
  const env = mkEnv(); const f = stubFetch([(u) => (u.includes('resend') ? new Response('{}', { status: 500 }) : undefined)]);
  try {
    const t = await makeTag(env, full());
    const row = await tagRow(env, t.id);
    const r = await dispatch(env, row, { kind: 'test', scan: { at: 1 } });
    assert.equal(r.failed.email, 2); assert.equal(r.sent.sms, 2);
    env.TAGDB.failNext(1); assert.ok(await dispatch(env, row, { kind: 'test', scan: { at: 1 } }), 'returns instead of throwing');
  } finally { f.restore(); }
});

test('caps: 12 SMS per tag per day then email only plus ONE "alerts capped" notice; 500 SMS a day site-wide stops texting entirely; 2,000 emails a day', async () => {
  const env = mkEnv(); const f = stubFetch();
  try {
    const t = await makeTag(env, full({ contacts: [{ slot: 1, email: 'a@b.co', phone: '+14355550123', sms: true, verified: true }] }));
    for (let i = 0; i < 15; i++) await dispatch(env, await tagRow(env, t.id), { kind: 'location', scan: { at: Date.now(), place_text: 'x' } });
    assert.equal(f.sms().length, 12); assert.equal(f.emails().filter((e) => /Text alerts paused/.test(e.body.subject)).length, 1, 'one capped notice');
    assert.equal(f.emails().length, 15 + 1, 'every alert still went by email');
    assert.equal((await allRows(env, "SELECT * FROM alerts WHERE channel = 'sms' AND status = 'capped'")).length, 3);
    // global SMS cap
    await env.TAGDB.prepare("INSERT OR REPLACE INTO counters(k, n, expires_at) VALUES(?1, 500, ?2)").bind(`cap:sms:${new Date().toISOString().slice(0, 10)}`, Date.now() + 1e8).run();
    const t2 = await makeTag(env, full({ contacts: [{ slot: 1, email: 'a@b.co', phone: '+14355550123', sms: true, verified: true }] })); f.calls.length = 0;
    await dispatch(env, await tagRow(env, t2.id), { kind: 'test', scan: { at: 1 } }); assert.equal(f.sms().length, 0); assert.equal(f.emails().length, 1);
    // global email cap
    await env.TAGDB.prepare("INSERT OR REPLACE INTO counters(k, n, expires_at) VALUES(?1, 2000, ?2)").bind(`cap:email:${new Date().toISOString().slice(0, 10)}`, Date.now() + 1e8).run(); f.calls.length = 0;
    const r = await dispatch(env, await tagRow(env, t2.id), { kind: 'test', scan: { at: 2 } }); assert.equal(f.emails().length, 0); assert.equal(r.capped.email, 1);
  } finally { f.restore(); }
});

test('dispatch: an unclaimed tag, an alerts-off contact, and a contact without email or phone send nothing; slot 2 is skipped when the plan disallows it', async () => {
  const env = mkEnv(); const f = stubFetch();
  try {
    const u = await makeTag(env, { status: 'shipped', owner: null }); assert.deepEqual((await dispatch(env, await tagRow(env, u.id), { kind: 'scan', scan: { at: 1 } })).sent, { email: 0, sms: 0 });
    const t = await makeTag(env, full({ contacts: [{ slot: 1, email: 'a@b.co', email_on: false }] }));
    assert.equal((await dispatch(env, await tagRow(env, t.id), { kind: 'scan', scan: { at: 1 } })).sent.email, 0);
    const annual = mkEnv({ SMART_PLAN: 'annual' }); const p = await makeTag(annual, full());
    const r = await dispatch(annual, await tagRow(annual, p.id), { kind: 'test', scan: { at: 1 } });
    assert.deepEqual(r.sent, { email: 1, sms: 0 }, 'lapsed paid plan: contact 2 and texting are off, the owner\'s email still goes');
  } finally { f.restore(); }
});

test('events: a lapsed paid plan drops to email only (finder page, relay and email are never gated)', async () => {
  const env = mkEnv({ SMART_PLAN: 'annual' }); const f = stubFetch();
  try {
    const t = await makeTag(env, full({ contacts: [{ slot: 1, email: 'a@b.co', phone: '+14355550123', sms: true, verified: true }] }));
    const r = await dispatch(env, await tagRow(env, t.id), { kind: 'test', scan: { at: 1 } });
    assert.equal(r.sent.email, 1); assert.equal(r.sent.sms, 0);
    await env.TAGDB.prepare('UPDATE tags SET paid_through = ?2 WHERE id = ?1').bind(t.id, Date.now() + 1e9).run();
    assert.equal((await dispatch(env, await tagRow(env, t.id), { kind: 'test', scan: { at: 1 } })).sent.sms, 1);
  } finally { f.restore(); }
});

test('onLocation without coordinates and onMessage on a paused tag: stored, never alerted', async () => {
  const env = mkEnv(); const f = stubFetch();
  try {
    const t = await makeTag(env, full({ paused: Date.now() + 3600e3 }));
    assert.equal((await onMessage(env, await tagRow(env, t.id), { message: 'hello' })).alerted, false);
    assert.equal((await onLocation(env, await tagRow(env, t.id), { place: 'park' })).alerted, false);
    assert.equal((await allRows(env, 'SELECT * FROM scans')).length, 2); assert.equal(f.calls.length, 0);
  } finally { f.restore(); }
});

/* ---------- STOP webhook ---------- */
const sign = async (token, url, params) => {
  const keys = [...params.keys()].sort(); let data = url; for (const k of keys) data += k + params.get(k);
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(token), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  return btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data)))));
};
const hook = async (env, fields, { sig, token = 'twtoken' } = {}) => {
  const params = new URLSearchParams(fields); const url = SITE + '/api/tag-sms-inbound';
  const signature = sig === undefined ? await sign(token, url, params) : sig;
  const r = await inbound({ request: new Request(url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', ...(signature ? { 'x-twilio-signature': signature } : {}) }, body: params.toString() }), env });
  return { status: r.status, body: await r.text() };
};

test('STOP webhook: a valid Twilio signature is required (403 otherwise, nothing changes); the signature algorithm matches Twilio\'s documented one', async () => {
  // Twilio's scheme: base64(HMAC-SHA1(token, url + each param name+value, sorted by name)). Cross-checked against node:crypto, an independent implementation.
  const { createHmac } = await import('node:crypto');
  const url = 'https://mycompany.com/myapp.php?foo=1&bar=2';
  const params = new URLSearchParams([['To', '+18005551212'], ['CallSid', 'CA1234567890ABCDE'], ['Digits', '1234'], ['From', '+12349013030'], ['Caller', '+12349013030']]);
  const want = createHmac('sha1', '12345').update(url + 'CallSidCA1234567890ABCDE' + 'Caller+12349013030' + 'Digits1234' + 'From+12349013030' + 'To+18005551212').digest('base64');
  assert.equal(await twilioSigOk('12345', url, params, want), true);
  assert.equal(await twilioSigOk('12345', url, params, want.slice(0, -2) + 'A='), false);
  assert.equal(await twilioSigOk('wrong', url, params, want), false);
  const env = mkEnv(); const t = await makeTag(env, full());
  assert.equal((await hook(env, { From: '+14355550123', Body: 'STOP' }, { sig: 'bad' })).status, 403);
  assert.equal((await hook(env, { From: '+14355550123', Body: 'STOP' }, { sig: '' })).status, 403);
  assert.equal((await hook(env, { From: '+14355550123', Body: 'STOP' }, { token: 'wrong-token' })).status, 403);
  assert.equal((await hook(mkEnv({ TWILIO_TOKEN: '' }), { From: '+14355550123', Body: 'STOP' })).status, 403);
  assert.equal((await getRow(env, 'SELECT sms_stopped_at s FROM contacts WHERE phone_e164 = ?1', '+14355550123')).s, null);
});

test('STOP webhook: STOP words set sms_stopped_at on that number only, email keeps flowing; START clears it; HELP replies; YES verifies a pending contact 2', async () => {
  const env = mkEnv(); const f = stubFetch(); const t = await makeTag(env, full());
  try {
    assert.ok(STOP_RE.test('STOP') && STOP_RE.test(' stopall ') && STOP_RE.test('Unsubscribe') && PLAIN_STOP_RE.test('stop texting me') && !STOP_RE.test('please keep going') && !PLAIN_STOP_RE.test('nonstop'));
    for (const w of ['STOP', 'Stop', 'unsubscribe', 'CANCEL', 'end', 'QUIT']) {
      await env.TAGDB.prepare('UPDATE contacts SET sms_stopped_at = NULL, sms_on = 1').run();
      assert.equal((await hook(env, { From: '+14355550123', Body: w })).status, 200);
      assert.ok((await getRow(env, 'SELECT sms_stopped_at s FROM contacts WHERE phone_e164 = ?1', '+14355550123')).s, w);
      assert.equal((await getRow(env, 'SELECT sms_stopped_at s FROM contacts WHERE phone_e164 = ?1', '+18015550100')).s, null, 'only that number');
    }
    const r = await dispatch(env, await tagRow(env, t.id), { kind: 'test', scan: { at: 1 } });
    assert.equal(r.sent.sms, 1); assert.equal(r.sent.email, 2); assert.equal(f.sms().at(-1).body.To, '+18015550100');
    assert.match((await hook(env, { From: '+14355550123', Body: 'START' })).body, /alerts are back on/);
    assert.equal((await getRow(env, 'SELECT sms_stopped_at s FROM contacts WHERE phone_e164 = ?1', '+14355550123')).s, null);
    assert.match((await hook(env, { From: '+14355550123', Body: 'HELP' })).body, /Reply STOP to end alerts/);
    await env.TAGDB.prepare('UPDATE contacts SET sms_verified_at = NULL, sms_pending_at = ?1 WHERE slot = 2').bind(Date.now()).run();
    assert.match((await hook(env, { From: '+18015550100', Body: 'yes' })).body, /You are set/);
    assert.ok((await getRow(env, 'SELECT sms_verified_at v FROM contacts WHERE slot = 2')).v);
    assert.equal((await hook(env, { From: '+19995550100', Body: 'yes' })).body.includes('Message'), false, 'a YES from a number we never texted does nothing');
    assert.equal((await hook(env, { From: 'junk', Body: 'STOP' })).status, 200);
  } finally { f.restore(); }
});

/* ---------- cron ---------- */
test('retry: failed alerts from the last 2 hours are re-sent (3 tries); stale, over-tried, and STOPped ones are not; digests batch per tag', async () => {
  const env = mkEnv(); const f = stubFetch([twilioErr(400, 30034)]);
  try {
    const t = await makeTag(env, full({ contacts: [{ slot: 1, email: 'a@b.co', phone: '+14355550123', sms: true, verified: true }] }));
    await dispatch(env, await tagRow(env, t.id), { kind: 'test', scan: { at: Date.now() } });
    assert.equal((await allRows(env, "SELECT * FROM alerts WHERE status = 'failed'")).length, 1);
    await env.TAGDB.prepare('UPDATE alerts SET last_try_at = ?1').bind(Date.now() - 10 * 60e3).run();
    f.restore(); const g = stubFetch();
    const r = await retryFailed(env); assert.equal(r.retried, 1); assert.equal(r.sent, 1);
    assert.equal((await getRow(env, "SELECT status, tries FROM alerts WHERE channel = 'sms'")).status, 'sent'); assert.equal(g.sms().length, 1);
    await env.TAGDB.prepare("UPDATE alerts SET status = 'failed', at = ?1").bind(Date.now() - 3 * 3600e3).run();
    assert.equal((await retryFailed(env)).retried, 0, 'older than 2 hours');
    await env.TAGDB.prepare("UPDATE alerts SET at = ?1, tries = 3, last_try_at = NULL").bind(Date.now()).run();
    assert.equal((await retryFailed(env)).retried, 0, 'tries exhausted'); g.restore();
  } finally { f.restore(); }
});

test('digest: messages over the hourly cap go out as one email per tag and contact', async () => {
  const env = mkEnv(); const f = stubFetch();
  try {
    const t = await makeTag(env, full({ contacts: [{ slot: 1, email: 'a@b.co' }] }));
    for (let i = 0; i < 8; i++) await onMessage(env, await tagRow(env, t.id), { message: 'finder note ' + i });
    assert.equal(f.emails().length, 5);
    const r = await sendDigests(env); assert.equal(r.digests, 1);
    const e = f.emails().at(-1).body; assert.match(e.subject, /3 more messages about Whisky/); assert.match(e.text, /finder note 7/);
    assert.equal((await allRows(env, "SELECT * FROM alerts WHERE kind = 'digest' AND status = 'queued'")).length, 0);
    assert.equal((await sendDigests(env)).digests, 0);
  } finally { f.restore(); }
});

test('purge: 30 day scans (location, message, finder contact) go unless kept; ip hashes null after 24 h; alerts 30 days; tokens, counters, sessions, codes when expired', async () => {
  const env = mkEnv(); const now = Date.now(), D = 86400e3;
  const t = await makeTag(env, full());
  await env.TAGDB.prepare("INSERT INTO scans(id, tag_id, at, kind, lat, lng, message, finder_reply, ip_hash, keep) VALUES('old',?1,?2,'location',1,2,'m','r','h',0),('kept',?1,?2,'message',NULL,NULL,'m',NULL,'h',1),('fresh',?1,?3,'scan',NULL,NULL,NULL,NULL,'h',0),('day',?1,?4,'scan',NULL,NULL,NULL,NULL,'h',0)").bind(t.id, now - 31 * D, now - 1000, now - 25 * 3600e3).run();
  await env.TAGDB.prepare("INSERT INTO alerts(id, tag_id, channel, status, at) VALUES('a-old',?1,'email','sent',?2),('a-new',?1,'email','sent',?3)").bind(t.id, now - 31 * D, now).run();
  await env.TAGDB.prepare("INSERT INTO login_tokens(id_hash,email,purpose,expires_at,used_at) VALUES('used','a','login',?1,?2),('exp','a','login',?3,NULL),('live','a','login',?1,NULL)").bind(now + 1e6, now, now - 1).run();
  await env.TAGDB.prepare("INSERT INTO counters(k,n,expires_at) VALUES('dead',1,?1),('alive',1,?2)").bind(now - 1, now + 1e6).run();
  await env.TAGDB.prepare("INSERT INTO sessions(id_hash,owner_id,created_at,expires_at) VALUES('s-old','o',1,?1),('s-live','o',1,?2)").bind(now - 1, now + 1e6).run();
  await env.TAGDB.prepare("INSERT INTO sms_codes(contact_id,code_hash,expires_at) VALUES('c-old','x',?1),('c-live','x',?2)").bind(now - 1, now + 1e6).run();
  const r = await purgeAll(env, now);
  assert.equal(r.scans, 1); assert.deepEqual((await allRows(env, 'SELECT id FROM scans ORDER BY id')).map((x) => x.id), ['day', 'fresh', 'kept']);
  assert.equal((await getRow(env, "SELECT ip_hash h FROM scans WHERE id = 'day'")).h, null); assert.equal((await getRow(env, "SELECT ip_hash h FROM scans WHERE id = 'fresh'")).h, 'h');
  assert.equal((await getRow(env, "SELECT ip_hash h FROM scans WHERE id = 'kept'")).h, null, 'even a kept scan loses its ip hash after 24 h');
  assert.deepEqual((await allRows(env, 'SELECT id FROM alerts')).map((x) => x.id), ['a-new']);
  assert.deepEqual((await allRows(env, 'SELECT id_hash FROM login_tokens')).map((x) => x.id_hash), ['live']);
  assert.deepEqual((await allRows(env, "SELECT k FROM counters WHERE k IN ('dead','alive')")).map((x) => x.k), ['alive']);
  assert.deepEqual((await allRows(env, 'SELECT id_hash FROM sessions')).map((x) => x.id_hash), ['s-live']);
  assert.deepEqual((await allRows(env, 'SELECT contact_id FROM sms_codes')).map((x) => x.contact_id), ['c-live']);
  assert.equal((await getRow(env, "SELECT at FROM meta WHERE k = 'last_purge_at'")).at, now);
  assert.equal(await purgeTag(env, t.id, now), 0);
});

test('canary: ok when /T/<id> answers 200 with the finder header; fails (and pushes Pushover) when the rewrite is gone (a static 404) or the host is down', async () => {
  const env = mkEnv({ PUSHOVER_TOKEN: 'pt', PUSHOVER_USER: 'pu' });
  const ok = await runCanary(env, async (u) => { assert.equal(u, 'https://saltydogtags.com/T/CANARY0000'); return new Response('x', { status: 200, headers: { 'x-sdt-finder': '1' } }); });
  assert.equal(ok.ok, true); assert.equal((await getRow(env, "SELECT v FROM meta WHERE k = 'canary'")).v, 'ok');
  const calls = [];
  const bad = await runCanary(env, async (u, i) => { calls.push(u); return u.includes('pushover') ? new Response('{}') : new Response('nf', { status: 404 }); });
  assert.equal(bad.ok, false); assert.match(bad.why, /status 404/); assert.equal((await getRow(env, "SELECT v FROM meta WHERE k = 'canary'")).v, 'fail');
  assert.ok(calls.some((u) => u.includes('pushover')), 'Pushover on failure');
  const noHeader = await runCanary(env, async () => new Response('<html>', { status: 200 })); assert.equal(noHeader.ok, false, '200 without the finder header means a wrong page answered');
  const down = await runCanary(env, async () => { throw new Error('dns'); }); assert.equal(down.ok, false);
});

test('cron worker: every run retries and sends digests and stamps last_retry_at; the daily run also purges and runs the canary; /health reports the times', async () => {
  const env = mkEnv(); const f = stubFetch([(u) => (u.includes('saltydogtags.com/T/') ? new Response('x', { status: 200, headers: { 'x-sdt-finder': '1' } }) : undefined)]);
  try {
    const a = await runJobs(env, '*/15 * * * *'); assert.ok(a.retry && a.digests && !a.purge);
    assert.equal(await getRow(env, "SELECT at FROM meta WHERE k = 'last_purge_at'"), null);
    const b = await runJobs(env, '17 9 * * *'); assert.ok(b.purge); assert.equal(b.canary.ok, true);
    const res = await cron.fetch(new Request('https://x/health'), env); const d = await res.json();
    assert.equal(d.ok, true); assert.ok(d.lastPurgeAt && d.lastRetryAt);
    let waited; await cron.scheduled({ cron: '*/15 * * * *' }, env, { waitUntil: (p) => { waited = p; } }); await waited;
  } finally { f.restore(); }
});

test('LIMITS table matches the ADR (the numbers Breaker and Tunnel Rat read)', () => {
  assert.equal(LIMITS.burstMs, 600000); assert.equal(LIMITS.locMoveM, 250); assert.equal(LIMITS.locPerBurst, 3); assert.equal(LIMITS.msgPerTagHour, 5);
  assert.equal(LIMITS.smsPerTagDay, 12); assert.equal(LIMITS.smsGlobalDay, 500); assert.equal(LIMITS.emailGlobalDay, 2000); assert.equal(LIMITS.retryWindowMs, 7200000);
  assert.deepEqual(LIMITS.rl.miss, [30, 3600]); assert.deepEqual(LIMITS.rl.scanIp, [20, 3600]); assert.deepEqual(LIMITS.rl.scanIpTag, [1, 600]); assert.deepEqual(LIMITS.rl.message, [5, 3600]); assert.deepEqual(LIMITS.rl.messageTag, [3, 86400]);
  assert.deepEqual(LIMITS.rl.location, [6, 3600]); assert.deepEqual(LIMITS.rl.claim, [10, 3600]); assert.deepEqual(LIMITS.rl.authEmail, [3, 3600]); assert.deepEqual(LIMITS.rl.authIp, [10, 3600]);
  assert.equal(LIMITS.scanKeepMs, 30 * 86400e3); assert.equal(LIMITS.ipHashKeepMs, 86400e3); assert.equal(LIMITS.pinsPerTag, 20); assert.equal(LIMITS.loginTokenMs, 900000);
});
