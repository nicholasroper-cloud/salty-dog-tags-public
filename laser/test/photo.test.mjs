import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { SDTLayout } from '../lib/layout.mjs';
import { loadFont } from '../lib/fonts.mjs';
import { loadConfig } from '../lib/config.mjs';
import { buildPhotoTag, DEMO_TAG } from '../lib/photodemo.mjs';
import { photoQuality, analysePhoto, planFront, PHOTO_EDGE_MM } from '../lib/photo.mjs';
import { loadPreset } from '../lib/presets.mjs';
import { BITMAP_PX_PER_UNIT } from '../lib/lbrn2.mjs';
import { toSubpaths } from '../lib/geometry.mjs';
import { flatten, distToPolys, pointInPolys, outlineDesign } from './containment.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const photoBytes = await readFile(path.join(here, '..', '..', 'site', 'assets', 'whisky-tag-real.jpg'));
const config = await loadConfig();
const font = await loadFont('block');
const built = await buildPhotoTag({ config, font, photoBytes, now: new Date('2026-10-16T12:00:00Z') });
// the 38 mm stainless bone has no cut-out, so an icon beside the photo is allowed there
const plain = await buildPhotoTag({ config, font, photoBytes, tag: { ...DEMO_TAG, finish: 'stainless', icon: 'paw' } });

function bitmapAttrs(xml) {
  const m = /<Shape Type="Bitmap" CutIndex="(\d+)" W="([\d.]+)" H="([\d.]+)"[^>]* Data="([^"]+)">\s*<XForm>([^<]+)<\/XForm>/.exec(xml);
  assert.ok(m, 'Bitmap shape present');
  const [a, b, c, d, e, f] = m[5].trim().split(/\s+/).map(Number);
  return { cut: +m[1], W: +m[2], H: +m[3], data: m[4], a, b, c, d, e, f };
}

test('every photo file parses as XML', async (t) => {
  if (!existsSync('/usr/bin/xmllint')) return t.skip('xmllint not installed');
  const dir = await mkdtemp(path.join(os.tmpdir(), 'sdt-photo-'));
  for (const [name, xml] of [['front', built.front.xml], ['half', built.frontHalftone.xml], ['back', built.back.xml], ['plain', plain.front.xml]]) {
    const f = path.join(dir, `${name}.lbrn2`);
    await writeFile(f, xml);
    execFileSync('/usr/bin/xmllint', ['--noout', f]);
  }
  const svg = path.join(dir, 'front.svg');
  await writeFile(svg, built.front.svg);
  execFileSync('/usr/bin/xmllint', ['--noout', svg]);
});

