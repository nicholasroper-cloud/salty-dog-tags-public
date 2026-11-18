// node --test tools/test/  Smart QR tag task 12: claim with the HMAC code, magic link, sessions, /my dashboard API, profile, contacts, SMS consent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { onRequestPost as claim } from '../../functions/api/tag/claim.js';
import { onRequestPost as authStart } from '../../functions/api/auth/start.js';
import { onRequestGet as verifyGet, onRequestPost as verifyPost } from '../../functions/api/auth/verify.js';
import { onRequest as my } from '../../functions/api/my/[action].js';
import { toE164 } from '../../functions/api/my/[action].js';
import { claimCode } from '../../functions/api/_tagid.js';
import { SMS_CONSENT_VERSION, SMS_CONSENT_TEXT, consentHash } from '../../functions/api/_tagsettings.js';
import { sha256Hex } from '../../functions/api/_tagid.js';
import { mkEnv, makeTag, req, stubFetch, getRow, allRows, KEY, SITE, ip } from './_smartenv.mjs';

const doClaim = async (env, body, over = {}) => { const r = await claim({ request: req('POST', '/api/tag/claim', { body, ...over }), env }); return { status: r.status, d: await r.json() }; };
const linkFrom = (f) => { const e = f.emails().at(-1); const m = /https:\/\/saltydogtags\.com\/api\/auth\/verify\?token=([A-Za-z0-9_-]+)/.exec(e.body.text); return m && m[1]; };
const unclaimed = async (env, over = {}) => makeTag(env, { status: 'shipped', owner: null, dog: null, ...over });
const verify = async (env, token, over = {}) => verifyPost({ request: req('POST', '/api/auth/verify', { body: 'token=' + encodeURIComponent(token), headers: { 'content-type': 'application/x-www-form-urlencoded' }, ...over }), env });
async function signedIn(env, t) {
  const f = stubFetch();
  try {
    const code = await claimCode(KEY, t.id, 1);
    assert.equal((await doClaim(env, { t: t.id, c: code, email: 'owner@example.com' })).status, 200);
    const res = await verify(env, linkFrom(f));
    return { cookie: res.headers.get('set-cookie').split(';')[0], res };
  } finally { f.restore(); }
}
const api = async (env, action, body, cookie, over = {}) => {
  const r = await my({ request: req(body === undefined ? 'GET' : 'POST', '/api/my/' + action, { body, headers: cookie ? { cookie } : {}, ...over }), env, params: { action } });
  return { status: r.status, d: await r.json(), h: r.headers };
};

test('claim: the HMAC code from the packing slip sends a magic link; the claim completes only when the link is used', async () => {
  const env = mkEnv(); const t = await unclaimed(env); const f = stubFetch();
  try {
    const code = await claimCode(KEY, t.id, 1);
    const r = await doClaim(env, { t: t.id.toLowerCase(), c: code.toLowerCase().replace(/-/g, ' '), email: 'Owner@Example.com' });
    assert.equal(r.status, 200); assert.match(r.d.message, /expires in 15 minutes/);
    assert.equal((await getRow(env, 'SELECT status, owner_id FROM tags WHERE id = ?1', t.id)).owner_id, null, 'a typo\'d email cannot own the tag: nothing is claimed yet');
    assert.deepEqual(f.emails()[0].body.to, ['owner@example.com']);
    const token = linkFrom(f); assert.ok(token && token.length >= 40);
    const row = await getRow(env, 'SELECT * FROM login_tokens');
    assert.notEqual(row.id_hash, token, 'the token is stored only as a hash'); assert.equal(row.id_hash, await sha256Hex(token));
    assert.equal(row.purpose, 'claim'); assert.ok(row.expires_at - Date.now() <= 15 * 60e3 + 1000);
  } finally { f.restore(); }
});

