// Thin HTTP adapter on 127.0.0.1 only (R5). Security guards from SPEC 10.4:
//  - Host allow-list (DNS rebinding), custom header + JSON content type on POST (CSRF via forced preflight),
//    Origin allow-list, 10 KB body cap, no CORS headers ever, no-store + nosniff + frame deny.
import http from 'node:http';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { LASER_DIR } from './config.mjs';
import { log } from './log.mjs';

const MAX_BODY = 10 * 1024;
const SVG_NAME = /^(SDT-[A-Z0-9]{4})-tag\d{1,2}-(front|back)\.svg$/;
const PHOTO_NAME = /^(SDT-[A-Z0-9]{4})-tag\d{1,2}-photo\.(jpg|png|webp)$/;
const MIME = { svg: 'image/svg+xml', jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
const LOAD_STATUS = { LB_DOWN: 409, LB_REFUSED: 409, LB_TIMEOUT: 409, LASER_BUSY: 409, RATE_LIMITED: 429, BAD_PATH: 400, BAD_REQUEST: 400, LB_INVALID: 409, LB_UNKNOWN: 409 };

export function createHttp({ queue, config, uiFile = path.join(LASER_DIR, 'ui', 'index.html') }) {
  const queueDir = config.queueDir;
  let server;

  const allowedHosts = () => {
    const p = server.address().port;
    return [`127.0.0.1:${p}`, `localhost:${p}`];
  };

  function send(res, status, body, headers = {}) {
    const isObj = body !== null && typeof body === 'object' && !Buffer.isBuffer(body);
    const payload = isObj ? JSON.stringify(body) : body;
    res.writeHead(status, {
      'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY',
      'Content-Type': isObj ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8',
      ...headers
    });
    res.end(payload);
  }

  function readBody(req) {
    return new Promise((resolve, reject) => {
      let size = 0, over = false; const chunks = [];
      req.on('data', (c) => {
        size += c.length;
        if (size > MAX_BODY) {
          if (!over) { over = true; reject(Object.assign(new Error('body too large'), { status: 413 })); }
          return;   // keep draining (and discarding) so the 413 reaches the client instead of a reset
        }
        chunks.push(c);
      });
      req.on('end', () => {
        if (over) return;
        try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); }
        catch { reject(Object.assign(new Error('bad json'), { status: 400 })); }
      });
      req.on('error', reject);
    });
  }

  async function serveFile(res, orderId, name) {
    const m = SVG_NAME.exec(name) || PHOTO_NAME.exec(name);
    if (!/^SDT-[A-Z0-9]{4}$/.test(orderId) || !m || m[1] !== orderId) return send(res, 404, 'not found');
    const abs = path.resolve(queueDir, orderId, name);
    if (!abs.startsWith(queueDir + path.sep)) return send(res, 404, 'not found');
    try { if (!(await stat(abs)).isFile()) return send(res, 404, 'not found'); } catch { return send(res, 404, 'not found'); }
    const ext = name.split('.').pop();
    const headers = {
      'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Content-Type': MIME[ext]
    };
    if (ext === 'svg') headers['Content-Security-Policy'] = "default-src 'none'; style-src 'unsafe-inline'";
    res.writeHead(200, headers);
    createReadStream(abs).pipe(res);
  }

  const asLoadReply = (res, r) => {
    if (r.ok) return send(res, 200, r);
    return send(res, LOAD_STATUS[r.code] || 400, r, r.code === 'RATE_LIMITED' ? { 'Retry-After': String(Math.ceil((r.retryAfterMs || 1000) / 1000)) } : {});
  };

  async function route(req, res) {
    const url = new URL(req.url, 'http://x');
    const p = url.pathname;
    if (req.method === 'GET' && p === '/') {
      return send(res, 200, await readFile(uiFile), { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'" });
    }
    if (req.method === 'GET' && p === '/api/health') return send(res, 200, queue.health());
    if (req.method === 'GET' && p === '/api/jobs') return send(res, 200, await queue.views());
    if (req.method === 'GET' && p.startsWith('/files/')) {
      const parts = p.slice(7).split('/');
      if (parts.length !== 2) return send(res, 404, 'not found');
      let a, b;
      try { a = decodeURIComponent(parts[0]); b = decodeURIComponent(parts[1]); } catch { return send(res, 404, 'not found'); }
      return serveFile(res, a, b);
    }
    if (req.method === 'POST') {
      const body = await readBody(req);
      switch (p) {
        case '/api/load': return asLoadReply(res, await queue.loadForOperator({ orderId: body.orderId, file: body.file, path: body.path, force: body.force === true, verb: body.verb === 'LOADFILE' ? 'LOADFILE' : undefined }));
        case '/api/reveal': { const r = await queue.reveal(body); return send(res, r.ok ? 200 : 400, r); }
        case '/api/engraved': {
          const r = await queue.engraved(body.orderId, { confirmPrints: body.confirmPrints === true });
          return send(res, r.ok ? 200 : (r.code === 'HAS_PRINTS' || r.code === 'NOT_OPEN' ? 409 : r.code === 'NO_JOB' ? 404 : r.code === 'BAD_ID' ? 400 : 502), r);
        }
        case '/api/regenerate': { const r = await queue.regenerate(body.orderId); return send(res, r.ok ? 200 : (r.code === 'BAD_ID' ? 400 : r.code === 'CANCELLED' ? 409 : r.code === 'NOT_FOUND' ? 404 : 502), r); }
        case '/api/poll': { const r = await queue.poll({ auto: body.auto === true }); return send(res, 200, r); }   // auto-load only when asked
        case '/api/ping': { const l = queue.lightburn; const pg = await l.ping(); const st = pg.up ? await l.status() : null; return send(res, 200, { up: pg.up, status: st ? (st.ok ? 'idle' : 'busy') : null }); }
        case '/api/demo': { const r = await queue.demo({ load: body.load === true }); return send(res, r.ok ? 200 : 502, r); }
        default: return send(res, 404, 'not found');
      }
    }
    return send(res, req.method === 'GET' ? 404 : 405, req.method === 'GET' ? 'not found' : 'method not allowed');
  }

  function handler(req, res) {
    // Order matters: reject on Host before anything else is looked at.
    if (!allowedHosts().includes(req.headers.host || '')) return send(res, 403, 'forbidden');
    const origin = req.headers.origin;
    if (origin !== undefined && !allowedHosts().map((h) => `http://${h}`).includes(origin)) return send(res, 403, 'forbidden');
    if (req.method === 'POST') {
      if (req.headers['x-sdt-laser'] !== '1') return send(res, 403, 'forbidden');
      if (!String(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) return send(res, 403, 'forbidden');
    }
    route(req, res).catch((e) => {
      if (res.headersSent) { res.destroy(); return; }
      if (e && e.status) return send(res, e.status, { ok: false, error: e.message }, e.status === 413 ? { Connection: 'close' } : {});
      log.error(`http ${req.method} ${String(req.url).slice(0, 80)}: ${e && e.message}`);
      send(res, 500, { ok: false, error: 'internal error' });
    });
  }

  return {
    // resolves with the bound port; rejects with the listen error (EADDRINUSE is handled by the caller)
    listen(port = config.ui.port, host = config.ui.host) {
      if (host !== '127.0.0.1') throw new Error('ui.host must be 127.0.0.1');   // R5
      server = http.createServer(handler);
      server.headersTimeout = 10000; server.requestTimeout = 15000;
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => { server.removeListener('error', reject); resolve(server.address().port); });
      });
    },
    close: () => new Promise((r) => (server ? server.close(() => r()) : r())),
    get server() { return server; }
  };
}
