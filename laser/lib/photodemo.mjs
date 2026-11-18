// `demo-photo`: one polished 48 mm bone as a photo tag, written as the usual queue files. Prototype for issue #3 (writePhotoDemo
// is the standalone preview). The poller builds real photo orders with buildPhotoTag() and planPhotoWindow() through generate.mjs
// (generate.mjs and this file import each other; neither uses the other's bindings while evaluating). buildPhotoTag() is pure.
//
// What the builder (site/app.js) promises for a photo tag: the front is the customer's photo and nothing else (front text and
// the icon are dropped), the back carries tag.back lines. Photo is offered on the polished bone only, which has a paw-shaped
// through-hole in its right lobe (layout module: OUT.bone.cut), so the photo window grows to the left of the hole and no icon
// is engraved. An icon beside the photo is still supported for blanks without a cut-out if tag.icon is set (the builder
// itself discards it).
import { mkdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { SDTLayout } from './layout.mjs';
import { loadFont } from './fonts.mjs';
import { toSubpaths, tagGeometry } from './geometry.mjs';
import { buildLbrn2, SERVICE_VERSION } from './lbrn2.mjs';
import { loadPreset, presetFor } from './presets.mjs';
import { preparePhoto, planFront, analysePhoto, inSuperellipse, PHOTO_DPI, FEATHER_MM, PHOTO_EDGE_MM } from './photo.mjs';
import { blankMm, warningsFor } from './generate.mjs';
import { writeFileAtomic, archiveDirContents } from './fsutil.mjs';

export const DEMO_TAG = { shape: 'bone', size: 'medium', finish: 'polished', font: 'block', front: [], back: ['WHISKY', '555-0142'], icon: 'none', qty: 1, photo: true };
export const IMAGE_LAYER_INDEX = 1;
export const ICON_MM = 4.5;
const DITHER_RE = /^[a-z]{3,16}$/;

// The portrait window planned for a tag (centre and half-sizes in blank-local mm; n = 2 ellipse beside an icon, 4 waist box).
// Pure and font-free, so the generator can check the photo against the window size before building anything. sourceAspect is
// the EXIF-rotated source width / height. Throws when no window fits the blank.
export function planPhotoWindow(tag, sourceAspect = 1.35) {
  const bl = blankMm(tag);
  const cutOut = SDTLayout.cutPath(tag);
  const hasIcon = !cutOut && tag.icon && tag.icon !== 'none' && SDTLayout.ICONS[tag.icon];
  return planFront({ free: SDTLayout.clearance(tag, PHOTO_EDGE_MM), wMm: bl.w, hMm: bl.h, aspect: sourceAspect, iconMm: hasIcon ? ICON_MM : 0 });
}

// deps: { config, font, photoBytes, presetsDir?, tag?, now?, photoName?, dither?, plan?, label?, extraWarnings? }
//   plan: a planPhotoWindow(tag, aspect) result to reuse. label: { orderId, n, count } puts the real order in the Notes instead of the
//   SDT-PHOTO prototype header. extraWarnings: [{code,text}] appended to the file warnings (quality gates).
// Returns { front:{xml,svg}, frontHalftone:{xml}, back:{xml,svg}, meta }.
export async function buildPhotoTag({ config, font, photoBytes, presetsDir, tag = DEMO_TAG, now = new Date(), photoName = 'photo', dither, plan: givenPlan, label, extraWarnings = [] }) {
  const textPreset = await presetFor(tag.finish, config, presetsDir);
  const imgPreset = await loadPreset('photo-stainless', presetsDir);
  if (dither !== undefined && !DITHER_RE.test(dither)) throw new Error(`bad dither mode "${dither}"`);
  const mainDither = dither || imgPreset.cutSetting.ditherMode;
  const bl = blankMm(tag);
  const cutOut = SDTLayout.cutPath(tag);   // the polished bone already has a paw-shaped hole, so no engraved icon
  let plan = givenPlan;
  if (!plan) { const src = await analysePhoto(photoBytes); plan = planPhotoWindow(tag, src.wPx / src.hPx); }
  const free = SDTLayout.clearance(tag, PHOTO_EDGE_MM);
  // mask in window-local mm: inside the superellipse AND clear of the outline (0.8 mm) and the hole (1 mm); the paw cut-out and
  // lobes notch the picture instead of shrinking it
  const maskMm = (x, y) => inSuperellipse(x - plan.a, y - plan.b, plan.a, plan.b, plan.n) && free(plan.cx - plan.a + x, plan.cy - plan.b + y);
  const sizeMm = [plan.a * 2, plan.b * 2];
  const img = await preparePhoto(photoBytes, { sizeMm, maskMm });

  // The back is the normal shape-aware text layout; its result also carries the outline geometry both sides share.
  const backTag = { ...tag, icon: 'none' };
  const rBack = SDTLayout.layout(backTag, 'back', font);
  const [Px, Py] = config.fieldCenter;
  const W = Number(rBack.W), H = Number(rBack.H);
  // blank-local mm (from top-left, y down) -> LightBurn workspace (blank centred on fieldCenter, Y up); same maths as fieldMatrix
  const toWs = (u, v) => [Px - W / 2 + u, Py + H / 2 - v];
  const gBack = tagGeometry(rBack, config.fieldCenter);
  let iconSubs = [];
  if (plan.icon) {
    const k = plan.icon.size / 24, [ox, oy] = toWs(plan.icon.x0, plan.icon.y0);
    iconSubs = toSubpaths(SDTLayout.ICONS[tag.icon], [k, 0, 0, -k, ox, oy]);
  }

  const warnings = warningsFor({ r: rBack, font, preset: textPreset });
  warnings.push({ code: 'untested-preset', text: `Photo preset ${imgPreset.name} is untested and nothing has been burned with it.` });
  warnings.push(...extraWarnings);
  const photoNote = (side, dm) => [
    label ? `${label.orderId}  tag ${label.n} of ${label.count}  ${side.toUpperCase()}` : `SDT-PHOTO  tag 1 of 1  ${side.toUpperCase()}  (PROTOTYPE, issue #3)`,
    ...(label ? [`Qty: ${tag.qty || 1}${tag.qty > 1 ? `  (run this file ${tag.qty} times)` : ''}`] : []),
    `Blank: ${tag.shape}, ${tag.finish}, ${bl.w.toFixed(2)} x ${bl.h.toFixed(2)} mm${cutOut ? ' (paw cut-out on T1, not engraved)' : ''}`,
    ...(side === 'front'
      ? [`Photo: ${photoName}, window ${sizeMm[0].toFixed(1)} x ${sizeMm[1].toFixed(1)} mm, ${plan.n === 4 ? 'superellipse' : 'ellipse'}, ${PHOTO_EDGE_MM} mm edge, ${img.wPx} x ${img.hPx} px (${PHOTO_DPI} dpi), ${FEATHER_MM} mm feather, layer ${IMAGE_LAYER_INDEX} (${imgPreset.name}, UNTESTED), dither ${dm}`,
         ...(plan.icon ? [`Icon: ${tag.icon}, ${plan.icon.size} mm, to the right of the photo`] : [])]
      : [`Text: ${rBack.lines.join(' / ')}  size ${(rBack.fs * rBack.s).toFixed(2)} mm, preset ${textPreset.name} (UNTESTED)`]),
    ...warnings.map((w) => `WARNING: ${w.text}`),
    `Generated ${now.toISOString().replace(/\.\d+Z$/, 'Z')} by sdt-laser ${SERVICE_VERSION}`
  ].join('\n');

  const centerMm = toWs(plan.cx, plan.cy);
  const frontXml = (dm) => buildLbrn2({
    deviceName: config.deviceName,
    layerName: `SDT ${textPreset.name} (UNTESTED)`,
    cutSetting: textPreset.cutSetting,
    tool: gBack.tool,   // outline plus the paw cut-out on a polished bone (Tool layer, no output)
    scan: iconSubs,
    image: {
      index: IMAGE_LAYER_INDEX,
      name: `SDT ${imgPreset.name} ${dm} (UNTESTED)`,
      cutSetting: { ...imgPreset.cutSetting, ditherMode: dm },
      bitmaps: [{ png: img.png, wPx: img.wPx, hPx: img.hPx, centerMm, sizeMm, flipY: true }] // flipY: LightBurn maps PNG row 0 to local y=0 in its Y-up space, so an unflipped bitmap shows upside down (seen on canvas 2026-10-16)
    },
    notes: photoNote('front', dm)
  });
  const backXml = buildLbrn2({
    deviceName: config.deviceName,
    layerName: `SDT ${textPreset.name} (UNTESTED)`,
    cutSetting: textPreset.cutSetting,
    tool: gBack.tool, scan: [...gBack.icon, ...gBack.text],
    notes: photoNote('back')
  });

  // SVG preview of the front: viewBox is design units, so convert mm back
  const s = rBack.s, [bx0, by0] = rBack.bb;
  const u = (mm) => mm / s;
  const imgEl = `<image id="photo" x="${(bx0 + u(plan.cx - plan.a)).toFixed(2)}" y="${(by0 + u(plan.cy - plan.b)).toFixed(2)}" width="${u(sizeMm[0]).toFixed(2)}" height="${u(sizeMm[1]).toFixed(2)}" href="data:image/png;base64,${img.png.toString('base64')}"/>`;
  const iconEl = plan.icon ? `<g id="icon" fill="#000000" transform="translate(${(bx0 + u(plan.icon.x0)).toFixed(2)} ${(by0 + u(plan.icon.y0)).toFixed(2)}) scale(${(u(plan.icon.size) / 24).toFixed(4)})"><path d="${SDTLayout.ICONS[tag.icon]}"/></g>` : '';
  const frontSvg = SDTLayout.svg({ ...tag, front: [], icon: 'none' }, 'front', font, { extra: imgEl + iconEl });
  const backSvg = SDTLayout.svg(backTag, 'back', font);

  return {
    front: { xml: frontXml(mainDither), svg: frontSvg, dither: mainDither },
    frontHalftone: { xml: frontXml('halftone'), dither: 'halftone' },
    back: { xml: backXml, svg: backSvg },
    meta: {
      cutOut: !!cutOut, blank: bl, window: { cx: plan.cx, cy: plan.cy, wMm: sizeMm[0], hMm: sizeMm[1], n: plan.n }, sizeMm, centerMm, icon: plan.icon,
      image: { wPx: img.wPx, hPx: img.hPx, dpi: img.dpi, bytes: img.png.length },
      back: { lines: rBack.lines, fontSize: rBack.fs, fontMm: rBack.fs * rBack.s, fit: rBack.fit },
      warnings, presets: { text: textPreset.name, image: imgPreset.name, imageStatus: imgPreset.status }, dither: mainDither
    }
  };
}

// Writes ~/SaltyDog Queue/SDT-PHOTO/ {front, front-halftone, back}.lbrn2 + front/back .svg + job.json. Returns { dir, file, files, meta }.
export async function writePhotoDemo({ config, photoPath, now = new Date(), fontOpts, dither, noIcon = false }) {
  const st = await stat(photoPath);
  if (!st.isFile()) throw new Error(`photo is not a file: ${photoPath}`);
  const photoBytes = await readFile(photoPath);
  const font = await loadFont(SDTLayout.fontKey(DEMO_TAG), fontOpts);
  const tag = noIcon ? { ...DEMO_TAG, icon: 'none' } : DEMO_TAG;
  const built = await buildPhotoTag({ config, font, photoBytes, now, photoName: path.basename(photoPath), tag, dither });
  const dir = path.join(config.queueDir, 'SDT-PHOTO');
  await mkdir(dir, { recursive: true });
  await archiveDirContents(dir, now);
  const b = 'SDT-PHOTO-tag1';
  const write = (name, data) => writeFileAtomic(path.join(dir, name), data);
  await write(`${b}-front.lbrn2`, built.front.xml);
  await write(`${b}-front.svg`, built.front.svg);
  await write(`${b}-front-halftone.lbrn2`, built.frontHalftone.xml);
  await write(`${b}-back.lbrn2`, built.back.xml);
  await write(`${b}-back.svg`, built.back.svg);
  const m = built.meta;
  const job = {
    schema: 1, orderId: 'SDT-PHOTO', generatedAt: now.toISOString(), generator: `sdt-laser ${SERVICE_VERSION}`, layoutVersion: SDTLayout.VERSION,
    prototype: 'issue #3 photo tag; not an order, not in state.json, never auto-loaded',
    customer: { name: 'Photo prototype', delivery: 'none' }, hasPrints: false, printsSummary: [], mode: 'queued',
    tags: [{
      index: 0, label: 'tag1', qty: 1, shape: tag.shape, size: tag.size, finish: tag.finish, font: tag.font, icon: tag.icon,
      mode: 'auto', manualReason: null, notes: [], preset: m.presets.text, presetStatus: 'untested', blankMm: m.blank,
      photo: { source: path.basename(photoPath), windowMm: m.window, ...m.image, preset: m.presets.image, layer: IMAGE_LAYER_INDEX, dither: m.dither },
      files: [
        { side: 'front', lbrn2: `${b}-front.lbrn2`, svg: `${b}-front.svg`, lines: [], fit: true, warnings: m.warnings },
        { side: 'front', variant: 'halftone', lbrn2: `${b}-front-halftone.lbrn2`, lines: [], fit: true, warnings: m.warnings },
        { side: 'back', lbrn2: `${b}-back.lbrn2`, svg: `${b}-back.svg`, lines: m.back.lines, fontSize: m.back.fontSize, fit: m.back.fit, warnings: m.warnings }
      ]
    }]
  };
  await write('job.json', JSON.stringify(job, null, 2) + '\n');
  return { dir, file: path.join(dir, `${b}-front.lbrn2`), files: ['front.lbrn2', 'front.svg', 'front-halftone.lbrn2', 'back.lbrn2', 'back.svg', 'job.json'].map((n) => n === 'job.json' ? n : `${b}-${n}`), meta: m };
}
