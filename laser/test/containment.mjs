// Geometry checks used by containment.test.mjs: is every glyph and icon point inside the blank, with clearance?
// "The blank" is the shape's outline path from the layout module (paw: the main pad only). This is an independent exact
// check (point-in-polygon + point-to-segment distance); the generator itself uses a precomputed distance grid.
import { SDTLayout } from '../lib/layout.mjs';
import { toSubpaths, fieldMatrix, applyMatrix, tagGeometry } from '../lib/geometry.mjs';

export const CLEARANCE_MM = 1.5;          // minimum gap between any engraved point and the blank's edge
export const CLEARANCE_SCRIPT_MM = 2.0;   // the script font overhangs its advance box
export const HOLE_CLEAR_MM = 1.0;         // gap between engraved points and the edge of the hanging hole
// Hole centre/radius (design units) come from the layout module itself: OUT[shape].hole, measured from the blank photos.
export const clearanceFor = (r) => (r.fk === 'script' ? CLEARANCE_SCRIPT_MM : CLEARANCE_MM);

const ID = [1, 0, 0, 1, 0, 0];

// Outline subpaths in design space (paw: the main pad only, the toes are never a text area).
export function outlineDesign(shape) {
  const sp = toSubpaths(SDTLayout.OUT[shape].d, ID);
  return shape === 'paw' ? [sp[0]] : sp;
}

// Sample a subpath list into closed polylines.
export function flatten(subpaths, steps = 24) {
  return subpaths.map((sp) => {
    const pts = [];
    for (const p of sp.prims) {
      const A = sp.verts[p.a], B = sp.verts[p.b];
      if (p.t === 'L') { pts.push([A.x, A.y]); continue; }
      const c1 = A.c0 || A, c2 = B.c1 || B;
      for (let i = 0; i < steps; i++) {
        const t = i / steps, u = 1 - t;
        pts.push([u * u * u * A.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * B.x,
                  u * u * u * A.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * B.y]);
      }
    }
    return pts;
  });
}

export function pointInPolys(x, y, polys) {
  let inside = false;                      // even-odd across all rings
  for (const ring of polys) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

export function distToPolys(x, y, polys) {
  let best = Infinity;
  for (const ring of polys) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [ax, ay] = ring[j], [bx, by] = ring[i];
      const dx = bx - ax, dy = by - ay;
      const l2 = dx * dx + dy * dy;
      let t = l2 ? ((x - ax) * dx + (y - ay) * dy) / l2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const ex = ax + t * dx - x, ey = ay + t * dy - y;
      const d2 = ex * ex + ey * ey;
      if (d2 < best) best = d2;
    }
  }
  return Math.sqrt(best);
}

// Points along every glyph/icon path (mm). Bezier segments are sampled, so extremes between vertices are covered.
export function samplePoints(subpaths, steps = 5) {
  const pts = [];
  for (const sp of subpaths) {
    for (const p of sp.prims) {
      const A = sp.verts[p.a], B = sp.verts[p.b];
      if (p.t === 'L') { pts.push([A.x, A.y], [(A.x + B.x) / 2, (A.y + B.y) / 2]); continue; }
      const c1 = A.c0 || A, c2 = B.c1 || B;
      for (let i = 0; i <= steps; i++) {
        const t = i / steps, u = 1 - t;
        pts.push([u * u * u * A.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * B.x,
                  u * u * u * A.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * B.y]);
      }
    }
  }
  return pts;
}

// Optional speed-up for tuning searches: a signed-distance grid (mm, positive inside) per (shape, matrix), 0.1 mm cells.
const fieldCache = new Map();
export function clearanceField(shape, M, polys) {
  const key = shape + JSON.stringify(M.map((v) => +v.toFixed(5)));
  if (fieldCache.has(key)) return fieldCache.get(key);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const ring of polys) for (const [x, y] of ring) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  const res = 0.1, pad = 3;
  const gx0 = x0 - pad, gy0 = y0 - pad, W = Math.ceil((x1 - x0 + 2 * pad) / res), H = Math.ceil((y1 - y0 + 2 * pad) / res);
  const data = new Float32Array(W * H);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const x = gx0 + (i + 0.5) * res, y = gy0 + (j + 0.5) * res;
    const d = distToPolys(x, y, polys);
    data[j * W + i] = pointInPolys(x, y, polys) ? d : -d;
  }
  const f = { gx0, gy0, W, H, res, data, at(x, y) {
    const i = Math.floor((x - gx0) / res), j = Math.floor((y - gy0) / res);
    if (i < 0 || j < 0 || i >= W || j >= H) return -99;
    return data[j * W + i] - res * 0.71;   // nearest-cell lookup: be conservative by half a cell diagonal
  } };
  fieldCache.set(key, f);
  return f;
}

// r = SDTLayout.layout() result for a tag. Returns { ok, minClearance, minHoleDist, outside, tooClose, nearHole }.
export function checkContained(shape, r, placeMm = [100, 100], { fast = false } = {}) {
  const M = fieldMatrix(r, placeMm);
  const outline = flatten(outlineDesign(shape).map((sp) => ({
    verts: sp.verts.map((v) => { const [x, y] = applyMatrix(M, v.x, v.y); const c0 = v.c0 && applyMatrix(M, v.c0.x, v.c0.y); const c1 = v.c1 && applyMatrix(M, v.c1.x, v.c1.y); return { x, y, c0: c0 && { x: c0[0], y: c0[1] }, c1: c1 && { x: c1[0], y: c1[1] } }; }),
    prims: sp.prims
  })));
  if (r.cutD) outline.push(...flatten(toSubpaths(r.cutD, M)));   // cut-out blank: the through-hole is a ring of the blank
  const g = tagGeometry(r, placeMm);
  const pts = samplePoints([...g.icon, ...g.text]);
  const hole = SDTLayout.OUT[shape].hole;
  const [hx, hy] = applyMatrix(M, hole.x, hole.y);
  const holeKeepOut = hole.r * r.s + HOLE_CLEAR_MM;      // mm from the hole centre
  const clearance = clearanceFor(r);
  let minClearance = Infinity, minHoleDist = Infinity, outside = 0, tooClose = 0, nearHole = 0;
  const field = fast ? clearanceField(shape, M, outline) : null;
  for (const [x, y] of pts) {
    let d;
    if (field) { d = field.at(x, y); if (d < 0) { outside++; continue; } }
    else {
      if (!pointInPolys(x, y, outline)) { outside++; continue; }
      d = distToPolys(x, y, outline);
    }
    if (d < minClearance) minClearance = d;
    if (d < clearance) tooClose++;
    const hd = Math.hypot(x - hx, y - hy);
    if (hd < minHoleDist) minHoleDist = hd;
    if (hd < holeKeepOut) nearHole++;
  }
  return { ok: pts.length > 0 && !outside && !tooClose && !nearHole, points: pts.length, minClearance, minHoleDist, outside, tooClose, nearHole };
}
