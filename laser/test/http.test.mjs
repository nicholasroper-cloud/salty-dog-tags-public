import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHttp } from '../lib/http.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = await mkdtemp(path.join(os.tmpdir(), 'sdt-http-'));
const queueDir = path.join(root, 'queue');
await mkdir(path.join(queueDir, 'SDT-7KQ2'), { recursive: true });
await mkdir(path.join(queueDir, 'SDT-2ABC'), { recursive: true });
await writeFile(path.join(queueDir, 'SDT-7KQ2', 'SDT-7KQ2-tag1-front.svg'), '<svg/>');
await writeFile(path.join(queueDir, 'SDT-7KQ2', 'SDT-7KQ2-tag1-front.lbrn2'), '<x/>');
await writeFile(path.join(queueDir, 'SDT-7KQ2', 'SDT-7KQ2-tag2-photo.jpg'), 'JPG');
await writeFile(path.join(queueDir, 'SDT-7KQ2', 'SDT-7KQ2-tag1-front-halftone.lbrn2'), '<x/>');
await writeFile(path.join(queueDir, 'SDT-7KQ2', 'job.json'), '{"secret":1}');
await writeFile(path.join(queueDir, 'SDT-2ABC', 'SDT-2ABC-tag1-front.svg'), '<svg/>');
await writeFile(path.join(root, 'outside.svg'), '<svg/>');

const calls = [];
const rec = (name, ret) => async (...a) => { calls.push([name, a]); return typeof ret === 'function' ? ret(...a) : ret; };
const queue = {
  health: () => ({ ok: true }),
  views: rec('views', { jobs: [] }),
  loadForOperator: rec('load', (r) => ({ ok: true, echo: r })),
  reveal: rec('reveal', { ok: true }),
  engraved: rec('engraved', { ok: false, code: 'HAS_PRINTS', prints: ['1x Benchy'] }),
  regenerate: rec('regenerate', { ok: true, mode: 'queued', warnings: [] }),
  poll: rec('poll', { ok: true, picked: [] }),
  demo: rec('demo', { ok: true, orders: [] }),
  lightburn: { ping: async () => ({ up: true }), status: async () => ({ ok: true }) }
};
const config = { queueDir, ui: { host: '127.0.0.1', port: 0 } };
const web = createHttp({ queue, config });
const port = await web.listen(0, '127.0.0.1');
after(() => web.close());

