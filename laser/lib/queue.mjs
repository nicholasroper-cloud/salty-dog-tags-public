// Orchestration: poll, eligibility, remote-status sync, load handoff, auto-load, Mark engraved.
// This is the only module that changes job state. http.mjs and cli.mjs are thin adapters over it.
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { generateOrder, snapshotOrder, ORDER_ID_RE } from './generate.mjs';
import { writeFileAtomic } from './fsutil.mjs';
import { log } from './log.mjs';
import { MAX_ATTEMPTS, OPEN } from './state.mjs';
import { LASER_DIR } from './config.mjs';
import { notify } from './notify.mjs';

const REAL_ID_RE = /^SDT-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}$/;
const DEMO_ID_RE = /^SDT-(DEMO|OOPS)$/;
const LBRN2_NAME_RE = /^(SDT-[A-Z0-9]{4})-tag\d{1,2}-(front|front-halftone|back)\.lbrn2$/;
const MIN_POLL_S = 180;          // KV free-plan floor
const MAX_BACKOFF_S = 900;
const MAX_NOTIFY_PER_POLL = 5;   // a backlog of new orders gets one summary line after this many
const READS_CAP_PER_DAY = 50000; // half the free limit, leaves headroom for orders.html and other workers

// SPEC 9.3 with one deliberate tweak: the 900 s backoff cap never undercuts the read budget (base can exceed 900 on huge order lists).
export function effectiveInterval({ pollSeconds, kvPlan, orderCount = 0, failures = 0 }) {
  let base = pollSeconds;
  if (kvPlan === 'free' || kvPlan === 'unknown') {
    base = Math.max(base, MIN_POLL_S);
    if ((orderCount * 86400) / base > READS_CAP_PER_DAY) base = Math.ceil((orderCount * 86400) / READS_CAP_PER_DAY);
  }
  const intervalS = Math.min(base * 2 ** failures, Math.max(MAX_BACKOFF_S, base));
  const listsPerDay = Math.round(86400 / intervalS);
  return { baseS: base, intervalS, listsPerDay, readsPerDay: listsPerDay * orderCount };
}

export function kvBudgetLine(plan, k) {
  return `KV budget: plan=${plan}, interval=${k.intervalS}s, ~${k.listsPerDay}/day lists, ~${k.readsPerDay}/day reads (free limits 1,000 lists / 100,000 reads per account)`;
}

