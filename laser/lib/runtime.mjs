// Shared bootstrap for the daemon and the CLI's in-process mode: config, key, log, lock, state, api, LightBurn, queue.
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { loadConfig, readAdminKey, LASER_DIR } from './config.mjs';
import { log, init as initLog, addSecret } from './log.mjs';
import { acquireLock } from './lock.mjs';
import { openState } from './state.mjs';
import { createApi } from './api.mjs';
import { createLightBurn } from './lightburn.mjs';
import { createQueue } from './queue.mjs';

// opts: { needKey (default true), echoLog }
export async function boot(opts = {}) {
  await mkdir(path.join(LASER_DIR, 'logs'), { recursive: true });   // before anything else (launchd opens its own files first)
  initLog({ dir: path.join(LASER_DIR, 'logs'), echoToStderr: !!opts.echoLog });
  const config = await loadConfig();
  const notes = [];
  let key = null;
  if (opts.needKey !== false) {
    const r = await readAdminKey(config);
    key = r.key;
    addSecret(key);
    if (r.warning) { log.warn(r.warning); notes.push(r.warning); }
  }
  const lock = await acquireLock(path.join(LASER_DIR, '.lock'));
  const state = await openState(path.join(LASER_DIR, 'state.json'));
  const api = key ? createApi({ apiBase: config.apiBase, key }) : null;
  const lightburn = createLightBurn({ config, queueDir: config.queueDir });
  await lightburn.start();
  const queue = createQueue({ config, state, api, lightburn, startupNotes: notes });
  return { config, lock, state, api, lightburn, queue, async shutdown() { queue.stopPolling(); await lightburn.close(); await state.save().catch(() => {}); await lock.release(); } };
}
