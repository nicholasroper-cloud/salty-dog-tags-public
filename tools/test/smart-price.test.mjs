// node --test tools/test/  Smart QR tag: the client and server copies of the price and wording stay equal; static files and flag file are sane.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { SMART_PRICE, SMART_LINE } from '../../functions/api/_lib.js';

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL('../../', import.meta.url));
const read = (p) => readFileSync(root + p, 'utf8');
const SDTQR = require('../../site/tag-qr.js');

test('app.js mirrors SMART_PRICE and SMART_LINE from _lib.js', () => {
  const app = read('site/app.js');
  assert.equal(Number(/smartCents: (\d+)/.exec(app)[1]), SMART_PRICE);
  assert.equal(/const SMART_LINE = '([^']+)'/.exec(app)[1], SMART_LINE);
});

test('the home page loads tag-layout, qrcodegen, tag-qr before app.js, and the smart box is in the back fieldset', () => {
  const h = read('site/index.html');
  const i = (n) => h.indexOf(n);
  assert.ok(i('/tag-layout.js') > 0 && i('/vendor/qrcodegen.js') > i('/tag-layout.js') && i('/tag-qr.js') > i('/vendor/qrcodegen.js') && i('/app.js') > i('/tag-qr.js'));
  assert.ok(h.indexOf('id="smartBox"') > h.indexOf('<b>03</b>') && h.indexOf('id="smartBox"') < h.indexOf('<b>04</b>'));
  assert.match(h, /id="smartBox" hidden/, 'hidden until /api/config turns it on');
});

test('static files for the QR are served without a Function (listed in _routes.json exclude)', () => {
  const ex = JSON.parse(read('site/_routes.json')).exclude;
  for (const f of ['/tag-qr.js', '/vendor/*', '/t.js', '/t.css', '/claim.js', '/my.js', '/slip.css', '/tag-qr-finishes.json']) assert.ok(ex.includes(f), f);
});

test('tag-qr-finishes.json: known finishes only, valid states, matches the gate table the ADR set', () => {
  const j = JSON.parse(read('site/tag-qr-finishes.json'));
  for (const [k, v] of Object.entries(j.finishes)) { assert.ok(SDTQR.FINISHES[k], k); assert.ok(['on', 'test', 'off'].includes(v), k); }
  for (const k of Object.keys(SDTQR.FINISHES)) assert.ok(k in j.finishes, `${k} missing from the flag file`);
  for (const k of ['stainless', 'polished', 'black', 'royal', 'red', 'green']) assert.equal(j.finishes[k], 'on', k);
  for (const k of ['silver', 'sky', 'yellow', 'pink', 'hotpink', 'ssblack', 'navy', 'gold', 'bronze', 'brass']) assert.equal(j.finishes[k], 'test', k);
  assert.equal(j.finishes.rainbow, 'off');
});

test('vendored libraries carry their licenses', () => {
  assert.match(read('site/vendor/QRCODEGEN-LICENSE.txt'), /MIT License/);
  assert.match(read('site/vendor/qrcodegen.js'), /Project Nayuki. MIT License/);
  assert.match(read('site/vendor/JSQR-LICENSE.txt'), /Apache License/);
  assert.ok(existsSync(root + 'site/vendor/jsqr.js'));
});