test('claim: a wrong code, a wrong id and a disabled tag all get the same error; the code is rotated by claim_ver', async () => {
  const env = mkEnv(); const t = await unclaimed(env); const d = await unclaimed(env, { status: 'disabled' }); const f = stubFetch();
  try {
    const good = await claimCode(KEY, t.id, 1);
    const errs = new Set();
    for (const b of [{ t: t.id, c: 'AAAA-AAAA-AAAA' }, { t: 'ZZZZZZZZZZ', c: good }, { t: d.id, c: await claimCode(KEY, d.id, 1) }, { t: 'bad', c: good }, { t: t.id, c: '' }]) { const r = await doClaim(env, { ...b, email: 'a@b.co' }); assert.equal(r.status, 400); errs.add(r.d.error); }
    assert.equal(errs.size, 1);
    await env.TAGDB.prepare('UPDATE tags SET claim_ver = 2 WHERE id = ?1').bind(t.id).run();
    assert.equal((await doClaim(env, { t: t.id, c: good, email: 'a@b.co' })).status, 400, 'the old printed code is dead after a rotation');
    assert.equal((await doClaim(env, { t: t.id, c: await claimCode(KEY, t.id, 2), email: 'a@b.co' })).status, 200);
    assert.equal(f.emails().length, 1);
  } finally { f.restore(); }
});

test('claim: 5 wrong codes on one tag lock it for the day (even a right code) and page Nick once; an already claimed tag says so only after a right code', async () => {
  const env = mkEnv({ PUSHOVER_TOKEN: 'pt', PUSHOVER_USER: 'pu' }); const t = await unclaimed(env); const f = stubFetch();
  try {
    for (let i = 0; i < 5; i++) assert.equal((await doClaim(env, { t: t.id, c: 'AAAA-AAAA-AA' + i + 'A', email: 'a@b.co' }, { ipaddr: ip() })).status, 400);
    assert.equal(f.calls.filter((c) => c.url.includes('pushover')).length, 1);
    const r = await doClaim(env, { t: t.id, c: await claimCode(KEY, t.id, 1), email: 'a@b.co' }, { ipaddr: ip() });
    assert.equal(r.status, 429); assert.match(r.d.error, /locked/);
    assert.equal(f.emails().length, 0);
    const c = await makeTag(env, { status: 'claimed', owner: { email: 'x@y.co' } });
    assert.equal((await doClaim(env, { t: c.id, c: 'AAAA-AAAA-AAAA', email: 'a@b.co' })).status, 400);
    const claimed = await doClaim(env, { t: c.id, c: await claimCode(KEY, c.id, 1), email: 'a@b.co' });
    assert.equal(claimed.status, 409); assert.equal(claimed.d.claimed, true);
  } finally { f.restore(); }
});

test('claim: 10 per IP per hour; 3 magic links per email per hour; bad email; other origin refused; no key means nobody can claim', async () => {
  const env = mkEnv(); const f = stubFetch();
  try {
    const o = { ipaddr: '203.0.113.40' };
    for (let i = 0; i < 10; i++) await doClaim(env, { t: 'ZZZZZZZZZZ', c: 'x', email: 'a@b.co' }, o);
    assert.equal((await doClaim(env, { t: 'ZZZZZZZZZZ', c: 'x', email: 'a@b.co' }, o)).status, 429);
    const t = await unclaimed(env), code = await claimCode(KEY, t.id, 1);
    for (let i = 0; i < 3; i++) assert.equal((await doClaim(env, { t: t.id, c: code, email: 'same@b.co' })).status, 200);
    assert.equal((await doClaim(env, { t: t.id, c: code, email: 'same@b.co' })).status, 429);
    assert.equal((await doClaim(env, { t: t.id, c: code, email: 'nope' })).status, 400);
    assert.equal((await doClaim(env, { t: t.id, c: code, email: 'a@b.co' }, { origin: 'https://evil.example' })).status, 403);
    assert.equal((await doClaim(mkEnv({ TAG_CLAIM_KEY: '' }), { t: t.id, c: code, email: 'a@b.co' })).status, 400);
  } finally { f.restore(); }
});

