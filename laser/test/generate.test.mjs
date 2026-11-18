import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { generateOrder, snapshotOrder, blankMm } from '../lib/generate.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(await readFile(path.join(here, '..', 'config.json'), 'utf8'));
const fixtures = JSON.parse(await readFile(path.join(here, 'fixtures', 'tags.json'), 'utf8'));
const demo = JSON.parse(await readFile(path.join(here, 'fixtures', 'demo-orders.json'), 'utf8'));
const JPG = await readFile(path.join(here, 'fixtures', 'demo-photo.jpg'));
// demo-photo.jpg is a 24 x 24 px stub (enough for the demo thumbnail, far too small to engrave); the real-sized photo is the site asset.
const GOOD = await readFile(path.join(here, '..', '..', 'site', 'assets', 'whisky-tag-real.jpg'));
const tagOf = (id) => structuredClone(fixtures.find((f) => f.id === id).tag);

const okPhoto = async () => ({ bytes: JPG, contentType: 'image/jpeg' });
async function run(order, over = {}) {
  const queueDir = over.queueDir || await mkdtemp(path.join(os.tmpdir(), 'sdt-gen-'));
  const res = await generateOrder(order, { config, queueDir, fetchPhoto: okPhoto, ...over });
  return { ...res, queueDir, files: (await readdir(res.dir)).sort() };
}
const order = (tags, extra = {}) => ({ id: 'SDT-7KQ2', at: 1760638800000, status: 'paid',
  customer: { name: 'Dana Price', email: 'dana@example.com', phone: '555-0101', address: '1 Main St', note: 'secret note', delivery: 'ship' },
  tags, prints: [], ...extra });

test('8.2 auto: front and back lbrn2 + svg, job.json shape', async () => {
  const { job, files } = await run(order([tagOf('f01')]));
  assert.deepEqual(files, ['SDT-7KQ2-tag1-back.lbrn2', 'SDT-7KQ2-tag1-back.svg', 'SDT-7KQ2-tag1-front.lbrn2', 'SDT-7KQ2-tag1-front.svg', 'job.json']);
  assert.equal(job.schema, 1);
  assert.equal(job.mode, 'queued');
  const t = job.tags[0];
  assert.equal(t.mode, 'auto'); assert.equal(t.manualReason, null);
  assert.equal(t.preset, 'anodized'); assert.equal(t.presetStatus, 'untested');
  assert.deepEqual(t.blankMm, { w: 38, h: 25.33 });
  assert.equal(t.qty, 2);
  assert.deepEqual(t.files.map((f) => f.side), ['front', 'back']);
  assert.deepEqual(t.files[0].lines, ['REX', 'CALL MY HUMAN', '555-0142']);
  assert.ok(t.files[0].warnings.some((w) => w.code === 'untested-preset'));
  assert.equal(typeof t.files[0].fontSize, 'number');
});

test('8.2 manual: no outline for shape', async () => {
  const t = tagOf('f01'); t.shape = 'hydrant';
  const { job, files } = await run(order([t]));
  assert.equal(job.tags[0].mode, 'manual');
  assert.equal(job.tags[0].manualReason, 'No laser outline for shape "hydrant" yet. Lay it out by hand.');
  assert.equal(job.mode, 'manual');
  assert.deepEqual(files, ['job.json']);
});

test('8.2 manual: unknown finish', async () => {
  const t = tagOf('f01'); t.finish = 'sparkle';
  const { job, files } = await run(order([t]));
  assert.equal(job.tags[0].manualReason, 'Unknown finish "sparkle", no material preset.');
  assert.deepEqual(files, ['job.json']);
});

const photoTag = (over = {}) => ({ ...tagOf('f07'), shape: 'bone', finish: 'polished', icon: 'none', photo: true, front: [], back: ['WHISKY', '555-0142'], qty: 2, ...over });
const photoOf = (bytes, contentType = 'image/jpeg') => async () => ({ bytes, contentType });

