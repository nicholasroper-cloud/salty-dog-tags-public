import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, readdir, mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { openState } from '../lib/state.mjs';
import { acquireLock, LockHeldError } from '../lib/lock.mjs';

const tmp = () => mkdtemp(path.join(os.tmpdir(), 'sdt-state-'));
const base = { dir: '/q/SDT-AAAA', orderAt: 1, customerName: 'A', remoteStatus: 'paid' };

test('(none) -> queued, and (none) -> manual', async () => {
  const s = await openState(path.join(await tmp(), 'state.json'));
  assert.equal(s.generated('SDT-AAAA', { ...base, mode: 'queued' }).status, 'queued');
  assert.equal(s.generated('SDT-BBBB', { ...base, mode: 'manual' }).status, 'manual');
  assert.throws(() => s.generated('SDT-CCCC', { ...base, mode: 'done' }));
});

test('(none) -> error with attempts += 1; retry allowed below 3 attempts', async () => {
  const s = await openState(path.join(await tmp(), 'state.json'));
  s.failed('SDT-AAAA', 'fonts unavailable: x');
  assert.equal(s.job('SDT-AAAA').status, 'error');
  assert.equal(s.job('SDT-AAAA').attempts, 1);
  assert.equal(s.retryable('SDT-AAAA'), true);
  s.failed('SDT-AAAA', 'again'); s.failed('SDT-AAAA', 'again');
  assert.equal(s.job('SDT-AAAA').attempts, 3);
  assert.equal(s.retryable('SDT-AAAA'), false);
});

test('error -> regenerate resets attempts and clears error', async () => {
  const s = await openState(path.join(await tmp(), 'state.json'));
  s.failed('SDT-AAAA', 'boom', base);
  s.generated('SDT-AAAA', { ...base, mode: 'queued' });
  assert.equal(s.job('SDT-AAAA').attempts, 0);
  assert.equal(s.job('SDT-AAAA').error, null);
});

test('queued -> loaded on a successful load; manual stays manual; lastLoaded updated', async () => {
  const s = await openState(path.join(await tmp(), 'state.json'));
  s.generated('SDT-AAAA', { ...base, mode: 'queued' });
  s.generated('SDT-BBBB', { ...base, mode: 'manual' });
  s.loaded('SDT-AAAA', 'a.lbrn2');
  assert.equal(s.job('SDT-AAAA').status, 'loaded');
  assert.equal(s.data.lastLoaded.file, 'a.lbrn2');
  s.loaded('SDT-BBBB', 'b.lbrn2');
  assert.equal(s.job('SDT-BBBB').status, 'manual');
  assert.equal(s.data.lastLoaded.orderId, 'SDT-BBBB');
});

test('queued, loaded, manual, error -> done on Mark engraved (ui); done cannot be engraved again', async () => {
  const s = await openState(path.join(await tmp(), 'state.json'));
  for (const [id, mode] of [['SDT-AAAA', 'queued'], ['SDT-BBBB', 'manual']]) s.generated(id, { ...base, mode });
  s.loaded('SDT-AAAA', 'a'); s.failed('SDT-CCCC', 'x');
  for (const id of ['SDT-AAAA', 'SDT-BBBB', 'SDT-CCCC']) {
    assert.equal(s.engraved(id).status, 'done');
    assert.equal(s.job(id).doneSource, 'ui');
  }
  assert.throws(() => s.engraved('SDT-AAAA'));
});

test('remote made/shipped/done -> done (remote); paid stays; cancelled only flags', async () => {
  const s = await openState(path.join(await tmp(), 'state.json'));
  for (const [i, st] of ['made', 'shipped', 'done'].entries()) {
    const id = `SDT-AAA${i}`;
    s.generated(id, { ...base, mode: 'queued' });
    s.remote(id, st);
    assert.equal(s.job(id).status, 'done'); assert.equal(s.job(id).doneSource, 'remote');
  }
  s.generated('SDT-BBBB', { ...base, mode: 'queued' });
  s.remote('SDT-BBBB', 'paid');
  assert.equal(s.job('SDT-BBBB').status, 'queued');
  s.remote('SDT-BBBB', 'cancelled');
  assert.equal(s.job('SDT-BBBB').status, 'queued');
  assert.equal(s.job('SDT-BBBB').remoteStatus, 'cancelled');
});

test('demo jobs ignore remote sync and missing flags', async () => {
  const s = await openState(path.join(await tmp(), 'state.json'));
  s.generated('SDT-DEMO', { ...base, mode: 'queued', demo: true });
  assert.equal(s.remote('SDT-DEMO', 'made'), null);
  assert.equal(s.missing('SDT-DEMO'), false);
  assert.equal(s.job('SDT-DEMO').status, 'queued');
});

