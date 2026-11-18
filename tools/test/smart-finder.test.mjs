// node --test tools/test/  Smart QR tag task 11: finder page, beacon scan counting, bot filter, location, message, unclaimed, rate limits.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { onRequest as finder } from '../../functions/t/[id].js';
import { onRequestPost as scan } from '../../functions/api/tag/scan.js';
import { onRequestPost as location } from '../../functions/api/tag/location.js';
import { onRequestPost as message } from '../../functions/api/tag/message.js';
import { LOC_CONSENT_VERSION } from '../../functions/api/_tagsettings.js';
import { _resetSpeedBumps } from '../../functions/api/_ratelimit.js';
import { mkEnv, makeTag, req, stubFetch, nonceFor, getRow, allRows, sessionCookieFor, ip, KEY } from './_smartenv.mjs';
import { scanNonce } from '../../functions/api/_tagid.js';

const page = async (env, id, over = {}) => { const r = await finder({ request: req('GET', '/t/' + id, over), env, params: { id } }); return { status: r.status, h: r.headers, body: await r.text() }; };
const claimedOwner = { owner: { email: 'owner@example.com' }, status: 'claimed', contacts: [{ slot: 1, email: 'owner@example.com' }] };

test('page: claimed state shows name, owner note, message form, location button; CSP self only; noindex; no cookies; no third parties', async () => {
  const env = mkEnv(); const t = await makeTag(env, { ...claimedOwner, dog: 'Whisky', message: 'Friendly but shy.' });
  const r = await page(env, t.id.toLowerCase());
  assert.equal(r.status, 200);
  assert.match(r.body, /<h1>Whisky<\/h1>/); assert.match(r.body, /Friendly but shy\./); assert.match(r.body, /Message my family/); assert.match(r.body, /Share my location/);
  assert.match(r.body, /Any vet or shelter can check for a microchip/); assert.match(r.body, /never ask you for money or a code/);
  assert.match(r.body, /Call the number on the back of this tag/);
  assert.equal(r.h.get('content-security-policy'), "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'");
  assert.match(r.h.get('x-robots-tag'), /noindex/); assert.equal(r.h.get('referrer-policy'), 'no-referrer'); assert.equal(r.h.get('set-cookie'), null);
  assert.equal(r.h.get('x-sdt-finder'), '1'); assert.match(r.h.get('permissions-policy'), /geolocation=\(self\)/);
  assert.ok(!/https?:\/\/(?!saltydogtags)/.test(r.body.replace(/https?:\/\/(www\.)?w3\.org/g, '')), 'no third-party URLs in the page');
  assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>/.test(r.body), 'no inline script (CSP)');
  assert.ok(!/style=/.test(r.body), 'no inline style (CSP)');
  assert.ok(!r.body.includes('owner@example.com'), 'never the owner email');
});

test('page: the upper case QR payload id, with O/I/L misreads, resolves the same tag', async () => {
  const env = mkEnv(); const t = await makeTag(env, { ...claimedOwner, id: 'ABCDEFGH1K' });
  assert.match((await page(env, 'abcdefgh1k')).body, /Whisky/);
  assert.match((await page(env, 'ABCDEFGHIK')).body, /Whisky/, 'I reads as 1');
});

test('page: the phone is hidden unless the owner turned show-phone on; then tel: and sms: links appear', async () => {
  const env = mkEnv();
  const a = await makeTag(env, { ...claimedOwner, contacts: [{ slot: 1, phone: '+14355550123', email: 'o@example.com' }] });
  const b = await makeTag(env, { ...claimedOwner, show_phone: true, contacts: [{ slot: 1, phone: '+14355550123', email: 'o@example.com' }] });
  const pa = (await page(env, a.id)).body, pb = (await page(env, b.id)).body;
  assert.ok(!pa.includes('435') && !pa.includes('tel:'));
  assert.match(pb, /href="tel:\+14355550123"/); assert.match(pb, /href="sms:\+14355550123"/);
});