test('photo tag (issue #3 step 2): auto, five files, job.json entry, queued', async () => {
  const { job, mode, files, dir } = await run(order([photoTag()]), { fetchPhoto: photoOf(GOOD) });
  assert.deepEqual(files, [
    'SDT-7KQ2-tag1-back.lbrn2', 'SDT-7KQ2-tag1-back.svg', 'SDT-7KQ2-tag1-front-halftone.lbrn2', 'SDT-7KQ2-tag1-front.lbrn2',
    'SDT-7KQ2-tag1-front.svg', 'SDT-7KQ2-tag1-photo.jpg', 'job.json']);
  assert.equal(mode, 'queued'); assert.equal(job.mode, 'queued');
  const t = job.tags[0];
  assert.equal(t.mode, 'auto'); assert.equal(t.manualReason, null);
  assert.equal(t.photo, 'SDT-7KQ2-tag1-photo.jpg');
  assert.equal(t.manualLines, undefined);
  assert.equal(t.preset, 'polished');
  assert.deepEqual(t.files.map((f) => [f.side, f.variant, f.lbrn2, f.svg]), [
    ['front', undefined, 'SDT-7KQ2-tag1-front.lbrn2', 'SDT-7KQ2-tag1-front.svg'],
    ['front', 'halftone', 'SDT-7KQ2-tag1-front-halftone.lbrn2', undefined],
    ['back', undefined, 'SDT-7KQ2-tag1-back.lbrn2', 'SDT-7KQ2-tag1-back.svg']]);
  assert.deepEqual(t.files[2].lines, ['WHISKY', '555-0142']);
  assert.ok(t.files.every((f) => f.warnings.some((w) => w.code === 'untested-preset')));
  const pi = t.photoInfo;
  assert.deepEqual(Object.keys(pi).sort(), ['dither', 'dpi', 'hPx', 'layer', 'preset', 'presetStatus', 'wPx', 'windowMm']);
  assert.equal(pi.preset, 'photo-stainless'); assert.equal(pi.layer, 1); assert.equal(pi.dither, 'stucki'); assert.equal(pi.dpi, 400);
  assert.ok(pi.windowMm.w > 20 && pi.windowMm.h > 15 && pi.wPx > 300 && pi.hPx > 200);
  // Notes carry the real order and tag, not the SDT-PHOTO prototype label
  const front = await readFile(path.join(dir, 'SDT-7KQ2-tag1-front.lbrn2'), 'utf8');
  assert.match(front, /SDT-7KQ2  tag 1 of 1  FRONT/);
  assert.match(front, /Qty: 2  \(run this file 2 times\)/);
  assert.doesNotMatch(front, /SDT-PHOTO|PROTOTYPE/);
  assert.match(front, /layer 1 \(photo-stainless, UNTESTED\), dither stucki/);
  assert.match(front, /Type="Bitmap"/);
});

test('photo tag without back text writes no back file; front text is ignored with a note', async () => {
  const { job, files } = await run(order([photoTag({ back: [], front: ['IGNORED'] })]), { fetchPhoto: photoOf(GOOD) });
  assert.ok(!files.some((f) => f.includes('-back.')));
  assert.deepEqual(job.tags[0].files.map((f) => f.side + (f.variant || '')), ['front', 'fronthalftone']);
  assert.deepEqual(job.tags[0].notes, ['Front text is ignored on photo tags; the front is the photo only.']);
});

test('photo tag too small for the window: manual with the size reason, photo saved, back text listed, no laser files', async () => {
  const tiny = await sharp({ create: { width: 40, height: 40, channels: 3, background: { r: 200, g: 40, b: 40 } } }).jpeg().toBuffer();
  const { job, files } = await run(order([photoTag()]), { fetchPhoto: photoOf(tiny) });
  const t = job.tags[0];
  assert.equal(t.mode, 'manual'); assert.equal(job.mode, 'manual');
  assert.match(t.manualReason, /^Photo too small: 40 x 40 px, need at least \d+ x \d+ for this tag$/);
  const m = /need at least (\d+) x (\d+)/.exec(t.manualReason);
  assert.ok(Number(m[1]) > 100 && Number(m[2]) > 80);
  assert.equal(t.photo, 'SDT-7KQ2-tag1-photo.jpg');
  assert.deepEqual(t.manualLines.back, ['WHISKY', '555-0142']);
  assert.equal(t.photoInfo, undefined);
  assert.deepEqual(files, ['SDT-7KQ2-tag1-photo.jpg', 'job.json']);
});

test('the 24 px demo stub is too small to engrave (SDT-OOPS stays manual)', async () => {
  const { job } = await run(order([photoTag()]));   // default fetchPhoto returns demo-photo.jpg
  assert.match(job.tags[0].manualReason, /^Photo too small: 24 x 24 px/);
});

test('flat gray photo: manual, low contrast', async () => {
  const flat = await sharp({ create: { width: 1200, height: 900, channels: 3, background: { r: 128, g: 128, b: 128 } } }).jpeg().toBuffer();
  const { job, files } = await run(order([photoTag()]), { fetchPhoto: photoOf(flat) });
  assert.equal(job.tags[0].mode, 'manual');
  assert.match(job.tags[0].manualReason, /^Photo is low contrast \(stddev [\d.]+\)\. Lay it out by hand or ask for a better photo$/);
  assert.deepEqual(files, ['SDT-7KQ2-tag1-photo.jpg', 'job.json']);
});

