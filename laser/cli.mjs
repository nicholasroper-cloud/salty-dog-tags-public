// CLI: a thin adapter. With the daemon up it calls the daemon over HTTP; otherwise it takes the lock and runs in-process,
// so exactly one process ever owns state.json, UDP port 19841, and the load rate limiter (SPEC 11.1).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './lib/config.mjs';
import { importPreset } from './lib/presets.mjs';
import { LockHeldError } from './lib/lock.mjs';
import { ConfigError } from './lib/config.mjs';

const USAGE = `usage: node cli.mjs <command>
  once                          one poll + generate (never auto-loads)
  gen <orderId>                 (re)generate one order
  load <file.lbrn2> [--force]   load a queue file into LightBurn (FORCELOAD)
  ping                          is LightBurn answering?
  preset import <file.lbrn2> <name> [--layer N]
  qr-matrix [--out <dir>]       write the QR laser test matrix: one .lbrn2 per finish and polarity (5 module sizes x M and Q); default <queueDir>/qr-matrix
  demo [--load]                 generate the two demo orders (--load: open SDT-DEMO with LOADFILE)
  demo-photo [--photo <file>] [--dither <mode>] [--no-icon] [--load]
                                prototype (issue #3): stainless bone photo tag in SDT-PHOTO: front photo, front-halftone variant, back text (never auto-queued)`;

const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith('--') && a !== '--layer' && a !== '--photo' && a !== '--dither' && a !== '--out'));
const li = argv.indexOf('--layer');
const layer = li >= 0 ? argv[li + 1] : undefined;
const pi = argv.indexOf('--photo');
const photoArg = pi >= 0 ? argv[pi + 1] : undefined;
const di = argv.indexOf('--dither');
const ditherArg = di >= 0 ? argv[di + 1] : undefined;
const oi0 = argv.indexOf('--out');
const pos = argv.filter((a, i) => !a.startsWith('--') && !(li >= 0 && i === li + 1) && !(pi >= 0 && i === pi + 1) && !(di >= 0 && i === di + 1) && !(oi0 >= 0 && i === oi0 + 1));
const cmd = pos[0];

const out = (s) => console.log(s);
const err = (s) => console.error(s);

async function daemonUp(port) {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(500) });
    return r.ok;
  } catch { return false; }
}