test('order absent from the API sets remoteMissing; reappearing clears it', async () => {
  const s = await openState(path.join(await tmp(), 'state.json'));
  s.generated('SDT-AAAA', { ...base, mode: 'queued' });
  assert.equal(s.missing('SDT-AAAA'), true);
  assert.equal(s.job('SDT-AAAA').remoteMissing, true);
  assert.equal(s.job('SDT-AAAA').status, 'queued');
  s.remote('SDT-AAAA', 'paid');
  assert.equal(s.job('SDT-AAAA').remoteMissing, false);
});

test('regenerate from any status goes back to queued/manual', async () => {
  const s = await openState(path.join(await tmp(), 'state.json'));
  s.generated('SDT-AAAA', { ...base, mode: 'queued' });
  s.engraved('SDT-AAAA');
  s.generated('SDT-AAAA', { ...base, mode: 'manual' });
  assert.equal(s.job('SDT-AAAA').status, 'manual');
  assert.equal(s.job('SDT-AAAA').doneSource, null);
});

test('R4 save round-trips and keeps a .bak of the previous version', async () => {
  const f = path.join(await tmp(), 'state.json');
  const s = await openState(f);
  s.generated('SDT-AAAA', { ...base, mode: 'queued' });
  await s.save();
  s.generated('SDT-BBBB', { ...base, mode: 'queued' });
  await s.save();
  const again = await openState(f);
  assert.deepEqual(Object.keys(again.jobs).sort(), ['SDT-AAAA', 'SDT-BBBB']);
  const bak = JSON.parse(await readFile(f + '.bak', 'utf8'));
  assert.deepEqual(Object.keys(bak.jobs), ['SDT-AAAA']);
});

test('R4 atomic: a crash between write and rename leaves the old file valid', async () => {
  const dir = await tmp(); const f = path.join(dir, 'state.json');
  const s = await openState(f);
  s.generated('SDT-AAAA', { ...base, mode: 'queued' });
  await s.save();
  const crashing = await openState(f, { beforeRename: () => { throw new Error('simulated crash'); } });
  crashing.generated('SDT-BBBB', { ...base, mode: 'queued' });
  await assert.rejects(crashing.save(), /simulated crash/);
  const after = await openState(f);
  assert.deepEqual(Object.keys(after.jobs), ['SDT-AAAA']);
  assert.ok((await readdir(dir)).some((n) => n.startsWith('state.json.tmp-')), 'torn temp file is left behind, not renamed');
});

test('saves are serialised: concurrent saves all land and the last write wins', async () => {
  const f = path.join(await tmp(), 'state.json');
  const s = await openState(f);
  const ps = [];
  for (let i = 0; i < 20; i++) { s.generated(`SDT-A${String(i).padStart(3, '0')}`.slice(0, 8), { ...base, mode: 'queued' }); ps.push(s.save()); }
  await Promise.all(ps);
  assert.equal(Object.keys((await openState(f)).jobs).length, Object.keys(s.jobs).length);
});

test('corrupt state.json: moved aside, .bak used', async () => {
  const dir = await tmp(); const f = path.join(dir, 'state.json');
  const s = await openState(f);
  s.generated('SDT-AAAA', { ...base, mode: 'queued' }); await s.save();
  s.generated('SDT-BBBB', { ...base, mode: 'queued' }); await s.save();   // .bak now has only AAAA
  await writeFile(f, '{ not json');
  const r = await openState(f);
  assert.deepEqual(Object.keys(r.jobs), ['SDT-AAAA']);
  assert.ok((await readdir(dir)).some((n) => /^state\.corrupt-\d{8}-\d{6}\.json$/.test(n)));
});

test('corrupt state.json and no usable .bak: start empty', async () => {
  const dir = await tmp(); const f = path.join(dir, 'state.json');
  await writeFile(f, 'garbage'); await writeFile(f + '.bak', 'also garbage');
  const r = await openState(f);
  assert.deepEqual(r.jobs, {});
  assert.equal(r.data.schema, 1);
});

test('lock: second acquire fails while held; stale lock (dead pid) is taken over; release frees it', async () => {
  const dir = await tmp(); const f = path.join(dir, '.lock');
  const a = await acquireLock(f);
  await assert.rejects(acquireLock(f), LockHeldError);
  await a.release();
  await writeFile(f, '999999');   // no such pid
  const b = await acquireLock(f);
  assert.equal((await readFile(f, 'utf8')).trim(), String(process.pid));
  await b.release();
  assert.ok(!(await readdir(dir)).includes('.lock'));
});