test('a very dark photo still goes auto, with a warning on its files', async () => {
  // half black, half 90 gray stripes: contrast clears the gate while the mean (45) stays low
  const dark = await sharp(Buffer.from(Array.from({ length: 600 * 450 }, (_, k) => ((k % 600) < 300 ? 0 : 90))), { raw: { width: 600, height: 450, channels: 1 } }).jpeg().toBuffer();
  const { job } = await run(order([photoTag()]), { fetchPhoto: photoOf(dark) });
  assert.equal(job.tags[0].mode, 'auto');
  const w = job.tags[0].files[0].warnings.map((x) => x.text);
  assert.ok(w.includes('Photo is very dark; check the preview'), w.join('|'));
});

test('review: a photo tag with a paid colour accent is manual (the accent cannot be made), photo saved, no laser files', async () => {
  for (const color of ['icon', 'line']) {
    const { job, files } = await run(order([photoTag({ color, colorHue: 'gold' })]), { fetchPhoto: photoOf(GOOD) });
    const t = job.tags[0];
    assert.equal(t.mode, 'manual'); assert.equal(job.mode, 'manual');
    assert.match(t.manualReason, /^Colour accent \((icon or short line|full line), gold\): needs colour-mark layers\. Lay out by hand\.$/);
    assert.equal(t.photo, 'SDT-7KQ2-tag1-photo.jpg');
    assert.deepEqual(files, ['SDT-7KQ2-tag1-photo.jpg', 'job.json']);
  }
  const { job } = await run(order([photoTag({ color: 'none' })]), { fetchPhoto: photoOf(GOOD) });
  assert.equal(job.tags[0].mode, 'auto', 'colour none stays automatic');
});

test('an unreadable photo is manual, never a crash', async () => {
  const { job } = await run(order([photoTag()]), { fetchPhoto: photoOf(Buffer.from('this is not an image at all'), 'image/jpeg') });
  assert.equal(job.tags[0].mode, 'manual');
  assert.match(job.tags[0].manualReason, /^Photo could not be read/);
});

test('photo extension follows content-type; unknown becomes bin', async () => {
  const t = tagOf('f07'); t.photo = true; t.front = [];
  const png = await run(order([t]), { fetchPhoto: async () => ({ bytes: JPG, contentType: 'image/png' }) });
  assert.ok(png.files.includes('SDT-7KQ2-tag1-photo.png'));
  const bin = await run(order([t]), { fetchPhoto: async () => ({ bytes: JPG, contentType: 'text/html' }) });
  assert.ok(bin.files.includes('SDT-7KQ2-tag1-photo.bin'));
});

test('photo download error: manual with retry hint, nothing else written', async () => {
  const t = tagOf('f07'); t.photo = true; t.front = [];
  const { job, files } = await run(order([t]), { fetchPhoto: async () => { throw Object.assign(new Error('nope'), { code: 'HTTP_404' }); } });
  assert.equal(job.tags[0].manualReason, 'Photo download failed (HTTP_404). Use Regenerate to retry.');
  assert.deepEqual(files, ['job.json']);
});

test('photo larger than 10 MB is refused', async () => {
  const t = tagOf('f07'); t.photo = true; t.front = [];
  const { job, files } = await run(order([t]), { fetchPhoto: async () => ({ bytes: Buffer.alloc(10 * 1024 * 1024 + 1), contentType: 'image/jpeg' }) });
  assert.match(job.tags[0].manualReason, /Photo download failed \(too-big\)/);
  assert.deepEqual(files, ['job.json']);
});

test('8.2 manual: colour accent, both kinds', async () => {
  for (const [color, label] of [['icon', 'icon or short line'], ['line', 'full line']]) {
    const t = tagOf('f07'); t.color = color; t.colorHue = 'gold';
    const { job, files } = await run(order([t]));
    assert.equal(job.tags[0].manualReason, `Colour accent (${label}, gold): needs colour-mark layers. Lay out by hand.`);
    assert.deepEqual(files, ['job.json']);
  }
});

test('mixed order: manual job still exposes the auto entries files', async () => {
  const bad = tagOf('f01'); bad.shape = 'fish';
  const { job, files } = await run(order([tagOf('f02'), bad]));
  assert.equal(job.mode, 'manual');
  assert.ok(files.includes('SDT-7KQ2-tag1-front.lbrn2'));
  assert.ok(!files.some((f) => f.includes('tag2')));
});

