// D1 access for tags: minting, status changes, the ship gate. Every function that an ORDER depends on is try/catch'd by its caller:
// a D1 failure must never block, lose, or fail an order (ADR section 7, step 2).
import { newTagId, tagPayload } from './_tagid.js';
import { hasDb, qrConfig } from './_tagsettings.js';

export const STATUS = ['issued', 'engraved', 'qc_pass', 'qc_fail', 'shipped', 'claimed', 'disabled'];
const MAX_MINT_TRIES = 5;

export async function getTag(env, id) {
  if (!hasDb(env)) return null;
  return env.TAGDB.prepare('SELECT * FROM tags WHERE id = ?1').bind(id).first();
}
export async function tagsForOrder(env, orderId) {
  const r = await env.TAGDB.prepare('SELECT * FROM tags WHERE order_id = ?1 ORDER BY tag_index').bind(orderId).all();
  return r.results;
}

// Mints (or returns) the tag row for one order entry. Idempotent per (order_id, tag_index): a second call returns the same id.
// A primary-key collision on the id retries with a fresh random id, up to 5 times. Throws when D1 is unavailable.
export async function mintTag(env, { orderId, index, shape, finish, buyerEmail, smart }, now = Date.now()) {
  if (!hasDb(env)) throw new Error('no-db');
  const have = await env.TAGDB.prepare('SELECT id FROM tags WHERE order_id = ?1 AND tag_index = ?2').bind(orderId, index).first();
  if (have) return have.id;
  qrConfig(env);
  for (let i = 0; i < MAX_MINT_TRIES; i++) {
    const id = newTagId();
    const payload = tagPayload(id, env);
    try {
      await env.TAGDB.prepare(
        `INSERT INTO tags(id, order_id, tag_index, shape, finish, status, buyer_email, qr_version, qr_ecl, qr_module_mm, payload, created_at)
         VALUES(?1, ?2, ?3, ?4, ?5, 'issued', ?6, ?7, ?8, ?9, ?10, ?11)`)
        .bind(id, orderId, index, shape, finish, buyerEmail || null, smart ? smart.v : null, smart ? smart.ecl : null, smart ? smart.mm : null, payload, now).run();
      return id;
    } catch (e) {
      const dup = /UNIQUE|constraint/i.test(String(e && e.message));
      if (!dup) throw e;
      // A concurrent mint of the same entry may have won: return its id instead of retrying forever.
      const again = await env.TAGDB.prepare('SELECT id FROM tags WHERE order_id = ?1 AND tag_index = ?2').bind(orderId, index).first();
      if (again) return again.id;
    }
  }
  throw new Error('id-collision');
}

// The smart block stored on an order tag entry. Unchangeable once the id exists: the QR payload, geometry and version are fixed here.
export function smartBlock(check, id, env) {
  return { id: id || null, url: id ? tagPayload(id, env) : null, ...check.smart };
}

// Mints every smart entry of an order that has no id yet. Returns { minted, failed }. Never throws.
export async function mintOrderTags(env, order) {
  const out = { minted: 0, failed: 0 };
  qrConfig(env);
  for (let i = 0; i < (order.tags || []).length; i++) {
    const t = order.tags[i];
    if (!t.smart || t.smart.id) continue;
    try {
      const id = await mintTag(env, { orderId: order.id, index: i, shape: t.shape, finish: t.finish, buyerEmail: order.customer && order.customer.email, smart: t.smart });
      t.smart.id = id; t.smart.url = tagPayload(id, env);
      out.minted++;
    } catch (e) { out.failed++; console.warn('tag mint failed', order.id, i, String((e && e.message) || e).slice(0, 80)); }
  }
  return out;
}

export async function disableOrderTags(env, orderId) {
  if (!hasDb(env)) return 0;
  const r = await env.TAGDB.prepare("UPDATE tags SET status = 'disabled' WHERE order_id = ?1 AND status != 'disabled'").bind(orderId).run();
  return r.meta.changes;
}
export async function markEngraved(env, orderId, now = Date.now()) {
  if (!hasDb(env)) return 0;
  const r = await env.TAGDB.prepare("UPDATE tags SET status = 'engraved', engraved_at = ?2, qc_decode_at = NULL, qc_fail_note = NULL WHERE order_id = ?1 AND status IN ('issued','qc_fail')").bind(orderId, now).run();
  return r.meta.changes;
}
export async function markShipped(env, orderId, now = Date.now()) {
  if (!hasDb(env)) return 0;
  const r = await env.TAGDB.prepare("UPDATE tags SET status = 'shipped', shipped_at = ?2 WHERE order_id = ?1 AND status = 'qc_pass'").bind(orderId, now).run();
  return r.meta.changes;
}

