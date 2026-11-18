// A D1-shaped fake backed by node:sqlite (real SQL, real migration). Supports the subset the app uses:
// prepare(sql).bind(...).first() / .all() / .run(), db.batch([...]), db.exec(sql). `failNext(n)` makes the next n calls throw,
// which is how the tests prove "D1 down never blocks an order".
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
export const MIGRATIONS_DIR = path.join(here, '..', '..', 'migrations');

export function makeD1({ migrate = true } = {}) {
  const sql = new DatabaseSync(':memory:');
  if (migrate) for (const f of readdirSync(MIGRATIONS_DIR).filter((n) => n.endsWith('.sql')).sort()) sql.exec(readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8'));
  let failing = 0;
  const guard = () => { if (failing > 0) { failing--; throw new Error('D1_ERROR: simulated outage'); } };
  const stmt = (q, args = []) => ({
    bind: (...a) => stmt(q, a),
    first: async (col) => { guard(); const r = sql.prepare(q).get(...args); if (r == null) return null; return col ? r[col] : { ...r }; },
    all: async () => { guard(); const results = sql.prepare(q).all(...args).map((r) => ({ ...r })); return { results, success: true, meta: {} }; },
    run: async () => { guard(); const r = sql.prepare(q).run(...args); return { success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; },
    raw: async () => { guard(); return sql.prepare(q).all(...args).map((r) => Object.values(r)); },
    _q: q, _a: args
  });
  return {
    prepare: (q) => stmt(q),
    batch: async (stmts) => { guard(); sql.exec('BEGIN'); try { const out = []; for (const s of stmts) out.push(await s.run()); sql.exec('COMMIT'); return out; } catch (e) { sql.exec('ROLLBACK'); throw e; } },
    exec: async (q) => { guard(); sql.exec(q); return { count: 1 }; },
    failNext: (n = 1) => { failing = n; },
    _sql: sql
  };
}
