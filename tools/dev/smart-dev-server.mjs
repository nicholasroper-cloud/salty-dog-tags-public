// LOCAL ONLY dev harness for the smart QR tag: serves site/ and runs the real Pages Functions in-process against an in-memory D1 (node:sqlite)
// and an in-memory KV. Every outbound call (Resend, Twilio, Pushover, Clover) is captured, never sent. Used for the headless screenshots.
//   node tools/dev/smart-dev-server.mjs [port]      then open http://localhost:8799/
// Debug routes (this harness only): /__outbox (captured emails and texts), /__debug/tags, /__debug/alerts, /__debug/scans, /__debug/contacts
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { makeD1 } from '../test/_d1.mjs';
import { claimCode } from '../../functions/api/_tagid.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = Number(process.argv[2] || process.env.PORT || 8799), ORIGIN = `http://localhost:${PORT}`;
const kvm = new Map();
export const env = {
  ORDERS: { get: async (k) => kvm.get(k) ?? null, put: async (k, v) => { kvm.set(k, v); }, delete: async (k) => { kvm.delete(k); }, getWithMetadata: async (k) => ({ value: kvm.get(k) ?? null, metadata: null }),
    list: async ({ prefix = '' } = {}) => ({ keys: [...kvm.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true }) },
  TAGDB: makeD1(), ADMIN_KEY: 'dev-admin-key-0123456789', TAG_CLAIM_KEY: 'dev-claim-key-0123456789abcdef', IP_SALT: 'dev-salt-0123456789abcdef',
  SITE_URL: ORIGIN, RESEND_API_KEY: 're_dev', TWILIO_SID: 'ACdev', TWILIO_TOKEN: 'devtoken', TAG_TWILIO_MSID: 'MGdev'
};
export const outbox = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (/resend|twilio|pushover|clover/.test(u)) {
    const b = typeof init.body === 'string' ? (init.body.startsWith('{') ? JSON.parse(init.body) : init.body) : init.body instanceof URLSearchParams ? Object.fromEntries(init.body) : null;
    outbox.push({ at: Date.now(), to: u.includes('resend') ? 'email' : u.includes('twilio') ? 'sms' : 'other', url: u, body: b });
    return new Response(JSON.stringify({ id: 'dev_' + outbox.length, sid: 'SMdev' + outbox.length }), { status: 200 });
  }
  return realFetch(url, init);
};

const routes = [
  [/^\/api\/config$/, 'functions/api/config.js'], [/^\/api\/order$/, 'functions/api/order.js'], [/^\/api\/orders$/, 'functions/api/orders.js'], [/^\/api\/ship$/, 'functions/api/ship.js'],
  [/^\/api\/tags\/(mint|qc|slip|status|health)$/, (m) => `functions/api/tags/${m[1]}.js`],
  [/^\/api\/tag\/(scan|location|message|claim)$/, (m) => `functions/api/tag/${m[1]}.js`], [/^\/api\/auth\/(start|verify)$/, (m) => `functions/api/auth/${m[1]}.js`],
  [/^\/api\/my\/([a-z-]+)$/, 'functions/api/my/[action].js', (m) => ({ action: m[1] })], [/^\/api\/tag-sms-inbound$/, 'functions/api/tag-sms-inbound.js'],
  [/^\/t\/([^/]+)$/, 'functions/t/[id].js', (m) => ({ id: m[1] })]
];
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.txt': 'text/plain', '.xml': 'application/xml' };

async function handle(req, res) {
  const url = new URL(req.url, ORIGIN);
  const chunks = []; for await (const c of req) chunks.push(c);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;
  const send = (r) => { res.writeHead(r.status, Object.fromEntries(r.headers)); r.arrayBuffer().then((b) => res.end(Buffer.from(b))); };
  if (url.pathname === '/__outbox') return send(new Response(JSON.stringify(outbox), { headers: { 'content-type': 'application/json' } }));
  if (url.pathname === '/__debug/reset-limits') { await env.TAGDB.prepare("DELETE FROM counters WHERE k LIKE 'rl:scan%'").run(); return send(new Response('ok')); }   // the 1-per-IP-per-tag-per-10-min limiter would hide a second scan from the same laptop
  if (url.pathname.startsWith('/__debug/')) {
    const what = url.pathname.slice(9);
    const q = { tags: 'SELECT id, order_id, status, shape, finish, dog_name, qc_decode_at, native_scan_seen_at, payload FROM tags', alerts: 'SELECT channel, kind, status, error_code, tries FROM alerts ORDER BY at', contacts: 'SELECT slot, label, phone_e164, email, sms_on, email_on, sms_verified_at, sms_consent_ver FROM contacts', scans: 'SELECT kind, by_owner, lat, lng, place_text, message FROM scans ORDER BY at' }[what];
    if (!q) return send(new Response('?', { status: 404 }));
    const rows = (await env.TAGDB.prepare(q).all()).results;
    if (what === 'tags') for (const r of rows) r.claimCode = await claimCode(env.TAG_CLAIM_KEY, r.id, 1);
    return send(new Response(JSON.stringify(rows, null, 1), { headers: { 'content-type': 'application/json' } }));
  }
  for (const [re, file, params] of routes) {
    const m = re.exec(url.pathname); if (!m) continue;
    const f = typeof file === 'function' ? file(m) : file;
    const mod = await import(pathToFileURL(path.join(root, f)).href + '?v=1');
    const headers = new Headers(); for (const [k, v] of Object.entries(req.headers)) headers.set(k, String(v));
    headers.set('cf-connecting-ip', '127.0.0.1'); if (!headers.has('origin') && req.method !== 'GET') headers.set('origin', ORIGIN);
    const request = new Request(url, { method: req.method, headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : body });
    const fn = mod.onRequest || mod['onRequest' + req.method[0] + req.method.slice(1).toLowerCase()];
    if (!fn) return send(new Response('method', { status: 405 }));
    const pending = [];
    return send(await fn({ request, env, params: params ? params(m) : {}, waitUntil: (p) => pending.push(p) }));
  }
  let p = decodeURIComponent(url.pathname); if (p.endsWith('/')) p += 'index.html';
  const tryFiles = [p, p + '.html'];
  for (const t of tryFiles) {
    const fp = path.join(root, 'site', t);
    if (!fp.startsWith(path.join(root, 'site'))) break;
    try { if ((await stat(fp)).isFile()) { const buf = await readFile(fp); res.writeHead(200, { 'content-type': MIME[path.extname(fp)] || 'application/octet-stream' }); return res.end(buf); } } catch { /* next */ }
  }
  res.writeHead(404, { 'content-type': 'text/plain' }); res.end('not found');
}
http.createServer((q, s) => handle(q, s).catch((e) => { console.error(e); s.writeHead(500); s.end('error'); })).listen(PORT, () => console.log('smart dev server on ' + ORIGIN));
