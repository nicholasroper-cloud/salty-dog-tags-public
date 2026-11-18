import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkConfig, mergeConfig } from '../lib/config.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const base = JSON.parse(await readFile(path.join(here, '..', 'config.json'), 'utf8'));
const cfg = (local) => mergeConfig(base, local);

test('the shipped config.json is valid', () => {
  assert.deepEqual(checkConfig(cfg({})), []);
});

test('R5: ui.host must be 127.0.0.1', () => {
  assert.ok(checkConfig(cfg({ ui: { host: '0.0.0.0' } })).some((p) => /ui\.host/.test(p)));
  assert.ok(checkConfig(cfg({ ui: { host: 'localhost' } })).some((p) => /ui\.host/.test(p)));
});

test('N5: lightburn.host must be loopback', () => {
  for (const host of ['192.168.1.20', '0.0.0.0', 'example.com', '::1', '', undefined]) {
    assert.ok(checkConfig(cfg({ lightburn: { host } })).some((p) => /lightburn\.host/.test(p)), String(host));
  }
  for (const host of ['127.0.0.1', 'localhost']) assert.deepEqual(checkConfig(cfg({ lightburn: { host } })), [], host);
});

test('other validations: fieldCenter range, eligibleStatuses, kvPlan, autoLoad types, https apiBase', () => {
  assert.ok(checkConfig(cfg({ fieldCenter: [250, 100] })).length);
  assert.ok(checkConfig(cfg({ eligibleStatuses: ['paid', 'new'] })).length);
  assert.ok(checkConfig(cfg({ kvPlan: 'enterprise' })).length);
  assert.ok(checkConfig(cfg({ autoLoad: 'yes' })).length);
  assert.ok(checkConfig(cfg({ apiBase: 'http://saltydogtags.com' })).length);
  assert.ok(checkConfig(cfg({ pollSeconds: 1 })).length);
});