function req({ method = 'GET', url = '/', headers = {}, body, host = `127.0.0.1:${port}` } = {}) {
  return new Promise((resolve, reject) => {
    const h = { host, ...headers };
    const r = http.request({ host: '127.0.0.1', port, method, path: url, headers: h, setHost: false }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    r.on('error', reject);
    if (body !== undefined) r.write(body);
    r.end();
  });
}
const POST_HEADERS = { 'content-type': 'application/json', 'x-sdt-laser': '1' };
const post = (url, obj, headers = {}) => req({ method: 'POST', url, headers: { ...POST_HEADERS, ...headers }, body: JSON.stringify(obj) });

test('R5: binds 127.0.0.1 only, and refuses any other host', async () => {
  assert.equal(web.server.address().address, '127.0.0.1');
  assert.throws(() => createHttp({ queue, config }).listen(0, '0.0.0.0'), /127\.0\.0\.1/);
});

test('Host header: only 127.0.0.1:<port> and localhost:<port> are accepted (DNS rebinding)', async () => {
  assert.equal((await req({ url: '/api/health' })).status, 200);
  assert.equal((await req({ url: '/api/health', host: `localhost:${port}` })).status, 200);
  for (const host of ['evil.example.com', `evil.example.com:${port}`, '127.0.0.1', `127.0.0.1:${port + 1}`, `[::1]:${port}`, '']) {
    assert.equal((await req({ url: '/api/health', host })).status, 403, host);
  }
});

test('POST needs X-SDT-Laser: 1 and a JSON content type', async () => {
  const noHeader = await req({ method: 'POST', url: '/api/poll', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal(noHeader.status, 403);
  const wrongValue = await post('/api/poll', {}, { 'x-sdt-laser': '0' });
  assert.equal(wrongValue.status, 403);
  const form = await req({ method: 'POST', url: '/api/poll', headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-sdt-laser': '1' }, body: 'a=1' });
  assert.equal(form.status, 403);
  const text = await req({ method: 'POST', url: '/api/poll', headers: { 'content-type': 'text/plain', 'x-sdt-laser': '1' }, body: '{}' });
  assert.equal(text.status, 403);
  assert.equal(calls.filter((c) => c[0] === 'poll').length, 0, 'guarded handlers never ran');
  assert.equal((await post('/api/poll', {})).status, 200);
});

test('Origin must be ours when present (GET and POST)', async () => {
  for (const origin of ['http://evil.example.com', 'null', `http://127.0.0.1:${port + 1}`, `https://127.0.0.1:${port}`]) {
    assert.equal((await req({ url: '/api/health', headers: { origin } })).status, 403, origin);
    assert.equal((await post('/api/poll', {}, { origin })).status, 403, origin);
  }
  assert.equal((await post('/api/poll', {}, { origin: `http://127.0.0.1:${port}` })).status, 200);
  assert.equal((await post('/api/poll', {}, { origin: `http://localhost:${port}` })).status, 200);
});

test('N3: body over 10 KB gets a real 413 response (not a reset); bad JSON gets 400', async () => {
  calls.length = 0;
  const big = await req({ method: 'POST', url: '/api/poll', headers: POST_HEADERS, body: JSON.stringify({ x: 'a'.repeat(11 * 1024) }) });
  assert.equal(big.status, 413);
  assert.equal(JSON.parse(big.body).ok, false);
  const huge = await req({ method: 'POST', url: '/api/poll', headers: POST_HEADERS, body: JSON.stringify({ x: 'a'.repeat(200 * 1024) }) });
  assert.equal(huge.status, 413);
  assert.equal(calls.filter((c) => c[0] === 'poll').length, 0, 'oversized bodies never reach the handler');
  assert.equal((await req({ method: 'POST', url: '/api/poll', headers: POST_HEADERS, body: '{nope' })).status, 400);
});

test('S2: /api/poll never auto-loads unless the caller asks (auto: true)', async () => {
  calls.length = 0;
  await post('/api/poll', {});
  await post('/api/poll', { auto: false });
  await post('/api/poll', { auto: 'yes' });
  await post('/api/poll', { auto: true });
  assert.deepEqual(calls.filter((c) => c[0] === 'poll').map((c) => c[1][0].auto), [false, false, false, true]);
});

test('no Access-Control-* headers anywhere; preflight is not answered; security headers present', async () => {
  const pre = await req({ method: 'OPTIONS', url: '/api/poll', headers: { origin: 'http://evil.example.com', 'access-control-request-method': 'POST' } });
  assert.ok(pre.status === 403 || pre.status === 405);
  const preOk = await req({ method: 'OPTIONS', url: '/api/poll' });
  assert.equal(preOk.status, 405);
  for (const r of [pre, preOk, await req({ url: '/api/health' }), await req({ url: '/' }), await req({ url: '/nope' }), await post('/api/poll', {})]) {
    assert.deepEqual(Object.keys(r.headers).filter((k) => k.startsWith('access-control')), []);
    if (r.status !== 403) {
      assert.equal(r.headers['cache-control'], 'no-store');
      assert.equal(r.headers['x-content-type-options'], 'nosniff');
      assert.equal(r.headers['x-frame-options'], 'DENY');
    }
  }
});

test('GET / serves the UI file', async () => {
  const r = await req({ url: '/' });
  assert.equal(r.status, 200);
  assert.match(r.headers['content-type'], /text\/html/);
  assert.equal(r.body, await readFile(path.join(here, '..', 'ui', 'index.html'), 'utf8'));
});

test('/files: previews and photos are served; SVG gets a locked-down CSP', async () => {
  const svg = await req({ url: '/files/SDT-7KQ2/SDT-7KQ2-tag1-front.svg' });
  assert.equal(svg.status, 200);
  assert.equal(svg.headers['content-type'], 'image/svg+xml');
  assert.equal(svg.headers['content-security-policy'], "default-src 'none'; style-src 'unsafe-inline'");
  const photo = await req({ url: '/files/SDT-7KQ2/SDT-7KQ2-tag2-photo.jpg' });
  assert.equal(photo.status, 200);
  assert.equal(photo.headers['content-type'], 'image/jpeg');
});

test('/files: the photo front preview is served; the halftone variant is a laser file with no preview, so it is not served', async () => {
  assert.equal((await req({ url: '/files/SDT-7KQ2/SDT-7KQ2-tag1-front.svg' })).status, 200);
  assert.equal((await req({ url: '/files/SDT-7KQ2/SDT-7KQ2-tag1-front-halftone.lbrn2' })).status, 404);
  assert.equal((await req({ url: '/files/SDT-7KQ2/SDT-7KQ2-tag1-front-halftone.svg' })).status, 404);
});

test('/api/load passes the halftone file name through to the queue', async () => {
  calls.length = 0;
  const r = await post('/api/load', { orderId: 'SDT-7KQ2', file: 'SDT-7KQ2-tag1-front-halftone.lbrn2' });
  assert.equal(r.status, 200);
  assert.equal(calls.at(-1)[1][0].file, 'SDT-7KQ2-tag1-front-halftone.lbrn2');
});

test('/files: traversal, absolute paths, wrong extension, id mismatch, and non-preview files are all 404', async () => {
  const bad = [
    '/files/SDT-7KQ2/..%2Fjob.json', '/files/SDT-7KQ2/%2e%2e%2fjob.json', '/files/..%2Foutside.svg/x', '/files/SDT-7KQ2/..%252F..%252Foutside.svg',
    '/files//etc/passwd', '/files/SDT-7KQ2//etc/passwd', '/files/%2Fetc%2Fpasswd/x', '/files/SDT-7KQ2/job.json', '/files/SDT-7KQ2/SDT-7KQ2-tag1-front.lbrn2',
    '/files/SDT-7KQ2/SDT-2ABC-tag1-front.svg', '/files/SDT-2ABC/SDT-7KQ2-tag1-front.svg', '/files/SDT-7KQ2/SDT-7KQ2-tag1-front.svg.bak',
    '/files/SDT-7KQ2/SDT-7KQ2-tag1-front.SVG', '/files/SDT-7KQ2/SDT-7KQ2-tag100-front.svg', '/files/SDT-7KQ2/SDT-7KQ2-tag1-middle.svg',
    '/files/SDT-7KQ2/SDT-7KQ2-tag1-photo.bin', '/files/sdt-7kq2/SDT-7KQ2-tag1-front.svg', '/files/SDT-7KQ2/', '/files/', '/files/SDT-7KQ2/SDT-7KQ2-tag9-front.svg',
    '/files/SDT-7KQ2/SDT-7KQ2-tag1-front.svg%00.png', '/files/SDT-7KQ2/%00'
  ];
  for (const u of bad) {
    const r = await req({ url: u });
    assert.equal(r.status, 404, `${u} -> ${r.status}`);
  }
});

test('API routes map results to status codes', async () => {
  queue.loadForOperator = rec('load', () => ({ ok: false, code: 'RATE_LIMITED', retryAfterMs: 3000 }));
  const rl = await post('/api/load', { orderId: 'SDT-7KQ2', file: 'x' });
  assert.equal(rl.status, 429); assert.equal(rl.headers['retry-after'], '3');
  queue.loadForOperator = rec('load', () => ({ ok: false, code: 'LB_DOWN' }));
  assert.equal((await post('/api/load', {})).status, 409);
  queue.loadForOperator = rec('load', () => ({ ok: false, code: 'BAD_PATH' }));
  assert.equal((await post('/api/load', {})).status, 400);
  const eng = await post('/api/engraved', { orderId: 'SDT-7KQ2' });
  assert.equal(eng.status, 409); assert.equal(JSON.parse(eng.body).code, 'HAS_PRINTS');
  assert.equal((await post('/api/ping', {})).status, 200);
  assert.equal((await post('/api/nope', {})).status, 404);
  assert.equal((await req({ url: '/api/jobs' })).status, 200);
});

test('only ping, status, and load exist for LightBurn: no generic command route', async () => {
  for (const p of ['/api/send', '/api/udp', '/api/command', '/api/lightburn']) assert.equal((await post(p, { cmd: 'PING' })).status, 404);
});

test('force must be literally true', async () => {
  queue.loadForOperator = rec('load', (r) => ({ ok: true, echo: r }));
  calls.length = 0;
  await post('/api/load', { orderId: 'SDT-7KQ2', file: 'f', force: 'yes' });
  assert.equal(calls.find((c) => c[0] === 'load')[1][0].force, false);
});
