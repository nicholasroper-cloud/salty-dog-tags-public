// Pure geometry: SVG path strings in design space (Y down) -> LightBurn vertex/primitive lists in mm (Y up).
// No I/O. See SPEC section 6.
import svgpath from 'svgpath';

const CLOSE_EPS = 1e-4;   // mm: last vertex counts as vertex 0 when closer than this
const DEGENERATE_EPS = 1e-6;

// ---- transforms ----

// M_field = [s,0,0,-s, Px - s*mx, Py + s*my]  (X = a*x + c*y + e, Y = b*x + d*y + f)
export function fieldMatrix(r, placeMm) {
  const [bx0, by0, bx1, by1] = r.bb;
  const mx = (bx0 + bx1) / 2, my = (by0 + by1) / 2;
  const [Px, Py] = placeMm;
  return [r.s, 0, 0, -r.s, Px - r.s * mx, Py + r.s * my];
}

// M_total = M_field o M_icon, using the ROUNDED strings layout() put in the SVG so lbrn2 == svg.
export function iconMatrix(r, placeMm) {
  const [bx0, by0, bx1, by1] = r.bb;
  const mx = (bx0 + bx1) / 2, my = (by0 + by1) / 2;
  const [Px, Py] = placeMm;
  const k = Number(r.iconK), tx = Number(r.iconTx), ty = Number(r.iconTy);
  const s = r.s;
  return [s * k, 0, 0, -s * k, s * tx + Px - s * mx, -s * ty + Py + s * my];
}

export function applyMatrix(M, x, y) {
  return [M[0] * x + M[2] * y + M[4], M[1] * x + M[3] * y + M[5]];
}

// ---- path conversion ----

// Returns [{ verts:[{x,y,c0?:{x,y},c1?:{x,y}}], prims:[{t:'L'|'B', a, b}] }], one entry per closed subpath.
// opts.onWarn(msg) is called for unexpected (open) subpaths.
export function toSubpaths(d, M, opts = {}) {
  const warn = opts.onWarn || (() => {});
  const P = (x, y) => { const [X, Y] = applyMatrix(M, x, y); return { x: X, y: Y }; };
  const out = [];
  let sub = null;           // current open subpath
  let startRaw = null;      // raw (design) start of the current subpath, for implicit restarts after Z
  let curRaw = null;

  function finish(closed) {
    if (!sub) return;
    const s = sub;
    sub = null;
    if (s.verts.length < 2) return;      // step 4: discard degenerate subpaths
    if (closed) {
      const first = s.verts[0], last = s.verts[s.verts.length - 1];
      if (s.verts.length > 2 && Math.hypot(first.x - last.x, first.y - last.y) < CLOSE_EPS) {
        // step 3: the path already returned to its start; merge the final vertex into vertex 0
        s.verts.pop();
        const lastPrim = s.prims[s.prims.length - 1];
        lastPrim.b = 0;
        if (last.c1) first.c1 = last.c1;
      } else {
        s.prims.push({ t: 'L', a: s.verts.length - 1, b: 0 });
      }
    } else {
      warn('open subpath emitted without closing primitive');
    }
    out.push(s);
  }

  function begin(rx, ry) {
    sub = { verts: [P(rx, ry)], prims: [] };
    startRaw = [rx, ry];
    curRaw = [rx, ry];
  }

  function ensureStarted() {
    if (!sub) begin(startRaw ? startRaw[0] : 0, startRaw ? startRaw[1] : 0);
  }

  function lineTo(rx, ry) {
    ensureStarted();
    const prev = sub.verts[sub.verts.length - 1];
    const v = P(rx, ry);
    if (Math.hypot(v.x - prev.x, v.y - prev.y) < DEGENERATE_EPS) { curRaw = [rx, ry]; return; }
    sub.verts.push(v);
    sub.prims.push({ t: 'L', a: sub.verts.length - 2, b: sub.verts.length - 1 });
    curRaw = [rx, ry];
  }

  function cubicTo(x1, y1, x2, y2, x, y) {
    ensureStarted();
    const prev = sub.verts[sub.verts.length - 1];
    prev.c0 = P(x1, y1);
    const v = P(x, y);
    v.c1 = P(x2, y2);
    sub.verts.push(v);
    sub.prims.push({ t: 'B', a: sub.verts.length - 2, b: sub.verts.length - 1 });
    curRaw = [x, y];
  }

  const parsed = svgpath(d);
  if (parsed.err) throw new Error(`bad path data: ${parsed.err}`);   // svgpath truncates silently otherwise
  parsed.abs().unarc().unshort().iterate((seg) => {
    const c = seg[0];
    switch (c) {
      case 'M':
        finish(false);
        begin(seg[1], seg[2]);
        break;
      case 'L': lineTo(seg[1], seg[2]); break;
      case 'H': lineTo(seg[1], curRaw ? curRaw[1] : 0); break;
      case 'V': lineTo(curRaw ? curRaw[0] : 0, seg[1]); break;
      case 'C': cubicTo(seg[1], seg[2], seg[3], seg[4], seg[5], seg[6]); break;
      case 'Q': {
        // degree elevation: c0 = P0 + 2/3 (Q - P0), c1 = P + 2/3 (Q - P)
        ensureStarted();
        const [x0, y0] = curRaw;
        const qx = seg[1], qy = seg[2], x = seg[3], y = seg[4];
        cubicTo(x0 + (2 / 3) * (qx - x0), y0 + (2 / 3) * (qy - y0),
                x + (2 / 3) * (qx - x), y + (2 / 3) * (qy - y), x, y);
        break;
      }
      case 'Z':
        if (sub) { finish(true); curRaw = startRaw; }
        break;
      default:
        throw new Error(`unsupported path segment "${c}"`);
    }
  });
  finish(false);   // a subpath never closed by Z is emitted as-is, with a warning
  return out;
}