export function createQueue(deps) {
  const { config, state, api, lightburn } = deps;
  const queueDir = config.queueDir;
  const dataDir = deps.dataDir || path.join(LASER_DIR, 'data', 'orders');
  const now = deps.now || (() => new Date());
  const doExec = deps.execFile || execFile;
  const demoFile = deps.demoOrdersFile || path.join(LASER_DIR, 'test', 'fixtures', 'demo-orders.json');
  const demoPhotoFile = deps.demoPhotoFile || path.join(LASER_DIR, 'test', 'fixtures', 'demo-photo.jpg');
  const tell = (body) => notify({ body, config, exec: deps.notifyExec });
  const genBase = { config, queueDir, presetsDir: deps.presetsDir, fontOpts: deps.fontOpts, now };

  const rt = {
    queueWritable: null, failures: 0, orderCount: 0, polling: null, timer: null,
    lastInterval: null, warned: new Set(), startedAt: Date.now(), notes: [...(deps.startupNotes || [])]
  };
  const chains = new Map();   // per-order promise chains

  function withOrder(id, fn) {
    const prev = chains.get(id) || Promise.resolve();
    const next = prev.then(fn, fn);
    chains.set(id, next.catch(() => {}));
    return next;
  }

  // ---- queue folder probe (TCC / permissions) ----
  async function probeQueue() {
    try {
      await mkdir(queueDir, { recursive: true });
      const tmp = path.join(queueDir, '.write-probe.tmp');
      await writeFile(tmp, String(Date.now()));
      await rename(tmp, path.join(queueDir, '.write-probe'));
      rt.queueWritable = true;
    } catch (e) {
      if (rt.queueWritable !== false) log.error(`queue folder not writable (${queueDir}): ${e.code || e.message}`);
      rt.queueWritable = false;
    }
    return rt.queueWritable;
  }

  // ---- KV budget ----
  function kv() {
    const k = effectiveInterval({ pollSeconds: config.pollSeconds, kvPlan: config.kvPlan, orderCount: rt.orderCount, failures: rt.failures });
    return { plan: config.kvPlan, ...k, line: kvBudgetLine(config.kvPlan, k) };
  }
  function announceKv() {
    const k = kv();
    if (rt.lastInterval !== k.intervalS) { log.info(k.line); rt.lastInterval = k.intervalS; }
    return k;
  }

  // ---- job processing ----
  async function writeSnapshot(order) {
    await mkdir(dataDir, { recursive: true });
    await writeFileAtomic(path.join(dataDir, `${order.id}.json`), JSON.stringify(snapshotOrder(order), null, 2) + '\n');
  }

  const stubPhoto = async () => ({ bytes: await readFile(demoPhotoFile), contentType: 'image/jpeg' });

  // Generate one order and record the outcome. Never throws for generation failures; they become `error` jobs.
  function processOrder(order, { demo = false } = {}) {
    return withOrder(order.id, async () => {
      const base = { dir: path.join(queueDir, order.id), orderAt: order.at, customerName: (order.customer && order.customer.name) || '', remoteStatus: order.status, demo };
      try {
        await writeSnapshot(order);
        const res = await generateOrder(order, { ...genBase, demo, fetchPhoto: demo ? stubPhoto : (id, i) => api.getPhoto(id, i) });
        state.generated(order.id, { mode: res.mode, ...base });
        await state.save();
        log.info(`generate ${order.id} ok mode=${res.mode} tags=${res.job.tags.length}`);
        return { ok: true, mode: res.mode, job: res.job };
      } catch (e) {
        state.failed(order.id, e.message, base);
        await state.save();
        log.error(`generate ${order.id} failed (attempt ${state.job(order.id).attempts}): ${e.message}`);
        return { ok: false, error: e.message };
      }
    });
  }

  function isEligible(order) {
    if (!order || typeof order.id !== 'string') return false;
    if (!REAL_ID_RE.test(order.id)) {
      if (!rt.warned.has(order.id)) { rt.warned.add(order.id); log.warn(`skipping order with unexpected id ${JSON.stringify(String(order.id).slice(0, 20))}`); }
      return false;
    }
    if (!config.eligibleStatuses.includes(order.status)) return false;
    if ((!Array.isArray(order.tags) || order.tags.length === 0) && (!Array.isArray(order.ornaments) || order.ornaments.length === 0)) return false;
    const j = state.job(order.id);
    if (!j) return true;
    return state.retryable(order.id);   // `error` with attempts < 3 only
  }

  function syncRemote(orders) {
    const byId = new Map(orders.map((o) => [o.id, o]));
    for (const id of Object.keys(state.jobs)) {
      const j = state.job(id);
      if (j.demo) continue;
      const o = byId.get(id);
      if (!o) { if (state.missing(id)) log.warn(`order ${id} is absent from the API list`); continue; }
      const ch = state.remote(id, o.status);
      if (ch && ch.includes('done')) log.info(`order ${id} is ${o.status} remotely; marked done`);
    }
  }

  // ---- loading into LightBurn ----
  async function jobFiles(id) {
    try {
      const job = JSON.parse(await readFile(path.join(queueDir, id, 'job.json'), 'utf8'));
      return job.tags.flatMap((t) => t.files.map((f) => f.lbrn2));
    } catch { return []; }
  }

  async function recordLoad(orderId, file) {
    if (orderId && state.job(orderId)) { state.loaded(orderId, file); await state.save(); }
  }

  // Operator action (UI button / CLI load). FORCELOAD, explicit by definition.
  // verb 'LOADFILE' (opt-in) lets LightBurn ask about unsaved work; anything else is the default FORCELOAD.
  async function loadForOperator({ orderId, file, path: absPath, force = false, verb }) {
    let abs, id = orderId, name = file;
    if (orderId !== undefined) {
      if (!(REAL_ID_RE.test(orderId) || DEMO_ID_RE.test(orderId)) || typeof file !== 'string') return { ok: false, code: 'BAD_REQUEST', error: 'bad orderId or file' };
      const m = LBRN2_NAME_RE.exec(file);
      if (!m || m[1] !== orderId) return { ok: false, code: 'BAD_REQUEST', error: 'bad file name' };
      abs = path.join(queueDir, orderId, file);
    } else {
      abs = absPath;
      const bad = lightburn.validatePath(abs);
      if (bad) return { ok: false, code: 'BAD_PATH', error: bad };
      const m = LBRN2_NAME_RE.exec(path.basename(abs));
      id = m ? m[1] : undefined; name = path.basename(abs);
    }
    const bad = lightburn.validatePath(abs);
    if (bad) return { ok: false, code: 'BAD_PATH', error: bad };
    const st = await lightburn.status();
    if (st.busy && !force) return { ok: false, code: 'LASER_BUSY', error: 'LightBurn reports the laser busy or not connected. Load anyway?' };
    const soft = verb === 'LOADFILE';
    const r = soft ? await lightburn.loadFile(abs) : await lightburn.forceLoad(abs);
    if (r.ok) { await recordLoad(id, name); log.info(`load ${id || '-'} ${name} ok (${soft ? 'LOADFILE' : 'FORCELOAD'})`); }
    else log.warn(`load ${id || '-'} ${name} failed: ${r.code}`);
    return r;
  }

  // Notification text for an auto-loaded file: which tag and side, and how many to run (qty comes from job.json).
  async function loadedBody(id, file) {
    const m = /-(tag\d+)-(front-halftone|front|back)\.lbrn2$/.exec(file);
    const what = m ? `${m[1]} ${m[2].replace('-', ' ')}` : file;
    let qty = 1;
    try {
      const job = JSON.parse(await readFile(path.join(queueDir, id, 'job.json'), 'utf8'));
      const t = job.tags.find((x) => x.files.some((f) => f.lbrn2 === file));
      if (t && t.qty) qty = t.qty;
    } catch { /* qty stays 1 */ }
    return `${id} ${what} loaded in LightBurn. Check outline, Frame, Start (qty ${qty}).`;
  }

  // New jobs from one poll that did not end up in LightBurn (manual, LightBurn down, auto-load off) and generation errors.
  // The job that was auto-loaded already announced itself in autoLoadJob. Polls with nothing new never get here with results.
  async function announcePoll({ results, auto, tried, autoLoaded }) {
    const WHY = { LB_DOWN: 'LightBurn not responding', LB_TIMEOUT: 'LightBurn not responding', LASER_BUSY: 'laser busy or not connected', RECENT_LOAD: 'another file was just loaded' };
    const lines = [];
    for (const [id, r] of results) {
      if (!r.ok) {
        const j = state.job(id);
        lines.push(`${id} failed to generate: ${r.error} (attempt ${(j && j.attempts) || 1} of ${MAX_ATTEMPTS})`);
        continue;
      }
      if (autoLoaded && autoLoaded.ok && autoLoaded.orderId === id) continue;
      if (r.mode === 'manual') {
        const t = r.job.tags.find((x) => x.mode === 'manual');
        lines.push(`${id} ready (manual: ${(t && t.manualReason) || 'needs hand layout'})`);
      } else if (!config.autoLoad) lines.push(`${id} ready, auto-load is off`);
      else if (auto && id === tried) lines.push(`${id} ready, ${(autoLoaded && WHY[autoLoaded.code]) || `not auto-loaded (${autoLoaded ? autoLoaded.code : 'skipped'})`}`);
      else lines.push(`${id} ready`);
    }
    const shown = lines.slice(0, MAX_NOTIFY_PER_POLL);
    if (lines.length > shown.length) shown.push(`${lines.length - shown.length} more orders need attention. Open the queue page.`);
    await Promise.all(shown.map(tell));
  }

  // Automatic load: LOADFILE, which lets LightBurn ask about unsaved work. Only an idle, responsive LightBurn.
  async function autoLoadJob(id, why) {
    const j = state.job(id);
    if (!config.autoLoad) return { ok: false, code: 'AUTOLOAD_OFF' };
    // demo jobs load only by explicit UI/CLI action, never automatically (they sort oldest and would jump the real queue)
    if (!j || j.demo || j.status !== 'queued' || j.remoteStatus === 'cancelled') return { ok: false, code: 'NOT_ELIGIBLE' };
    if (lightburn.recentlyLoaded(config.lightburn.minLoadGapMs)) return { ok: false, code: 'RECENT_LOAD' };
    const p = await lightburn.ping();
    if (!p.up) return { ok: false, code: 'LB_DOWN' };
    const st = await lightburn.status();
    if (!st.ok) return { ok: false, code: 'LASER_BUSY' };
    const files = await jobFiles(id);
    if (!files.length) return { ok: false, code: 'NO_FILES' };
    const r = await lightburn.loadFile(path.join(queueDir, id, files[0]));
    if (r.ok) {
      await recordLoad(id, files[0]);
      log.info(`auto-load ${id} ${files[0]} ok (LOADFILE, ${why})`);
      await tell(await loadedBody(id, files[0]));
    } else log.info(`auto-load ${id} skipped: ${r.code} (${why})`);
    return { ...r, orderId: id, file: files[0] };
  }

  function nextQueued() {
    return Object.entries(state.jobs)
      .filter(([, j]) => !j.demo && j.status === 'queued' && j.remoteStatus !== 'cancelled' && !j.remoteMissing)
      .sort((a, b) => (a[1].orderAt || 0) - (b[1].orderAt || 0))[0];
  }

  async function autoLoadNextAfterEngraved() {
    if (!config.autoLoad || !config.autoLoadAfterEngraved) return null;
    const n = nextQueued();
    if (!n) return null;
    return autoLoadJob(n[0], 'after-engraved');
  }

  // ---- polling ----
  async function doPoll({ auto }) {
    const picked = [];
    await probeQueue();
    let orders;
    try {
      orders = await api.listOrders();
    } catch (e) {
      rt.failures++;
      state.setLastPoll({ at: now().toISOString(), ok: false, error: e.message, code: e.code || 'ERROR', orderCount: rt.orderCount, intervalS: kv().intervalS });
      await state.save();
      log.warn(`poll failed: ${e.message} (failures=${rt.failures}, next in ${kv().intervalS}s)`);
      return { ok: false, picked, error: e.message, code: e.code };
    }
    rt.failures = 0;
    rt.orderCount = orders.length;
    syncRemote(orders);
    const eligible = orders.filter(isEligible).sort((a, b) => a.at - b.at);
    const results = [];
    if (rt.queueWritable) {
      for (const o of eligible) {
        const r = await processOrder(o);
        picked.push(o.id);
        results.push([o.id, r]);
      }
    } else if (eligible.length) {
      log.warn(`poll: ${eligible.length} eligible order(s) not generated because the queue folder is not writable`);
    }
    const k = announceKv();
    state.setLastPoll({ at: now().toISOString(), ok: true, error: null, orderCount: orders.length, intervalS: k.intervalS });
    await state.save();
    log.info(`poll ok orders=${orders.length} picked=${picked.length} interval=${k.intervalS}s`);
    let autoLoaded = null, tried = null;
    if (auto && config.autoLoad) {
      const first = results.find(([, r]) => r.ok && r.mode === 'queued');
      if (first) { tried = first[0]; autoLoaded = await autoLoadJob(first[0], 'new-job'); }
    }
    if (results.length) await announcePoll({ results, auto, tried, autoLoaded }).catch((e) => log.warn(`notify failed: ${e.message}`));
    return { ok: true, picked, autoLoaded };
  }

  function poll({ auto = true } = {}) {
    if (rt.polling) return rt.polling;
    rt.polling = doPoll({ auto }).finally(() => { rt.polling = null; });
    return rt.polling;
  }

  // setTimeout chain, never setInterval: at most one poll in flight
  function startPolling({ firstDelayMs = 2000 } = {}) {
    announceKv();
    const tick = async () => {
      try { await poll(); } catch (e) { log.error(`poll crashed: ${e.message}`); }
      rt.timer = setTimeout(tick, kv().intervalS * 1000);
    };
    rt.timer = setTimeout(tick, firstDelayMs);
  }
  function stopPolling() { clearTimeout(rt.timer); rt.timer = null; }

  // ---- regenerate / gen ----
  async function fetchOrder(id) {
    if (DEMO_ID_RE.test(id)) {
      const demo = JSON.parse(await readFile(demoFile, 'utf8')).find((o) => o.id === id);
      if (demo) return { order: demo, demo: true, warnings: [] };
    }
    try {
      const o = (await api.listOrders()).find((x) => x.id === id);
      if (o) return { order: o, demo: false, warnings: [] };
    } catch (e) {
      try {
        const snap = JSON.parse(await readFile(path.join(dataDir, `${id}.json`), 'utf8'));
        return { order: snap, demo: false, warnings: [`API unavailable (${e.message}); regenerated from the saved snapshot`] };
      } catch { throw Object.assign(new Error(`API unavailable (${e.message}) and no saved snapshot`), { code: e.code || 'API' }); }
    }
    throw Object.assign(new Error(`order ${id} not found`), { code: 'NOT_FOUND' });
  }

  async function regenerate(id) {
    if (typeof id !== 'string' || !(REAL_ID_RE.test(id) || DEMO_ID_RE.test(id))) return { ok: false, code: 'BAD_ID', error: 'bad order id' };
    if (!rt.queueWritable && !(await probeQueue())) return { ok: false, code: 'QUEUE_NOT_WRITABLE', error: 'queue folder not writable' };
    let got;
    try { got = await fetchOrder(id); } catch (e) { return { ok: false, code: e.code || 'API', error: e.message }; }
    const { order, demo, warnings } = got;
    if (order.status === 'cancelled') return { ok: false, code: 'CANCELLED', error: 'order is cancelled' };
    if (!demo && order.status !== 'paid') warnings.push(`order status is "${order.status}", not paid`);
    if ((!Array.isArray(order.tags) || !order.tags.length) && (!Array.isArray(order.ornaments) || !order.ornaments.length)) return { ok: false, code: 'NO_TAGS', error: 'order has no tags or ornaments' };
    const r = await processOrder(order, { demo });
    log.info(`regenerate ${id}: ${r.ok ? r.mode : 'error'}${warnings.length ? ' warnings=' + warnings.join('|') : ''}`);
    return r.ok ? { ok: true, mode: r.mode, warnings } : { ok: false, code: 'GENERATE', error: r.error, warnings };
  }

  async function demo({ load = false } = {}) {
    await probeQueue();
    if (!rt.queueWritable) return { ok: false, code: 'QUEUE_NOT_WRITABLE', error: 'queue folder not writable' };
    const orders = JSON.parse(await readFile(demoFile, 'utf8'));
    const out = [];
    for (const o of orders) { const r = await processOrder(o, { demo: true }); out.push({ id: o.id, ...r }); }
    let loaded = null;
    if (load) {
      const files = await jobFiles('SDT-DEMO');
      loaded = files.length ? await lightburn.loadFile(path.join(queueDir, 'SDT-DEMO', files[0])) : { ok: false, code: 'NO_FILES' };
      if (loaded.ok) { await recordLoad('SDT-DEMO', files[0]); log.info(`load ok ${files[0]} (demo --load, LOADFILE)`); }
      else log.warn(`demo --load failed: ${loaded.code}`);
    }
    return { ok: out.every((r) => r.ok), orders: out.map((r) => ({ id: r.id, ok: r.ok, mode: r.mode, error: r.error })), loaded };
  }

  // ---- Mark engraved ----
  async function engraved(id, { confirmPrints = false } = {}) {
    if (typeof id !== 'string' || !(REAL_ID_RE.test(id) || DEMO_ID_RE.test(id))) return { ok: false, code: 'BAD_ID' };
    return withOrder(id, async () => {
      const j = state.job(id);
      if (!j) return { ok: false, code: 'NO_JOB' };
      if (!OPEN.includes(j.status)) return { ok: false, code: 'NOT_OPEN' };
      let job = null;
      try { job = JSON.parse(await readFile(path.join(queueDir, id, 'job.json'), 'utf8')); } catch { /* treated as no prints */ }
      if (job && job.hasPrints && !confirmPrints) return { ok: false, code: 'HAS_PRINTS', prints: job.printsSummary };
      if (!j.demo) {
        try { await api.setStatus(id, 'made'); } catch (e) {
          log.warn(`mark engraved ${id}: POST made failed: ${e.message}`);
          return { ok: false, code: e.code || 'API', error: e.message };
        }
      }
      state.engraved(id);
      await state.save();
      log.info(`mark engraved ${id} (${j.demo ? 'demo, no POST' : 'POST made ok'})`);
      const out = { ok: true };
      const auto = await autoLoadNextAfterEngraved().catch((e) => ({ ok: false, code: 'ERROR', error: e.message }));
      if (auto) out.autoLoaded = { orderId: auto.orderId, file: auto.file, ok: auto.ok, code: auto.code };
      return out;
    });
  }

  // ---- reveal ----
  async function reveal({ orderId, file }) {
    if (typeof orderId !== 'string' || !(REAL_ID_RE.test(orderId) || DEMO_ID_RE.test(orderId))) return { ok: false, code: 'BAD_ID' };
    let target = path.join(queueDir, orderId);
    if (file !== undefined) {
      if (typeof file !== 'string' || !/^SDT-[A-Z0-9]{4}-tag\d{1,2}-(front|front-halftone|back)\.lbrn2$|^SDT-[A-Z0-9]{4}-tag\d{1,2}-photo\.(jpg|png|webp|bin)$/.test(file) || !file.startsWith(orderId + '-')) return { ok: false, code: 'BAD_FILE' };
      target = path.join(target, file);
    }
    target = path.resolve(target);
    if (!(target + path.sep).startsWith(queueDir + path.sep)) return { ok: false, code: 'BAD_PATH' };
    return new Promise((resolve) => doExec('/usr/bin/open', ['-R', target], (err) => resolve(err ? { ok: false, code: 'OPEN_FAILED', error: err.message } : { ok: true })));
  }

  // ---- views for the UI ----
  async function readJob(id) {
    try { return JSON.parse(await readFile(path.join(queueDir, id, 'job.json'), 'utf8')); } catch { return null; }
  }

  function banners() {
    const b = [];
    const lp = state.data.lastPoll;
    if (lp && !lp.ok && lp.code === 'AUTH') b.push('Admin key rejected by the site. Update laser/../.admin-key and restart the service (README, Troubleshooting).');
    if (rt.queueWritable === false) b.push(`Cannot write to the queue folder (${queueDir}). Check its permissions, or change queueDir in config.local.json (README, Troubleshooting).`);
    if (lightburn.disabled) b.push(`UDP reply port ${config.lightburn.replyPort} busy`);
    for (const [id, j] of Object.entries(state.jobs)) {
      if (j.demo || !OPEN.includes(j.status)) continue;
      if (j.remoteStatus === 'cancelled') b.push(`Order ${id} was cancelled. Do not engrave it.`);
      if (j.remoteMissing) b.push(`Order ${id} is no longer in the order list. Check /orders.html.`);
    }
    b.push(...rt.notes);
    return b;
  }

  async function views() {
    const all = Object.entries(state.jobs).map(([id, j]) => ({ id, j }));
    const open = all.filter((x) => OPEN.includes(x.j.status)).sort((a, b) => (a.j.orderAt || 0) - (b.j.orderAt || 0));
    const done = all.filter((x) => x.j.status === 'done').sort((a, b) => String(b.j.updatedAt).localeCompare(String(a.j.updatedAt))).slice(0, 20);
    const mk = async ({ id, j }) => {
      const { dir, ...rest } = j;
      return { orderId: id, ...rest, job: await readJob(id) };
    };
    return {
      jobs: await Promise.all([...open, ...done].map(mk)),
      lastLoaded: state.data.lastLoaded, lastPoll: state.data.lastPoll,
      lightburn: lightburn.health(), kv: kv(), banners: banners()
    };
  }

  function health() {
    const counts = { queued: 0, loaded: 0, manual: 0, error: 0, done: 0 };
    for (const j of Object.values(state.jobs)) if (j.status in counts) counts[j.status]++;
    const k = kv();
    return {
      ok: true, version: '1.0.0', caps: ['load-verb'], uptimeS: Math.round((Date.now() - rt.startedAt) / 1000), lastPoll: state.data.lastPoll,
      lightburn: lightburn.health(), counts, queueWritable: rt.queueWritable,
      kv: { plan: k.plan, intervalS: k.intervalS, listsPerDay: k.listsPerDay, readsPerDay: k.readsPerDay }
    };
  }

  return {
    poll, startPolling, stopPolling, probeQueue, regenerate, demo, engraved, reveal, views, health, kv, banners,
    lightburn, loadForOperator, autoLoadJob, autoLoadNextAfterEngraved, processOrder, isEligible, rt,
    MAX_ATTEMPTS, ORDER_ID_RE
  };
}
