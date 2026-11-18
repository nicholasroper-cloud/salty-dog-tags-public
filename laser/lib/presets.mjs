// Material presets: load, validate, map finish -> preset, and import from a saved .lbrn2. See SPEC 9.2.
import { readFile, readdir, rename, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exists, stamp, writeFileAtomic } from './fsutil.mjs';

export const PRESETS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'presets');
export const RESERVED_KEYS = ['index', 'name', 'priority', 'scanOpt', 'tabCount', 'tabCountMax'];
const NAME_RE = /^[a-z][a-z0-9-]{1,30}$/;
const KEY_RE = /^[A-Za-z][A-Za-z0-9_]*$/;
const MAX_IMPORT_BYTES = 50 * 1024 * 1024;

export function validatePreset(p) {
  const errs = [];
  if (!p || typeof p !== 'object') return ['preset must be an object'];
  if (typeof p.name !== 'string' || !NAME_RE.test(p.name)) errs.push('name must match /^[a-z][a-z0-9-]{1,30}$/');
  if (!['untested', 'tuned'].includes(p.status)) errs.push('status must be "untested" or "tuned"');
  if (!p.cutSetting || typeof p.cutSetting !== 'object' || Array.isArray(p.cutSetting)) {
    errs.push('cutSetting must be an object');
  } else {
    for (const [k, v] of Object.entries(p.cutSetting)) {
      if (!KEY_RE.test(k)) errs.push(`cutSetting key "${k}" is not a valid name`);
      if (RESERVED_KEYS.includes(k)) errs.push(`cutSetting key "${k}" is reserved`);
      const okNum = typeof v === 'number' && Number.isFinite(v);
      const okStr = typeof v === 'string' && v.length <= 64;
      if (!okNum && !okStr) errs.push(`cutSetting.${k} must be a finite number or a string of 64 characters or fewer`);
    }
  }
  return errs;
}

// Presets are read fresh for each generation, so an import needs no restart.
export async function loadPreset(name, dir = PRESETS_DIR) {
  if (!NAME_RE.test(name)) throw new Error(`bad preset name "${name}"`);
  const p = JSON.parse(await readFile(path.join(dir, `${name}.json`), 'utf8'));
  const errs = validatePreset(p);
  if (errs.length) throw new Error(`preset ${name} invalid: ${errs.join('; ')}`);
  if (p.name !== name) throw new Error(`preset file ${name}.json declares name "${p.name}"`);
  return p;
}

// finish -> preset, or undefined when the finish is not mapped (the entry becomes manual).
export async function presetFor(finish, config, dir = PRESETS_DIR) {
  const name = Object.prototype.hasOwnProperty.call(config.finishPreset, finish) ? config.finishPreset[finish] : undefined;
  return name ? loadPreset(name, dir) : undefined;
}

export async function validateAllMapped(config, dir = PRESETS_DIR) {
  const problems = [];
  for (const name of new Set(Object.values(config.finishPreset))) {
    if (!(await exists(path.join(dir, `${name}.json`)))) { problems.push(`finishPreset refers to missing presets/${name}.json`); continue; }
    try { await loadPreset(name, dir); } catch (e) { problems.push(e.message); }
  }
  return problems;
}

// ---- import from a saved .lbrn2 (pure parse, then file handling) ----

function xmlUnescape(s) {
  return s.replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}

