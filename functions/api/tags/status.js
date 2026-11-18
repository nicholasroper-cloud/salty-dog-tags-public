// GET /api/tags/status?orders=SDT-AAAA,SDT-BBBB (admin). The orders page's tag status column: one row per smart tag, no personal data.
import { json, isAdmin } from '../_lib.js';
import { hasDb } from '../_tagsettings.js';

export async function onRequestGet({ request, env }) {
  if (!isAdmin(request, env)) return json({ error: 'nope' }, 401);
  if (!hasDb(env)) return json({ error: 'The tag database is not connected.', tags: {} }, 503);
  const ids = [...new Set(String(new URL(request.url).searchParams.get('orders') || '').split(',').map((s) => s.trim()).filter((s) => /^SDT-[A-Z0-9]{4}$/.test(s)))].slice(0, 60);
  if (!ids.length) return json({ tags: {} });
  try {
    const q = `SELECT id, order_id, tag_index, status, qc_decode_at, native_scan_seen_at, qc_fail_note, claimed_at, engraved_at, shipped_at,
        (SELECT COUNT(*) FROM scans s WHERE s.tag_id = tags.id AND s.by_owner = 0 AND s.kind = 'scan') AS scans
      FROM tags WHERE order_id IN (${ids.map((_, i) => '?' + (i + 1)).join(',')})`;
    const r = await env.TAGDB.prepare(q).bind(...ids).all();
    const tags = {};
    for (const row of r.results) tags[row.id] = row;
    return json({ tags });
  } catch { return json({ error: 'tag database error', tags: {} }, 502); }
}
