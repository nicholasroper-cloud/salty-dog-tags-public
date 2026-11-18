// Photo tags (prototype, issue #3): turn a customer photo into the grayscale PNG that goes into a LightBurn Bitmap shape,
// and find the biggest window for it on the blank. Pure image work with sharp; no network, no LightBurn.
import sharp from 'sharp';

export const PHOTO_DPI = 400;            // source pixels per inch at the placed size; LightBurn dithers it at the layer's own dpi
export const PHOTO_EDGE_MM = 0.8;        // photo to outline; text keeps 1.5 mm (SDTLayout default), a portrait can sit closer
export const FEATHER_MM = 0.3;           // mask edge fades to white over this distance so the portrait does not end in a hard edge
export const WAIST_OFFSET_MM = 5;        // the waist is measured this far left of the blank centre, clear of the hanging hole
const ASPECT = 1.35;                     // widest window width / height; the photo is cover-cropped to it

const CAP_BYTES = 10 * 1024 * 1024;

// Superellipse test, |x/a|^n + |y/b|^n <= 1 (n = 2 ellipse, n = 4 the rounded-square "waist" window), centre (0, 0).
export function inSuperellipse(dx, dy, a, b, n) {
  return Math.pow(Math.abs(dx / a), n) + Math.pow(Math.abs(dy / b), n) <= 1;
}

// bytes: jpeg/png/webp. sizeMm: [w, h] of the placed window. maskMm(x, y) -> truthy where the photo shows, in mm from the
// window's top-left (y down). Returns { png, wPx, hPx, dpi }.
// Steps: EXIF-rotate, cover-crop to the window aspect, resample to ~400 dpi, grayscale, stretch 2nd..98th percentile,
// mild unsharp, then fade to white outside the mask (white = no mark): the binary mask is blurred by the feather width.
export async function preparePhoto(bytes, { sizeMm, maskMm, dpi = PHOTO_DPI, featherMm = FEATHER_MM }) {
  if (!bytes || bytes.length === 0 || bytes.length > CAP_BYTES) throw new Error('photo missing or over 10 MB');
  if (typeof maskMm !== 'function') throw new Error('preparePhoto needs a maskMm(x, y) function');
  const wPx = Math.max(8, Math.round(sizeMm[0] / 25.4 * dpi)), hPx = Math.max(8, Math.round(sizeMm[1] / 25.4 * dpi));
  const { data } = await sharp(bytes, { limitInputPixels: 64e6 })
    .rotate()
    .resize(wPx, hPx, { fit: 'cover', position: 'attention', kernel: 'lanczos3' })
    .grayscale()
    .normalise({ lower: 2, upper: 98 })
    .sharpen({ sigma: 0.8, m1: 0.6, m2: 1.2 })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const pxPerMm = dpi / 25.4;
  const bin = Buffer.alloc(wPx * hPx);
  for (let y = 0; y < hPx; y++) for (let x = 0; x < wPx; x++) bin[y * wPx + x] = maskMm((x + 0.5) / pxPerMm, (y + 0.5) / pxPerMm) ? 255 : 0;
  // toColourspace('b-w') before raw(): without it sharp hands back 3 channels and the mask stripes
  const soft = await sharp(bin, { raw: { width: wPx, height: hPx, channels: 1 } }).blur(Math.max(0.5, featherMm * pxPerMm / 2)).toColourspace('b-w').raw().toBuffer({ resolveWithObject: true });
  if (soft.info.channels !== 1) throw new Error(`mask came back with ${soft.info.channels} channels`);
  const out = Buffer.alloc(wPx * hPx);
  for (let k = 0; k < out.length; k++) {
    const m = soft.data[k] / 255;
    out[k] = Math.round(data[k] * m + 255 * (1 - m));
  }
  const png = await sharp(out, { raw: { width: wPx, height: hPx, channels: 1 } }).toColourspace('b-w').png({ compressionLevel: 9 }).toBuffer();
  return { png, wPx, hPx, dpi };
}

// The waist of the blank: the vertical free extent at a column WAIST_OFFSET_MM left of the blank centre (scanned in 0.05 mm
// steps with `free`, the clearance predicate). Returns { top, bottom } in blank-local mm, or null when nothing is free there.
export function waistExtent({ free, wMm, hMm }) {
  const x = wMm / 2 - WAIST_OFFSET_MM;
  let top = null, bottom = null;
  for (let y = 0; y <= hMm + 1e-9; y += 0.05) if (free(x, y)) { if (top === null) top = y; bottom = y; }
  return top === null ? null : { top, bottom };
}