// QC result for one tag. pass requires the in-page decode (decodedText must equal the tag's payload exactly) AND, to reach 'qc_pass',
// the native phone-camera beacon (native_scan_seen_at). A pass without the beacon records qc_decode_at and stays 'engraved'.
export async function recordQc(env, id, { decodedText, fail, note }, now = Date.now()) {
  const tag = await getTag(env, id);
  if (!tag) return { error: 'no such tag', status: 404 };
  if (!['engraved', 'qc_pass', 'qc_fail'].includes(tag.status)) return { error: `tag is ${tag.status}; mark it engraved first`, status: 409 };
  if (fail) {
    await env.TAGDB.prepare("UPDATE tags SET status = 'qc_fail', qc_fail_note = ?2, qc_decode_at = NULL WHERE id = ?1").bind(id, String(note || '').slice(0, 200)).run();
    return { ok: true, tag: await getTag(env, id) };
  }
  if (String(decodedText || '').trim() !== tag.payload) return { error: 'decoded text does not match this tag\'s payload', status: 422, expected: tag.payload };
  const seen = tag.native_scan_seen_at;
  await env.TAGDB.prepare("UPDATE tags SET qc_decode_at = ?2, qc_fail_note = NULL, status = CASE WHEN ?3 IS NOT NULL THEN 'qc_pass' ELSE 'engraved' END WHERE id = ?1").bind(id, now, seen).run();
  return { ok: true, tag: await getTag(env, id) };
}
// Called when a counted beacon arrives for an engraved (not yet shipped) tag: the phone camera check.
export async function noteNativeScan(env, tag, now = Date.now()) {
  if (!['engraved', 'qc_fail', 'qc_pass'].includes(tag.status) || tag.native_scan_seen_at) return false;
  await env.TAGDB.prepare("UPDATE tags SET native_scan_seen_at = ?2, status = CASE WHEN qc_decode_at IS NOT NULL AND status = 'engraved' THEN 'qc_pass' ELSE status END WHERE id = ?1").bind(tag.id, now).run();
  return true;
}

// Reasons an order cannot be marked shipped yet. Empty = OK. D1 unreachable is a blocker too (fail closed); the owner can
// override from the orders page, which records the override on the order.
export async function shipBlockers(env, order) {
  const entries = (order.tags || []).map((t, i) => ({ t, i })).filter((x) => x.t.smart && !x.t.declined);
  if (!entries.length) return [];
  const blockers = [];
  let rows = [];
  if (!hasDb(env)) return ['tag database is not connected'];
  try { rows = await tagsForOrder(env, order.id); } catch { return ['tag database is unreachable, try again or override']; }
  for (const { t, i } of entries) {
    const n = i + 1;
    if (!t.smart.id) { blockers.push(`Tag ${n}: no QR id yet. Tap "Mint QR id".`); continue; }
    const row = rows.find((r) => r.id === t.smart.id);
    if (!row) { blockers.push(`Tag ${n}: id ${t.smart.id} is not in the tag database.`); continue; }
    if (row.status === 'disabled') blockers.push(`Tag ${n}: disabled.`);
    else if (row.status === 'qc_pass' || row.status === 'shipped' || row.status === 'claimed') continue;
    else if (row.status === 'qc_fail') blockers.push(`Tag ${n}: QC failed. Re-engrave on a new blank, destroy the bad one, run QC again.`);
    else if (!row.qc_decode_at) blockers.push(`Tag ${n}: scan check not done (use "Scan check" on the orders page).`);
    else if (!row.native_scan_seen_at) blockers.push(`Tag ${n}: scan it with the iPhone camera and open the link once.`);
    else blockers.push(`Tag ${n}: status ${row.status}, not QC passed.`);
  }
  return blockers;
}
