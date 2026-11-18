// Header-level inspection of uploaded raster images: verify the file really is a PNG, JPEG or WebP, read its pixel size,
// and refuse anything absurd. A 304 KB PNG can declare 50000 x 50000 pixels; xTool, LightBurn and browsers will try to
// allocate that, so the cap is enforced where the bytes arrive. Pure functions, no dependencies, unit-tested in
// tools/test/fullcolor.test.mjs.
//
// inspectRaster(bytes) -> { ok: true, mime, w, h } | { ok: false, error }

export const MAX_SIDE_PX = 12000;
export const MAX_PIXELS = 40_000_000;

const be32 = (b, i) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
const be16 = (b, i) => (b[i] << 8) | b[i + 1];
const le24 = (b, i) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);
const ascii = (b, i, s) => { for (let k = 0; k < s.length; k++) if (b[i + k] !== s.charCodeAt(k)) return false; return true; };

function png(b) {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (b.length < 33 || !sig.every((v, i) => b[i] === v)) return null;
  if (be32(b, 8) !== 13 || !ascii(b, 12, 'IHDR')) return { error: 'bad' };
  return { mime: 'image/png', w: be32(b, 16), h: be32(b, 20) };
}

function jpeg(b) {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) { i++; continue; }
    let m = b[i + 1];
    while (m === 0xff && i + 2 < b.length) { i++; m = b[i + 1]; } // fill bytes
    if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; } // markers with no length
    if (m === 0xd9 || m === 0xda) break; // end of image or start of scan: no frame header came first
    const len = be16(b, i + 2);
    if (len < 2) return { error: 'bad' };
    const sof = m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc;
    if (sof) return { mime: 'image/jpeg', h: be16(b, i + 5), w: be16(b, i + 7) };
    i += 2 + len;
  }
  return { error: 'bad' };
}

function webp(b) {
  if (b.length < 30 || !ascii(b, 0, 'RIFF') || !ascii(b, 8, 'WEBP')) return null;
  if (ascii(b, 12, 'VP8 ')) { // lossy: frame tag at 20, start code 9d 01 2a at 23
    if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return { error: 'bad' };
    return { mime: 'image/webp', w: (b[26] | (b[27] << 8)) & 0x3fff, h: (b[28] | (b[29] << 8)) & 0x3fff };
  }
  if (ascii(b, 12, 'VP8L')) { // lossless: signature 0x2f at 20, then 14 + 14 bits
    if (b[20] !== 0x2f) return { error: 'bad' };
    const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] * 2 ** 24);
    return { mime: 'image/webp', w: (bits & 0x3fff) + 1, h: ((bits >>> 14) & 0x3fff) + 1 };
  }
  if (ascii(b, 12, 'VP8X')) return { mime: 'image/webp', w: le24(b, 24) + 1, h: le24(b, 27) + 1 };
  return { error: 'bad' };
}

export function inspectRaster(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const r = png(b) || jpeg(b) || webp(b);
  if (!r || r.error) return { ok: false, error: 'That image could not be read. Use a PNG or JPG file.' };
  if (!(r.w > 0 && r.h > 0)) return { ok: false, error: 'That image could not be read. Use a PNG or JPG file.' };
  if (r.w > MAX_SIDE_PX || r.h > MAX_SIDE_PX || r.w * r.h > MAX_PIXELS) return { ok: false, error: `That image is too large (${r.w} x ${r.h} px). Resize it under ${MAX_SIDE_PX} px on each side and 40 megapixels.` };
  return { ok: true, mime: r.mime, w: r.w, h: r.h };
}
