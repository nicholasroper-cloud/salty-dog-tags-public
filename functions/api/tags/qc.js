// POST /api/tags/qc (admin).
//   { id, decodedText }        the orders page decoded the engraved QR with the camera; it must equal the tag's payload exactly.
//   { id, fail: true, note }   QC failed: re-engrave the same id on a new blank and destroy the bad one.
// 'qc_pass' needs BOTH this decode and the native phone-camera beacon (see _tagdb.js recordQc / noteNativeScan).
import { json, isAdmin } from '../_lib.js';
import { normalizeTagId } from '../_tagid.js';
import { recordQc } from '../_tagdb.js';
import { hasDb } from '../_tagsettings.js';

export async function onRequestPost({ request, env }) {
  if (!isAdmin(request, env)) return json({ error: 'nope' }, 401);
  let body; try { body = await request.json(); } catch { return json({ error: 'bad json' }, 400); }
  if (!body || typeof body !== 'object') return json({ error: 'bad json' }, 400);
  if (!hasDb(env)) return json({ error: 'The tag database is not connected.' }, 503);
  const id = normalizeTagId(body.id);
  if (!id) return json({ error: 'bad tag id' }, 400);
  try {
    const r = await recordQc(env, id, { decodedText: String(body.decodedText || '').slice(0, 200), fail: body.fail === true, note: body.note });
    if (r.error) return json({ error: r.error, expected: r.expected }, r.status || 400);
    const t = r.tag;
    return json({ ok: true, status: t.status, decoded: Boolean(t.qc_decode_at), nativeScan: Boolean(t.native_scan_seen_at) });
  } catch { return json({ error: 'tag database error, try again' }, 502); }
}