async function viaDaemon(port, route, body) {
  const r = await fetch(`http://127.0.0.1:${port}${route}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-SDT-Laser': '1' }, body: JSON.stringify(body || {}), signal: AbortSignal.timeout(120000)
  });
  let data = {}; try { data = await r.json(); } catch { /* empty */ }
  return data;
}

// ---- command bodies; each takes a `ctx` with the same shape for daemon and in-process modes ----
const ops = {
  async once(ctx) {
    const r = await ctx.poll();
    if (!r.ok) { err(`poll failed: ${r.error || r.code}`); return 3; }
    out(r.picked.length ? `picked: ${r.picked.join(', ')}` : 'nothing new');
    return 0;
  },
  async gen(ctx, id) {
    if (!/^SDT-[A-Z0-9]{4}$/.test(id || '')) { err('bad order id (expected SDT-XXXX)'); return 1; }
    const r = await ctx.regenerate(id);
    (r.warnings || []).forEach((w) => err(`warning: ${w}`));
    if (r.ok) { out(`${id}: ${r.mode}`); return 0; }
    err(`${id}: ${r.error || r.code}`);
    return r.code === 'CANCELLED' || r.code === 'BAD_ID' || r.code === 'NO_TAGS' ? 1 : 3;
  },
  async load(ctx, file, force) {
    if (!file) { err(USAGE); return 1; }
    const r = await ctx.load(path.resolve(file), force);
    if (r.ok) { out('loaded'); if (r.warning) err(`warning: ${r.warning}`); return 0; }
    err(`load failed: ${r.code}${r.error ? ' - ' + r.error : ''}${r.code === 'LASER_BUSY' ? ' (use --force)' : ''}`);
    return r.code === 'BAD_PATH' || r.code === 'BAD_REQUEST' ? 1 : 2;
  },
  async ping(ctx) {
    const r = await ctx.ping();
    if (!r.up) { out('LightBurn: not responding'); return 2; }
    out('LightBurn: OK');
    out(r.status === 'idle' ? 'Laser: idle' : 'Laser: busy/not connected');
    return 0;
  },
  async demo(ctx, withLoad) {
    const r = await ctx.demo(withLoad);
    for (const o of r.orders || []) out(`${o.id}: ${o.ok ? o.mode : 'ERROR ' + o.error}`);
    if (!r.ok && !r.orders) { err(r.error || r.code); return 1; }
    if (withLoad) {
      if (r.loaded && r.loaded.ok) out('SDT-DEMO loaded in LightBurn');
      else { err(`load failed: ${r.loaded ? r.loaded.code : 'n/a'}`); return 2; }
    }
    return r.ok ? 0 : 1;
  }
};

function httpCtx(port) {
  return {
    poll: () => viaDaemon(port, '/api/poll', { auto: false }),   // `once` never auto-loads
    regenerate: (id) => viaDaemon(port, '/api/regenerate', { orderId: id }),
    load: (p, force) => viaDaemon(port, '/api/load', { path: p, force }),
    ping: () => viaDaemon(port, '/api/ping'),
    demo: (load) => viaDaemon(port, '/api/demo', { load })
  };
}

function localCtx(rt) {
  const { queue, lightburn } = rt;
  return {
    poll: () => queue.poll({ auto: false }),            // local mode never auto-loads
    regenerate: (id) => queue.regenerate(id),
    load: (p, force) => queue.loadForOperator({ path: p, force }),
    ping: async () => { const pg = await lightburn.ping(); const st = pg.up ? await lightburn.status() : null; return { up: pg.up, status: st ? (st.ok ? 'idle' : 'busy') : null }; },
    demo: (load) => queue.demo({ load })
  };
}

// Writes the SDT-PHOTO files, then (with --load) opens the front with LOADFILE, never FORCELOAD and never a start command:
//  1. service up and new enough (health.caps has load-verb): POST /api/load {path, verb:'LOADFILE'} like the UI does;
//  2. service up but older (its /api/load only does FORCELOAD): one raw LOADFILE datagram; LightBurn answers the service's
//     reply port, so there is no confirmation here;
//  3. service down: this process opens its own LightBurn socket.
async function demoPhoto() {
  const [{ writePhotoDemo }, { createLightBurn }, { existsSync }] = await Promise.all([
    import('./lib/photodemo.mjs'), import('./lib/lightburn.mjs'), import('node:fs')
  ]);
  const cfg = await loadConfig();
  const siteAssets = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'site', 'assets');
  const sources = [
    photoArg && ['--photo', path.resolve(photoArg)],
    ['dog-photo.jpg in the queue folder', path.join(cfg.queueDir, 'dog-photo.jpg')],
    ['default site/assets/whisky-tag-real.jpg (a photo of a tag, not a dog)', path.join(siteAssets, 'whisky-tag-real.jpg')]
  ].filter(Boolean);
  const src = sources.find(([, p]) => existsSync(p));
  if (!src) { err('no photo found; pass --photo <file>'); return 1; }
  const photoPath = src[1];
  let r;
  try { r = await writePhotoDemo({ config: cfg, photoPath, dither: ditherArg, noIcon: flags.has('--no-icon') }); } catch (e) { err(e.message); return 1; }
  const m = r.meta;
  out(`photo: ${photoPath}  [${src[0]}]`);
  out(`blank ${m.blank.w} x ${m.blank.h} mm; photo window ${m.window.n === 4 ? 'superellipse' : 'ellipse'} ${m.sizeMm[0].toFixed(2)} x ${m.sizeMm[1].toFixed(2)} mm centred (${m.window.cx.toFixed(2)}, ${m.window.cy.toFixed(2)}) from top-left${m.icon ? `; icon ${m.icon.size} mm at x ${m.icon.x0.toFixed(2)}` : ''}`);
  out(`image ${m.image.wPx} x ${m.image.hPx} px @ ${m.image.dpi} dpi, ${m.image.bytes} bytes PNG; dither ${m.dither} (+ halftone variant); back text ${m.back.lines.join(' / ')} at ${m.back.fontMm.toFixed(2)} mm`);
  for (const f of r.files) out(`wrote ${path.join(r.dir, f)}`);
  if (!flags.has('--load')) return 0;

  if (await daemonUp(cfg.ui.port)) {
    let caps = [];
    try { caps = (await (await fetch(`http://127.0.0.1:${cfg.ui.port}/api/health`, { signal: AbortSignal.timeout(1000) })).json()).caps || []; } catch { /* treated as old */ }
    if (caps.includes('load-verb')) {
      const l = await viaDaemon(cfg.ui.port, '/api/load', { path: r.file, verb: 'LOADFILE' });
      if (l.ok) { out('loaded in LightBurn through the service (LOADFILE)'); if (l.warning) err(`warning: ${l.warning}`); return 0; }
      err(`load failed: ${l.code || 'error'}${l.error ? ' - ' + l.error : ''}`); return 2;
    }
    const { default: dgram } = await import('node:dgram');
    const sock = dgram.createSocket('udp4');
    await new Promise((res) => sock.send(Buffer.from(`LOADFILE:${r.file}`), cfg.lightburn.cmdPort, cfg.lightburn.host, () => setTimeout(res, 300)));
    sock.close();
    out('service is running but predates the load verb (its /api/load is FORCELOAD only); sent one LOADFILE datagram instead. No reply is visible here: check the LightBurn title bar. Restart the service to use the route.');
    return 0;
  }
  const lb = createLightBurn({ config: cfg, queueDir: cfg.queueDir });
  try {
    if (!(await lb.start())) { err('UDP reply port busy; not loading'); return 2; }
    const l = await lb.loadFile(r.file);
    if (l.ok) { out('loaded in LightBurn (LOADFILE)'); if (l.warning) err(`warning: ${l.warning}`); return 0; }
    err(`load failed: ${l.code}`); return 2;
  } finally { await lb.close(); }
}