test('front: the bitmap sits inside the blank, upright, on image layer 1', () => {
  for (const b of [built, plain]) {
    const bm = bitmapAttrs(b.front.xml);
    const wMm = bm.W * bm.a, hMm = bm.H * Math.abs(bm.d);   // d<0 = Y flip; LightBurn: W/H are pixels/2.835, XForm scales to mm
    const [Px, Py] = config.fieldCenter, bl = b.meta.blank;
    assert.ok(wMm > 12 && hMm > 9, `window ${wMm} x ${hMm}`);
    assert.ok(b === plain || (wMm > 20 && hMm > 18), 'polished bone window fills the waist: 20+ x 18+ mm');
    // the waist box is not limited to the free width (the mask clips it), but it stays inside the blank's bounding box
    assert.ok(bm.e - wMm / 2 >= Px - bl.w / 2 - 1e-6 && bm.e + wMm / 2 <= Px + bl.w / 2 + 1e-6, 'x within the blank');
    assert.ok(bm.f - hMm / 2 >= Py - bl.h / 2 + PHOTO_EDGE_MM - 1e-6 && bm.f + hMm / 2 <= Py + bl.h / 2 - PHOTO_EDGE_MM + 1e-6, 'y within blank minus 0.8 mm');
    assert.ok(b === plain || Math.abs(bm.e - Px) < 1e-6, 'the polished window is centred on the blank (owner)');
    assert.equal(bm.cut, 1);
    assert.equal(bm.b, 0); assert.equal(bm.c, 0);
    assert.ok(bm.a > 0 && bm.d < 0, 'Y-flipped XForm: LightBurn maps PNG row 0 to local y=0 (Y up), so d<0 shows the photo upright (confirmed on canvas 2026-10-16)');
    assert.ok(Math.abs(bm.W - b.meta.image.wPx / BITMAP_PX_PER_UNIT) < 1e-3);
  }
  assert.match(built.front.xml, /<CutSetting_Img type="Image">/);
  assert.match(built.front.xml, /<CutSetting type="Tool">/);
  assert.doesNotMatch(built.front.xml, /<name Value="WHISKY/);
});

// A smooth left-to-right gradient: every pixel of the window is a distinct mid-range gray, so "photo present" is unambiguous.
const gradient = (w, h) => sharp(Buffer.from(Array.from({ length: w * h }, (_, k) => Math.round(((k % w) / w) * 255))), { raw: { width: w, height: h, channels: 1 } }).jpeg({ quality: 95 }).toBuffer();
const pngOf = (b) => sharp(Buffer.from(bitmapAttrs(b.front.xml).data, 'base64')).greyscale().raw().toBuffer({ resolveWithObject: true });
const MM = 400 / 25.4;   // px per mm in the photo PNG

test('waist box on the polished bone: 19.0 mm tall, 20.9 wide for a 1.10 source, square for a portrait, 1.35 cap for a wide one', async () => {
  const wide = await buildPhotoTag({ config, font, photoBytes: await gradient(660, 600) });
  assert.ok(Math.abs(wide.meta.window.hMm - 19.0) < 0.2, `h ${wide.meta.window.hMm}`);
  assert.ok(Math.abs(wide.meta.window.wMm - 20.9) < 0.25, `w ${wide.meta.window.wMm}`);
  assert.equal(wide.meta.window.n, 4);
  assert.ok(Math.abs(wide.meta.window.cx - 24) < 1e-9, 'centred on the 48 mm blank');
  const tall = await buildPhotoTag({ config, font, photoBytes: await gradient(600, 800) });
  assert.ok(Math.abs(tall.meta.window.hMm - 19.0) < 0.2 && Math.abs(tall.meta.window.wMm - tall.meta.window.hMm) < 1e-9, 'portrait source: 19.0 square');
  const pano = await buildPhotoTag({ config, font, photoBytes: await gradient(1600, 600) });
  assert.ok(Math.abs(pano.meta.window.wMm / pano.meta.window.hMm - 1.35) < 1e-9);
  // the plan rule itself, without sharp: height is the free extent 5 mm left of centre, 0.8 mm edge
  const free = SDTLayout.clearance(DEMO_TAG, PHOTO_EDGE_MM);
  const plan = planFront({ free, wMm: 48, hMm: 32, aspect: 1.1 });
  assert.ok(Math.abs(plan.b * 2 - 19.0) < 0.2 && plan.n === 4 && plan.icon === null);
});

test('mask: white at the hole, the photo at the window centre, white where the paw cut-out and the outline are', async () => {
  const b = await buildPhotoTag({ config, font, photoBytes: await gradient(660, 600) });
  const { data, info } = await pngOf(b);
  const { cx, cy, wMm, hMm } = b.meta.window;
  const px = (xMm, yMm) => data[Math.min(info.height - 1, Math.max(0, Math.floor(yMm * MM))) * info.width + Math.min(info.width - 1, Math.max(0, Math.floor(xMm * MM)))];
  // hanging hole is at (24.0, 5.0) mm on the blank, 2.34 mm radius + 1 mm ring: it notches the top of the window
  const holeX = 24, holeY = 5;
  assert.equal(px(holeX - (cx - wMm / 2), Math.max(0, holeY - (cy - hMm / 2))), 255, 'hole centre (clamped into the window) is white');
  assert.equal(px(holeX - (cx - wMm / 2), 0.4 * 1), 255, 'top of the window under the hole is white');
  const mid = px(wMm / 2, hMm / 2);
  assert.ok(mid > 40 && mid < 215, `window centre is the photo, got ${mid}`);
  assert.equal(px(0, 0), 255, 'corner is white (superellipse + clip)');
  // the paw cut-out (blank-local 40.0, 24.5, 8.9 mm paw) sits right of the window; its ring is clipped where it overlaps
  assert.equal(px(40 - (cx - wMm / 2), 24.5 - (cy - hMm / 2)), 255, 'paw centre is white');
});

test('every clearly-inked pixel clears the outline, the hole ring and the paw cut-out (independent exact check)', async () => {
  const b = await buildPhotoTag({ config, font, photoBytes, tag: DEMO_TAG });
  const { data, info } = await pngOf(b);
  const { cx, cy, wMm, hMm } = b.meta.window;
  const s = 48 / 240;
  const outline = flatten(outlineDesign('bone').map((sp) => sp)).map((ring) => ring.map(([x, y]) => [(x - 40) * s, (y - 50) * s]));
  const paw = flatten(toSubpaths(SDTLayout.cutPath(DEMO_TAG), [s, 0, 0, s, -40 * s, -50 * s]));
  const slack = 0.35;   // the 0.3 mm feather blurs the mask edge, so allow that much on the dark side of the limit
  let dark = 0;
  for (let j = 0; j < info.height; j += 3) for (let i = 0; i < info.width; i += 3) {
    if (data[j * info.width + i] > 100) continue;   // only pixels that are clearly engraved
    dark++;
    const x = cx - wMm / 2 + (i + 0.5) / MM, y = cy - hMm / 2 + (j + 0.5) / MM;
    assert.ok(pointInPolys(x, y, outline) && distToPolys(x, y, outline) >= PHOTO_EDGE_MM - slack, `outline at ${x.toFixed(2)},${y.toFixed(2)}`);
    assert.ok(Math.hypot(x - 24, y - 5) >= 2.34 + 1.0 - slack, `hole ring at ${x.toFixed(2)},${y.toFixed(2)}`);
    assert.ok(!pointInPolys(x, y, paw) && distToPolys(x, y, paw) >= PHOTO_EDGE_MM - slack, `paw at ${x.toFixed(2)},${y.toFixed(2)}`);
  }
  assert.ok(dark > 2000, `enough ink sampled (${dark})`);
  assert.equal(SDTLayout.cutPath({ ...DEMO_TAG, finish: 'stainless' }), null, 'only the polished finish has the cut-out');
  assert.equal(b.meta.icon, null, 'no engraved icon on a blank that already has a paw hole');
  assert.ok(plain.meta.icon && plain.meta.icon.x0 >= plain.meta.window.cx + plain.meta.window.wMm / 2, 'icon sits to the right of the photo on a plain blank');
  assert.equal(plain.meta.window.n, 2, 'icon case keeps the ellipse');
  assert.match(b.front.xml, /Notes[^>]*paw cut-out on T1/);
  assert.match(b.front.xml, /window \d+\.\d x \d+\.\d mm, superellipse, 0\.8 mm edge/);
});

test('ordinary text on the polished bone keeps 1.5 mm from the paw cut-out and shrinks only as needed', () => {
  const t = { shape: 'bone', size: 'large', finish: 'polished', font: 'slab', icon: 'none', front: ['WHISKY', 'YES I LICK MY OWN JUNK'], back: [] };
  const r = SDTLayout.layout(t, 'front', font);
  assert.ok(r.fit && r.cutD);
  assert.equal(SDTLayout.layout({ ...t, finish: 'black' }, 'front', font).cutD, null);
});

test('front has the image layer only plus outline (and icon); back has text on the Scan layer, no bitmap', () => {
  assert.doesNotMatch(built.back.xml, /Type="Bitmap"|CutSetting_Img/);
  assert.deepEqual(built.meta.back.lines, ['WHISKY', '555-0142']);
  assert.equal(built.meta.back.fit, true);
  assert.match(built.back.xml, /<name Value="SDT polished \(UNTESTED\)"\/>/);
  assert.match(built.front.xml, /<name Value="SDT photo-stainless stucki \(UNTESTED\)"\/>/);
});

test('dither: stucki by default, selectable, and the halftone variant differs only in the image layer', async () => {
  assert.match(built.front.xml, /<ditherMode Value="stucki"\/>/);
  assert.match(built.frontHalftone.xml, /<ditherMode Value="halftone"\/>/);
  const j = await buildPhotoTag({ config, font, photoBytes, dither: 'jarvis' });
  assert.match(j.front.xml, /<ditherMode Value="jarvis"\/>/);
  await assert.rejects(buildPhotoTag({ config, font, photoBytes, dither: '"><x' }), /bad dither/);
  assert.equal(built.frontHalftone.xml.replaceAll('halftone', 'stucki'), built.front.xml);
});

test('photo PNG: grayscale, ~400 dpi at the placed size, white outside the feathered window', async () => {
  const bm = bitmapAttrs(built.front.xml);
  const png = Buffer.from(bm.data, 'base64');
  const meta = await sharp(png).metadata();
  assert.equal(meta.channels, 1);
  assert.equal(meta.width, built.meta.image.wPx);
  const dpi = meta.width / (built.meta.sizeMm[0] / 25.4);
  assert.ok(dpi > 390 && dpi < 410, `dpi ${dpi}`);
  const { data, info } = await sharp(png).greyscale().raw().toBuffer({ resolveWithObject: true });
  for (const [x, y] of [[0, 0], [info.width - 1, 0], [0, info.height - 1], [info.width - 1, info.height - 1]]) assert.equal(data[y * info.width + x], 255, 'corners are white');
  // edge row mid-point is within the feather: lighter than the middle of the photo
  const mid = data[Math.floor(info.height / 2) * info.width + Math.floor(info.width / 2)];
  assert.ok(data[Math.floor(info.height / 2) * info.width] > 200, 'left edge pixel has faded almost to white');
  let min = 255, max = 0;
  for (const v of data) { if (v < min) min = v; if (v > max) max = v; }
  assert.ok(min < 40 && max === 255 && mid < 255, 'contrast stretched');
});

test('exclude is opt-in: layout() without options is unchanged by the option existing', () => {
  const a = SDTLayout.layout(DEMO_TAG, 'back', font);
  assert.deepEqual(a.textPaths, SDTLayout.layout(DEMO_TAG, 'back', font, {}).textPaths);
  assert.deepEqual(a.textPaths, SDTLayout.layout(DEMO_TAG, 'back', font, { exclude: [] }).textPaths);
  assert.equal(SDTLayout.svg(DEMO_TAG, 'back', font), SDTLayout.svg(DEMO_TAG, 'back', font, {}));
  const ex = SDTLayout.layout(DEMO_TAG, 'back', font, { exclude: [{ x0: 10, y0: 8, x1: 28, y1: 17 }] });
  assert.notDeepEqual(a.textPaths, ex.textPaths);
});

test('photo-stainless preset is valid, untested, image-typed, dither default stucki', async () => {
  const p = await loadPreset('photo-stainless');
  assert.equal(p.status, 'untested');
  assert.equal(p.layerType, 'image');
  assert.equal(p.cutSetting.ditherMode, 'stucki');
  assert.ok(p.cutSetting.interval >= 0.02 && p.cutSetting.interval <= 0.03);
});

// ---- quality gates (issue #3 step 2) ----
const WIN = [22, 16.3];   // roughly the polished bone window
test('photoQuality: size gate is 150 dpi at the window, measured on the cover-cropped source', () => {
  const stats = { mean: 120, stddev: 60 };
  const need = Math.ceil(22 / 25.4 * 150);   // 130 px across, 97 down
  assert.equal(photoQuality({ wPx: 2000, hPx: 1500, stats, windowMm: WIN }).ok, true);
  const small = photoQuality({ wPx: need - 5, hPx: Math.round((need - 5) / 1.35) , stats, windowMm: WIN });
  assert.equal(small.ok, false);
  assert.match(small.reason, new RegExp(`^Photo too small: ${need - 5} x \\d+ px, need at least ${need} x ${Math.ceil(16.3 / 25.4 * 150)} for this tag$`));
  // a very wide strip is wide enough but the crop leaves too few rows
  assert.equal(photoQuality({ wPx: 4000, hPx: 60, stats, windowMm: WIN }).ok, false);
  assert.equal(photoQuality({ wPx: need, hPx: Math.ceil(need / 1.35), stats, windowMm: WIN }).ok, true, 'exactly 150 dpi passes');
});

test('photoQuality: 150..250 dpi is soft (warning), above is clean', () => {
  const stats = { mean: 120, stddev: 60 };
  const soft = photoQuality({ wPx: 200, hPx: 150, stats, windowMm: WIN });
  assert.equal(soft.ok, true); assert.deepEqual(soft.warnings, ['Photo is soft at this size']);
  assert.deepEqual(photoQuality({ wPx: 400, hPx: 300, stats, windowMm: WIN }).warnings, []);
});

test('photoQuality: low contrast is manual; very dark or bright is a warning only', () => {
  const big = { wPx: 2000, hPx: 1500, windowMm: WIN };
  const flat = photoQuality({ ...big, stats: { mean: 128, stddev: 17.9 } });
  assert.equal(flat.ok, false); assert.match(flat.reason, /^Photo is low contrast \(stddev 17\.9\)\. Lay it out by hand or ask for a better photo$/);
  assert.equal(photoQuality({ ...big, stats: { mean: 128, stddev: 18 } }).ok, true);
  assert.deepEqual(photoQuality({ ...big, stats: { mean: 59, stddev: 50 } }).warnings, ['Photo is very dark; check the preview']);
  assert.deepEqual(photoQuality({ ...big, stats: { mean: 201, stddev: 50 } }).warnings, ['Photo is very bright; check the preview']);
  assert.deepEqual(photoQuality({ ...big, stats: { mean: 60, stddev: 50 } }).warnings, []);
  // size is checked before contrast
  assert.match(photoQuality({ wPx: 20, hPx: 20, windowMm: WIN, stats: { mean: 128, stddev: 0 } }).reason, /too small/);
});

test('analysePhoto: dimensions follow EXIF rotation; stats are grayscale', async () => {
  const a = await analysePhoto(photoBytes);
  assert.equal(a.wPx, 635); assert.equal(a.hPx, 384);
  assert.ok(a.stats.stddev > 50);
  const rot = await sharp({ create: { width: 300, height: 200, channels: 3, background: '#808080' } }).withMetadata({ orientation: 6 }).jpeg().toBuffer();
  const r = await analysePhoto(rot);
  assert.equal(r.wPx, 200); assert.equal(r.hPx, 300);
  assert.ok(Math.abs(r.stats.mean - 128) < 3 && r.stats.stddev < 2);
  await assert.rejects(analysePhoto(Buffer.from('nope')));
});
