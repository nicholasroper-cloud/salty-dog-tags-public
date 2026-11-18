// Real (tiny) image headers for the upload tests: the server parses PNG IHDR, JPEG SOF and WebP headers (functions/api/_raster.js).
export const mkPng = (w, h) => { const b = Buffer.alloc(45); Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b); b.writeUInt32BE(13, 8); b.write('IHDR', 12); b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20); b[24] = 8; b[25] = 2; b.writeUInt32BE(0, 29); b.writeUInt32BE(0, 33); b.write('IEND', 37); return b; };
export const mkJpeg = (w, h) => Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, h >> 8, h & 255, w >> 8, w & 255, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01, 0xff, 0xd9]);
// WebP: kind 'VP8X' (extended), 'VP8L' (lossless) or 'VP8 ' (lossy)
export function mkWebp(w, h, kind = 'VP8X') {
  const b = Buffer.alloc(40); b.write('RIFF', 0); b.writeUInt32LE(32, 4); b.write('WEBP', 8); b.write(kind, 12); b.writeUInt32LE(18, 16);
  if (kind === 'VP8X') { b.writeUIntLE(w - 1, 24, 3); b.writeUIntLE(h - 1, 27, 3); }
  else if (kind === 'VP8L') { b[20] = 0x2f; const bits = (w - 1) | ((h - 1) << 14); b.writeUInt32LE(bits >>> 0, 21); }
  else { b[23] = 0x9d; b[24] = 0x01; b[25] = 0x2a; b.writeUInt16LE(w, 26); b.writeUInt16LE(h, 28); }
  return b;
}
export const dataUrl = (mime, buf) => `data:${mime};base64,` + Buffer.from(buf).toString('base64');
