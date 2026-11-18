// state.json: the job ledger. Atomic saves (R4), .bak fallback, corrupt-file recovery, and the job
// transition table from SPEC 9.5. The queue is the only module that calls the transitions.
import { copyFile, readFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { writeFileAtomic, stamp } from './fsutil.mjs';
import { log } from './log.mjs';

export const MAX_ATTEMPTS = 3;
export const OPEN = ['queued', 'loaded', 'manual', 'error'];
const REMOTE_DONE = ['made', 'shipped', 'done'];

function empty(now) {
  return { schema: 1, createdAt: now.toISOString(), lastPoll: null, lastLoaded: null, jobs: {} };
}

async function tryRead(file) {
  const parsed = JSON.parse(await readFile(file, 'utf8'));
  if (!parsed || typeof parsed !== 'object' || parsed.schema !== 1 || typeof parsed.jobs !== 'object') throw new Error('bad schema');
  return parsed;
}

// opts: { now: () => Date, beforeRename }
export async function openState(file, opts = {}) {
  const now = opts.now || (() => new Date());
  let data;
  try {
    data = await tryRead(file);
  } catch (e) {
    if (e.code === 'ENOENT') {
      data = empty(now());
    } else {
      log.warn(`state.json unreadable (${e.message}); moving to state.corrupt-*.json`);
      try { await rename(file, path.join(path.dirname(file), `state.corrupt-${stamp(now())}.json`)); } catch { /* gone */ }
      try {
        data = await tryRead(file + '.bak');
        log.warn('recovered state from state.json.bak');
      } catch {
        log.warn('state.json.bak also unusable; starting with an empty state (safe: only remote-paid orders regenerate, files are archived not overwritten)');
        data = empty(now());
      }
    }
  }
  let saveChain = Promise.resolve();

  function save() {
    const run = async () => {
      try { await copyFile(file, file + '.bak'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
      await writeFileAtomic(file, JSON.stringify(data, null, 2) + '\n', { beforeRename: opts.beforeRename });
    };
    const p = saveChain.then(run, run);
    saveChain = p.catch(() => {});
    return p;
  }

  const iso = () => now().toISOString();
  const job = (id) => data.jobs[id];

  // ---- transitions (SPEC 9.5) ----

  // (none)/any -> queued | manual after generation. Regenerate resets attempts.
  function generated(id, { mode, dir, orderAt, customerName, remoteStatus, demo = false }) {
    if (!['queued', 'manual'].includes(mode)) throw new Error(`bad mode ${mode}`);
    const prev = data.jobs[id];
    data.jobs[id] = {
      status: mode, demo, orderAt, customerName, remoteStatus, remoteMissing: false, dir,
      attempts: 0, error: null, createdAt: prev ? prev.createdAt : iso(), updatedAt: iso(), doneSource: null
    };
    return data.jobs[id];
  }

  // generation threw -> error, attempts += 1
  function failed(id, message, base = {}) {
    const prev = data.jobs[id];
    data.jobs[id] = {
      status: 'error', demo: false, orderAt: null, customerName: '', remoteStatus: null, remoteMissing: false, dir: null,
      createdAt: iso(), doneSource: null, ...(prev || {}), ...base,
      error: String(message).slice(0, 300), attempts: (prev ? prev.attempts : 0) + 1, updatedAt: iso()
    };
    return data.jobs[id];
  }

  const retryable = (id) => !!data.jobs[id] && data.jobs[id].status === 'error' && data.jobs[id].attempts < MAX_ATTEMPTS;

  // A load of one of the job's files returned OK. queued -> loaded; manual stays manual.
  function loaded(id, file) {
    const j = data.jobs[id];
    if (!j) throw new Error(`no job ${id}`);
    if (j.status === 'queued') j.status = 'loaded';
    j.updatedAt = iso();
    data.lastLoaded = { orderId: id, file, at: iso() };
    return j;
  }

  // Mark engraved succeeded. queued/loaded/manual/error -> done (ui).
  function engraved(id) {
    const j = data.jobs[id];
    if (!j) throw new Error(`no job ${id}`);
    if (!OPEN.includes(j.status)) throw new Error(`job ${id} is ${j.status}, not open`);
    j.status = 'done'; j.doneSource = 'ui'; j.updatedAt = iso();
    return j;
  }

  // Poll saw the order's remote status. Returns what changed.
  function remote(id, remoteStatus) {
    const j = data.jobs[id];
    if (!j || j.demo) return null;
    const changes = [];
    if (j.remoteStatus !== remoteStatus) { j.remoteStatus = remoteStatus; changes.push('remoteStatus'); }
    if (j.remoteMissing) { j.remoteMissing = false; changes.push('remoteMissing'); }
    if (REMOTE_DONE.includes(remoteStatus) && OPEN.includes(j.status)) {
      j.status = 'done'; j.doneSource = 'remote'; changes.push('done');
    }
    if (changes.length) j.updatedAt = iso();
    return changes;
  }

  function missing(id) {
    const j = data.jobs[id];
    if (!j || j.demo || j.remoteMissing) return false;
    j.remoteMissing = true; j.updatedAt = iso();
    return true;
  }

  return {
    file, data, save, job, generated, failed, retryable, loaded, engraved, remote, missing,
    setLastPoll(p) { data.lastPoll = p; },
    get jobs() { return data.jobs; }
  };
}