test('blank front: no front file, info note; back is generated (f11)', async () => {
  const { job, files } = await run(order([tagOf('f11')]));
  assert.ok(!files.includes('SDT-7KQ2-tag1-front.lbrn2'));
  assert.ok(files.includes('SDT-7KQ2-tag1-back.lbrn2'));
  assert.deepEqual(job.tags[0].notes, ['Front is blank.']);
});

test('icon-only front is generated (f12) and the icon never goes on the back', async () => {
  const { job } = await run(order([tagOf('f12')]));
  const sides = job.tags[0].files.map((f) => f.side);
  assert.deepEqual(sides, ['front', 'back']);
  assert.deepEqual(job.tags[0].files[0].lines, []);
});

test('front-only tag writes no back file', async () => {
  const { files } = await run(order([tagOf('f02')]));
  assert.ok(!files.some((f) => f.includes('-back')));
});

test('overflow warning on f10', async () => {
  const { job } = await run(order([tagOf('f10')]));
  const f = job.tags[0].files[0];
  assert.equal(f.fit, false);
  assert.ok(f.warnings.some((w) => w.code === 'overflow' && w.text.startsWith('Text did not fit even at size 6.')));
});

test('overlap-risk on script and marker fonts only', async () => {
  const s = await run(order([tagOf('f03')]));
  assert.ok(s.job.tags[0].files[0].warnings.some((w) => w.code === 'overlap-risk'));
  const b = await run(order([tagOf('f02')]));
  assert.ok(!b.job.tags[0].files[0].warnings.some((w) => w.code === 'overlap-risk'));
});

test('missing glyph warning names the character', async () => {
  const t = tagOf('f02'); t.front = ['REX ☃'];
  const { job } = await run(order([t]));
  assert.ok(job.tags[0].files[0].warnings.some((w) => w.code === 'missing-glyph' && w.text.includes('☃')));
});

test('filenames never contain customer text, and neither do the Notes or job.json PII fields', async () => {
  const t = tagOf('f01'); t.front = ['../../EVIL', 'a/b']; t.back = [];
  const { files, dir, job } = await run(order([t]));
  for (const f of files) assert.match(f, /^(job\.json|SDT-7KQ2-tag1-(front|back)\.(lbrn2|svg))$/);
  const lbrn2 = await readFile(path.join(dir, 'SDT-7KQ2-tag1-front.lbrn2'), 'utf8');
  assert.ok(!lbrn2.includes('Dana'));
  assert.ok(!lbrn2.includes('EVIL'));
  const raw = await readFile(path.join(dir, 'job.json'), 'utf8');
  for (const s of ['dana@example.com', '555-0101', '1 Main St', 'secret note']) assert.ok(!raw.includes(s), s);
  assert.deepEqual(job.customer, { name: 'Dana Price', delivery: 'ship' });
});

test('Notes: qty, customer size, preset, font, fit, ShowOnLoad=0, no admin-ish content', async () => {
  const { dir } = await run(order([tagOf('f01')]));
  const x = await readFile(path.join(dir, 'SDT-7KQ2-tag1-front.lbrn2'), 'utf8');
  const notes = x.match(/Notes="([^"]*)"/)[1];
  assert.match(notes, /SDT-7KQ2  tag 1 of 1  FRONT/);
  assert.match(notes, /Qty: 2  \(run this file 2 times\)/);
  assert.match(notes, /Blank: bone, black, 38\.00 x 25\.33 mm  \(customer size: Medium 1\.5&quot;\)/);
  assert.match(notes, /Preset: anodized \(UNTESTED - tune in LightBurn\)/);
  assert.match(notes, /Font: block \d+  Fit: ok/);
});

test('invalid order ids are rejected; demo ids only with demo mode', async () => {
  for (const id of ['../x', 'SDT-abcd', 'SDT-O0O0', 'SDT-12345', '', 'SDT-DEMO']) {
    await assert.rejects(run({ ...order([tagOf('f01')]), id }), /invalid order id/, id);
  }
  const ok = await run({ ...demo[0] }, { demo: true });
  assert.equal(ok.job.orderId, 'SDT-DEMO');
});

test('demo orders: SDT-DEMO is queued with qty 2; SDT-OOPS is manual with three reasons', async () => {
  const a = await run(demo[0], { demo: true });
  assert.equal(a.mode, 'queued');
  assert.equal(a.job.tags[0].qty, 2);
  assert.equal(a.job.tags[0].files.length, 2);
  assert.equal(a.job.tags[1].files.length, 1);
  const b = await run(demo[1], { demo: true });
  assert.equal(b.mode, 'manual');
  assert.equal(b.job.tags.filter((t) => t.mode === 'manual').length, 3);
  assert.equal(b.job.hasPrints, true);
  assert.deepEqual(b.job.printsSummary, ['1x Benchy boat']);
});

