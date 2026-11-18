// node --test tools/test/  Smart QR tag, task 1 (schema) and task 2 (ids, claim HMAC, payload, nonce).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { newTagId, normalizeTagId, ID_ALPHABET, ID_RE, claimCode, claimCodeOk, normalizeClaimCode, scanNonce, scanNonceOk, tagPayload, tagDisplayUrl, b32, randomToken, sha256Hex } from '../../functions/api/_tagid.js';
import { makeD1, MIGRATIONS_DIR } from './_d1.mjs';
import { mintTag } from '../../functions/api/_tagdb.js';

const KEY = 'test-claim-key-0123456789abcdef';

test('ids: 10 chars, Crockford alphabet only (no I L O U), all draws valid', () => {
  assert.equal(ID_ALPHABET.length, 32);
  for (const bad of 'ILOU') assert.ok(!ID_ALPHABET.includes(bad));
  for (let i = 0; i < 2000; i++) { const id = newTagId(); assert.match(id, ID_RE); assert.equal(id.length, 10); }
});

test('ids: no modulo bias, every symbol appears about equally often (32 symbols, 160k draws)', () => {
  const n = {}; for (const c of ID_ALPHABET) n[c] = 0;
  for (let i = 0; i < 16000; i++) for (const c of newTagId()) n[c]++;
  const exp = 160000 / 32;
  for (const c of ID_ALPHABET) assert.ok(Math.abs(n[c] - exp) < exp * 0.08, `${c}: ${n[c]} vs ${exp}`);
});

test('ids: ids are not sequential and carry no order data (50 draws, all different)', () => {
  assert.equal(new Set(Array.from({ length: 500 }, newTagId)).size, 500);
});

test('lookup: case-insensitive, O to 0, I and L to 1, spaces and hyphens ignored; junk is null', () => {
  assert.equal(normalizeTagId('abcdefghjk'), 'ABCDEFGHJK');
  assert.equal(normalizeTagId('0123456789'), '0123456789');
  assert.equal(normalizeTagId('O1l1I0O123'), '0111100123');
  assert.equal(normalizeTagId('ABCDE-FGHJK'), 'ABCDEFGHJK');
  for (const bad of ['', null, undefined, 'short', 'ABCDEFGHJKM', 'ABCDEFGHJ!', 'UUUUUUUUUU', '../../etc/p']) assert.equal(normalizeTagId(bad), null, String(bad));
});

test('claim code: HMAC of id:claim_ver, 12 chars shown XXXX-XXXX-XXXX, stable, never stored', async () => {
  const a = await claimCode(KEY, 'ABCDEFGHJK', 1);
  assert.match(a, /^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
  assert.equal(a, await claimCode(KEY, 'ABCDEFGHJK', 1));
  assert.notEqual(a, await claimCode(KEY, 'ABCDEFGHJK', 2), 'bumping claim_ver retires the printed code');
  assert.notEqual(a, await claimCode(KEY, 'ABCDEFGHJM', 1));
  assert.notEqual(a, await claimCode(KEY + 'x', 'ABCDEFGHJK', 1));
});

test('claim code: known vector (HMAC-SHA256, base32 Crockford, first 12 chars)', async () => {
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', await crypto.subtle.importKey('raw', new TextEncoder().encode(KEY), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']), new TextEncoder().encode('ABCDEFGHJK:1')));
  assert.equal((await claimCode(KEY, 'ABCDEFGHJK', 1)).replace(/-/g, ''), b32(mac).slice(0, 12));
});

test('claim code: verify accepts typed variants, rejects wrong, wrong version, and no key (fail closed)', async () => {
  const c = await claimCode(KEY, 'ABCDEFGHJK', 3);
  assert.equal(await claimCodeOk(KEY, 'ABCDEFGHJK', 3, c), true);
  assert.equal(await claimCodeOk(KEY, 'ABCDEFGHJK', 3, c.toLowerCase().replace(/-/g, ' ')), true);
  assert.equal(await claimCodeOk(KEY, 'ABCDEFGHJK', 4, c), false);
  assert.equal(await claimCodeOk(KEY, 'ABCDEFGHJK', 3, 'AAAA-AAAA-AAAA'), false);
  assert.equal(await claimCodeOk(KEY, 'ABCDEFGHJK', 3, ''), false);
  assert.equal(await claimCode('', 'ABCDEFGHJK', 3), '', 'no key, no codes');
  assert.equal(await claimCode('short', 'ABCDEFGHJK', 3), '');
  assert.equal(await claimCodeOk('', 'ABCDEFGHJK', 3, c), false);
  assert.equal(normalizeClaimCode('abcd-efgh-jkmn'), 'ABCDEFGHJKMN');
});

test('payload: upper case HTTPS://SALTYDOGTAGS.COM/T/<ID>, TAG_BASE_URL overrides, display url is lower case', () => {
  assert.equal(tagPayload('ABCDEFGHJK', {}), 'HTTPS://SALTYDOGTAGS.COM/T/ABCDEFGHJK');
  assert.equal(tagPayload('abcdefghjk', {}), 'HTTPS://SALTYDOGTAGS.COM/T/ABCDEFGHJK');
  assert.equal(tagPayload('ABCDEFGHJK', { TAG_BASE_URL: 'https://sdt.pet/t/' }), 'HTTPS://SDT.PET/T/ABCDEFGHJK');
  assert.equal(tagDisplayUrl('ABCDEFGHJK', {}), 'saltydogtags.com/t/abcdefghjk');
  assert.ok(!/[?&=]/.test(tagPayload('ABCDEFGHJK', {})), 'no query strings or tracking parameters, ever');
});