test('page: unclaimed tag says it is not set up and offers the message form; unknown, disabled and malformed ids all return the SAME generic page (200)', async () => {
  const env = mkEnv(); const u = await makeTag(env, { status: 'shipped', owner: null });
  const un = await page(env, u.id);
  assert.match(un.body, /isn&rsquo;t set up yet/); assert.match(un.body, /data-state="unclaimed"/);
  const d = await makeTag(env, { status: 'disabled', owner: null });
  const a = await page(env, d.id), b = await page(env, 'ZZZZZZZZZZ'), c = await page(env, 'not-an-id');
  assert.equal(a.status, 200); assert.equal(b.status, 200); assert.equal(c.status, 200);
  assert.equal(a.body, b.body); assert.equal(b.body, c.body);
  assert.match(a.body, /Call the number on the back of this tag/); assert.ok(!/data-t=/.test(a.body), 'no beacon data on the generic page');
});

test('page: D1 down shows the generic "call the number" page, never an error', async () => {
  const env = mkEnv(); const t = await makeTag(env, claimedOwner);
  env.TAGDB.failNext(1);
  const r = await page(env, t.id); assert.equal(r.status, 200); assert.match(r.body, /Call the number on the back of this tag/); assert.ok(!r.body.includes('Whisky'));
  const noDb = await page(mkEnv({ TAGDB: undefined }), t.id); assert.equal(noDb.status, 200);
});

test('page: misses are limited to 30 per IP per hour, then a 429 page; real tags are not counted', async () => {
  const env = mkEnv(); const real = await makeTag(env, claimedOwner); _resetSpeedBumps();
  const o = { ipaddr: '203.0.113.77' };
  for (let i = 0; i < 30; i++) assert.equal((await page(env, 'ZZZZZZZZ' + (10 + i), o)).status, 200);
  const r = await page(env, 'ZZZZZZZZ99', o); assert.equal(r.status, 429); assert.match(r.body, /Too many tries/);
  assert.equal((await page(env, 'ZZZZZZZZ99', { ipaddr: '203.0.113.78' })).status, 200, 'other networks unaffected');
  for (let i = 0; i < 40; i++) assert.equal((await page(env, real.id, { ipaddr: '203.0.113.90' })).status, 200);
});

test('page: only GET and HEAD', async () => {
  const env = mkEnv(); const t = await makeTag(env, claimedOwner);
  const r = await finder({ request: req('POST', '/t/' + t.id, { body: '{}' }), env, params: { id: t.id } });
  assert.equal(r.status, 405);
});

/* ---------- the beacon ---------- */
const beacon = async (env, id, over = {}) => {
  const n = over.n === undefined ? await nonceFor(id) : over.n;
  const r = await scan({ request: req('POST', '/api/tag/scan', { body: { t: id, n }, ...over.req }), env });
  return { status: r.status, d: await r.json() };
};

