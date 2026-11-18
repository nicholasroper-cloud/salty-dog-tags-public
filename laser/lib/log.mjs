// One-line-per-event logger. Writes logs/laser.log (rotates to laser.log.1 at 5 MB) once init() is called.
// Before init() (and in tests) lines only go to an in-memory ring, so importing a module never touches disk.
// Secrets registered with addSecret() are scrubbed from every line (R6: the admin key is never logged).
import { appendFileSync, mkdirSync, statSync, renameSync } from 'node:fs';
import path from 'node:path';

const MAX_BYTES = 5 * 1024 * 1024;
const secrets = new Set();
const ring = [];
let file = null;
let echo = false;

export function init({ dir, echoToStderr = false }) {
  mkdirSync(dir, { recursive: true });
  file = path.join(dir, 'laser.log');
  echo = echoToStderr;
}

export function addSecret(s) {
  if (typeof s === 'string' && s.length >= 8) secrets.add(s);
}

export function scrub(text) {
  let out = String(text);
  for (const s of secrets) out = out.split(s).join('[redacted]');
  return out;
}

function rotateIfNeeded() {
  try {
    if (statSync(file).size >= MAX_BYTES) renameSync(file, file + '.1');
  } catch { /* no file yet */ }
}

function write(level, msg) {
  const line = `${new Date().toISOString()} ${level} ${scrub(msg).replace(/\s*\n\s*/g, ' ')}`;
  ring.push(line);
  if (ring.length > 500) ring.shift();
  if (file) {
    try {
      rotateIfNeeded();
      appendFileSync(file, line + '\n');
    } catch { /* never let logging crash the daemon */ }
  }
  if (echo) process.stderr.write(line + '\n');
}

export const log = {
  info: (m) => write('INFO', m),
  warn: (m) => write('WARN', m),
  error: (m) => write('ERROR', m),
  recent: () => ring.slice(),
  clear: () => { ring.length = 0; }
};
