import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, mkdtemp, mkdir, writeFile, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import dgram from 'node:dgram';
import { fileURLToPath } from 'node:url';
import { createLightBurn } from '../lib/lightburn.mjs';
import { mockLightBurn, lbConfig } from './helpers.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const queueDir = await mkdtemp(path.join(os.tmpdir(), 'sdt-lbq-'));
await mkdir(path.join(queueDir, 'SDT-AAAA'));
const good = path.join(queueDir, 'SDT-AAAA', 'SDT-AAAA-tag1-front.lbrn2');
await writeFile(good, '<x/>');
const cleanups = [];
after(async () => { for (const c of cleanups) await c(); });

async function setup(handler, over) {
  const mock = await mockLightBurn(handler);
  const lb = createLightBurn({ config: { ...lbConfig(mock, over) }, queueDir });
  await lb.start();
  cleanups.push(() => lb.close(), () => mock.close());
  return { mock, lb };
}

test('R1: send() refuses START in any casing or spacing, and the mock receives nothing', async () => {
  const { mock, lb } = await setup();
  for (const cmd of ['START', 'start', ' start:/x', '\tStArT', 'START:foo']) {
    assert.throws(() => lb.send(cmd), /START is forbidden/, JSON.stringify(cmd));
  }
  await new Promise((r) => setTimeout(r, 100));
  assert.deepEqual(mock.received, []);
});

test('R1: no source file can send START (grep guard)', async () => {
  const root = path.join(here, '..');
  const files = [];
  async function walk(d) {
    for (const e of await readdir(d, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name === 'test' || e.name === 'data' || e.name === 'logs') continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) await walk(p); else if (/\.(mjs|js|html)$/.test(e.name)) files.push(p);
    }
  }
  await walk(root);
  assert.ok(files.length >= 3);
  const offenders = [];
  for (const f of files) {
    (await readFile(f, 'utf8')).split('\n').forEach((line, i) => {
      // the single marked guard line is the only place the word may appear
      if (/\bSTART\b/.test(line) && !line.includes('R1-GUARD')) offenders.push(`${path.relative(root, f)}:${i + 1}: ${line.trim()}`);
    });
  }
  assert.deepEqual(offenders, []);
  // and the guard line itself exists exactly once, in lightburn.mjs
  const lbSrc = await readFile(path.join(root, 'lib', 'lightburn.mjs'), 'utf8');
  assert.equal(lbSrc.split('\n').filter((l) => l.includes('R1-GUARD')).length, 1);
});

test('ping and status map replies', async () => {
  const { lb } = await setup((c) => (c === 'PING' ? 'OK' : c === 'STATUS' ? '!' : '?'));
  assert.equal((await lb.ping()).up, true);
  const s = await lb.status();
  assert.equal(s.busy, true);
  assert.equal(lb.health().status, 'busy');
});

test('FORCELOAD sends the absolute path (spaces ok), OK succeeds, no trailing newline', async () => {
  const { mock, lb } = await setup();
  const r = await lb.forceLoad(good);
  assert.equal(r.ok, true);
  assert.equal(r.warning, undefined);
  assert.ok(mock.received.includes(`FORCELOAD:${good}`));
  assert.ok(mock.received.every((c) => !c.endsWith('\n')));
  assert.equal(mock.received.filter((c) => c.startsWith('LOADFILE')).length, 0);
});

test('LOADFILE (non-forcing) uses its own verb', async () => {
  const { mock, lb } = await setup();
  assert.equal((await lb.loadFile(good)).ok, true);
  assert.ok(mock.received.includes(`LOADFILE:${good}`));
  assert.equal(mock.received.filter((c) => c.startsWith('FORCELOAD')).length, 0);
});

test('R3: a second load within 5 s is RATE_LIMITED and nothing is sent; shared across both verbs', async () => {
  const { mock, lb } = await setup();
  assert.equal((await lb.forceLoad(good)).ok, true);
  const before = mock.received.length;
  const r2 = await lb.forceLoad(good);
  assert.equal(r2.ok, false); assert.equal(r2.code, 'RATE_LIMITED');
  assert.ok(r2.retryAfterMs > 0 && r2.retryAfterMs <= 5000);
  const r3 = await lb.loadFile(good);
  assert.equal(r3.code, 'RATE_LIMITED');
  assert.equal(mock.received.length, before);
  assert.equal(lb.recentlyLoaded(), true);
});

test('the gap is configurable and expires', async () => {
  const { lb } = await setup(undefined, { minLoadGapMs: 120 });
  assert.equal((await lb.forceLoad(good)).ok, true);
  await new Promise((r) => setTimeout(r, 160));
  assert.equal((await lb.forceLoad(good)).ok, true);
});

test('no reply: TIMEOUT after timeoutMs; load returns LB_DOWN', async () => {
  const { lb } = await setup(() => null, { timeoutMs: 120 });
  const t0 = Date.now();
  assert.equal(await lb.send('PING'), 'TIMEOUT');
  assert.ok(Date.now() - t0 >= 100);
  assert.equal((await lb.forceLoad(good)).code, 'LB_DOWN');
});

test('default timeout is 2000 ms in config.json', async () => {
  const cfg = JSON.parse(await readFile(path.join(here, '..', 'config.json'), 'utf8'));
  assert.equal(cfg.lightburn.timeoutMs, 2000);
  assert.equal(cfg.lightburn.minLoadGapMs, 5000);
});

