// Single-writer lock file (.lock, O_EXCL, pid). One owner of state.json, UDP 19841, and the load rate limiter.
import { open, readFile, rename, unlink } from 'node:fs/promises';

export class LockHeldError extends Error {
  constructor(pid) { super(`another instance holds the lock (pid ${pid})`); this.pid = pid; }
}

function alive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

export async function acquireLock(file) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const fh = await open(file, 'wx', 0o600);
      await fh.writeFile(String(process.pid));
      await fh.close();
      let released = false;
      return {
        file,
        async release() {
          if (released) return;
          released = true;
          try {
            if ((await readFile(file, 'utf8')).trim() === String(process.pid)) await unlink(file);
          } catch { /* already gone */ }
        }
      };
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
    }
    let pid = NaN;
    try { pid = parseInt((await readFile(file, 'utf8')).trim(), 10); } catch (e) { if (e.code === 'ENOENT') continue; throw e; }
    if (Number.isInteger(pid) && pid > 0 && alive(pid)) throw new LockHeldError(pid);
    // stale: the owner is gone. Move it aside (never delete blindly) and retry.
    try { await rename(file, `${file}.stale-${Date.now()}`); } catch { /* raced */ }
  }
  throw new Error('could not acquire lock');
}
