import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApi, ApiError } from '../lib/api.mjs';
import { log, addSecret } from '../lib/log.mjs';

const KEY = 'k'.repeat(32);
const seen = [];
let handler = (req, res) => { res.statusCode = 404; res.end(); };
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => { seen.push({ method: req.method, url: req.url, auth: req.headers.authorization, body }); handler(req, res, body); });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
after(() => server.close());
const api = (fetchImpl) => createApi({ apiBase: `http://127.0.0.1:${server.address().port}`, key: KEY, fetchImpl });

test('listOrders sends the Bearer key and validates the body', async () => {
  handler = (req, res) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ orders: [{ id: 'SDT-AAAA' }] })); };
  const orders = await api().listOrders();
  assert.equal(orders.length, 1);
  assert.equal(seen.at(-1).auth, `Bearer ${KEY}`);
  handler = (req, res) => res.end('{"nope":1}');
  await assert.rejects(api().listOrders(), (e) => e.code === 'BAD_BODY');
  handler = (req, res) => res.end('not json');
  await assert.rejects(api().listOrders(), (e) => e.code === 'BAD_BODY');
});

test('401 maps to AUTH and the error text never contains the key', async () => {
  handler = (req, res) => { res.statusCode = 401; res.end('{"error":"nope"}'); };
  await assert.rejects(api().listOrders(), (e) => e instanceof ApiError && e.code === 'AUTH' && !e.message.includes(KEY));
  handler = (req, res) => { res.statusCode = 503; res.end(); };
  await assert.rejects(api().listOrders(), (e) => e.code === 'HTTP_503');
});

test('network failure maps to NETWORK without leaking the key', async () => {
  const dead = createApi({ apiBase: 'http://127.0.0.1:1', key: KEY });
  await assert.rejects(dead.listOrders(), (e) => e.code === 'NETWORK' && !e.message.includes(KEY));
});

test('setStatus POSTs only {id,status}', async () => {
  handler = (req, res) => res.end('{"ok":true}');
  await api().setStatus('SDT-AAAA', 'made');
  const last = seen.at(-1);
  assert.equal(last.method, 'POST');
  assert.deepEqual(JSON.parse(last.body), { id: 'SDT-AAAA', status: 'made' });
});

test('getPhoto returns bytes and content type; id/t are query-encoded', async () => {
  handler = (req, res) => { res.setHeader('content-type', 'image/png'); res.end(Buffer.from([1, 2, 3])); };
  const p = await api().getPhoto('SDT-AAAA', 2);
  assert.deepEqual([...p.bytes], [1, 2, 3]);
  assert.equal(p.contentType, 'image/png');
  assert.equal(seen.at(-1).url, '/api/photo?id=SDT-AAAA&t=2');
});

test('getPhoto aborts above 10 MB', async () => {
  handler = (req, res) => { res.setHeader('content-type', 'image/jpeg'); res.end(Buffer.alloc(10 * 1024 * 1024 + 10)); };
  await assert.rejects(api().getPhoto('SDT-AAAA', 0), (e) => e.code === 'TOO_BIG');
});

test('R6: the logger scrubs a registered secret', () => {
  addSecret(KEY);
  log.info(`calling with ${KEY} inside`);
  const line = log.recent().at(-1);
  assert.ok(!line.includes(KEY));
  assert.ok(line.includes('[redacted]'));
});