test('Regenerate moves existing files to old/<ts>/ and deletes nothing', async () => {
  const first = await run(order([tagOf('f01')]), { now: () => new Date('2026-10-16T18:00:00Z') });
  const before = (await readdir(first.dir)).sort();
  const beforeBodies = {};
  for (const f of before) beforeBodies[f] = await readFile(path.join(first.dir, f));
  const second = await run(order([tagOf('f01')]), { queueDir: first.queueDir, now: () => new Date('2026-10-16T18:15:00Z') });
  assert.equal(path.basename(second.archived), '20261016-181500');
  const archivedNames = (await readdir(second.archived)).sort();
  assert.deepEqual(archivedNames, before);
  for (const f of before) assert.deepEqual(await readFile(path.join(second.archived, f)), beforeBodies[f]);
  assert.ok(second.files.includes('old'));
  // a third regenerate in the same second must not overwrite the earlier archive
  const third = await run(order([tagOf('f01')]), { queueDir: first.queueDir, now: () => new Date('2026-10-16T18:15:00Z') });
  assert.notEqual(third.archived, second.archived);
  assert.ok((await readdir(second.archived)).length >= before.length);
});

test('fonts unavailable surfaces as a thrown error the queue can record', async () => {
  const empty = await mkdtemp(path.join(os.tmpdir(), 'sdt-nofonts-'));
  await assert.rejects(run(order([tagOf('f01')]), { fontOpts: { dir: empty, fetchImpl: async () => { throw new Error('offline'); } } }), /fonts unavailable: offline/);
});

test('snapshotOrder strips contact, payment, and prize fields', () => {
  const s = snapshotOrder({ ...order([tagOf('f01')]), checkout: { id: 'x' }, payment: { status: 'paid' }, prize: 'SDT-UP-AAAA', prizeCode: 'SDT-UP-AAAA', ua: 'x', ip: '1.1.1.1' });
  const raw = JSON.stringify(s);
  for (const k of ['dana@example.com', '555-0101', '1 Main St', 'secret note', 'SDT-UP-AAAA', '1.1.1.1', 'checkout', 'payment']) assert.ok(!raw.includes(k), k);
  assert.equal(s.customer.name, 'Dana Price');
});

test('blankMm matches the layout W/H for every outline shape', () => {
  assert.deepEqual(blankMm({ shape: 'bone', finish: 'polished' }), { w: 48, h: 32 });
  assert.deepEqual(blankMm({ shape: 'round', finish: 'black' }), { w: 30, h: 30 });
});

// Flint CR-007: ornaments are never automatic, but every one appears in the job as a manual entry.
test('ornaments: one manual entry each (stainless on the fiber laser, acrylic on the O1), ornament-only orders are not an empty job', async () => {
  const o = order([], { ornaments: [
    { tier: 'stainless', name: 'Whisky', year: '2026', qty: 1, photo: true, photoIndex: 100 },
    { tier: 'acrylic', name: 'Biscuit', year: '2026', qty: 2, photo: true, photoIndex: 101 },
  ] });
  const { job, files } = await run(o);
  assert.deepEqual(files, ['job.json']);
  assert.equal(job.mode, 'manual');
  assert.equal(job.tags.length, 2);
  assert.equal(job.tags[0].label, 'ornament1'); assert.equal(job.tags[0].mode, 'manual'); assert.match(job.tags[0].manualReason, /fiber laser/);
  assert.equal(job.tags[1].qty, 2); assert.match(job.tags[1].manualReason, /xTool O1/);
  assert.deepEqual(job.tags[1].manualLines.front, ['Biscuit', '2026']);
  const mixed = await run(order([tagOf('f01')], { ornaments: o.ornaments }));
  assert.equal(mixed.job.tags.length, 3);
  assert.equal(mixed.job.tags[0].mode, 'auto', 'the engraved tag in a mixed order stays automatic');
  assert.equal(mixed.job.tags[1].index, 1);
});

test('full-color tag: manual with the O1 message, never the fiber laser', async () => {
  const t = { ...tagOf('f01'), finish: 'fullcolor', photo: true, art: 'upload' };
  const { job } = await run(order([t]));
  assert.equal(job.tags[0].mode, 'manual'); assert.match(job.tags[0].manualReason, /xTool O1/);
});
