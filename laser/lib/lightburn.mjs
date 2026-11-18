// LightBurn UDP handoff. LightBurn listens on 19840 and replies to 19841 on loopback.
//
// HARD RULE (R1): this module can never tell LightBurn to begin burning. send() throws on that command
// before anything touches the socket, and the only commands the rest of the service can reach are the four
// wrappers below (ping, status, loadFile, forceLoad). The operator frames and presses Start in LightBurn.
import dgram from 'node:dgram';
import { realpathSync } from 'node:fs';
import path from 'node:path';
import { log } from './log.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function createLightBurn({ config, queueDir }) {
  const cfg = config.lightburn;
  const root = path.resolve(queueDir);
  let sock = null;
  let disabled = false;
  let bindTimer = null;
  let waiter = null;            // { resolve } for the single in-flight command
  let chain = Promise.resolve(); // mutex: commands are serialised
  let inFlight = 0;
  let lastLoadAt = 0;
  let pingTimer = null;
  const health = { up: false, status: null, checkedAt: null, disabled: false };

  function onMessage(buf) {
    const reply = buf.toString('utf8').replace(/\0/g, '').trim();
    if (waiter) { const w = waiter; waiter = null; w.resolve(reply); }
    // no waiter: a stale datagram from an earlier timed-out command; dropped on purpose
  }

  function bind() {
    return new Promise((resolve) => {
      const s = dgram.createSocket({ type: 'udp4', reuseAddr: false });
      s.once('error', (err) => {
        try { s.close(); } catch { /* not open */ }
        if (err.code === 'EADDRINUSE') {
          disabled = true; health.disabled = true;
          log.error(`UDP reply port ${cfg.replyPort} busy; LightBurn handoff disabled, retrying in 60s`);
          bindTimer = setTimeout(() => { bind(); }, 60000);
          bindTimer.unref();
        } else {
          log.error(`UDP socket error: ${err.message}`);
        }
        resolve(false);
      });
      s.on('message', onMessage);
      s.bind({ port: cfg.replyPort, address: '127.0.0.1', exclusive: true }, () => {
        s.removeAllListeners('error');
        s.on('error', (e) => log.error(`UDP socket error: ${e.message}`));
        sock = s; disabled = false; health.disabled = false;
        resolve(true);
      });
    });
  }

  // Low-level send. Exported for tests only; nothing in http.mjs or cli.mjs exposes it.
  function send(cmd) {
    if (/START/i.test(String(cmd))) throw new Error('START is forbidden'); // R1-GUARD: no command or payload may contain it
    if (!/^(?:PING|STATUS|(?:LOADFILE|FORCELOAD):[^\n\r\0]+)$/.test(String(cmd))) throw new Error('command not allowed'); // verb whitelist
    const run = async () => {
      if (!sock) return 'DISABLED';
      inFlight++;
      try {
        return await new Promise((resolve) => {
          const t = setTimeout(() => { if (waiter && waiter.resolve === done) waiter = null; resolve('TIMEOUT'); }, cfg.timeoutMs);
          const done = (r) => { clearTimeout(t); resolve(r); };
          waiter = { resolve: done };
          sock.send(Buffer.from(cmd, 'utf8'), cfg.cmdPort, cfg.host, (err) => {
            if (err) { clearTimeout(t); waiter = null; resolve('TIMEOUT'); }
          });
        });
      } finally { inFlight--; }
    };
    const p = chain.then(run, run);
    chain = p.catch(() => {});
    return p;
  }

  async function ping() {
    const r = await send('PING');
    health.up = r === 'OK';
    health.checkedAt = new Date().toISOString();
    if (!health.up) health.status = null;
    return { up: health.up, reply: r };
  }

  async function status() {
    const r = await send('STATUS');
    health.status = r === 'OK' ? 'idle' : r === '!' ? 'busy' : null;
    health.checkedAt = new Date().toISOString();
    return { ok: r === 'OK', busy: r === '!', reply: r };
  }

  // Path rules from SPEC 10.1: absolute, inside queueDir, .lbrn2, no control characters, exists.
  function validatePath(absPath) {
    if (typeof absPath !== 'string' || !absPath || /[\n\r\0]/.test(absPath)) return 'bad path';
    if (!path.isAbsolute(absPath)) return 'path must be absolute';
    const resolved = path.resolve(absPath);
    if (!resolved.startsWith(root + path.sep)) return 'path outside the queue folder';
    if (!resolved.endsWith('.lbrn2')) return 'not a .lbrn2 file';
    // a symlink inside the queue must not lead outside it: compare real paths
    let real, realRoot;
    try { real = realpathSync(resolved); realRoot = realpathSync(root); } catch { return 'file does not exist'; }
    if (!real.startsWith(realRoot + path.sep)) return 'path resolves outside the queue folder';
    if (!real.endsWith('.lbrn2')) return 'not a .lbrn2 file';
    return null;
  }

  // verb is 'LOADFILE' (LightBurn asks about unsaved work) or 'FORCELOAD' (explicit operator action, no prompt).
  async function load(verb, absPath) {
    const bad = validatePath(absPath);
    if (bad) return { ok: false, code: 'BAD_PATH', error: bad };
    const now = Date.now();
    const since = now - lastLoadAt;
    if (lastLoadAt && since < cfg.minLoadGapMs) return { ok: false, code: 'RATE_LIMITED', retryAfterMs: cfg.minLoadGapMs - since }; // R3
    const p = await ping();
    if (!p.up) return { ok: false, code: 'LB_DOWN' };
    lastLoadAt = Date.now();
    const reply = await send(`${verb}:${path.resolve(absPath)}`);
    if (reply === 'OK') {
      const out = { ok: true, reply };
      await sleep(cfg.postLoadCheckMs ?? 1000);
      if (!(await ping()).up) out.warning = 'LightBurn is showing a dialog after loading. Check the LightBurn window.';
      return out;
    }
    if (reply === '!') return { ok: false, code: 'LB_REFUSED', reply };
    if (reply === '?') { log.error(`LightBurn rejected ${verb} as invalid (bug)`); return { ok: false, code: 'LB_INVALID', reply }; }
    if (reply === 'TIMEOUT') return { ok: false, code: 'LB_TIMEOUT', reply };
    return { ok: false, code: 'LB_UNKNOWN', reply };
  }

  const forceLoad = (absPath) => load('FORCELOAD', absPath);
  const loadFile = (absPath) => load('LOADFILE', absPath);

  function startBackgroundPing() {
    if (pingTimer) return;
    const tick = async () => {
      if (inFlight || !sock) return;
      try { if ((await ping()).up) await status(); } catch { /* keep going */ }
    };
    tick();   // fresh pill on startup instead of waiting a full interval
    pingTimer = setInterval(tick, cfg.pingEverySeconds * 1000);
    pingTimer.unref();
  }

  async function start() { await bind(); return !disabled; }
  async function close() {
    clearInterval(pingTimer); pingTimer = null;
    clearTimeout(bindTimer);
    if (sock) { const s = sock; sock = null; await new Promise((r) => s.close(r)); }
  }

  return {
    start, close, send, ping, status, forceLoad, loadFile, validatePath, startBackgroundPing,
    health: () => ({ ...health }),
    recentlyLoaded: (ms = cfg.minLoadGapMs) => lastLoadAt !== 0 && Date.now() - lastLoadAt < ms,
    get disabled() { return disabled; }
  };
}