// Returns { cutSetting, layerIndex, appVersion, warnings }. Throws "no Scan layer found".
export function parseScanLayer(xml, layer) {
  const warnings = [];
  const noSub = xml.replace(/<SubLayer\b[^>]*>[\s\S]*?<\/SubLayer>/g, () => {
    if (!warnings.includes('sub-layers ignored')) warnings.push('sub-layers ignored');
    return '';
  });
  const appVersion = (noSub.match(/<LightBurnProject\b[^>]*\bAppVersion="([^"]*)"/) || [])[1] || 'unknown';
  const blocks = [...noSub.matchAll(/<CutSetting type="Scan">([\s\S]*?)<\/CutSetting>/g)].map((m) => m[1]);
  let chosen = null, layerIndex = null;
  for (const b of blocks) {
    const idx = (b.match(/<index Value="([^"]*)"\/>/) || [])[1];
    if (layer === undefined || layer === null || String(layer) === idx) { chosen = b; layerIndex = idx; break; }
  }
  if (!chosen) throw new Error('no Scan layer found');
  const cutSetting = {};
  let scanOpt;
  for (const m of chosen.matchAll(/<(\w+) Value="([^"]*)"\/>/g)) {
    const key = m[1];
    const raw = xmlUnescape(m[2]);
    if (key === 'scanOpt') scanOpt = raw;
    if (RESERVED_KEYS.includes(key)) continue;
    cutSetting[key] = /^-?\d+(\.\d+)?$/.test(raw) ? Number(raw) : raw;
  }
  if (scanOpt !== undefined && scanOpt !== 'mergeAll') {
    warnings.push(`scanOpt=${scanOpt} dropped; fills use fill-all-at-once so letter holes stay open`);
  }
  return { cutSetting, layerIndex, appVersion, warnings };
}

export function diffCutSettings(oldCS, newCS) {
  const lines = [];
  for (const k of new Set([...Object.keys(oldCS || {}), ...Object.keys(newCS)])) {
    const a = oldCS ? oldCS[k] : undefined, b = newCS[k];
    if (a === b) lines.push(`  ${k}: ${b}`);
    else lines.push(`  ${k}: ${a === undefined ? '(none)' : a} -> ${b === undefined ? '(removed)' : b}`);
  }
  return lines;
}

// opts: { file, name, layer, config, presetsDir, now }
export async function importPreset({ file, name, layer, config, presetsDir = PRESETS_DIR, now = new Date() }) {
  if (!NAME_RE.test(name)) throw new Error('preset name must match /^[a-z][a-z0-9-]{1,30}$/');
  if (!file.endsWith('.lbrn2')) throw new Error('file must end with .lbrn2');
  const st = await stat(file);
  if (!st.isFile()) throw new Error('not a file');
  if (st.size > MAX_IMPORT_BYTES) throw new Error('file is larger than 50 MB');
  const warnings = [];
  if (config && !Object.values(config.finishPreset).includes(name)) warnings.push('preset will not be used until mapped (add it to finishPreset in config.local.json)');
  const parsed = parseScanLayer(await readFile(file, 'utf8'), layer);
  warnings.push(...parsed.warnings);
  let previous = null;
  const target = path.join(presetsDir, `${name}.json`);
  if (await exists(target)) {
    try { previous = JSON.parse(await readFile(target, 'utf8')); } catch { /* unreadable old preset is archived anyway */ }
    const hist = path.join(presetsDir, 'history');
    await mkdir(hist, { recursive: true });
    await rename(target, path.join(hist, `${name}-${stamp(now)}.json`));
  }
  const preset = {
    name,
    label: previous && previous.label ? previous.label : name,
    status: 'tuned',
    source: `imported from ${path.basename(file)} layer ${parsed.layerIndex} (${parsed.appVersion})`,
    updatedAt: now.toISOString().slice(0, 10),
    cutSetting: parsed.cutSetting
  };
  const errs = validatePreset(preset);
  if (errs.length) throw new Error(`imported preset invalid: ${errs.join('; ')}`);
  await mkdir(presetsDir, { recursive: true });
  await writeFileAtomic(target, JSON.stringify(preset, null, 2) + '\n');
  return { preset, warnings, diff: diffCutSettings(previous && previous.cutSetting, preset.cutSetting) };
}

export async function listPresets(dir = PRESETS_DIR) {
  return (await readdir(dir)).filter((n) => n.endsWith('.json')).map((n) => n.slice(0, -5)).sort();
}