test('replies: ! -> LB_REFUSED, ? -> LB_INVALID, silence after ping -> LB_TIMEOUT', async () => {
  let mode = '!';
  const { lb } = await setup((c) => (c === 'PING' ? 'OK' : mode === 'silent' ? null : mode));
  assert.equal((await lb.forceLoad(good)).code, 'LB_REFUSED');
  await new Promise((r) => setTimeout(r, 0));
  const lb2 = await setup((c) => (c === 'PING' ? 'OK' : '?'));
  assert.equal((await lb2.lb.forceLoad(good)).code, 'LB_INVALID');
  const lb3 = await setup((c) => (c === 'PING' ? 'OK' : null));
  assert.equal((await lb3.lb.forceLoad(good)).code, 'LB_TIMEOUT');
});

test('a dialog after load (PING stops answering) attaches the warning', async () => {
  let loaded = false;
  const { lb } = await setup((c) => { if (c.startsWith('FORCELOAD')) { loaded = true; return 'OK'; } return loaded ? null : 'OK'; });
  const r = await lb.forceLoad(good);
  assert.equal(r.ok, true);
  assert.match(r.warning, /showing a dialog/);
});

test('paths are validated before anything is sent', async () => {
  const { mock, lb } = await setup();
  const outside = path.join(os.tmpdir(), 'evil.lbrn2');
  await writeFile(outside, '<x/>');
  const bad = [
    outside,
    path.join(queueDir, '..', 'evil.lbrn2'),
    path.join(queueDir, 'SDT-AAAA', '..', '..', 'evil.lbrn2'),
    'relative/SDT-AAAA-tag1-front.lbrn2',
    path.join(queueDir, 'SDT-AAAA', 'job.json'),
    path.join(queueDir, 'SDT-AAAA', 'missing.lbrn2'),
    `${good}\nSTART`,
    `${good}\0`,
    `${good}\r`,
    queueDir + '-sibling/x.lbrn2',
    '', null, undefined, 42
  ];
  for (const p of bad) {
    const r = await lb.forceLoad(p);
    assert.equal(r.ok, false, String(p));
    assert.equal(r.code, 'BAD_PATH', String(p));
  }
  assert.equal(mock.received.length, 0);
});

test('EADDRINUSE on the reply port disables the client instead of crashing', async () => {
  const mock = await mockLightBurn();
  const hog = dgram.createSocket('udp4');
  await new Promise((r) => hog.bind(mock.replyPort, '127.0.0.1', r));
  const lb = createLightBurn({ config: lbConfig(mock), queueDir });
  const ok = await lb.start();
  assert.equal(ok, false);
  assert.equal(lb.disabled, true);
  assert.equal(lb.health().disabled, true);
  assert.equal((await lb.ping()).up, false);
  await lb.close();
  await new Promise((r) => hog.close(r));
  await mock.close();
});

test('commands are serialised: concurrent pings each get their own reply', async () => {
  const { lb } = await setup();
  const rs = await Promise.all([lb.ping(), lb.ping(), lb.ping(), lb.status()]);
  assert.deepEqual(rs.map((r) => r.up ?? r.ok), [true, true, true, true]);
});

test('N1: verb whitelist: only PING, STATUS, LOADFILE:<path>, FORCELOAD:<path> go out; START may not appear anywhere', async () => {
  const { mock, lb } = await setup();
  for (const cmd of ['STOP', 'ping', 'PING:x', 'STATUS ', 'LOADFILE', 'LOADFILE:', 'FORCELOAD', 'GOTO:1', 'MOVE:1,2', 'PING\nSTOP', 'LOADFILE:/a\nSTOP', '']) {
    assert.throws(() => lb.send(cmd), /command not allowed/, JSON.stringify(cmd));
  }
  for (const cmd of ['LOADFILE:/Users/x/START.lbrn2', 'FORCELOAD:/a/b/restart/x.lbrn2', 'PING START', 'loadfile:/x/Start.lbrn2', 'XSTART']) {
    assert.throws(() => lb.send(cmd), /START is forbidden/, JSON.stringify(cmd));
  }
  assert.equal(await lb.send('PING'), 'OK');
  assert.equal(await lb.send('STATUS'), 'OK');
  assert.deepEqual(mock.received, ['PING', 'STATUS']);
});

test('N2: a symlink inside the queue that points outside is rejected (file and directory)', async () => {
  const { mock, lb } = await setup();
  const outsideDir = await mkdtemp(path.join(os.tmpdir(), 'sdt-outside-'));
  const target = path.join(outsideDir, 'evil.lbrn2');
  await writeFile(target, '<x/>');
  const fileLink = path.join(queueDir, 'SDT-AAAA', 'SDT-AAAA-tag9-front.lbrn2');
  await symlink(target, fileLink);
  const dirLink = path.join(queueDir, 'SDT-LINK');
  await symlink(outsideDir, dirLink);
  const r1 = await lb.forceLoad(fileLink);
  assert.equal(r1.code, 'BAD_PATH'); assert.match(r1.error, /outside the queue folder/);
  const r2 = await lb.forceLoad(path.join(dirLink, 'evil.lbrn2'));
  assert.equal(r2.code, 'BAD_PATH');
  assert.equal(lb.validatePath(good), null, 'a normal file still validates');
  assert.equal(mock.received.length, 0);
});
