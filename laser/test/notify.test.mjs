import { test } from 'node:test';
import assert from 'node:assert/strict';
import { notify, notifyArgs, OSASCRIPT } from '../lib/notify.mjs';
import { log } from '../lib/log.mjs';

const stub = (err = null) => { const calls = []; return { calls, exec: (bin, args, opts, cb) => { calls.push({ bin, args, opts }); cb(err); } }; };

test('notify: osascript gets the text as argv through `on run argv`, never inside the script', async () => {
  const s = stub();
  const evil = `x" & (do shell script "touch /tmp/pwned") & "`;
  assert.equal(await notify({ title: 'Salty Dog Tags', body: evil, config: {}, exec: s.exec }), true);
  const { bin, args, opts } = s.calls[0];
  assert.equal(bin, OSASCRIPT);
  assert.deepEqual(args, ['-e', 'on run argv', '-e', 'display notification (item 1 of argv) with title (item 2 of argv)', '-e', 'end run', '--', evil, 'Salty Dog Tags']);
  assert.ok(!args.slice(0, 6).join('\n').includes('pwned'));
  assert.equal(opts.timeout, 3000);
});

test('notify: control characters are folded and the body is capped', () => {
  const a = notifyArgs({ title: 'T', body: 'a\nb\u0000c' + 'z'.repeat(500) });
  assert.ok(!/[\u0000-\u001f]/.test(a.at(-2)));
  assert.equal(a.at(-2).length, 200);
});

test('notify: off when config.notify is false; errors are swallowed', async () => {
  const s = stub();
  assert.equal(await notify({ body: 'x', config: { notify: false }, exec: s.exec }), false);
  assert.equal(s.calls.length, 0);
  const bad = stub(Object.assign(new Error('boom'), { code: 'ETIMEDOUT' }));
  assert.equal(await notify({ body: 'x', config: {}, exec: bad.exec }), false);
  assert.equal(await notify({ body: 'x', config: {}, exec: () => { throw new Error('sync boom'); } }), false);
});

test('notify: without an injected exec, the test runner never shows a real notification', async () => {
  assert.equal(await notify({ body: 'x', config: {} }), false);
});

test('review: a failed notification never puts the body (order data) in the log, including the execFile timeout message', async () => {
  log.clear();
  const secret = 'SDT-7KQ2 Colour accent (full line, SECRETHUE)';
  // execFile's own error on a timeout: code null, killed, message = "Command failed: <bin> <all argv>"
  const timeout = Object.assign(new Error(`Command failed: ${OSASCRIPT} -e x -- ${secret} Salty Dog Tags\n`), { code: null, killed: true, signal: 'SIGTERM' });
  assert.equal(await notify({ body: secret, config: {}, exec: (b, a, o, cb) => cb(timeout) }), false);
  const exit1 = Object.assign(new Error(`Command failed: ${OSASCRIPT} ${secret}`), { code: 1 });
  assert.equal(await notify({ body: secret, config: {}, exec: (b, a, o, cb) => cb(exit1) }), false);
  const sync = Object.assign(new Error(`bad argument Received '${secret}'`), { code: 'ERR_INVALID_ARG_VALUE' });
  assert.equal(await notify({ body: secret, config: {}, exec: () => { throw sync; } }), false);
  const lines = log.recent().filter((l) => /notify failed/.test(l));
  assert.equal(lines.length, 3);
  for (const l of lines) assert.ok(!/SECRETHUE|SDT-7KQ2|osascript/.test(l), l);
  assert.match(lines[0], /notify failed: SIGTERM$/);
  assert.match(lines[1], /notify failed: 1$/);
  assert.match(lines[2], /notify failed: ERR_INVALID_ARG_VALUE$/);
});
