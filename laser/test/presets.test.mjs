import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, mkdtemp, cp, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { importPreset, parseScanLayer, validatePreset, loadPreset, presetFor, validateAllMapped, PRESETS_DIR } from '../lib/presets.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(await readFile(path.join(here, '..', 'config.json'), 'utf8'));
const SRC = path.join(here, 'fixtures', 'preset-source.lbrn2');
const COLOUR_FILE = path.join(os.homedir(), 'Desktop/Laser Files/LightBurn Projects/Thirsty Beaches Dog Tag - Color.lbrn2');

async function tmpPresets() {
  const d = await mkdtemp(path.join(os.tmpdir(), 'sdt-presets-'));
  await cp(PRESETS_DIR, d, { recursive: true });
  return d;
}

test('seed presets are valid and every finishPreset target exists', async () => {
  assert.deepEqual(await validateAllMapped(config), []);
  for (const n of ['anodized', 'stainless', 'polished', 'brass']) {
    const p = await loadPreset(n);
    assert.equal(p.status, 'untested');
  }
  assert.deepEqual((await loadPreset('stainless')).cutSetting, (await loadPreset('polished')).cutSetting);
  assert.deepEqual(await loadPreset('anodized').then((p) => p.cutSetting), { maxPower: 70, maxPower2: 20, speed: 800, frequency: 50000, QPulseWidth: 250, interval: 0.02 });
});

test('finish map: unknown finish has no preset', async () => {
  assert.equal((await presetFor('black', config)).name, 'anodized');
  assert.equal((await presetFor('navy', config)).name, 'stainless');
  assert.equal(await presetFor('sparkle', config), undefined);
  assert.equal(await presetFor('__proto__', config), undefined);
});

test('validation: reserved keys, bad keys, bad values, bad status', () => {
  const base = { name: 'abc', status: 'tuned', cutSetting: { speed: 1 } };
  assert.deepEqual(validatePreset(base), []);
  assert.ok(validatePreset({ ...base, cutSetting: { scanOpt: 'x' } }).length);
  assert.ok(validatePreset({ ...base, cutSetting: { index: 1 } }).length);
  assert.ok(validatePreset({ ...base, cutSetting: { '1bad': 1 } }).length);
  assert.ok(validatePreset({ ...base, cutSetting: { speed: Infinity } }).length);
  assert.ok(validatePreset({ ...base, cutSetting: { note: 'x'.repeat(65) } }).length);
  assert.ok(validatePreset({ ...base, status: 'great' }).length);
  assert.ok(validatePreset({ ...base, name: 'Bad Name' }).length);
});

test('import picks the first Scan layer; strips scanOpt (warn), SubLayer (warn), reserved keys; unescapes', async () => {
  const r = parseScanLayer(await readFile(SRC, 'utf8'));
  assert.equal(r.layerIndex, '1');
  assert.deepEqual(r.cutSetting, { maxPower: 70, maxPower2: 20, speed: 800, frequency: 50000, QPulseWidth: 250, interval: 0.02, comment: 'a "quoted" note' });
  assert.ok(r.warnings.includes('sub-layers ignored'));
  assert.ok(r.warnings.some((w) => w.startsWith('scanOpt=individual dropped')));
});

test('import --layer selects by index; no Scan layer is an error', async () => {
  assert.deepEqual(parseScanLayer(await readFile(SRC, 'utf8'), 7).cutSetting, { maxPower: 33, speed: 150 });
  assert.throws(() => parseScanLayer('<LightBurnProject><CutSetting type="Cut"><index Value="0"/></CutSetting></LightBurnProject>'), /no Scan layer found/);
  assert.throws(() => parseScanLayer('<LightBurnProject><CutSetting type="Scan"><index Value="1"/></CutSetting></LightBurnProject>', 99), /no Scan layer found/);
});

test('import writes a tuned preset, moves the previous one to history, prints a diff', async () => {
  const dir = await tmpPresets();
  const res = await importPreset({ file: SRC, name: 'anodized', config, presetsDir: dir, now: new Date('2026-10-16T19:00:00Z') });
  assert.equal(res.preset.status, 'tuned');
  assert.match(res.preset.source, /^imported from preset-source\.lbrn2 layer 1 \(2\.1\.03\)$/);
  assert.equal(res.preset.updatedAt, '2026-10-16');
  assert.ok(res.diff.some((l) => l.includes('maxPower: 70')));
  const hist = await readdir(path.join(dir, 'history'));
  assert.deepEqual(hist, ['anodized-20261016-190000.json']);
  const old = JSON.parse(await readFile(path.join(dir, 'history', hist[0]), 'utf8'));
  assert.equal(old.status, 'untested');
  assert.equal((await loadPreset('anodized', dir)).status, 'tuned');
});

test('import warns when the new preset is not mapped; a changed value shows old -> new in the diff', async () => {
  const dir = await tmpPresets();
  const res = await importPreset({ file: SRC, name: 'stainless', layer: 7, config, presetsDir: dir });
  assert.ok(res.diff.some((l) => /speed: 150$/.test(l)));
  assert.ok(res.diff.some((l) => /maxPower: 32 -> 33/.test(l)));
  const res2 = await importPreset({ file: SRC, name: 'mynew', config, presetsDir: dir });
  assert.ok(res2.warnings.some((w) => w.includes('preset will not be used until mapped')));
});

test('import rejects bad names, wrong extension, missing file', async () => {
  const dir = await tmpPresets();
  for (const name of ['Bad', 'a', '../evil', 'has space', '1abc']) {
    await assert.rejects(importPreset({ file: SRC, name, config, presetsDir: dir }), /preset name/);
  }
  const txt = path.join(dir, 'x.txt'); await writeFile(txt, 'x');
  await assert.rejects(importPreset({ file: txt, name: 'okname', config, presetsDir: dir }), /\.lbrn2/);
  await assert.rejects(importPreset({ file: path.join(dir, 'nope.lbrn2'), name: 'okname', config, presetsDir: dir }));
  assert.deepEqual((await readdir(dir)).filter((n) => n === 'okname.json'), []);
});

test('import from Nick colour file picks layer C01 values (skipped if the file is absent)', async (t) => {
  if (!existsSync(COLOUR_FILE)) return t.skip('colour file not on this machine');
  const r = parseScanLayer(await readFile(COLOUR_FILE, 'utf8'));
  assert.equal(r.cutSetting.maxPower, 70);
  assert.equal(r.cutSetting.speed, 800);
  assert.equal(r.cutSetting.frequency, 50000);
  assert.equal(r.cutSetting.QPulseWidth, 250);
  assert.equal(r.cutSetting.interval, 0.02);
});
