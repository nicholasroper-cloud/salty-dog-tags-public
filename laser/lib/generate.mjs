// order -> job folder (lbrn2 + svg per side, photos, job.json). File I/O stays under the job dir.
// Photos arrive through an injected fetchPhoto so tests run offline. See SPEC section 8.
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { SDTLayout } from './layout.mjs';
import { loadFont } from './fonts.mjs';
import { tagGeometry, qrSubpaths } from './geometry.mjs';
import { SDTQR, loadFinishFlags } from './qr.mjs';
import { buildLbrn2, SERVICE_VERSION, QR_LAYER_INDEX } from './lbrn2.mjs';
import { presetFor, loadPreset } from './presets.mjs';
import { writeFileAtomic, archiveDirContents } from './fsutil.mjs';
import { analysePhoto, photoQuality } from './photo.mjs';
import { buildPhotoTag, planPhotoWindow, IMAGE_LAYER_INDEX } from './photodemo.mjs';
import { log } from './log.mjs';

export const ORDER_ID_RE = /^SDT-[A-Z0-9]{4}$/;
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
const PHOTO_EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const SIZE_LABEL = { small: 'Small 1"', medium: 'Medium 1.5"', large: 'Large 2"', xl: 'XL 2.5"' };
const COLOR_LABEL = { icon: 'icon or short line', line: 'full line' };

export function sizeLabel(size) {
  return SIZE_LABEL[size] || String(size || 'unknown');
}

// Real blank size from the layout constants only (no font needed). Matches layout().W / .H.
export function blankMm(t) {
  const o = SDTLayout.OUT[t.shape] || SDTLayout.OUT.bone;
  const bw = o.bb[2] - o.bb[0], bh = o.bb[3] - o.bb[1];
  const s = SDTLayout.widthMm(t) / bw;
  return { w: Number((bw * s).toFixed(2)), h: Number((bh * s).toFixed(2)) };
}

// API order with contact and payment fields removed. Only name and delivery survive of the customer block.
export function snapshotOrder(order) {
  const o = JSON.parse(JSON.stringify(order));
  delete o.checkout; delete o.payment; delete o.prize; delete o.prizeCode; delete o.ua; delete o.ip;
  if (o.customer) {
    delete o.customer.email; delete o.customer.phone; delete o.customer.address; delete o.customer.note;
  }
  return o;
}

export function warningsFor({ r, font, preset }) {
  const w = [];
  if (r.fit === false) w.push({ code: 'overflow', text: 'Text did not fit even at size 6. Check it in LightBurn before running.' });
  const seen = new Set();
  for (const line of r.lines) {
    for (const ch of line) {
      if (/\s/.test(ch) || seen.has(ch)) continue;
      seen.add(ch);
      if (font.charToGlyphIndex(ch) === 0) w.push({ code: 'missing-glyph', text: `"${ch}" is not in the ${r.fk} font and will engrave as a box.` });
    }
  }
  if (r.fk === 'script' || r.fk === 'marker') {
    w.push({ code: 'overlap-risk', text: 'Script letters can overlap; if the preview shows gaps, select the text and Weld.' });
  }
  if (preset.status === 'untested') w.push({ code: 'untested-preset', text: `Preset ${preset.name} is untested. Run a test tag first.` });
  return w;
}

function notesText({ orderId, i, count, side, t, bl, preset, r, warnings, generatedAt, qrNote }) {
  const lines = [
    `${orderId}  tag ${i + 1} of ${count}  ${side.toUpperCase()}`,
    `Qty: ${t.qty}${t.qty > 1 ? `  (run this file ${t.qty} times)` : ''}`,
    `Blank: ${t.shape}, ${t.finish}, ${bl.w.toFixed(2)} x ${bl.h.toFixed(2)} mm  (customer size: ${sizeLabel(t.size)})`,
    `Preset: ${preset.name} (${preset.status === 'untested' ? 'UNTESTED - tune in LightBurn' : 'tuned'})`,
    `Font: ${r.fk} ${r.fs}  Fit: ${r.fit ? 'ok' : 'OVERFLOW'}`
  ];
  if (qrNote) lines.push(qrNote);
  for (const w of warnings) lines.push(`WARNING: ${w.text}`);
  lines.push(`Generated ${generatedAt} by sdt-laser ${SERVICE_VERSION}`);
  return lines.join('\n');
}