async function main() {
  if (!cmd || cmd === 'help' || cmd === '--help') { out(USAGE); return cmd ? 0 : 1; }

  if (cmd === 'preset') {
    if (pos[1] !== 'import' || !pos[2] || !pos[3]) { err(USAGE); return 1; }
    try {
      const config = await loadConfig();
      const r = await importPreset({ file: path.resolve(pos[2]), name: pos[3], layer, config });
      r.warnings.forEach((w) => err(`warning: ${w}`));
      out(`preset "${r.preset.name}" written (status ${r.preset.status}); ${r.preset.source}`);
      r.diff.forEach((l) => out(l));
      return 0;
    } catch (e) { err(`preset import failed: ${e.message}`); return 1; }
  }

  if (cmd === 'demo-photo') return demoPhoto();

  if (cmd === 'qr-matrix') {
    try {
      const { writeMatrix } = await import('./lib/qrmatrix.mjs');
      const config = await loadConfig();
      const oi = argv.indexOf('--out');
      const outDir = path.resolve(oi >= 0 ? argv[oi + 1] : path.join(config.queueDir, 'qr-matrix'));
      const files = await writeMatrix({ outDir, config });
      files.forEach((f) => out(path.join(outDir, f)));
      out(`${files.length} files, see INDEX.csv. Engrave each on a scrap of that finish, scan with 3 phones, then edit site/tag-qr-finishes.json.`);
      return 0;
    } catch (e) { err(`qr-matrix failed: ${e.message}`); return 1; }
  }

  const known = { once: 'once', gen: 'gen', load: 'load', ping: 'ping', demo: 'demo' };
  if (!known[cmd]) { err(USAGE); return 1; }
  const run = (ctx) => (cmd === 'once' ? ops.once(ctx) : cmd === 'gen' ? ops.gen(ctx, pos[1]) : cmd === 'load' ? ops.load(ctx, pos[1], flags.has('--force')) : cmd === 'ping' ? ops.ping(ctx) : ops.demo(ctx, flags.has('--load')));

  let cfg;
  try { cfg = await loadConfig(); } catch (e) { err(e.message); return 1; }
  if (await daemonUp(cfg.ui.port)) return run(httpCtx(cfg.ui.port));

  // daemon down: take the lock and run in-process
  const { boot } = await import('./lib/runtime.mjs');
  let rt;
  try { rt = await boot({ needKey: cmd === 'once' || cmd === 'gen' }); } catch (e) {
    if (e instanceof LockHeldError) { err(`${e.message}; try again in a moment`); return 1; }
    if (e instanceof ConfigError) { err(e.message); return 1; }
    throw e;
  }
  try { return await run(localCtx(rt)); } finally { await rt.shutdown(); }
}

main().then((code) => process.exit(code), (e) => { console.error(e.stack || e.message); process.exit(1); });