// Window plan. Without an icon (every blank that has a cut-out, i.e. the polished bone): the "waist box". Its height is the free
// vertical extent at the waist, its width is height x clamp(aspect, 1.0, ASPECT) (aspect = EXIF-rotated source width/height),
// centred on the blank horizontally; it may exceed the free width because the mask clips it to `free` (a superellipse n = 4,
// so the cut-out and lobes simply notch the picture). With an icon: the largest ellipse of that aspect whose whole outline and a
// coarse interior grid pass `free`. `free(xMm, yMm)` is SDTLayout.clearance(t, PHOTO_EDGE_MM); coordinates are mm
// from the blank's top-left, y down. With `iconMm` set, a square icon of that size is kept clear on the right of the
// ellipse (the ellipse shifts left to make room). Returns { cx, cy, a, b, n (2 ellipse, 4 waist box), icon: {x0,y0,size}|null }.
export function planFront({ free, wMm, hMm, aspect = ASPECT, iconMm = 0 }) {
  const asp = Math.min(ASPECT, Math.max(1.0, aspect));
  if (!iconMm) {
    const e = waistExtent({ free, wMm, hMm });
    if (!e || e.bottom - e.top < 6) throw new Error('no photo window fits the blank');
    const h = e.bottom - e.top, w = h * asp;
    return { cx: wMm / 2, cy: (e.top + e.bottom) / 2, a: w / 2, b: h / 2, n: 4, icon: null };
  }
  const step = 0.25, mid = wMm / 2;
  const ringFree = (cx, cy, a, b) => {
    const n = Math.max(48, Math.ceil(2 * Math.PI * Math.max(a, b) / step));
    for (let k = 0; k < n; k++) { const t = 2 * Math.PI * k / n; if (!free(cx + a * Math.cos(t), cy + b * Math.sin(t))) return false; }
    for (let fx = -0.75; fx <= 0.75; fx += 0.25) for (let fy = -0.75; fy <= 0.75; fy += 0.25) if (fx * fx + fy * fy <= 0.5625 && !free(cx + a * fx, cy + b * fy)) return false;
    return true;
  };
  const squareFree = (x0, y0, s) => {
    for (let t = 0; t <= s + 1e-9; t += step) if (!free(x0 + t, y0) || !free(x0 + t, y0 + s) || !free(x0, y0 + t) || !free(x0 + s, y0 + t)) return false;
    return true;
  };
  // Icon case: the ellipse slides left (the blank is symmetric) to leave the icon its room; the largest one wins.
  let best = null;
  for (let shift = 0; shift <= 14; shift += 0.5) {
    const cx = mid - shift;
    for (let cy = 5; cy <= hMm - 5; cy += 0.5) {
      for (let a = Math.min(wMm / 2, 20); a >= 4; a -= 0.25) {
        const b = a / asp;
        if (best && a * b <= best.a * best.b) break;
        if (!ringFree(cx, cy, a, b)) continue;
        const x0 = cx + a + 1.0, y0 = cy - iconMm / 2;
        if (!squareFree(x0, y0, iconMm)) continue;
        best = { cx, cy, a, b, n: 2, icon: { x0, y0, size: iconMm } };
        break;
      }
    }
  }
  if (!best) throw new Error('no photo window fits the blank');
  return best;
}

// ---- quality gates (issue #3 step 2) ----
export const MIN_DPI = 150;              // below this at the placed size the photo is too small to engrave
export const SOFT_DPI = 250;             // 150..250 works but looks soft
export const MIN_STDDEV = 18;            // grayscale stddev (0-255); flatter than this dithers to a blob
export const DARK_MEAN = 60;
export const BRIGHT_MEAN = 200;

// Decoded source facts the gates need: pixel size after EXIF rotation, plus grayscale mean and stddev (0-255).
// Throws if sharp cannot decode the bytes.
export async function analysePhoto(bytes) {
  if (!bytes || bytes.length === 0 || bytes.length > CAP_BYTES) throw new Error('photo missing or over 10 MB');
  const img = sharp(bytes, { limitInputPixels: 64e6 });
  const meta = await img.metadata();
  const swap = meta.orientation >= 5 && meta.orientation <= 8;   // EXIF 5..8 are the 90 degree rotations
  if (!meta.width || !meta.height) throw new Error('unreadable image');
  const st = (await sharp(bytes, { limitInputPixels: 64e6 }).rotate().grayscale().stats()).channels[0];
  return { wPx: swap ? meta.height : meta.width, hPx: swap ? meta.width : meta.height, stats: { mean: st.mean, stddev: st.stdev } };
}

// Pure. windowMm: [w, h] of the placed ellipse. The source is cover-cropped to the window aspect, so the pixels that land
// across the window are min(wPx, hPx * aspect) wide and min(hPx, wPx / aspect) tall. Returns { ok, reason, warnings: string[], dpi }.
export function photoQuality({ wPx, hPx, stats, windowMm }) {
  const [ww, wh] = windowMm;
  const aspect = ww / wh;
  const across = Math.min(wPx, hPx * aspect);
  const dpi = across / (ww / 25.4);
  const needW = Math.ceil(ww / 25.4 * MIN_DPI), needH = Math.ceil(wh / 25.4 * MIN_DPI);
  const warnings = [];
  if (dpi < MIN_DPI) return { ok: false, reason: `Photo too small: ${wPx} x ${hPx} px, need at least ${needW} x ${needH} for this tag`, warnings, dpi };
  if (stats.stddev < MIN_STDDEV) return { ok: false, reason: `Photo is low contrast (stddev ${stats.stddev.toFixed(1)}). Lay it out by hand or ask for a better photo`, warnings, dpi };
  if (dpi < SOFT_DPI) warnings.push('Photo is soft at this size');
  if (stats.mean < DARK_MEAN) warnings.push('Photo is very dark; check the preview');
  else if (stats.mean > BRIGHT_MEAN) warnings.push('Photo is very bright; check the preview');
  return { ok: true, reason: null, warnings, dpi };
}
