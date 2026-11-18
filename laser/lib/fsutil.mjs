// Small filesystem helpers shared by state, generate, and presets. Nothing here deletes user data.
import { open, rename, mkdir, readdir, access } from 'node:fs/promises';
import path from 'node:path';

// Write temp file, fsync, rename. A reader (LightBurn!) never sees a half-written file (R4, 7.4).
// opts.beforeRename is a test seam to simulate a crash between write and rename.
export async function writeFileAtomic(file, data, opts = {}) {
  const tmp = `${file}.tmp-${process.pid}`;
  const fh = await open(tmp, 'w', 0o644);
  try {
    await fh.writeFile(data);
    await fh.sync();
  } finally {
    await fh.close();
  }
  if (opts.beforeRename) await opts.beforeRename(tmp);
  await rename(tmp, file);
}

export async function exists(p) {
  try { await access(p); return true; } catch { return false; }
}

// 20261016-181500 (UTC)
export function stamp(date = new Date()) {
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${date.getUTCFullYear()}${p(date.getUTCMonth() + 1)}${p(date.getUTCDate())}-${p(date.getUTCHours())}${p(date.getUTCMinutes())}${p(date.getUTCSeconds())}`;
}

// Move every entry in `dir` (except the `old` archive itself) into dir/old/<stamp>/. Returns the archive path or null.
// R2: the service never deletes; regeneration archives.
export async function archiveDirContents(dir, date = new Date()) {
  let entries;
  try { entries = await readdir(dir); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
  const moving = entries.filter((n) => n !== 'old');
  if (!moving.length) return null;
  let dest = path.join(dir, 'old', stamp(date));
  for (let i = 1; await exists(dest); i++) dest = path.join(dir, 'old', `${stamp(date)}-${i}`);
  await mkdir(dest, { recursive: true });
  for (const n of moving) await rename(path.join(dir, n), path.join(dest, n));
  return dest;
}