// ---- whole-tag geometry ----

// r = SDTLayout.layout() result. Returns { tool, icon, text } as arrays of subpaths.
export function tagGeometry(r, placeMm, opts = {}) {
  const Mf = fieldMatrix(r, placeMm);
  const tool = toSubpaths(r.o.d, Mf, opts);
  if (r.cutD) tool.push(...toSubpaths(r.cutD, Mf, opts));   // through-hole of a cut-out blank: reference only, like the outline
  const icon = r.iconD ? toSubpaths(r.iconD, iconMatrix(r, placeMm), opts) : [];
  const text = [];
  for (const d of r.textPaths) text.push(...toSubpaths(d, Mf, opts));
  return { tool, icon, text };
}

// ---- smart QR tag ----

// Marked rectangles of the QR (mm from the blank's top-left, y down: SDTQR.geometry) -> closed subpaths in LightBurn field mm (Y up),
// placed exactly like the tag outline: the blank's centre sits at placeMm. For inverse polarity the whole box is one subpath and
// the dark modules follow as holes; the fill is even-odd, so they stay open. `r` is the SDTLayout.layout() result of the back side.
export function qrSubpaths(g, r, placeMm) {
  const W = r.bw * r.s, H = r.bh * r.s, [Px, Py] = placeMm;
  const P = (x, y) => ({ x: Px + (x - W / 2), y: Py - (y - H / 2) });
  const rect = (q) => {
    const verts = [P(q.x, q.y), P(q.x + q.w, q.y), P(q.x + q.w, q.y + q.h), P(q.x, q.y + q.h)];
    return { verts, prims: [{ t: 'L', a: 0, b: 1 }, { t: 'L', a: 1, b: 2 }, { t: 'L', a: 2, b: 3 }, { t: 'L', a: 3, b: 0 }] };
  };
  const out = [];
  if (g.polarity === 'inverse') out.push(rect(g.box));
  for (const q of g.rects) out.push(rect(q));
  return out;
}

// ---- measurement helpers (used by tests and the generator's size report) ----

// Axis-aligned bbox of subpaths by sampling every segment (control-point hulls over-estimate).
export function sampledBBox(subpaths, steps = 100) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const add = (x, y) => { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; };
  for (const sp of subpaths) {
    for (const p of sp.prims) {
      const A = sp.verts[p.a], B = sp.verts[p.b];
      if (p.t === 'L') { add(A.x, A.y); add(B.x, B.y); continue; }
      const c1 = A.c0 || A, c2 = B.c1 || B;
      for (let i = 0; i <= steps; i++) {
        const t = i / steps, u = 1 - t;
        add(u * u * u * A.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * B.x,
            u * u * u * A.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * B.y);
      }
    }
  }
  return [x0, y0, x1, y1];
}