test('beacon nonce: valid after 1 s, refused too fresh, too old, forged, other tag, no key', async () => {
  const t0 = 1_700_000_000_000;
  const n = await scanNonce(KEY, 'ABCDEFGHJK', t0);
  assert.equal(await scanNonceOk(KEY, 'ABCDEFGHJK', n, t0 + 1500), true);
  assert.equal(await scanNonceOk(KEY, 'ABCDEFGHJK', n, t0 + 200), false, 'under 1 s');
  assert.equal(await scanNonceOk(KEY, 'ABCDEFGHJK', n, t0 + 7 * 3600 * 1000), false, 'stale');
  assert.equal(await scanNonceOk(KEY, 'ABCDEFGHJM', n, t0 + 1500), false, 'other tag');
  assert.equal(await scanNonceOk(KEY, 'ABCDEFGHJK', n.slice(0, -1) + (n.endsWith('A') ? 'B' : 'A'), t0 + 1500), false, 'forged');
  assert.equal(await scanNonceOk('', 'ABCDEFGHJK', n, t0 + 1500), false);
  assert.equal(await scanNonce('', 'ABCDEFGHJK', t0), '');
  assert.equal(await scanNonceOk(KEY, 'ABCDEFGHJK', 'junk', t0), false);
});

test('tokens: random, url safe, 32 bytes of entropy; sha256 hex is stable', async () => {
  const a = randomToken(), b = randomToken();
  assert.notEqual(a, b); assert.match(a, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(await sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

/* ---------- task 1: the migration ---------- */
test('migration: creates every table of ADR section 5, and only adds (no DROP, no destructive ALTER)', async () => {
  const db = makeD1();
  const t = (await db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()).results.map((r) => r.name);
  for (const need of ['tags', 'owners', 'contacts', 'scans', 'alerts', 'sessions', 'login_tokens', 'counters', 'meta', 'sms_codes']) assert.ok(t.includes(need), need);
  for (const f of readdirSync(MIGRATIONS_DIR).filter((n) => n.endsWith('.sql'))) {
    const sql = readFileSync(MIGRATIONS_DIR + '/' + f, 'utf8').replace(/--.*$/gm, '');
    assert.ok(!/\bDROP\b|\bTRUNCATE\b|\bDELETE\s+FROM\b|ALTER\s+TABLE\s+\w+\s+(DROP|RENAME)/i.test(sql), f + ' must only add');
  }
});

test('migration: is re-runnable, tag status is constrained, ip_hash and no raw ip column on scans', async () => {
  const db = makeD1();
  await db.exec(readFileSync(MIGRATIONS_DIR + '/0001_smart_tags.sql', 'utf8'));   // second run changes nothing
  await assert.rejects(() => db.prepare("INSERT INTO tags(id,order_id,tag_index,shape,finish,status,created_at) VALUES('X','SDT-AAAA',0,'bone','black','bogus',1)").run());
  const cols = (await db.prepare("PRAGMA table_info(scans)").all()).results.map((c) => c.name);
  assert.ok(cols.includes('ip_hash')); assert.ok(!cols.includes('ip') && !cols.includes('ip_address'));
});

/* ---------- task 7 core: minting ---------- */
const mintArgs = { orderId: 'SDT-AAAA', index: 0, shape: 'military', finish: 'stainless', buyerEmail: 'a@b.co', smart: { v: 3, ecl: 'Q', mm: 0.6 } };
test('mint: inserts an issued tag with payload, is idempotent per order entry', async () => {
  const env = { TAGDB: makeD1() };
  const id = await mintTag(env, mintArgs);
  assert.match(id, ID_RE);
  assert.equal(await mintTag(env, mintArgs), id, 'second mint returns the same id');
  const row = await env.TAGDB.prepare('SELECT * FROM tags WHERE id = ?1').bind(id).first();
  assert.equal(row.status, 'issued'); assert.equal(row.payload, 'HTTPS://SALTYDOGTAGS.COM/T/' + id); assert.equal(row.qr_ecl, 'Q');
  assert.equal(await mintTag(env, { ...mintArgs, index: 1 }) === id, false);
});

test('mint: an id collision retries with a fresh id (up to 5), then throws', async () => {
  const real = makeD1(); let n = 0;
  const env = { TAGDB: { ...real, prepare: (q) => { const s = real.prepare(q); if (!/^INSERT INTO tags/.test(q)) return s; return { bind: (...a) => ({ ...s.bind(...a), run: async () => { if (++n <= 2) throw new Error('UNIQUE constraint failed: tags.id'); return s.bind(...a).run(); } }) }; } } };
  assert.match(await mintTag(env, mintArgs), ID_RE); assert.equal(n, 3);
  n = -100;   // always collides
  const env2 = { TAGDB: { ...real, prepare: (q) => { const s = real.prepare(q); if (!/^INSERT INTO tags/.test(q)) return s; return { bind: (...a) => ({ ...s.bind(...a), run: async () => { throw new Error('UNIQUE constraint failed: tags.id'); } }) }; } } };
  await assert.rejects(() => mintTag(env2, { ...mintArgs, orderId: 'SDT-BBBB' }), /id-collision/);
});

test('mint: no D1 binding throws (callers catch it; an order never fails because of it)', async () => {
  await assert.rejects(() => mintTag({}, mintArgs), /no-db/);
});