// Photo tag (issue #3 step 2): the proven buildPhotoTag() prototype, wired to a real order. Front is the photo and nothing else
// (front text and icon are dropped by contract), the back is the normal text layout when the tag has back lines.
async function writePhotoFiles({ t, n, count, entry, dir, orderId, config, deps, now, photoBytes, photoJob }) {
  let font;
  try {
    font = await loadFont(SDTLayout.fontKey(t), deps.fontOpts);
  } catch (e) {
    throw new Error(`fonts unavailable: ${e.message}`);
  }
  const extraWarnings = photoJob.q.warnings.map((text) => ({ code: 'photo-quality', text }));
  const built = await buildPhotoTag({ config, font, photoBytes, presetsDir: deps.presetsDir, tag: t, now, photoName: entry.photo,
    plan: photoJob.plan, label: { orderId, n, count }, extraWarnings });
  const m = built.meta;
  const backHas = (t.back || []).some(Boolean);
  const hasFrontText = (t.front || []).some(Boolean);
  if (hasFrontText) entry.notes.push('Front text is ignored on photo tags; the front is the photo only.');
  const b = `${orderId}-tag${n}`;
  const write = (name, data) => writeFileAtomic(path.join(dir, name), data);
  await write(`${b}-front.lbrn2`, built.front.xml);
  await write(`${b}-front.svg`, built.front.svg);
  await write(`${b}-front-halftone.lbrn2`, built.frontHalftone.xml);
  entry.files.push(
    { side: 'front', lbrn2: `${b}-front.lbrn2`, svg: `${b}-front.svg`, lines: [], fit: true, warnings: m.warnings },
    { side: 'front', variant: 'halftone', lbrn2: `${b}-front-halftone.lbrn2`, lines: [], fit: true, warnings: m.warnings }
  );
  if (backHas) {
    await write(`${b}-back.lbrn2`, built.back.xml);
    await write(`${b}-back.svg`, built.back.svg);
    entry.files.push({ side: 'back', lbrn2: `${b}-back.lbrn2`, svg: `${b}-back.svg`, lines: m.back.lines, fontSize: m.back.fontSize, fit: m.back.fit, warnings: m.warnings });
  }
  entry.photoInfo = {
    windowMm: { w: Number(m.sizeMm[0].toFixed(2)), h: Number(m.sizeMm[1].toFixed(2)) },
    wPx: m.image.wPx, hPx: m.image.hPx, dpi: m.image.dpi, preset: m.presets.image, presetStatus: m.presets.imageStatus,
    layer: IMAGE_LAYER_INDEX, dither: m.dither
  };
}

function colourAccentReason(t) {
  return `Colour accent (${COLOR_LABEL[t.color]}, ${t.colorHue || 'blue'}): needs colour-mark layers. Lay out by hand.`;
}

function fileBase(orderId, n, side) {
  return `${orderId}-tag${n}-${side}`;
}

