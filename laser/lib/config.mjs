// Load config.json + config.local.json, expand ~, validate. Exit-1 material lives in ConfigError.
import { readFile, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateAllMapped, PRESETS_DIR } from './presets.mjs';

export const LASER_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

export class ConfigError extends Error {
  constructor(problems) {
    super(`Invalid configuration:\n  - ${problems.join('\n  - ')}`);
    this.problems = problems;
  }
}

export function expandHome(p) {
  if (typeof p !== 'string') return p;
  if (p === '~') return os.homedir();
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2));
  return p;
}

const NESTED = ['ui', 'lightburn', 'finishPreset'];

export function mergeConfig(base, local) {
  const out = { ...base, ...local };
  for (const k of NESTED) out[k] = { ...(base[k] || {}), ...((local && local[k]) || {}) };
  return out;
}

async function readJsonIfPresent(file) {
  try { return JSON.parse(await readFile(file, 'utf8')); } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw new Error(`${file}: ${e.message}`);
  }
}

// Pure checks (no disk). Returns a list of problems.
export function checkConfig(c) {
  const p = [];
  if (!c.ui || c.ui.host !== '127.0.0.1') p.push('ui.host must be 127.0.0.1');
  if (!c.ui || !Number.isInteger(c.ui.port) || c.ui.port < 1 || c.ui.port > 65535) p.push('ui.port must be a port number');
  if (!Array.isArray(c.fieldCenter) || c.fieldCenter.length !== 2 || !c.fieldCenter.every((v) => typeof v === 'number' && v >= 0 && v <= 200)) p.push('fieldCenter must be [x, y] with both between 0 and 200');
  if (!Array.isArray(c.eligibleStatuses) || !c.eligibleStatuses.length || !c.eligibleStatuses.every((s) => ['paid', 'invoiced'].includes(s))) p.push('eligibleStatuses must be a non-empty subset of ["paid","invoiced"]');
  if (!['free', 'paid', 'unknown'].includes(c.kvPlan)) p.push('kvPlan must be "free", "paid", or "unknown"');
  if (typeof c.pollSeconds !== 'number' || !(c.pollSeconds >= 10)) p.push('pollSeconds must be a number of at least 10');
  if (typeof c.autoLoad !== 'boolean') p.push('autoLoad must be true or false');
  if (typeof c.autoLoadAfterEngraved !== 'boolean') p.push('autoLoadAfterEngraved must be true or false');
  if (c.notify !== undefined && typeof c.notify !== 'boolean') p.push('notify must be true or false');
  if (typeof c.queueDir !== 'string' || !c.queueDir) p.push('queueDir must be a path');
  if (typeof c.apiBase !== 'string' || !/^https:\/\//.test(c.apiBase)) p.push('apiBase must be an https:// URL');
  if (!c.finishPreset || typeof c.finishPreset !== 'object') p.push('finishPreset must be an object');
  const lb = c.lightburn || {};
  if (!['127.0.0.1', 'localhost'].includes(lb.host)) p.push('lightburn.host must be 127.0.0.1 (or localhost): LightBurn commands are never sent off this machine');
  for (const k of ['cmdPort', 'replyPort', 'timeoutMs', 'minLoadGapMs', 'pingEverySeconds']) {
    if (typeof lb[k] !== 'number') p.push(`lightburn.${k} must be a number`);
  }
  return p;
}

// Returns the resolved config (absolute paths). Throws ConfigError.
export async function loadConfig({ dir = LASER_DIR, presetsDir = PRESETS_DIR } = {}) {
  const base = JSON.parse(await readFile(path.join(dir, 'config.json'), 'utf8'));
  const local = await readJsonIfPresent(path.join(dir, 'config.local.json'));
  const c = mergeConfig(base, local || {});
  const problems = checkConfig(c);
  if (problems.length) throw new ConfigError(problems);
  c.queueDir = path.resolve(expandHome(c.queueDir));
  c.adminKeyFile = path.resolve(dir, expandHome(c.adminKeyFile));
  problems.push(...(await validateAllMapped(c, presetsDir)));
  if (problems.length) throw new ConfigError(problems);
  return c;
}

// Read the admin key once. Never log it; the caller registers it with log.addSecret().
export async function readAdminKey(c) {
  let key;
  try { key = (await readFile(c.adminKeyFile, 'utf8')).trim(); } catch (e) {
    throw new ConfigError([`admin key file not readable: ${c.adminKeyFile} (${e.code || e.message})`]);
  }
  if (key.length !== 32) throw new ConfigError([`admin key in ${c.adminKeyFile} must be 32 characters after trimming`]);
  let warning = null;
  try {
    const mode = (await stat(c.adminKeyFile)).mode;
    if (mode & 0o044) warning = `admin key file ${c.adminKeyFile} is group- or world-readable; chmod 600 it`;
  } catch { /* ignore */ }
  return { key, warning };
}