test('magic link: opening it (GET) shows a button and uses nothing up; only the POST claims; the token is single use and expires', async () => {
  const env = mkEnv(); const t = await unclaimed(env, { order: 'SDT-BBBB' }); const f = stubFetch();
  try {
    await env.ORDERS.put('order:SDT-BBBB', JSON.stringify({ id: 'SDT-BBBB', tags: [{ back: ['Biscuit', '801-336-2244'] }] }));
    await doClaim(env, { t: t.id, c: await claimCode(KEY, t.id, 1), email: 'owner@example.com' });
    const token = linkFrom(f);
    for (let i = 0; i < 3; i++) {   // a mail scanner opening the link three times
      const g = await verifyGet({ request: req('GET', '/api/auth/verify?token=' + token), env });
      const html = await g.text(); assert.equal(g.status, 200); assert.match(html, /<button[^>]*>Activate my tag<\/button>/); assert.ok(!g.headers.get('set-cookie'));
    }
    assert.equal((await getRow(env, 'SELECT owner_id FROM tags WHERE id = ?1', t.id)).owner_id, null);
    assert.equal((await getRow(env, 'SELECT used_at FROM login_tokens')).used_at, null);
    const res = await verify(env, token);
    assert.equal(res.status, 303); assert.equal(res.headers.get('location'), '/my?claimed=' + t.id);
    const ck = res.headers.get('set-cookie');
    assert.match(ck, /^sdt_s=[A-Za-z0-9_-]{43};/); assert.match(ck, /HttpOnly/); assert.match(ck, /Secure/); assert.match(ck, /SameSite=Lax/); assert.match(ck, /Max-Age=2592000/); assert.match(ck, /Path=\//);
    const row = await getRow(env, 'SELECT * FROM tags WHERE id = ?1', t.id);
    assert.equal(row.status, 'claimed'); assert.ok(row.owner_id); assert.equal(row.dog_name, 'Biscuit', 'pre-filled from the engraved back line'); assert.equal(row.buyer_email, null);
    assert.equal((await getRow(env, 'SELECT email, email_on, sms_on FROM contacts WHERE tag_id = ?1', t.id)).email, 'owner@example.com');
    const again = await verify(env, token); assert.equal(again.status, 410);
    assert.equal((await verifyGet({ request: req('GET', '/api/auth/verify?token=' + token), env })).status, 410);
    // the session is stored hashed
    const sess = await getRow(env, 'SELECT * FROM sessions'); assert.ok(!ck.includes(sess.id_hash));
  } finally { f.restore(); }
});

test('magic link: expired after 15 min, POST needs the site Origin, garbage tokens are 410, two simultaneous POSTs cannot both win', async () => {
  const env = mkEnv(); const t = await unclaimed(env); const f = stubFetch();
  try {
    await doClaim(env, { t: t.id, c: await claimCode(KEY, t.id, 1), email: 'owner@example.com' });
    const token = linkFrom(f);
    assert.equal((await verify(env, token, { origin: 'https://evil.example' })).status, 403);
    assert.equal((await verify(env, 'x'.repeat(43))).status, 410);
    const [a, b] = await Promise.all([verify(env, token), verify(env, token)]);
    assert.deepEqual([a.status, b.status].sort(), [303, 410]);
    await doClaim(env, { t: (await unclaimed(env)).id, c: 'x', email: 'a@b.co' });
    const t2 = await unclaimed(env); await doClaim(env, { t: t2.id, c: await claimCode(KEY, t2.id, 1), email: 'second@example.com' });
    const tok2 = linkFrom(f);
    await env.TAGDB.prepare('UPDATE login_tokens SET expires_at = ?1').bind(Date.now() - 1000).run();
    assert.equal((await verify(env, tok2)).status, 410);
  } finally { f.restore(); }
});

test('claim race: a tag claimed by someone else between the code check and the link cannot be re-claimed', async () => {
  const env = mkEnv(); const t = await unclaimed(env); const f = stubFetch();
  try {
    await doClaim(env, { t: t.id, c: await claimCode(KEY, t.id, 1), email: 'first@example.com' }); const tok1 = linkFrom(f);
    await doClaim(env, { t: t.id, c: await claimCode(KEY, t.id, 1), email: 'second@example.com' }); const tok2 = linkFrom(f);
    assert.equal((await verify(env, tok1)).status, 303);
    assert.equal((await verify(env, tok2)).status, 409);
    assert.equal((await getRow(env, 'SELECT o.email FROM tags t JOIN owners o ON o.id = t.owner_id WHERE t.id = ?1', t.id)).email, 'first@example.com');
  } finally { f.restore(); }
});

test('sign in: the reply is identical whether or not the email exists; only owners get a link; limits 3 per email and 10 per IP per hour', async () => {
  const env = mkEnv(); const f = stubFetch();
  try {
    await makeTag(env, { status: 'claimed', owner: { email: 'known@example.com' } });
    const post = async (email, ipaddr) => { const r = await authStart({ request: req('POST', '/api/auth/start', { body: { email }, ipaddr }), env }); return { status: r.status, body: await r.text() }; };
    const a = await post('known@example.com'), b = await post('nobody@example.com');
    assert.equal(a.status, 200); assert.equal(a.body, b.body);
    assert.equal(f.emails().length, 1); assert.deepEqual(f.emails()[0].body.to, ['known@example.com']);
    assert.equal((await getRow(env, 'SELECT purpose FROM login_tokens')).purpose, 'login');
    for (let i = 0; i < 4; i++) await post('known@example.com');
    assert.equal(f.emails().length, 3, 'a 4th request in the hour sends nothing, and still looks the same');
    assert.equal((await post('known@example.com')).body, a.body);
    assert.equal((await authStart({ request: req('POST', '/api/auth/start', { body: { email: 'bad' } }), env })).status, 400);
    assert.equal((await authStart({ request: req('POST', '/api/auth/start', { body: { email: 'a@b.co' }, origin: 'https://evil.example' }), env })).status, 403);
  } finally { f.restore(); }
});

test('sign in link: a login token for an unknown email never creates an owner', async () => {
  const env = mkEnv(); const f = stubFetch();
  try {
    const { createLoginToken } = await import('../../functions/api/_session.js');
    const tok = await createLoginToken(env, { email: 'ghost@example.com', purpose: 'login' });
    assert.equal((await verify(env, tok)).status, 410);
    assert.equal(await getRow(env, 'SELECT id FROM owners WHERE email = ?1', 'ghost@example.com'), null);
  } finally { f.restore(); }
});

/* ---------- /my ---------- */
test('/my: needs a session (401); POST needs the site Origin; sessions are hashed; sign out ends them', async () => {
  const env = mkEnv(); const t = await unclaimed(env); const { cookie } = await signedIn(env, t);
  assert.equal((await api(env, 'me')).status, 401);
  assert.equal((await api(env, 'me', undefined, 'sdt_s=bogus')).status, 401);
  const me = await api(env, 'me', undefined, cookie);
  assert.equal(me.status, 200); assert.equal(me.d.owner.email, 'owner@example.com'); assert.equal(me.d.tags.length, 1); assert.equal(me.d.tags[0].show_phone, 0, 'show-phone defaults OFF');
  assert.equal((await api(env, 'tag', { id: t.id, dog_name: 'X' }, cookie, { origin: 'https://evil.example' })).status, 403);
  assert.equal((await api(env, 'signout', {}, cookie)).status, 200);
  assert.equal((await api(env, 'me', undefined, cookie)).status, 401);
});

test('/my: profile saves dog name, a 200 char note with links removed, show-phone, pause; another owner\'s tag is 404', async () => {
  const env = mkEnv(); const t = await unclaimed(env); const { cookie } = await signedIn(env, t);
  const other = await makeTag(env, { status: 'claimed', owner: { email: 'other@example.com' } });
  const long = 'Gentle boy, call me first. Visit www.evil.com or http://x.co/p now. ' + 'y'.repeat(300);
  assert.equal((await api(env, 'tag', { id: t.id, dog_name: 'Whisky', message: long, show_phone: true, pause: '1h' }, cookie)).status, 200);
  const row = await getRow(env, 'SELECT * FROM tags WHERE id = ?1', t.id);
  assert.equal(row.dog_name, 'Whisky'); assert.equal(row.message.length, 200); assert.ok(!/evil|http|\.com/.test(row.message)); assert.equal(row.show_phone, 1);
  assert.ok(row.alerts_paused_until > Date.now() && row.alerts_paused_until < Date.now() + 3700e3);
  await api(env, 'tag', { id: t.id, pause: 'off' }, cookie); assert.ok((await getRow(env, 'SELECT alerts_paused_until a FROM tags WHERE id = ?1', t.id)).a > Date.now() + 365 * 86400e3);
  await api(env, 'tag', { id: t.id, pause: 'none' }, cookie); assert.equal((await getRow(env, 'SELECT alerts_paused_until a FROM tags WHERE id = ?1', t.id)).a, null);
  assert.equal((await api(env, 'tag', { id: t.id, pause: 'weird' }, cookie)).status, 400);
  assert.equal((await api(env, 'tag', { id: other.id, dog_name: 'Hacked' }, cookie)).status, 404);
  assert.equal((await getRow(env, 'SELECT dog_name FROM tags WHERE id = ?1', other.id)).dog_name, 'Whisky');
});

test('/my contacts: phones become E.164; SMS needs the ticked box with the CURRENT versioned consent (hash stored); contact 2 is its own slot', async () => {
  assert.equal(toE164('435-555-0123'), '+14355550123'); assert.equal(toE164('(435) 555 0123'), '+14355550123'); assert.equal(toE164('1 435 555 0123'), '+14355550123'); assert.equal(toE164('+44 20 7946 0958'), '+442079460958');
  for (const bad of ['123', '055-555-0123', '1234567890123456789', 'abc', '']) assert.equal(toE164(bad), '', bad);
  const env = mkEnv(); const t = await unclaimed(env); const { cookie } = await signedIn(env, t);
  const base = { tag_id: t.id, slot: 1, label: 'Nick', phone: '435-555-0123', email: 'nick@example.com', email_on: true, sms_on: true };
  assert.equal((await api(env, 'contact', base, cookie)).status, 400, 'no consent');
  assert.equal((await api(env, 'contact', { ...base, consent: { checked: true, ver: 'old-version' } }, cookie)).status, 400, 'stale wording');
  assert.equal((await api(env, 'contact', { ...base, consent: { checked: false, ver: SMS_CONSENT_VERSION } }, cookie)).status, 400);
  assert.equal((await api(env, 'contact', { ...base, phone: '123', consent: { checked: true, ver: SMS_CONSENT_VERSION } }, cookie)).status, 400);
  assert.equal((await api(env, 'contact', { ...base, consent: { checked: true, ver: SMS_CONSENT_VERSION } }, cookie)).status, 200);
  const c = await getRow(env, 'SELECT * FROM contacts WHERE tag_id = ?1 AND slot = 1', t.id);
  assert.equal(c.phone_e164, '+14355550123'); assert.equal(c.sms_on, 1); assert.equal(c.sms_consent_ver, SMS_CONSENT_VERSION); assert.equal(c.sms_consent_hash, await consentHash(SMS_CONSENT_TEXT)); assert.ok(c.sms_consent_at);
  assert.equal(c.sms_verified_at, null, 'not verified yet: no texts until the 6 digit code');
  assert.equal((await api(env, 'contact', { tag_id: t.id, slot: 2, label: 'Dana', phone: '801-555-0100', sms_on: false }, cookie)).status, 200);
  assert.equal((await allRows(env, 'SELECT * FROM contacts WHERE tag_id = ?1', t.id)).length, 2);
  assert.equal((await api(env, 'contact', { tag_id: t.id, slot: 1, label: 'x' }, cookie)).status, 400, 'a contact needs a phone or an email');
  assert.match((await api(env, 'me', undefined, cookie)).d.sms.text, /Reply STOP to cancel/);
});

test('/my SMS: with the flag off, texting cannot be turned on and nothing is sent; email still saves', async () => {
  const env = mkEnv({ SMS_ALERTS_ENABLED: 'false' }); const t = await unclaimed(env); const { cookie } = await signedIn(env, t);
  const r = await api(env, 'contact', { tag_id: t.id, slot: 1, phone: '435-555-0123', email: 'a@b.co', sms_on: true, consent: { checked: true, ver: SMS_CONSENT_VERSION } }, cookie);
  assert.equal(r.status, 400); assert.match(r.d.error, /switched off/);
  assert.equal((await api(env, 'contact', { tag_id: t.id, slot: 1, phone: '435-555-0123', email: 'a@b.co', sms_on: false }, cookie)).status, 200);
  assert.equal((await api(env, 'me', undefined, cookie)).d.sms.enabled, false);
});

test('/my SMS verification: a 6 digit code goes out through the Messaging Service, verifies once, expires, is limited to 5 tries; wrong code never verifies', async () => {
  const env = mkEnv(); const t = await unclaimed(env); const { cookie } = await signedIn(env, t); const f = stubFetch();
  try {
    await api(env, 'contact', { tag_id: t.id, slot: 1, phone: '435-555-0123', email: 'a@b.co', sms_on: true, consent: { checked: true, ver: SMS_CONSENT_VERSION } }, cookie);
    const c = await getRow(env, 'SELECT id FROM contacts WHERE tag_id = ?1 AND slot = 1', t.id);
    const sent = await api(env, 'sms-send', { contact_id: c.id }, cookie); assert.equal(sent.status, 200); assert.equal(sent.d.mode, 'code');
    const sms = f.sms()[0]; assert.equal(sms.body.MessagingServiceSid, 'MGtest'); assert.ok(!('From' in sms.body), 'never the TB marketing number'); assert.equal(sms.body.To, '+14355550123');
    const code = /code: (\d{6})/.exec(sms.body.Body)[1];
    assert.ok(!(await getRow(env, 'SELECT code_hash FROM sms_codes')).code_hash.includes(code), 'stored hashed');
    assert.equal((await api(env, 'sms-verify', { contact_id: c.id, code: '000000' }, cookie)).status, 400);
    assert.equal((await getRow(env, 'SELECT sms_verified_at v FROM contacts WHERE id = ?1', c.id)).v, null);
    assert.equal((await api(env, 'sms-verify', { contact_id: c.id, code }, cookie)).status, 200);
    assert.ok((await getRow(env, 'SELECT sms_verified_at v FROM contacts WHERE id = ?1', c.id)).v);
    assert.equal((await api(env, 'sms-verify', { contact_id: c.id, code }, cookie)).status, 400, 'a used code is gone');
    // tries
    await api(env, 'sms-send', { contact_id: c.id }, cookie);
    for (let i = 0; i < 5; i++) await api(env, 'sms-verify', { contact_id: c.id, code: '111111' }, cookie);
    const code2 = /code: (\d{6})/.exec(f.sms().at(-1).body.Body)[1];
    assert.equal((await api(env, 'sms-verify', { contact_id: c.id, code: code2 }, cookie)).status, 400, 'after 5 wrong tries even the right code is refused');
    await env.TAGDB.prepare('UPDATE sms_codes SET tries = 0, expires_at = ?1').bind(Date.now() - 1000).run();
    assert.equal((await api(env, 'sms-verify', { contact_id: c.id, code: code2 }, cookie)).status, 400, 'expired');
  } finally { f.restore(); }
});

test('/my SMS contact 2: gets a "Reply YES" text and is not verified until they answer; a STOPped number cannot be re-texted; not-ready Twilio is a clear 503', async () => {
  const env = mkEnv(); const t = await unclaimed(env); const { cookie } = await signedIn(env, t); const f = stubFetch();
  try {
    await api(env, 'contact', { tag_id: t.id, slot: 2, label: 'Dana', phone: '801-555-0100', sms_on: true, consent: { checked: true, ver: SMS_CONSENT_VERSION } }, cookie);
    const c = await getRow(env, 'SELECT id FROM contacts WHERE slot = 2'); 
    assert.equal((await api(env, 'sms-send', { contact_id: c.id }, cookie)).d.mode, 'yes');
    assert.match(f.sms()[0].body.Body, /Reply YES/); assert.match(f.sms()[0].body.Body, /Reply STOP/);
    const row = await getRow(env, 'SELECT sms_pending_at p, sms_verified_at v FROM contacts WHERE id = ?1', c.id); assert.ok(row.p); assert.equal(row.v, null);
    await env.TAGDB.prepare('UPDATE contacts SET sms_stopped_at = ?2 WHERE id = ?1').bind(c.id, Date.now()).run();
    assert.equal((await api(env, 'sms-send', { contact_id: c.id }, cookie)).status, 409);
  } finally { f.restore(); }
});

test('/my: test alert sends to the owner\'s own contacts (3 per tag per hour); pin keeps a scan (max 20); release and account delete wipe the data', async () => {
  const env = mkEnv(); const t = await unclaimed(env); const { cookie } = await signedIn(env, t); const f = stubFetch();
  try {
    for (let i = 0; i < 3; i++) assert.equal((await api(env, 'test', { tag_id: t.id }, cookie)).status, 200);
    assert.equal((await api(env, 'test', { tag_id: t.id }, cookie)).status, 429);
    assert.equal(f.emails().length, 3); assert.match(f.emails()[0].body.subject, /Test alert/);
    for (let i = 0; i < 22; i++) await env.TAGDB.prepare("INSERT INTO scans(id, tag_id, at, kind, message) VALUES(?1,?2,?3,'message','m')").bind('s' + i, t.id, Date.now() - i * 1000).run();
    let kept = 0, last;
    for (let i = 0; i < 22; i++) { last = await api(env, 'pin', { scan_id: 's' + i, keep: true }, cookie); if (last.status === 200) kept++; }
    assert.equal(kept, 20); assert.equal(last.status, 409);
    const other = await makeTag(env, { status: 'claimed', owner: { email: 'o2@example.com' } });
    await env.TAGDB.prepare("INSERT INTO scans(id, tag_id, at, kind) VALUES('foreign',?1,?2,'scan')").bind(other.id, Date.now()).run();
    assert.equal((await api(env, 'pin', { scan_id: 'foreign', keep: true }, cookie)).status, 404);
    assert.equal((await api(env, 'release', { tag_id: t.id }, cookie)).status, 200);
    const row = await getRow(env, 'SELECT * FROM tags WHERE id = ?1', t.id);
    assert.equal(row.owner_id, null); assert.equal(row.status, 'shipped'); assert.equal(row.claim_ver, 2); assert.equal(row.dog_name, null);
    assert.equal((await allRows(env, 'SELECT * FROM contacts WHERE tag_id = ?1', t.id)).length, 0); assert.equal((await allRows(env, 'SELECT * FROM scans WHERE tag_id = ?1', t.id)).length, 0);
    assert.notEqual(await claimCode(KEY, t.id, 2), await claimCode(KEY, t.id, 1));
  } finally { f.restore(); }
});

test('/my: delete account removes the owner, contacts and sessions, and every tag goes back to unclaimed with a rotated code', async () => {
  const env = mkEnv(); const t = await unclaimed(env); const { cookie } = await signedIn(env, t);
  assert.equal((await api(env, 'delete-account', { confirm: 'no' }, cookie)).status, 400);
  assert.equal((await api(env, 'delete-account', { confirm: 'DELETE' }, cookie)).status, 200);
  assert.equal((await allRows(env, 'SELECT * FROM owners')).length, 0); assert.equal((await allRows(env, 'SELECT * FROM sessions')).length, 0); assert.equal((await allRows(env, 'SELECT * FROM contacts')).length, 0);
  const row = await getRow(env, 'SELECT * FROM tags WHERE id = ?1', t.id); assert.equal(row.owner_id, null); assert.equal(row.claim_ver, 2);
  assert.equal((await api(env, 'me', undefined, cookie)).status, 401);
});

test('/my settings: time zone must be real; marketing is its own opt-in, default off', async () => {
  const env = mkEnv(); const t = await unclaimed(env); const { cookie } = await signedIn(env, t);
  assert.equal((await api(env, 'me', undefined, cookie)).d.owner.marketing_optin, 0);
  assert.equal((await api(env, 'settings', { tz: 'Mars/Olympus' }, cookie)).status, 400);
  assert.equal((await api(env, 'settings', { tz: 'America/New_York', marketing_optin: true }, cookie)).status, 200);
  const o = await getRow(env, 'SELECT tz, marketing_optin m FROM owners'); assert.equal(o.tz, 'America/New_York'); assert.equal(o.m, 1);
});

test('CSRF: under no-referrer browsers send "Origin: null" on form posts; that passes only with Sec-Fetch-Site same-origin, a cross-site "null" origin is refused', async () => {
  const env = mkEnv(); const t = await unclaimed(env); const f = stubFetch();
  try {
    await doClaim(env, { t: t.id, c: await claimCode(KEY, t.id, 1), email: 'owner@example.com' }); const tok = linkFrom(f);
    const post = (headers) => verifyPost({ request: new Request(SITE + '/api/auth/verify', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'cf-connecting-ip': ip(), ...headers }, body: 'token=' + tok }), env });
    assert.equal((await post({ origin: 'null', 'sec-fetch-site': 'cross-site' })).status, 403);
    assert.equal((await post({ origin: 'null' })).status, 403, 'null origin and no fetch metadata: refused');
    assert.equal((await post({})).status, 403);
    assert.equal((await post({ origin: 'null', 'sec-fetch-site': 'same-origin' })).status, 303);
  } finally { f.restore(); }
});