// deps: { config, queueDir, presetsDir?, fontOpts?, fetchPhoto(orderId, index) -> {bytes, contentType}, now?: () => Date, demo?: bool }
// Returns { dir, job, mode, archived }. Throws on infrastructure failure (fonts, disk); the caller records `error`.
export async function generateOrder(order, deps) {
  const { config, queueDir } = deps;
  const now = deps.now ? deps.now() : new Date();
  if (!order || typeof order.id !== 'string' || !ORDER_ID_RE.test(order.id)) throw new Error('invalid order id');
  const orderId = order.id;
  const demoOk = deps.demo && /^SDT-(DEMO|OOPS)$/.test(orderId);
  if (!demoOk && !/^SDT-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}$/.test(orderId)) throw new Error('invalid order id');
  const tags = Array.isArray(order.tags) ? order.tags : [];
  const dir = path.join(queueDir, orderId);
  const generatedAt = now.toISOString().replace(/\.\d+Z$/, 'Z');
  const placeMm = config.fieldCenter;

  await mkdir(dir, { recursive: true });
  const archived = await archiveDirContents(dir, now);
  if (archived) log.info(`generate ${orderId}: previous files archived to ${archived}`);

  const jobTags = [];
  for (let i = 0; i < tags.length; i++) {
    const t = tags[i];
    const n = i + 1;
    const entry = {
      index: i, label: `tag${n}`, qty: t.qty || 1,
      shape: t.shape, size: t.size, sizeLabel: sizeLabel(t.size), finish: t.finish, font: t.font, icon: t.icon,
      mode: 'auto', manualReason: null, files: [], notes: []
    };
    jobTags.push(entry);
    if (SDTLayout.hasOutline(t.shape)) entry.blankMm = blankMm(t);

    // 8.2: first matching condition decides the mode
    const preset = SDTLayout.hasOutline(t.shape) ? await presetFor(t.finish, config, deps.presetsDir) : undefined;
    let manual = null, photoBytes = null, photoJob = null;
    if (!SDTLayout.hasOutline(t.shape)) manual = `No laser outline for shape "${t.shape}" yet. Lay it out by hand.`;
    else if (t.finish === 'fullcolor') manual = 'Full color UV print: make it on the xTool O1 from the orders page (print sheet), not on the fiber laser.';
    else if (!preset) manual = `Unknown finish "${t.finish}", no material preset.`;
    else if (t.photo === true) {
      try {
        const got = await deps.fetchPhoto(orderId, i);
        if (!got || !got.bytes || got.bytes.length === 0) throw Object.assign(new Error('empty'), { code: 'empty' });
        if (got.bytes.length > MAX_PHOTO_BYTES) throw Object.assign(new Error('too big'), { code: 'too-big' });
        const ext = PHOTO_EXT[String(got.contentType || '').split(';')[0].trim().toLowerCase()] || 'bin';
        const name = `${orderId}-tag${n}-photo.${ext}`;
        await writeFileAtomic(path.join(dir, name), got.bytes);
        entry.photo = name;
        photoBytes = got.bytes;
      } catch (e) {
        log.warn(`generate ${orderId}: photo ${n} failed: ${e.message}`);
        manual = `Photo download failed (${e.code || e.status || 'error'}). Use Regenerate to retry.`;
      }
      // A paid colour accent cannot be made on a photo tag (the front is the photo and nothing else), so the operator decides.
      if (!manual && (t.color === 'icon' || t.color === 'line')) manual = colourAccentReason(t);
      if (!manual) {
        // Quality gates (issue #3 step 2): anything the laser cannot do well is handed to the operator with the photo saved.
        let info = null;
        try { info = await analysePhoto(photoBytes); } catch (e) {
          log.warn(`generate ${orderId}: photo ${n} unreadable: ${e.message}`);
          manual = 'Photo could not be read (not a valid image). Ask for another photo or lay it out by hand.';
        }
        if (info) {
          let plan = null;
          try { plan = planPhotoWindow(t, info.wPx / info.hPx); } catch (e) { manual = `No photo window fits this ${t.shape} blank. Lay it out by hand.`; }
          if (plan) {
            const q = photoQuality({ ...info, windowMm: [plan.a * 2, plan.b * 2] });
            if (!q.ok) manual = q.reason;
            else photoJob = { plan, q };
          }
        }
      }
    } else if (t.color === 'icon' || t.color === 'line') {
      manual = colourAccentReason(t);
    }

    // Smart QR tag (ADR section 7 step 3): the stored plan is re-checked here. No id, a test-gated finish, an untested QR preset, or
    // geometry that no longer fits all send the tag to manual instead of engraving something that may not scan.
    let qr = null;
    if (!manual && t.smart && typeof t.smart === 'object') {
      if (deps.qrFlags) SDTQR.configure({ finishes: deps.qrFlags }); else loadFinishFlags();
      const sm = t.smart, fin = SDTQR.finishInfo(t.finish);
      entry.smart = { id: sm.id || null, finish: t.finish };
      if (!sm.id || !/^[0-9A-HJKMNP-TV-Z]{10}$/.test(sm.id)) manual = 'Smart QR tag with no QR id yet. Tap "Mint QR id" on the orders page, then Regenerate.';
      else if (fin.status !== 'on') manual = `QR on finish "${t.finish}" is ${fin.status === 'test' ? 'test-gated (not proven on 3 phones yet)' : 'not allowed'}. Make this tag by hand or ask the customer to drop the QR.`;
      else if (!fin.preset) manual = `No QR preset for finish "${t.finish}".`;
      else {
        let qp = null;
        try { qp = await loadPreset(fin.preset, deps.presetsDir); } catch (e) { manual = `QR preset ${fin.preset} is missing: ${e.message}`; }
        if (qp && qp.status === 'untested') manual = `QR preset ${qp.name} is untested. Run the QR test matrix (laser/README), import the tuned preset, then Regenerate.`;
        else if (qp) {
          const base = typeof sm.url === 'string' && sm.url.length > 10 ? sm.url.slice(0, sm.url.length - 10) : undefined;
          const planned = SDTQR.planTag({ shape: t.shape, finish: t.finish, font: t.font, back: t.back }, { id: sm.id, base, fixed: { ecl: sm.ecl, mm: sm.mm, q: sm.q, x: sm.x, y: sm.y } });
          if (!planned.ok) manual = 'The stored QR placement no longer fits this tag with its text. Check the order and lay it out by hand.';
          else if (!SDTQR.verify(planned.plan, sm.id, { base }).ok) manual = 'The QR would run too close to the edge or the hole. Lay it out by hand.';
          else if (sm.url && sm.url !== planned.plan.payload) manual = 'The stored QR payload does not match its id. Do not engrave; check the order.';
          else qr = { plan: planned.plan, preset: qp, base, id: sm.id };
        }
      }
    }

    if (manual) {
      entry.mode = 'manual';
      entry.manualReason = manual;
      // Customer text is data the operator needs to lay the tag out by hand (shown in the UI, never put in a path).
      entry.manualLines = { front: (t.front || []).filter(Boolean), back: (t.back || []).filter(Boolean) };
    }
    if (preset) { entry.preset = preset.name; entry.presetStatus = preset.status; }

    // Only auto entries produce lbrn2/svg. Manual entries (including photo tags and their back side) write no laser files.
    if (!manual && photoJob) {
      await writePhotoFiles({ t, n, i, count: tags.length, entry, dir, orderId, config, deps, now, photoBytes, photoJob });
    } else if (!manual) {
      const frontHas = (t.front || []).some(Boolean) || (t.icon && t.icon !== 'none');
      const backHas = (t.back || []).some(Boolean);
      if (!frontHas) entry.notes.push('Front is blank.');
      if (!frontHas && !backHas) {
        entry.mode = 'manual';
        entry.manualReason = 'Nothing to engrave on this tag.';
        continue;
      }
      let font;
      try {
        font = await loadFont(SDTLayout.fontKey(t), deps.fontOpts);
      } catch (e) {
        throw new Error(`fonts unavailable: ${e.message}`);
      }
      for (const side of ['front', 'back']) {
        if (side === 'front' ? !frontHas : !backHas) continue;
        const qrHere = qr && side === 'back' ? qr : null;
        const lopts = qrHere ? { qr: SDTQR.layoutOpts(qrHere.plan, qrHere.id, { base: qrHere.base }) } : undefined;
        const r = SDTLayout.layout(t, side, font, lopts);
        const warnings = warningsFor({ r, font, preset });
        if (qrHere && qrHere.preset.status === 'untested') warnings.push({ code: 'untested-preset', text: `QR preset ${qrHere.preset.name} is untested.` });
        const geoWarn = [];
        const g = tagGeometry(r, placeMm, { onWarn: (m) => geoWarn.push(m) });
        for (const m of geoWarn) log.warn(`generate ${orderId} tag${n} ${side}: ${m}`);
        const bl = { w: Number(r.W), h: Number(r.H) };
        let qrLayer;
        if (qrHere) {
          const g = SDTQR.geometry(qrHere.plan, qrHere.id, { base: qrHere.base });
          qrLayer = { index: QR_LAYER_INDEX, name: `SDT ${qrHere.preset.name} QR`, cutSetting: qrHere.preset.cutSetting, shapes: qrSubpaths(g, r, placeMm) };
        }
        const xml = buildLbrn2({
          qr: qrLayer,
          deviceName: config.deviceName,
          layerName: `SDT ${preset.name}${preset.status === 'untested' ? ' (UNTESTED)' : ''}`,
          cutSetting: preset.cutSetting,
          tool: g.tool,
          scan: [...g.icon, ...g.text],
          notes: notesText({ orderId, i, count: tags.length, side, t, bl, preset, r, warnings, generatedAt, qrNote: qrHere ? `QR ${qrHere.id}: v${qrHere.plan.version}-${qrHere.plan.ecl}, ${qrHere.plan.moduleMm} mm modules, ${qrHere.plan.polarity} polarity, preset ${qrHere.preset.name}. Scan it on the orders page before it ships.` : '' })
        });
        const base = fileBase(orderId, n, side);
        await writeFileAtomic(path.join(dir, `${base}.lbrn2`), xml);
        await writeFileAtomic(path.join(dir, `${base}.svg`), SDTLayout.svg(t, side, font, lopts));
        entry.files.push({ side, lbrn2: `${base}.lbrn2`, svg: `${base}.svg`, lines: r.lines, fontSize: r.fs, fit: r.fit, warnings });
      }
    }
  }

  // Holiday ornaments (Flint CR-007): never automatic. One manual entry each so the queue shows what is in the order:
  // the engraved stainless bone goes on the fiber laser from the photo, the printed acrylic goes to the xTool O1 from the orders page.
  const ornaments = Array.isArray(order.ornaments) ? order.ornaments : [];
  ornaments.forEach((o, j) => {
    if (!o || typeof o !== 'object') return;
    const stainless = o.tier === 'stainless';
    jobTags.push({
      index: tags.length + j, label: `ornament${j + 1}`, qty: o.qty || 1,
      shape: 'ornament', size: 'ornament', sizeLabel: '3 in disc / stainless bone', finish: stainless ? 'ornament-stainless' : 'ornament-acrylic', font: null, icon: 'none',
      mode: 'manual',
      manualReason: o.declined ? 'Upload declined: do not make this ornament.'
        : stainless ? 'Holiday ornament, engraved stainless bone: engrave the customer photo (grayscale) on the fiber laser, name and year on the back. Download the photo from the orders page.'
          : 'Holiday ornament, printed acrylic: make it on the xTool O1 from the orders page (print sheet and layout JSON), not on the fiber laser.',
      files: [], notes: [],
      manualLines: { front: [o.name, o.year].filter(Boolean), back: [] }
    });
  });

  const prints = Array.isArray(order.prints) ? order.prints : [];
  const job = {
    schema: 1,
    orderId,
    orderAt: order.at,
    generatedAt: now.toISOString(),
    generator: `sdt-laser ${SERVICE_VERSION}`,
    layoutVersion: SDTLayout.VERSION,
    customer: { name: (order.customer && order.customer.name) || '', delivery: (order.customer && order.customer.delivery) || 'ship' },
    hasPrints: prints.length > 0,
    printsSummary: prints.map((p) => `${p.qty || 1}x ${p.item}`),
    mode: jobTags.some((t) => t.mode === 'manual') ? 'manual' : 'queued',
    tags: jobTags
  };
  await writeFileAtomic(path.join(dir, 'job.json'), JSON.stringify(job, null, 2) + '\n');
  return { dir, job, mode: job.mode, archived };
}
