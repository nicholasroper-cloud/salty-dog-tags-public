/* Salty Dog Tags: smart QR tag geometry. Shared by site/app.js (builder), site/orders.html (export, slip, QC), functions/ (order
 * time eligibility) and laser/ (lbrn2). Classic script (no import/export) like tag-layout.js, so it loads from a <script> tag and
 * from require(). Needs SDTLayout (tag-layout.js) and qrcodegen (vendor/qrcodegen.js, Nayuki, MIT).
 *
 * What it decides, in order (ADR 2026-11-16 section 1):
 *   1. the QR: payload text, error correction level, version, module size, quiet zone;
 *   2. where on the real blank it goes (all in millimetres from the blank's top-left corner, y down);
 *   3. which finishes may carry one (flag table, flipped by Nick in site/tag-qr-finishes.json after the laser matrix);
 *   4. how the back text flows around it (the plan hands tag-layout.js an exclude box, a text centre, and a minimum font size).
 *
 * Eligibility is geometry plus a text-size estimate. The estimate is deliberately conservative (wide capitals); the authority for
 * the engraved result is layout() itself, which refuses to shrink below the minimum cap height and reports fit:false, and the
 * laser service sends any such tag to manual. Every number that can be tuned is a named constant below.
 */
(function (root) {
  'use strict';
  const L = (typeof require === 'function' && typeof module === 'object') ? require('./tag-layout.js') : root.SDTLayout;
  const QG = (typeof require === 'function' && typeof module === 'object') ? require('./vendor/qrcodegen.js') : root.qrcodegen;

  /* ---------- constants (the only place the numbers live) ---------- */
  // The QR encodes this base plus the 10 character id. UPPER CASE ON PURPOSE: every character is in the QR alphanumeric set, so the
  // whole payload is one alphanumeric segment (37 chars, Version 2-M or 3-Q). A Cloudflare Transform Rule maps /T/* to /t/*.
  // The Pages secret/var TAG_BASE_URL overrides it at order time (functions/api/_tagsettings.js); the minted payload is stored on
  // the order and the tag row, so changing this later never alters a tag that already exists.
  const TAG_BASE_URL = 'HTTPS://SALTYDOGTAGS.COM/T/';
  // A future short domain, e.g. 'HTTPS://SDT.PET/T/'. Empty means "not bought yet". When set it replaces TAG_BASE_URL for NEW tags,
  // and qrEligibility() recomputes version and module table from the shorter payload, so more blanks may qualify automatically.
  const TAG_BASE_URL_SHORT = '';
  const ID_LEN = 10;
  const MODULE_STEPS_MM = [0.60, 0.55, 0.50, 0.45, 0.40];   // tried largest first
  const MODULE_MIN_MM = 0.40, MODULE_TARGET_MM = 0.50;
  const QUIET_WIDE = 4, QUIET_TIGHT = 2;                    // quiet zone in modules: preferred, and the minimum when space is tight
  const QR_INSET_MM = 0.02;                                 // qrInsetMm: marked area shrinks this much per edge (anneal spread)
  const DATA_CLEAR_MM = 1.5, QUIET_CLEAR_MM = 0.3;          // from the blank's edge: data modules, and the quiet zone (edge band)
  const MIN_BLANK_MM = 38;                                  // policy (Nick 2026-11-16): QR only on blanks of 1.5 inch (38 mm) and up
  const MIN_CAP_MM = 1.6;                                   // capitals at least 1.6 mm tall (CAP_RATIO below turns that into a font size)
  const TEXT_GAP_MM = 0.6;                                  // air between the QR box and any letter
  const GRID_MM = 0.25;                                     // placement grid
  const MAX_CANDIDATES = 60;                                // positions tried per module size before giving up
  // Estimated advance per character, in ems: L = letters, D = digits, O = spaces and punctuation. Measured on the five engraving fonts
  // (laser/fonts) and rounded UP a little, so the estimate errs toward "does not fit". CAP_RATIO = cap height / font size, measured.
  const EST_EM = { block: { L: 0.79, D: 0.64, O: 0.50 }, bungee: { L: 0.74, D: 0.64, O: 0.52 }, slab: { L: 0.80, D: 0.63, O: 0.50 }, script: { L: 0.62, D: 0.52, O: 0.45 }, marker: { L: 0.69, D: 0.58, O: 0.48 } };
  const CAP_RATIO = { block: 0.688, bungee: 0.72, slab: 0.778, script: 0.88, marker: 0.753 };
  const LINE_H = 1.18;                                      // same line height layout() uses
  // The reference text a blank is judged with (a typical dog name and a US phone); real orders are re-checked with their own text.
  const REF_NAME = 'WHISKY', REF_PHONE = '(435) 555-0123';

  /* ---------- finishes ---------- */
  // status: 'on' | 'test' (test-gated: stays off until the 3-phone matrix passes) | 'off' (never). polarity: 'dark' = the QR's dark
  // modules are marked; 'inverse' = light modules and the quiet zone are engraved to bare metal and the dark modules stay as
  // anodize. preset = the laser material preset (laser/presets/<preset>.json). site/tag-qr-finishes.json overrides the statuses.
  const FINISHES = {
    stainless: { status: 'on', polarity: 'dark', preset: 'qr-stainless' },
    polished: { status: 'on', polarity: 'dark', preset: 'qr-polished', note: 'glare test pending (a light frost pass over the QR box is optional)' },
    black: { status: 'on', polarity: 'inverse', preset: 'qr-anodized' },
    royal: { status: 'on', polarity: 'inverse', preset: 'qr-anodized' },
    red: { status: 'on', polarity: 'inverse', preset: 'qr-anodized', note: 'needs a contrast check' },
    green: { status: 'on', polarity: 'inverse', preset: 'qr-anodized', note: 'needs a contrast check' },
    silver: { status: 'test', polarity: 'dark', preset: 'qr-anodized' },
    sky: { status: 'test', polarity: 'dark', preset: 'qr-anodized' },
    yellow: { status: 'test', polarity: 'dark', preset: 'qr-anodized' },
    pink: { status: 'test', polarity: 'dark', preset: 'qr-anodized' },
    hotpink: { status: 'test', polarity: 'dark', preset: 'qr-anodized' },
    ssblack: { status: 'test', polarity: 'inverse', preset: 'qr-stainless' },
    navy: { status: 'test', polarity: 'inverse', preset: 'qr-stainless' },
    gold: { status: 'test', polarity: 'inverse', preset: 'qr-stainless' },
    bronze: { status: 'test', polarity: 'inverse', preset: 'qr-stainless' },
    rainbow: { status: 'off', polarity: 'dark', preset: 'qr-stainless' },
    brass: { status: 'test', polarity: 'dark', preset: 'qr-brass' },
    fullcolor: { status: 'off', polarity: 'dark', preset: null }
  };
  // Per-shape placement. anchor: which end of the blank the QR is pushed to (the text takes the rest). phoneSplit: the phone is
  // engraved on two lines, "(435)" over "555-0123" (only the 38 mm bone; the ADR's "bone conditional" case).
  const SHAPE_PLAN = {
    bone: { anchor: 'right', phoneSplit: true },
    'bone+polished': { anchor: 'left', phoneSplit: false },
    heart: { anchor: 'bottom', phoneSplit: true },
    round: { anchor: 'top', phoneSplit: false },
    military: { anchor: 'right', phoneSplit: false },
    paw: { anchor: 'bottom', phoneSplit: false }
  };

  let statusOverride = null;                                // set by configure() from site/tag-qr-finishes.json
  let baseOverride = null;
  function configure(cfg) {
    cfg = cfg || {};
    if (cfg.finishes && typeof cfg.finishes === 'object') {
      const o = {};
      for (const k of Object.keys(cfg.finishes)) if (Object.prototype.hasOwnProperty.call(FINISHES, k) && ['on', 'test', 'off'].includes(cfg.finishes[k])) o[k] = cfg.finishes[k];
      statusOverride = o;
    } else if (cfg.finishes === null) statusOverride = null;
    if (typeof cfg.base === 'string') baseOverride = cfg.base.trim() || null;
    else if (cfg.base === null) baseOverride = null;
  }
  const baseUrl = (opts) => (opts && opts.base) || baseOverride || TAG_BASE_URL_SHORT || TAG_BASE_URL;
  const own = (o, k) => (typeof k === 'string' && Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined);
  function finishInfo(finish) {
    const f = own(FINISHES, finish);
    if (!f) return { status: 'off', polarity: 'dark', preset: null, known: false };
    const st = statusOverride && own(statusOverride, finish);
    return { status: st || f.status, polarity: f.polarity, preset: f.preset, note: f.note || '', known: true };
  }

  /* ---------- payload and encoder ---------- */
  const payloadFor = (id, opts) => baseUrl(opts) + String(id).toUpperCase();
  const PLACEHOLDER_ID = '0000000000';
  const ECC = { M: QG.QrCode.Ecc.MEDIUM, Q: QG.QrCode.Ecc.QUARTILE };

  // Encodes at the EXACT error correction level asked for (no boosting) with the library's own deterministic mask choice.
  function encode(text, ecl) {
    const segs = QG.QrSegment.makeSegments(text);
    const qr = QG.QrCode.encodeSegments(segs, ECC[ecl], 1, 40, -1, false);
    const rows = [];
    for (let y = 0; y < qr.size; y++) { const r = []; for (let x = 0; x < qr.size; x++) r.push(qr.getModule(x, y)); rows.push(r); }
    return { version: qr.version, size: qr.size, ecl, mask: qr.mask, text, modules: rows };
  }

  // The (ecl, version, size) table for a payload length: recomputed from the base text every time, so a shorter domain
  // automatically gives a smaller version and (through the placement search) wider eligibility.
  function ladder(opts) {
    const text = payloadFor(PLACEHOLDER_ID, opts);
    return ['Q', 'M'].map((ecl) => { const e = encode(text, ecl); return { ecl, version: e.version, size: e.size }; });
  }

  /* ---------- the real blank, sampled once ---------- */
  const blankOf = (t) => {
    const o = L.OUT[t.shape] || L.OUT.bone, bw = o.bb[2] - o.bb[0], bh = o.bb[3] - o.bb[1], s = L.widthMm(t) / bw;
    return { o, mm: s, W: bw * s, H: bh * s, k: 1 / s, bx0: o.bb[0], by0: o.bb[1] };
  };
  const mapCache = {};
  // ok(edge)[j*w+i] = the lattice point (i*GRID, j*GRID) is inside the blank by >= edge + half a cell diagonal (so any point of a
  // box whose lattice points all pass is >= edge inside: the distance to the outline is 1-Lipschitz) and clear of the hole ring.
  function okMap(t, edge) {
    const b = blankOf(t), cut = t.finish === 'polished' ? 'c' : '';
    const key = t.shape + '|' + L.widthMm(t) + '|' + cut + '|' + edge;
    if (mapCache[key]) return mapCache[key];
    const clear = L.clearance({ shape: t.shape, finish: t.finish, font: 'block' }, edge + GRID_MM * 0.71);
    const w = Math.ceil(b.W / GRID_MM) + 1, h = Math.ceil(b.H / GRID_MM) + 1;
    const P = new Int32Array((w + 1) * (h + 1));   // prefix sums of "bad" lattice points
    for (let j = 0; j < h; j++) {
      let row = 0;
      for (let i = 0; i < w; i++) {
        row += clear(i * GRID_MM, j * GRID_MM) ? 0 : 1;
        P[(j + 1) * (w + 1) + (i + 1)] = P[j * (w + 1) + (i + 1)] + row;
      }
    }
    return (mapCache[key] = { w, h, P });
  }
  // true when every lattice point under [x0,x1]x[y0,y1] (rounded outward) is ok
  function rectOk(m, x0, y0, x1, y1) {
    const i0 = Math.floor(x0 / GRID_MM + 1e-9), i1 = Math.ceil(x1 / GRID_MM - 1e-9), j0 = Math.floor(y0 / GRID_MM + 1e-9), j1 = Math.ceil(y1 / GRID_MM - 1e-9);
    if (i0 < 0 || j0 < 0 || i1 >= m.w || j1 >= m.h) return false;
    const P = m.P, s = m.w + 1;
    return P[(j1 + 1) * s + (i1 + 1)] - P[j0 * s + (i1 + 1)] - P[(j1 + 1) * s + i0] + P[j0 * s + i0] === 0;
  }

  /* ---------- text estimate ---------- */
  function backLinesFor(tag, planOrSplit) {
    const split = typeof planOrSplit === 'boolean' ? planOrSplit : Boolean(planOrSplit && planOrSplit.phoneSplit);
    const back = (tag.back || []).map((s) => String(s || '')).filter(Boolean);
    if (!split || back.length < 2) return back;
    return [back[0], ...splitPhone(back[1]), ...back.slice(2)];
  }
  // "(435)" over "555-0123" for a 10 digit US number (a leading 1 is dropped); anything else is cut near the middle.
  function splitPhone(s) {
    s = String(s || '').trim();
    let d = s.replace(/\D/g, '');
    if (d.length === 11 && d[0] === '1') d = d.slice(1);
    if (d.length === 10) return ['(' + d.slice(0, 3) + ')', d.slice(3, 6) + '-' + d.slice(6)];
    const cut = Math.ceil(s.length / 2), sp = s.lastIndexOf(' ', cut), at = sp > 2 ? sp : cut;
    return [s.slice(0, at).trim(), s.slice(at).trim()].filter(Boolean);
  }
  const fontOf = (t) => (own(EST_EM, t.font) ? t.font : 'block');
  const upperOf = (t) => (L.UPPER[fontOf(t)] === false ? (s) => s : (s) => s.toUpperCase());
  function textBox(lines, t, fsMm) {
    const em = EST_EM[fontOf(t)], up = upperOf(t);
    let w = 0;
    for (const l of lines) { let e = 0; for (const ch of up(l)) e += /[A-Za-z]/.test(ch) ? em.L : /[0-9]/.test(ch) ? em.D : em.O; w = Math.max(w, e * fsMm); }
    return { w, h: lines.length * LINE_H * fsMm };
  }
  // Is there a free rectangle for the text block outside `qrBox`? Returns its centre (mm) or null.
  function textRoom(t, lines, qrBox, fsMm) {
    if (!lines.length) return { cx: 0, cy: 0 };
    const edge = (fontOf(t) === 'script' ? 2.0 : DATA_CLEAR_MM);
    const m = okMap(t, edge), b = blankOf(t), box = textBox(lines, t, fsMm);
    const hw = box.w / 2, hh = box.h / 2;
    let best = null, bestScore = Infinity;
    const gx = b.W / 2, gy = b.H / 2;
    for (let cy = hh; cy <= b.H - hh; cy += GRID_MM) {
      for (let cx = hw; cx <= b.W - hw; cx += GRID_MM) {
        const x0 = cx - hw, x1 = cx + hw, y0 = cy - hh, y1 = cy + hh;
        if (qrBox && x1 > qrBox.x0 - TEXT_GAP_MM && x0 < qrBox.x1 + TEXT_GAP_MM && y1 > qrBox.y0 - TEXT_GAP_MM && y0 < qrBox.y1 + TEXT_GAP_MM) continue;
        if (!rectOk(m, x0, y0, x1, y1)) continue;
        const score = (cx - gx) * (cx - gx) + (cy - gy) * (cy - gy);   // closest to the blank's centre
        if (score < bestScore) { bestScore = score; best = { cx, cy, w: box.w, h: box.h, fs: fsMm }; }
      }
    }
    return best;
  }

  /* ---------- placement ---------- */
  function planKey(t) { return t.shape === 'bone' && t.finish === 'polished' ? 'bone+polished' : t.shape; }
  function shapePlan(t) { return own(SHAPE_PLAN, planKey(t)) || own(SHAPE_PLAN, t.shape) || { anchor: 'right', phoneSplit: false }; }
  function candidates(t, N, m, q, anchor) {
    const b = blankOf(t), S = (N + 2 * q) * m, D = N * m, off = q * m;
    const mk = okMap(t, DATA_CLEAR_MM), mq = okMap(t, QUIET_CLEAR_MM);
    const out = [];
    for (let y = 0; y + S <= b.H + 1e-9; y += GRID_MM) {
      for (let x = 0; x + S <= b.W + 1e-9; x += GRID_MM) {
        if (!rectOk(mq, x, y, x + S, y + S)) continue;
        if (!rectOk(mk, x + off, y + off, x + off + D, y + off + D)) continue;
        out.push({ x, y });
      }
    }
    const cx = b.W / 2 - S / 2, cy = b.H / 2 - S / 2;
    const key = { right: (p) => [-p.x, Math.abs(p.y - cy)], left: (p) => [p.x, Math.abs(p.y - cy)], bottom: (p) => [-p.y, Math.abs(p.x - cx)], top: (p) => [p.y, Math.abs(p.x - cx)] }[anchor] || ((p) => [0, 0]);
    out.sort((a, c) => { const ka = key(a), kc = key(c); return ka[0] - kc[0] || ka[1] - kc[1]; });
    return out;
  }

  const roundMm = (v) => Math.round(v * 1000) / 1000;
  // Plans one tag. tag: { shape, finish, font, back:[name, phone, ...] }. opts: { base, id, fixed: {ecl, mm, q, x, y} }.
  // Returns { ok:true, plan } or { ok:false, reason }.
  function planTag(tag, opts) {
    opts = opts || {};
    const t = { shape: tag.shape, finish: tag.finish, font: tag.font || 'block' };
    if (!L.hasOutline(t.shape)) return { ok: false, reason: 'shape' };
    const sp = shapePlan(t), fin = finishInfo(t.finish), blank = blankOf(t);
    const lines = opts.refText ? (sp.phoneSplit ? [REF_NAME, '(435)', '555-0123'] : [REF_NAME, REF_PHONE]) : backLinesFor(tag, sp.phoneSplit);
    const fsMin = MIN_CAP_MM / CAP_RATIO[fontOf(t)], fsComfort = fsMin * 1.25;
    const tries = [];
    if (opts.fixed) {
      const f = opts.fixed, e = encode(payloadFor(opts.id || PLACEHOLDER_ID, opts), f.ecl);
      tries.push({ ecl: f.ecl, version: e.version, size: e.size, m: f.mm, q: f.q || QUIET_TIGHT, at: { x: f.x, y: f.y } });
    } else {
      const lad = ladder(opts);
      const order = [];
      // Q first. Q needs modules of at least TARGET (0.50 mm) when it costs a bigger version than M; when the payload is short enough that Q
      // and M are the same version (a future short domain), Q costs nothing and is allowed down to the minimum module size.
      const mVer = lad.find((c) => c.ecl === 'M').version;
      for (const c of lad.filter((c) => c.ecl === 'Q')) for (const m of MODULE_STEPS_MM) if (m >= (c.version <= mVer ? MODULE_MIN_MM : MODULE_TARGET_MM) - 1e-9) order.push({ ...c, m });
      for (const c of lad.filter((c) => c.ecl === 'M')) for (const m of MODULE_STEPS_MM) if (m >= MODULE_MIN_MM - 1e-9) order.push({ ...c, m });
      for (const o of order) for (const q of [QUIET_WIDE, QUIET_TIGHT]) tries.push({ ...o, q });
    }
    for (const c of tries) {
      const S = (c.size + 2 * c.q) * c.m;
      if (S > Math.min(blank.W, blank.H) + 1e-9) continue;
      const cands = c.at ? [c.at] : candidates(t, c.size, c.m, c.q, sp.anchor);
      let n = 0;
      for (const p of cands) {
        if (++n > MAX_CANDIDATES) break;
        const box = { x0: p.x, y0: p.y, x1: p.x + S, y1: p.y + S };
        const room = textRoom(t, lines, box, fsComfort) || textRoom(t, lines, box, fsMin);
        if (!room) continue;
        return { ok: true, plan: buildPlan(t, tag, sp, fin, blank, c, p, S, room, lines, opts) };
      }
    }
    return { ok: false, reason: 'fit' };
  }

  function buildPlan(t, tag, sp, fin, blank, c, p, S, room, lines, opts) {
    const off = c.q * c.m, D = c.size * c.m;
    const plan = {
      shape: t.shape, finish: t.finish, polarity: fin.polarity, preset: fin.preset,
      ecl: c.ecl, version: c.version, size: c.size, moduleMm: c.m, quiet: c.q,
      x: roundMm(p.x), y: roundMm(p.y), boxMm: roundMm(S), dataMm: roundMm(D), dataX: roundMm(p.x + off), dataY: roundMm(p.y + off),
      phoneSplit: sp.phoneSplit, anchor: sp.anchor, insetMm: QR_INSET_MM,
      blank: { w: roundMm(blank.W), h: roundMm(blank.H) },
      textCenter: { x: roundMm(room.cx), y: roundMm(room.cy) },
      textBoxMm: { w: roundMm(room.w || 0), h: roundMm(room.h || 0), fs: roundMm(room.fs || 0) },   // the estimated text rectangle (builder preview only)
      minFsMm: roundMm(MIN_CAP_MM / CAP_RATIO[fontOf(t)]),
      payload: payloadFor(opts.id || PLACEHOLDER_ID, opts),
      backLines: lines
    };
    plan.exclude = [{ x0: roundMm(p.x - TEXT_GAP_MM), y0: roundMm(p.y - TEXT_GAP_MM), x1: roundMm(p.x + S + TEXT_GAP_MM), y1: roundMm(p.y + S + TEXT_GAP_MM) }];
    return plan;
  }

  // The blank-level answer. Includes policy (size floor, finish gate), reasons, and the fixture-ready numbers.
  // opts: { base, ignoreGate: true (laser matrix and tests), refText: true (default for this function) }
  function qrEligibility(shape, finish, opts) {
    opts = opts || {};
    const t = { shape, finish, font: 'block' };
    const fin = finishInfo(finish);
    const out = { shape, finish, eligible: false, fits: false, reason: null, finishStatus: fin.status, polarity: fin.polarity, preset: fin.preset };
    if (!L.hasOutline(shape)) { out.reason = 'shape'; return out; }
    const blank = blankOf(t); out.blankMm = { w: roundMm(blank.W), h: roundMm(blank.H) };
    out.phoneSplit = shapePlan(t).phoneSplit;
    const r = planTag({ ...t, back: [REF_NAME, '435-555-0123'] }, { ...opts, refText: true });
    if (r.ok) {
      const p = r.plan;
      Object.assign(out, { fits: true, version: p.version, ecl: p.ecl, moduleMm: p.moduleMm, quiet: p.quiet, modules: p.size, boxMm: p.boxMm, x: p.x, y: p.y });
    }
    if (!opts.ignoreGate && Math.round(L.widthMm(t)) < MIN_BLANK_MM) out.reason = 'size';
    else if (!r.ok) out.reason = 'fit';
    else if (!opts.ignoreGate && fin.status !== 'on') out.reason = fin.status === 'test' ? 'finish-test' : 'finish';
    else out.eligible = true;
    return out;
  }

  // The order-time and builder-time check for one tag with its real text. Same answer on the server and in the browser.
  // Returns { ok:true, smart:{ v, ecl, mm, q, x, y }, plan } or { ok:false, reason, message }.
  function checkTag(tag, opts) {
    opts = opts || {};
    const e = qrEligibility(tag.shape, tag.finish, opts);
    if (!e.eligible) return { ok: false, reason: e.reason, message: MESSAGES[e.reason] || MESSAGES.fit };
    const r = planTag(tag, opts);
    if (!r.ok) return { ok: false, reason: 'text', message: MESSAGES.text };
    const p = r.plan;
    return { ok: true, plan: p, smart: { v: p.version, ecl: p.ecl, mm: p.moduleMm, q: p.quiet, x: p.x, y: p.y } };
  }
  const MESSAGES = {
    shape: 'The scan-to-find QR is not available on that shape.',
    size: 'The scan-to-find QR needs a bigger tag (1.5 inch or larger).',
    finish: 'The scan-to-find QR is not available on that finish.',
    'finish-test': 'The scan-to-find QR is not available on that finish yet.',
    fit: 'The scan-to-find QR does not fit on that tag.',
    text: 'That name or phone is too long to sit next to the QR. Shorten it, or turn the QR off.'
  };

  /* ---------- geometry of the engraved QR ---------- */
  // Rectangles (mm from the blank's top-left, y down) for the marked area. dark polarity: one rect per merged run of dark modules.
  // inverse: the whole box is marked (data plus quiet zone) and the dark modules are holes. The anneal spread correction (insetMm) is
  // applied ONLY on edges that touch a light module (or the quiet zone): marks shrink by insetMm per such edge, holes grow by it.
  // Edges shared between two dark modules get no correction, so merged blocks stay solid with no hairline seams. Runs merge along
  // rows (where the top and bottom edge types match), then identical runs merge down columns.
  function runs(mod, m, g) {
    const n = mod.length, dark = (x, y) => x >= 0 && y >= 0 && x < n && y < n && mod[y][x];
    const done = [], open = new Map();
    for (let y = 0; y <= n; y++) {
      const here = [];
      for (let x = 0; y < n && x < n;) {
        if (!dark(x, y)) { x++; continue; }
        const top = !dark(x, y - 1), bot = !dark(x, y + 1);
        let e = x + 1;
        while (e < n && dark(e, y) && (!dark(e, y - 1)) === top && (!dark(e, y + 1)) === bot) e++;
        here.push({ x0: x, x1: e, top, bot, left: !dark(x - 1, y), right: !dark(e, y) });
        x = e;
      }
      const keys = new Set(here.map((r) => r.x0 + '-' + r.x1 + '-' + r.left + '-' + r.right));
      for (const [k, o] of [...open]) if (!keys.has(k) || o.bot || here.find((r) => r.x0 + '-' + r.x1 + '-' + r.left + '-' + r.right === k).top) { done.push(o); open.delete(k); }
      for (const r of here) {
        const k = r.x0 + '-' + r.x1 + '-' + r.left + '-' + r.right;
        if (open.has(k)) { const o = open.get(k); o.y1 = y + 1; o.bot = r.bot; } else open.set(k, { ...r, y0: y, y1: y + 1 });
      }
    }
    for (const o of open.values()) done.push(o);
    return done.map((o) => {
      const x0 = o.x0 * m - (o.left ? g : 0), x1 = o.x1 * m + (o.right ? g : 0), y0 = o.y0 * m - (o.top ? g : 0), y1 = o.y1 * m + (o.bot ? g : 0);
      return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    }).sort((a, b) => a.y - b.y || a.x - b.x);
  }
  function geometry(plan, id, opts) {
    const text = id ? payloadFor(id, opts) : plan.payload;
    const e = encode(text, plan.ecl);
    if (e.version !== plan.version) throw new Error('QR version drift: plan v' + plan.version + ' but payload needs v' + e.version);
    const m = plan.moduleMm, ins = plan.insetMm == null ? QR_INSET_MM : plan.insetMm, inv = plan.polarity === 'inverse';
    const rects = runs(e.modules, m, inv ? ins : -ins).map((r) => ({ x: roundMm(plan.dataX + r.x), y: roundMm(plan.dataY + r.y), w: roundMm(r.w), h: roundMm(r.h) }));
    const box = { x: roundMm(plan.x + ins), y: roundMm(plan.y + ins), w: roundMm(plan.boxMm - 2 * ins), h: roundMm(plan.boxMm - 2 * ins) };
    return { payload: text, version: e.version, size: e.size, mask: e.mask, modules: e.modules, polarity: plan.polarity, rects, box: inv ? box : null };
  }
  // Independent containment check of the exact engraved geometry (not the placement grid): every marked rect corner and edge midpoint is
  // >= DATA_CLEAR_MM inside the blank for data modules, and the box corners/edges >= QUIET_CLEAR_MM; none touches the hole ring.
  // Returns { ok, worst } (worst = smallest clearance seen, in mm margin above the requirement; negative = violation).
  function verify(plan, id, opts) {
    const g = geometry(plan, id, opts), t = { shape: plan.shape, finish: plan.finish, font: 'block' };
    const dataOk = L.clearance(t, DATA_CLEAR_MM - 0.02), quietOk = L.clearance(t, QUIET_CLEAR_MM - 0.02);
    const pts = (r, n) => { const o = []; for (let i = 0; i <= n; i++) { const f = i / n; o.push([r.x + r.w * f, r.y], [r.x + r.w * f, r.y + r.h], [r.x, r.y + r.h * f], [r.x + r.w, r.y + r.h * f]); } return o; };
    let ok = true;
    const dataRects = plan.polarity === 'inverse' ? [{ x: plan.dataX, y: plan.dataY, w: plan.dataMm, h: plan.dataMm }] : g.rects;
    for (const r of dataRects) for (const [x, y] of pts(r, 2)) if (!dataOk(x, y)) ok = false;
    const box = { x: plan.x, y: plan.y, w: plan.boxMm, h: plan.boxMm };
    for (const [x, y] of pts(box, 24)) if (!quietOk(x, y)) ok = false;
    return { ok, rects: g.rects.length };
  }
  const f3 = (v) => String(roundMm(v));
  const rectD = (r, rev) => rev
    ? `M${f3(r.x)} ${f3(r.y)}v${f3(r.h)}h${f3(r.w)}v${f3(-r.h)}z`
    : `M${f3(r.x)} ${f3(r.y)}h${f3(r.w)}v${f3(r.h)}h${f3(-r.w)}z`;
  // Path data, mm. dark: marked runs. inverse: outer box then the dark modules as reverse-wound holes (use fill-rule evenodd).
  function pathD(g) {
    const parts = [];
    if (g.polarity === 'inverse') parts.push(rectD(g.box, false));
    for (const r of g.rects) parts.push(rectD(r, g.polarity === 'inverse'));
    return parts.join('');
  }
  // The <g id="qr"> for the back SVG (design-unit viewBox): millimetre path data under one transform, separate from #engrave.
  function svgGroup(plan, id, opts) {
    const b = blankOf({ shape: plan.shape, finish: plan.finish });
    const g = geometry(plan, id, opts);
    return `<g id="qr" data-polarity="${g.polarity}" data-version="${g.version}" data-ecl="${plan.ecl}" data-module-mm="${plan.moduleMm}" data-payload="${g.payload}" transform="translate(${b.bx0} ${b.by0}) scale(${(b.k).toFixed(8)})" fill="#000000" fill-rule="evenodd"><path d="${pathD(g)}"/></g>`;
  }
  // The object tag-layout.js layout()/svg() take as opts.qr. group is a string appended to the back SVG; omitted for previews.
  function layoutOpts(plan, id, opts) {
    return { exclude: plan.exclude, backLines: plan.backLines, center: plan.textCenter, minFsMm: plan.minFsMm, group: (opts && opts.group === false) ? undefined : svgGroup(plan, id, opts) };
  }

  /* ---------- builder preview: a clearly fake QR in the right place and size ---------- */
  function placeholderGroup(plan) {
    const b = blankOf({ shape: plan.shape, finish: plan.finish });
    const e = encode(payloadFor(PLACEHOLDER_ID, { base: plan.payload.slice(0, plan.payload.length - ID_LEN) }), plan.ecl);
    // Scramble the data modules (keep finders, timing, and alignment so it still reads as a QR) so it can never be scanned.
    const n = e.size, mods = e.modules.map((r) => r.slice());
    const fn = (x, y) => (x < 8 && y < 8) || (x >= n - 8 && y < 8) || (x < 8 && y >= n - 8) || x === 6 || y === 6;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (!fn(x, y)) mods[y][x] = ((x * 7 + y * 13 + x * y) % 5) < 2;
    const m = plan.moduleMm, inv = plan.polarity === 'inverse';
    const rs = runs(mods, m, 0).map((r) => rectD({ x: plan.dataX + r.x, y: plan.dataY + r.y, w: r.w, h: r.h }, inv));
    const box = rectD({ x: plan.x, y: plan.y, w: plan.boxMm, h: plan.boxMm }, false);
    return `<g class="qr-ph" transform="translate(${b.bx0} ${b.by0}) scale(${b.k.toFixed(8)})" fill-rule="evenodd" opacity=".85"><path d="${inv ? box + rs.join('') : rs.join('')}" fill="${inv ? '#E6EAF0' : '#1E2124'}"/></g>`;
  }

  /* ---------- id parsing, shared with the QC decode check ---------- */
  const ID_RE = /^[0-9A-HJKMNP-TV-Z]{10}$/;
  function idFromPayload(text, opts) {
    const base = baseUrl(opts);
    const s = String(text || '').trim();
    if (!s.toUpperCase().startsWith(base)) return null;
    const id = s.slice(base.length).toUpperCase();
    return ID_RE.test(id) ? id : null;
  }

  const api = {
    TAG_BASE_URL, TAG_BASE_URL_SHORT, ID_LEN, MODULE_STEPS_MM, MODULE_MIN_MM, MODULE_TARGET_MM, QUIET_WIDE, QUIET_TIGHT, QR_INSET_MM,
    DATA_CLEAR_MM, QUIET_CLEAR_MM, MIN_BLANK_MM, MIN_CAP_MM, CAP_RATIO, EST_EM, FINISHES, SHAPE_PLAN, REF_NAME, REF_PHONE, MESSAGES,
    configure, finishInfo, baseUrl, payloadFor, encode, ladder, qrEligibility, planTag, checkTag, backLinesFor, splitPhone,
    runs, geometry, verify, pathD, svgGroup, layoutOpts, placeholderGroup, idFromPayload, blankOf, ID_RE
  };
  root.SDTQR = api;
  if (typeof module === 'object' && module && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