test('beacon: a GET of the page alone never alerts or counts; the beacon does (claimed: one alert by email)', async () => {
  const env = mkEnv(); const t = await makeTag(env, claimedOwner); const f = stubFetch();
  try {
    await page(env, t.id);
    assert.equal((await allRows(env, 'SELECT * FROM scans')).length, 0); assert.equal(f.emails().length, 0);
    const r = await beacon(env, t.id);
    assert.equal(r.d.counted, true); assert.equal(r.d.alerted, true);
    assert.equal(f.emails().length, 1); assert.match(f.emails()[0].body.subject, /Whisky's tag was scanned/);
    assert.equal((await allRows(env, "SELECT * FROM scans WHERE kind = 'scan'")).length, 1);
  } finally { f.restore(); }
});

test('beacon: refused without the page-issued nonce, too fresh (under 1 s), stale, forged, for another tag, or from another origin', async () => {
  const env = mkEnv(); const t = await makeTag(env, claimedOwner); const o = await makeTag(env, claimedOwner); const f = stubFetch();
  try {
    for (const n of ['', 'junk', await nonceFor(t.id, Date.now() - 100), await nonceFor(t.id, Date.now() - 8 * 3600e3), await nonceFor(o.id), (await nonceFor(t.id)).slice(0, -1) + '!']) {
      const r = await beacon(env, t.id, { n }); assert.equal(r.d.counted, false, String(n).slice(0, 20));
    }
    const x = await scan({ request: req('POST', '/api/tag/scan', { body: { t: t.id, n: await nonceFor(t.id) }, origin: 'https://evil.example' }), env });
    assert.equal(x.status, 403);
    assert.equal((await allRows(env, 'SELECT * FROM scans')).length, 0); assert.equal(f.emails().length, 0);
    assert.equal((await beacon(mkEnv({ TAG_CLAIM_KEY: '' }), t.id, { n: await nonceFor(t.id) })).d.counted, false, 'no key means no nonces: fail closed');
  } finally { f.restore(); }
});

test('beacon: link previewers, crawlers and scripts are not counted (bot filter), real phones are', async () => {
  const env = mkEnv(); const t = await makeTag(env, claimedOwner); const f = stubFetch();
  try {
    for (const ua of ['Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)', 'facebookexternalhit/1.1', 'WhatsApp/2.23', 'Slackbot-LinkExpanding 1.0', 'Twitterbot/1.0', 'curl/8.1', 'python-requests/2.31', 'Mozilla/5.0 HeadlessChrome/120', 'Mozilla/5.0 (Macintosh) AppleWebKit/605 LinkPresentation', 'Applebot/0.1', 'Discordbot/2.0', '']) {
      const r = await beacon(env, t.id, { req: { ua, ipaddr: ip() } });
      assert.equal(r.d.counted, false, ua);
    }
    assert.equal((await allRows(env, 'SELECT * FROM scans')).length, 0);
    assert.equal((await beacon(env, t.id, { req: { ipaddr: ip() } })).d.counted, true);
  } finally { f.restore(); }
});

test('beacon: burst dedupe (one alert per 10 min burst, later scans only raise the count); a new burst alerts again; counts toward the total', async () => {
  const env = mkEnv(); const t = await makeTag(env, claimedOwner); const f = stubFetch();
  try {
    const a = await beacon(env, t.id, { req: { ipaddr: ip() } }), b = await beacon(env, t.id, { req: { ipaddr: ip() } }), c = await beacon(env, t.id, { req: { ipaddr: ip() } });
    assert.equal(a.d.alerted, true); assert.equal(b.d.alerted, false); assert.equal(c.d.alerted, false);
    assert.equal(f.emails().length, 1); assert.equal((await allRows(env, "SELECT * FROM scans WHERE kind = 'scan'")).length, 3);
    await env.TAGDB.prepare('UPDATE tags SET burst_at = ?2 WHERE id = ?1').bind(t.id, Date.now() - 11 * 60e3).run();   // the burst ended
    const d = await beacon(env, t.id, { req: { ipaddr: ip() } });
    assert.equal(d.d.alerted, true); assert.equal(f.emails().length, 2); assert.match(f.emails()[1].body.text, /4 scans so far/);
  } finally { f.restore(); }
});

test('beacon: limits are 1 counted per IP per tag per 10 min, 20 per IP per hour', async () => {
  const env = mkEnv(); const a = await makeTag(env, claimedOwner); const f = stubFetch();
  try {
    const o = { req: { ipaddr: '203.0.113.5' } };
    assert.equal((await beacon(env, a.id, o)).d.counted, true);
    assert.equal((await beacon(env, a.id, o)).d.counted, false, 'same IP, same tag, within 10 min');
    let last;
    for (let i = 0; i < 25; i++) { const t = await makeTag(env, claimedOwner); last = await beacon(env, t.id, o); }
    assert.equal(last.status, 429, '20 per IP per hour');
  } finally { f.restore(); }
});

test('beacon: unclaimed tags count but notify nobody; the signed-in owner\'s own scan counts but never alerts; paused tags stay quiet; disabled is ignored', async () => {
  const env = mkEnv(); const f = stubFetch();
  try {
    const u = await makeTag(env, { status: 'shipped', owner: null, buyer_email: 'buyer@example.com' });
    assert.equal((await beacon(env, u.id)).d.alerted, false); assert.equal(f.emails().length, 0);
    const t = await makeTag(env, claimedOwner);
    const cookie = await sessionCookieFor(env, t.ownerId);
    const own = await beacon(env, t.id, { req: { headers: { cookie }, ipaddr: ip() } });
    assert.equal(own.d.counted, true); assert.equal(own.d.alerted, false); assert.equal(f.emails().length, 0);
    assert.equal((await getRow(env, 'SELECT by_owner FROM scans WHERE tag_id = ?1', t.id)).by_owner, 1);
    const p = await makeTag(env, { ...claimedOwner, paused: Date.now() + 3600e3 });
    assert.equal((await beacon(env, p.id)).d.alerted, false);
    const d = await makeTag(env, { status: 'disabled', owner: null });
    assert.equal((await beacon(env, d.id)).d.counted, false);
    assert.equal(f.emails().length, 0);
  } finally { f.restore(); }
});

test('beacon: an engraved, unshipped tag sets native_scan_seen_at (the iPhone camera QC check) and QC passes once the in-page decode is also done', async () => {
  const env = mkEnv(); const t = await makeTag(env, { status: 'engraved', owner: null });
  await env.TAGDB.prepare('UPDATE tags SET qc_decode_at = ?2 WHERE id = ?1').bind(t.id, Date.now()).run();
  assert.equal((await beacon(env, t.id)).d.counted, true);
  const row = await getRow(env, 'SELECT status, native_scan_seen_at FROM tags WHERE id = ?1', t.id);
  assert.ok(row.native_scan_seen_at); assert.equal(row.status, 'qc_pass');
  const shipped = await makeTag(env, { status: 'shipped', owner: null });
  await beacon(env, shipped.id, { req: { ipaddr: ip() } });
  assert.equal((await getRow(env, 'SELECT native_scan_seen_at FROM tags WHERE id = ?1', shipped.id)).native_scan_seen_at, null, 'shipped tags do not set the marker');
});

test('beacon: purges that tag\'s expired rows on each new scan (30 days, kept rows stay)', async () => {
  const env = mkEnv(); const t = await makeTag(env, claimedOwner); const f = stubFetch();
  try {
    const old = Date.now() - 31 * 86400e3;
    await env.TAGDB.prepare("INSERT INTO scans(id, tag_id, at, kind, message, keep) VALUES('old1',?1,?2,'message','x',0),('old2',?1,?2,'message','y',1)").bind(t.id, old).run();
    await beacon(env, t.id);
    const ids = (await allRows(env, 'SELECT id FROM scans WHERE tag_id = ?1', t.id)).map((r) => r.id);
    assert.ok(!ids.includes('old1')); assert.ok(ids.includes('old2'));
  } finally { f.restore(); }
});

/* ---------- location ---------- */
const loc = async (env, id, body, over = {}) => { const r = await location({ request: req('POST', '/api/tag/location', { body: { t: id, n: await nonceFor(id), ...body }, ...over }), env }); return { status: r.status, d: await r.json() }; };

test('location: needs the consent version with coordinates; coordinates are rounded; first location in a burst alerts with map links and "within N m"', async () => {
  const env = mkEnv(); const t = await makeTag(env, claimedOwner); const f = stubFetch();
  try {
    assert.equal((await loc(env, t.id, { lat: 40.3916, lng: -111.8508, accuracy: 18 })).status, 400, 'no consent');
    assert.equal((await loc(env, t.id, { lat: 100, lng: 0, consent: LOC_CONSENT_VERSION })).status, 400);
    assert.equal((await loc(env, t.id, { lat: 'x', lng: 0, consent: LOC_CONSENT_VERSION })).status, 400, 'nothing valid to send');
    const r = await loc(env, t.id, { lat: 40.391612345, lng: -111.850812345, accuracy: 17.6, consent: LOC_CONSENT_VERSION });
    assert.equal(r.d.alerted, true);
    const row = await getRow(env, "SELECT * FROM scans WHERE kind = 'location'");
    assert.equal(row.lat, 40.39161); assert.equal(row.lng, -111.85081); assert.equal(row.loc_consent_ver, LOC_CONSENT_VERSION); assert.equal(row.accuracy_m, 18);
    const body = f.emails()[0].body;
    assert.match(body.text, /maps\.apple\.com\/\?ll=40\.39161,-111\.85081/); assert.match(body.text, /google\.com\/maps/); assert.match(body.text, /within 18 m/);
    assert.ok(!/reverse|address/i.test(body.text), 'no reverse geocoding');
  } finally { f.restore(); }
});

test('location: later locations in the burst alert only when the finder moved more than 250 m, at most 3 per burst', async () => {
  const env = mkEnv(); const t = await makeTag(env, claimedOwner); const f = stubFetch();
  try {
    const go = (lat, lng) => loc(env, t.id, { lat, lng, accuracy: 10, consent: LOC_CONSENT_VERSION }, { ipaddr: ip() });
    assert.equal((await go(40.0, -111.0)).d.alerted, true);
    assert.equal((await go(40.0005, -111.0)).d.alerted, false, '55 m');
    assert.equal((await go(40.01, -111.0)).d.alerted, true, '1.1 km');
    assert.equal((await go(40.02, -111.0)).d.alerted, true);
    assert.equal((await go(40.03, -111.0)).d.alerted, false, 'a 4th in one burst');
    assert.equal(f.emails().length, 3);
  } finally { f.restore(); }
});

test('location: a typed place works without coordinates and no consent; limited to 6 per IP per tag per hour', async () => {
  const env = mkEnv(); const t = await makeTag(env, claimedOwner); const f = stubFetch();
  try {
    const r = await loc(env, t.id, { place: 'Main St and 200 N, near the gas station' }, { ipaddr: '203.0.113.9' });
    assert.equal(r.d.alerted, true); assert.match(f.emails()[0].body.text, /They typed: "Main St and 200 N/);
    let last; for (let i = 0; i < 7; i++) last = await loc(env, t.id, { place: 'again ' + i }, { ipaddr: '203.0.113.9' });
    assert.equal(last.status, 429);
  } finally { f.restore(); }
});

/* ---------- message ---------- */
const msg = async (env, id, body, over = {}) => { const r = await message({ request: req('POST', '/api/tag/message', { body: { t: id, n: await nonceFor(id), ...body }, ...over }), env }); return { status: r.status, d: await r.json() }; };

test('message: alerts the owner with links removed, length capped, scam keywords flagged, finder reply included, "never send money" footer', async () => {
  const env = mkEnv(); const t = await makeTag(env, claimedOwner); const f = stubFetch();
  try {
    const r = await msg(env, t.id, { message: 'I have your dog! Send a $50 reward by Zelle to http://evil.example/pay or www.scam.com first. ' + 'x'.repeat(400), reply: 'call 801-555-0100 or evil.com' });
    assert.equal(r.d.sent, true);
    const row = await getRow(env, "SELECT * FROM scans WHERE kind = 'message'");
    assert.ok(!/evil|scam|http/i.test(row.message)); assert.ok(row.message.length <= 300); assert.ok(!/evil\.com/.test(row.finder_reply));
    const t0 = f.emails()[0].body.text;
    assert.match(t0, /Careful: this message mentions money/); assert.match(t0, /Never send money or read a code to a finder\./); assert.match(t0, /How to reach them: "call 801-555-0100/);
  } finally { f.restore(); }
});

test('message: the finder\'s text is HTML-escaped in the email', async () => {
  const env = mkEnv(); const t = await makeTag(env, claimedOwner); const f = stubFetch();
  try {
    await msg(env, t.id, { message: '<script>alert(1)</script> <img src=x onerror=1> found him' });
    const h = f.emails()[0].body.html;
    assert.ok(!h.includes('<script>') && !h.includes('<img')); assert.match(h, /&lt;script&gt;/);
  } finally { f.restore(); }
});

test('message: limits 5 per IP per hour and 3 per IP per tag per day; honeypot is silent; empty and link-only messages are refused', async () => {
  const env = mkEnv(); const t = await makeTag(env, claimedOwner); const f = stubFetch();
  try {
    const o = { ipaddr: '203.0.113.20' };
    for (let i = 0; i < 3; i++) assert.equal((await msg(env, t.id, { message: 'hello ' + i }, o)).status, 200);
    assert.equal((await msg(env, t.id, { message: 'hello 4' }, o)).status, 429, '3 per IP per tag per day');
    assert.equal((await msg(env, t.id, { message: 'x', website: 'bot' }, { ipaddr: '203.0.113.21' })).d.sent, true);
    assert.equal((await msg(env, t.id, { message: 'https://evil.example' }, { ipaddr: '203.0.113.22' })).status, 400);
    assert.equal((await msg(env, t.id, { message: '  ' }, { ipaddr: '203.0.113.22' })).status, 400);
    assert.equal(f.emails().length, 3);
  } finally { f.restore(); }
});

test('message: each message alerts up to 5 per tag per hour; the rest queue for the email digest', async () => {
  const env = mkEnv(); const t = await makeTag(env, claimedOwner); const f = stubFetch();
  try {
    for (let i = 0; i < 7; i++) await msg(env, t.id, { message: 'msg ' + i }, { ipaddr: ip() });
    assert.equal(f.emails().length, 5);
    assert.equal((await allRows(env, "SELECT * FROM alerts WHERE kind = 'digest' AND status = 'queued'")).length, 2);
  } finally { f.restore(); }
});

test('unclaimed message: forwards to the buyer\'s email, at most 1 per tag per 24 h, with an activation nudge; no contact data of anyone else leaks', async () => {
  const env = mkEnv(); const t = await makeTag(env, { status: 'shipped', owner: null, buyer_email: 'buyer@example.com' }); const f = stubFetch();
  try {
    const a = await msg(env, t.id, { message: 'found your dog by the park' }, { ipaddr: ip() });
    assert.equal(a.d.delivered, true);
    const e = f.emails()[0].body; assert.deepEqual(e.to, ['buyer@example.com']); assert.match(e.text, /Activate the tag with the code on your packing slip/);
    const b = await msg(env, t.id, { message: 'second message' }, { ipaddr: ip() });
    assert.equal(b.d.delivered, false); assert.equal(f.emails().length, 1);
    await env.TAGDB.prepare('UPDATE tags SET unclaimed_notified_at = ?2 WHERE id = ?1').bind(t.id, Date.now() - 25 * 3600e3).run();
    assert.equal((await msg(env, t.id, { message: 'third' }, { ipaddr: ip() })).d.delivered, true);
  } finally { f.restore(); }
});

test('message and location: no D1 is a 503, never a crash, and unknown ids look like success', async () => {
  const env = mkEnv(); const t = await makeTag(env, claimedOwner);
  const r = await message({ request: req('POST', '/api/tag/message', { body: { t: t.id, n: await nonceFor(t.id), message: 'hi' } }), env: mkEnv({ TAGDB: undefined }) });
  assert.equal(r.status, 503);
  const u = await message({ request: req('POST', '/api/tag/message', { body: { t: 'ZZZZZZZZZZ', n: await nonceFor('ZZZZZZZZZZ'), message: 'hi' } }), env });
  assert.equal((await u.json()).counted, false);
});

test('beacon: scans made while the tag is unclaimed (QC, poking) do not open a burst, so the owner\'s first scan after activation still alerts', async () => {
  const env = mkEnv(); const f = stubFetch();
  try {
    const t = await makeTag(env, { status: 'engraved', owner: null });
    await beacon(env, t.id, { req: { ipaddr: ip() } }); await beacon(env, t.id, { req: { ipaddr: ip() } });
    assert.equal((await getRow(env, 'SELECT burst_at b FROM tags WHERE id = ?1', t.id)).b, null);
    const owner = await makeTag(env, { ...claimedOwner, id: t.id.replace(/./, 'A') });   // a second, claimed tag for the same shape of check
    await env.TAGDB.prepare("UPDATE tags SET status = 'claimed', owner_id = ?2 WHERE id = ?1").bind(t.id, owner.ownerId).run();
    await env.TAGDB.prepare("INSERT INTO contacts(id, owner_id, tag_id, slot, email, email_on) VALUES('cc', ?2, ?1, 1, 'o@example.com', 1)").bind(t.id, owner.ownerId).run();
    const r = await beacon(env, t.id, { req: { ipaddr: ip() } });
    assert.equal(r.d.alerted, true); assert.equal(f.emails().length, 1);
  } finally { f.restore(); }
});
