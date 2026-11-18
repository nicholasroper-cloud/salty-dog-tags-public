// QR laser test matrix (ADR task 4 support). For every QR-capable finish and both polarities it writes ONE .lbrn2 holding 10 test
// codes on a flat coupon of that material: 5 module sizes (0.35 0.40 0.45 0.50 0.60 mm) x 2 error correction levels (M = Version 2,
// Q = Version 3). The payloads are real, harmless ones: they open the generic "call the number on the back" page.
// Nick engraves each file on a scrap of the matching finish, scans with 3 phones, and fills in site/tag-qr-finishes.json.
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { SDTQR } from './qr.mjs';
import { qrSubpaths } from './geometry.mjs';
import { buildLbrn2, SERVICE_VERSION, QR_LAYER_INDEX } from './lbrn2.mjs';
import { loadPreset } from './presets.mjs';
import { writeFileAtomic } from './fsutil.mjs';

export const MATRIX_MODULES_MM = [0.35, 0.40, 0.45, 0.50, 0.60];
export const MATRIX_ECLS = ['M', 'Q'];
const COLS = 4, PITCH_MM = 25, QUIET = 4;

// Finishes the matrix covers: every finish that has a QR preset family (rainbow and full color are never QR).
export const matrixFinishes = () => Object.keys(SDTQR.FINISHES).filter((f) => SDTQR.FINISHES[f].preset && SDTQR.FINISHES[f].status !== 'off');

export function matrixCodes(polarity) {
  const out = []; let i = 0;
  for (const ecl of MATRIX_ECLS) for (const mm of MATRIX_MODULES_MM) {
    const id = `TEST${ecl}${String(Math.round(mm * 100)).padStart(3, '0')}${polarity === 'inverse' ? 'N' : 'D'}${i}`;
    out.push({ i, id, ecl, mm });
    i++;
  }
  return out;
}

// One matrix file: returns { name, xml, codes }. placeMm is the coupon centre in the LightBurn workspace.
export async function buildMatrix({ finish, polarity, config, presetsDir, now = new Date(), insetMm = SDTQR.QR_INSET_MM }) {
  const info = SDTQR.finishInfo(finish);
  const preset = await loadPreset(info.preset, presetsDir);
  const codes = matrixCodes(polarity);
  const rows = Math.ceil(codes.length / COLS);
  const gridW = COLS * PITCH_MM, gridH = rows * PITCH_MM;
  const shapes = [];
  for (const c of codes) {
    const e = SDTQR.encode(SDTQR.payloadFor(c.id), c.ecl);
    const box = (e.size + 2 * QUIET) * c.mm, col = c.i % COLS, row = Math.floor(c.i / COLS);
    const x = col * PITCH_MM + (PITCH_MM - box) / 2, y = row * PITCH_MM + (PITCH_MM - box) / 2;
    const plan = { ecl: c.ecl, version: e.version, size: e.size, moduleMm: c.mm, quiet: QUIET, x, y, boxMm: box, dataMm: e.size * c.mm,
      dataX: x + QUIET * c.mm, dataY: y + QUIET * c.mm, polarity, insetMm, payload: SDTQR.payloadFor(c.id) };
    shapes.push(...qrSubpaths(SDTQR.geometry(plan, c.id), { bw: gridW, bh: gridH, s: 1 }, config.fieldCenter));
  }
  const grid = codes.map((c) => `#${c.i + 1} (row ${Math.floor(c.i / COLS) + 1}, col ${(c.i % COLS) + 1}): ${c.ecl} ${c.mm} mm`).join('\n');
  const notes = [`QR test matrix: ${finish}, ${polarity} polarity`,
    `Engrave on a flat scrap of the same finish. ${polarity === 'inverse' ? 'INVERSE: the light modules and the quiet zone are engraved (bare metal); the dark modules stay as the original surface.' : 'DARK: the dark modules are engraved (marked).'}`,
    `Layer ${QR_LAYER_INDEX} is the QR layer (preset ${preset.name}, ${preset.status}). Scan each code with 3 phones at 10 to 30 cm, indoors and in daylight.`,
    grid, `Generated ${now.toISOString().replace(/\.\d+Z$/, 'Z')} by sdt-laser ${SERVICE_VERSION}`].join('\n');
  const xml = buildLbrn2({
    deviceName: config.deviceName, layerName: `SDT ${preset.name} matrix`, cutSetting: preset.cutSetting, tool: [], scan: [], notes,
    qr: { index: QR_LAYER_INDEX, name: `SDT ${preset.name} QR`, cutSetting: preset.cutSetting, shapes }
  });
  return { name: `qrtest-${finish}-${polarity}.lbrn2`, xml, codes, preset: preset.name };
}

// Writes every file plus an index. Returns the list of files.
export async function writeMatrix({ outDir, config, presetsDir, now = new Date() }) {
  await mkdir(outDir, { recursive: true });
  const files = [], index = ['finish,polarity,preset,file'];
  for (const finish of matrixFinishes()) for (const polarity of ['dark', 'inverse']) {
    const m = await buildMatrix({ finish, polarity, config, presetsDir, now });
    await writeFileAtomic(path.join(outDir, m.name), m.xml);
    files.push(m.name); index.push(`${finish},${polarity},${m.preset},${m.name}`);
  }
  await writeFileAtomic(path.join(outDir, 'INDEX.csv'), index.join('\n') + '\n');
  return files;
}
