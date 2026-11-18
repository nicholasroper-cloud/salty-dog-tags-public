/* Salty Dog Tags: shared tag layout math. Single source for site/orders.html (browser) and laser/ (Node).
 *
 * Classic script (no import/export) so it works from a <script> tag and from require().
 * The constants and arithmetic below were moved character for character from site/orders.html
 * (the "LightBurn export" block). Do not reformat numbers, reorder keys, or "fix" anything:
 * laser/test/golden/*.svg were captured from the original code and must keep matching byte for byte.
 *
 * Deliberate differences from the original block (documented in issue #1; v4 adds the polished-bone paw cut-out, see cutOf):
 *   - FONT_BASE is pinned to a google/fonts commit instead of @main, so an upstream font change
 *     cannot silently change engraving geometry. Bump it only together with a golden re-capture.
 *   - The 'marker' font path is apache/permanentmarker/... (the original ofl/ path 404s upstream).
 *   - Text placement (layout v3): the rectangular text box is gone. layout() fits the real glyph outlines against the real
 *     blank (>= 1.5 mm from every edge, 2.0 mm for the script font, >= 1.0 mm from the hanging hole) and picks the largest
 *     size that fits, sliding the block up/down within OUT[shape].tx.nudge. Hole positions/sizes were measured from the
 *     photos in site/assets/blanks. laser/test/containment.test.mjs proves the property with an independent exact check.
 *   - OUT.military.d is the true rounded rectangle (the old end arcs were scaled to radius 70 by SVG and overshot the blank).
 * widthMm(t) ignores t.size on purpose (one blank size per shape and finish; owner decision Q2).
 */
(function (root) {
  'use strict';
  const FONT_BASE = 'https://cdn.jsdelivr.net/gh/google/fonts@47d54ca1ebb14fd864695f1d39dc734f39017c33/';
  const FONT_TTF={block:'ofl/archivoblack/ArchivoBlack-Regular.ttf',bungee:'ofl/bungee/Bungee-Regular.ttf',script:'ofl/pacifico/Pacifico-Regular.ttf',slab:'ofl/alfaslabone/AlfaSlabOne-Regular.ttf',marker:'apache/permanentmarker/PermanentMarker-Regular.ttf'};
  const UPPER={block:true,bungee:true,slab:true,script:false,marker:false};
  const ICONS={paw:'M12 13c-2.8 0-6 2.2-6 5 0 1.7 1.3 2.5 2.6 2.5 1.2 0 2-.6 3.4-.6s2.2.6 3.4.6c1.3 0 2.6-.8 2.6-2.5 0-2.8-3.2-5-6-5zM5.5 7a2 2.6 0 1 0 0 5.2 2 2.6 0 1 0 0-5.2zm13 0a2 2.6 0 1 0 0 5.2 2 2.6 0 1 0 0-5.2zM9 3.5a2 3 0 1 0 0 6 2 3 0 1 0 0-6zm6 0a2 3 0 1 0 0 6 2 3 0 1 0 0-6z',bone:'M6 7.5a2.5 2.5 0 0 1 4.3-1.7L13.7 9.2 17 6a2.5 2.5 0 1 1 3.5 3.5L19 11l1.5 1.5A2.5 2.5 0 1 1 17 16l-3.3-3.2L10.3 16A2.5 2.5 0 1 1 6.8 12.5L8.3 11 6.8 9.5A2.5 2.5 0 0 1 6 7.5z',heart:'M12 21s-7.5-4.6-9.5-9.3C1 8 3.4 4.5 6.8 4.5c2 0 3.6 1.1 5.2 3 1.6-1.9 3.2-3 5.2-3 3.4 0 5.8 3.5 4.3 7.2C19.5 16.4 12 21 12 21z',star:'M12 2l2.9 6.3 6.9.8-5.1 4.7 1.4 6.8L12 17.3 5.9 20.6l1.4-6.8L2.2 9.1l6.9-.8z',anchor:'M12 2a3 3 0 0 1 1 5.8V9h4v2h-4v8.9c3.2-.4 5.8-2.6 6.6-5.9h2.2c-.9 4.6-4.9 8-9.8 8s-8.9-3.4-9.8-8h2.2c.8 3.3 3.4 5.5 6.6 5.9V11H7V9h4V7.8A3 3 0 0 1 12 2zm0 2a1 1 0 1 0 0 2 1 1 0 0 0 0-2z',bolt:'M13 2L4 14h6l-1 8 9-12h-6z',crown:'M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5z',skull:'M12 2C7 2 3 5.6 3 10c0 2.6 1.3 4.9 3.3 6.3V20h3v-2h1.4v2h2.6v-2h1.4v2h3v-3.7C19.7 14.9 21 12.6 21 10c0-4.4-4-8-9-8zm-3.5 7a2 2 0 1 1 0 4 2 2 0 0 1 0-4zm7 0a2 2 0 1 1 0 4 2 2 0 0 1 0-4zM12 13l1 2h-2z'};
  // outline paths in a 320x240 design box + the real tag width in mm by shape/size/finish, hole {x,y,r}, text anchor tx {cx,cy,nudge mm}
  const OUT={bone:{d:'M82 50 A42 42 0 0 1 121.6 78 L198.4 78 A42 42 0 1 1 255.9 130 A42 42 0 1 1 198.4 182 L121.6 182 A42 42 0 1 1 64.1 130 A42 42 0 0 1 82 50 Z',bb:[40,50,280,210],hole:{x:160,y:75,r:11.7},tx:{cx:160,cy:140,nudge:6},cut:{finish:'polished',cx:240,cy:172.6,k:2.62}},
    heart:{d:'M160 236 C 100 190 40 150 40 96 C 40 60 68 36 100 36 C 128 36 150 52 160 72 C 170 52 192 36 220 36 C 252 36 280 60 280 96 C 280 150 220 190 160 236 Z',bb:[40,36,280,236],hole:{x:160,y:76,r:12.6},tx:{cx:160,cy:140,nudge:6}},
    round:{d:'M160 32 A100 100 0 1 1 159.9 32 Z',bb:[60,32,260,232],hole:{x:160,y:59,r:14.3},tx:{cx:160,cy:140,nudge:6}},
    military:{d:'M62 62 H258 A42 42 0 0 1 300 104 V160 A42 42 0 0 1 258 202 H62 A42 42 0 0 1 20 160 V104 A42 42 0 0 1 62 62 Z',bb:[20,62,300,202],hole:{x:45,y:135,r:10.6},tx:{cx:182,cy:132,nudge:3}},
    paw:{d:'M82 166 C 82 128 118 104 160 104 C 202 104 238 128 238 166 C 238 204 204 228 160 228 C 116 228 82 204 82 166 Z M58 96 C 58 76 70 62 84 62 C 100 62 110 80 110 100 C 110 120 98 130 84 130 C 70 130 58 116 58 96 Z M108 56 C 108 36 120 22 134 22 C 150 22 160 40 160 60 C 160 80 148 92 134 92 C 120 92 108 76 108 56 Z M160 60 C 160 40 170 22 186 22 C 200 22 212 36 212 56 C 212 76 200 92 186 92 C 172 92 160 80 160 60 Z M210 100 C 210 80 220 62 236 62 C 250 62 262 76 262 96 C 262 116 250 130 236 130 C 222 130 210 120 210 100 Z',bb:[58,22,262,228],hole:{x:160,y:124,r:15.4},tx:{cx:160,cy:176,nudge:5},main:1}};
  function widthMm(t){ if(t.shape==='bone') return t.finish==='polished'?48:38; if(t.shape==='heart') return 38; if(t.shape==='round') return t.finish==='brass'?38:(t.finish==='black'?30:25); if(t.shape==='military') return t.finish==='stainless'?51:50; if(t.shape==='paw') return 33; return 38; }
  function fontKey(t) { return FONT_TTF[t.font] ? t.font : 'block'; }
  function hasOutline(shape) { return Object.prototype.hasOwnProperty.call(OUT, shape); }

  // ---- shape-aware text fit (layout v3) ----
  // Instead of fitting text into a rectangle, try the real glyph outlines against the real blank: every sampled point of
  // every glyph (and the icon's square) must be inside the outline with >= 1.5 mm clearance (2.0 mm for the overhanging
  // script font) and >= 1.0 mm clear of the hanging hole. Largest size wins; the block may slide up/down within a band.
  const EDGE_CLEAR_MM = 1.5, EDGE_CLEAR_SCRIPT_MM = 2.0, HOLE_CLEAR_MM = 1.0, GLYPH_STEP_MM = 0.5;
  const GRID_SLACK_U = 0.3;   // covers the distance-grid interpolation error (about 0.05 mm)
  const MAX_FS = 26, MIN_FS = 6, ICON_MAX = 26, MIN_ICON_FS_MM = 2.5;

  // Flatten an absolute SVG path (M L H V C A Z, the commands the outlines use) into closed rings of [x,y].
  function flattenPath(d, step) {
    const tok = d.match(/[MLHVCAZ]|-?\d*\.?\d+(?:e[-+]?\d+)?/gi) || [];
    const rings = []; let ring = null, i = 0, cmd = '', x = 0, y = 0, sx = 0, sy = 0;
    const num = () => parseFloat(tok[i++]);
    while (i < tok.length) {
      if (/[A-Za-z]/.test(tok[i])) cmd = tok[i++];
      if (cmd === 'M') { x = num(); y = num(); sx = x; sy = y; ring = [[x, y]]; rings.push(ring); cmd = 'L'; }
      else if (cmd === 'L') { x = num(); y = num(); ring.push([x, y]); }
      else if (cmd === 'H') { x = num(); ring.push([x, y]); }
      else if (cmd === 'V') { y = num(); ring.push([x, y]); }
      else if (cmd === 'C') {
        const x1 = num(), y1 = num(), x2 = num(), y2 = num(), x3 = num(), y3 = num();
        const len = Math.sqrt((x1-x)*(x1-x)+(y1-y)*(y1-y)) + Math.sqrt((x2-x1)*(x2-x1)+(y2-y1)*(y2-y1)) + Math.sqrt((x3-x2)*(x3-x2)+(y3-y2)*(y3-y2));
        const n = Math.max(8, Math.ceil(len / step));
        for (let k = 1; k <= n; k++) { const t = k / n, u = 1 - t; ring.push([u*u*u*x + 3*u*u*t*x1 + 3*u*t*t*x2 + t*t*t*x3, u*u*u*y + 3*u*u*t*y1 + 3*u*t*t*y2 + t*t*t*y3]); }
        x = x3; y = y3;
      } else if (cmd === 'A') {
        const arc = arcPoints(x, y, num(), num(), num(), num(), num(), num(), num(), step);
        for (const p of arc) ring.push(p);
        x = arc[arc.length - 1][0]; y = arc[arc.length - 1][1];
      } else if (cmd === 'Z') { x = sx; y = sy; }
      else throw new Error('unsupported path command ' + cmd);
    }
    return rings;
  }

  // SVG endpoint-arc to polyline (spec F.6.5, including the radius scale-up for impossible radii).
  function arcPoints(x1, y1, rx, ry, rot, large, sweep, x2, y2, step) {
    rx = Math.abs(rx); ry = Math.abs(ry);
    const phi = rot * Math.PI / 180, cp = Math.cos(phi), sp = Math.sin(phi);
    const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2;
    const x1p = cp * dx + sp * dy, y1p = -sp * dx + cp * dy;
    const lam = (x1p*x1p)/(rx*rx) + (y1p*y1p)/(ry*ry);
    if (lam > 1) { const k = Math.sqrt(lam); rx *= k; ry *= k; }
    const num = rx*rx*ry*ry - rx*rx*y1p*y1p - ry*ry*x1p*x1p, den = rx*rx*y1p*y1p + ry*ry*x1p*x1p;
    let co = Math.sqrt(Math.max(0, num / den)); if (large === sweep) co = -co;
    const cxp = co * rx * y1p / ry, cyp = -co * ry * x1p / rx;
    const cx = cp * cxp - sp * cyp + (x1 + x2) / 2, cy = sp * cxp + cp * cyp + (y1 + y2) / 2;
    const ang = (ux, uy, vx, vy) => { const a = Math.atan2(ux*vy - uy*vx, ux*vx + uy*vy); return a; };
    const th1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
    let dth = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
    if (!sweep && dth > 0) dth -= 2 * Math.PI; else if (sweep && dth < 0) dth += 2 * Math.PI;
    const n = Math.max(8, Math.ceil(Math.abs(dth) * Math.max(rx, ry) / step));
    const pts = [];
    for (let k = 1; k <= n; k++) { const a = th1 + dth * k / n; pts.push([cp * rx * Math.cos(a) - sp * ry * Math.sin(a) + cx, sp * rx * Math.cos(a) + cp * ry * Math.sin(a) + cy]); }
    pts[pts.length - 1] = [x2, y2];
    return pts;
  }

  // Through-hole in the blank (the polished bone has a paw-shaped cut-out in its right lobe, like the real blank in
  // site/assets/whisky-tag-real.jpg). The paw glyph is the 24x24 ICONS.paw drawn in absolute commands, placed with centre
  // (cx,cy) design units and k design units per glyph unit. Size and position were measured on that photo (hole about 8.9 mm wide,
  // centre about 40 mm from the left end and 7.5 mm above the bottom of the 48 x 32 mm blank); app.js draws the same hole smaller
  // (k 1.756) because it predates the measurement. Only the finish named in OUT[shape].cut.finish has it.
  function cutOf(t){ const o=OUT[t.shape]; return o&&o.cut&&o.cut.finish===t.finish?o.cut:null; }
  function cutPath(c){
    const X=u=>(c.cx+(u-12)*c.k).toFixed(2), Y=v=>(c.cy+(v-12)*c.k).toFixed(2);
    const el=(u,v,rx,ry)=>`M${X(u-rx)} ${Y(v)}A${(rx*c.k).toFixed(2)} ${(ry*c.k).toFixed(2)} 0 1 0 ${X(u+rx)} ${Y(v)}A${(rx*c.k).toFixed(2)} ${(ry*c.k).toFixed(2)} 0 1 0 ${X(u-rx)} ${Y(v)}Z`;
    const pad=`M${X(12)} ${Y(13)}C${X(9.2)} ${Y(13)} ${X(6)} ${Y(15.2)} ${X(6)} ${Y(18)}C${X(6)} ${Y(19.7)} ${X(7.3)} ${Y(20.5)} ${X(8.6)} ${Y(20.5)}C${X(9.8)} ${Y(20.5)} ${X(10.6)} ${Y(19.9)} ${X(12)} ${Y(19.9)}C${X(13.4)} ${Y(19.9)} ${X(14.2)} ${Y(20.5)} ${X(15.4)} ${Y(20.5)}C${X(16.7)} ${Y(20.5)} ${X(18)} ${Y(19.7)} ${X(18)} ${Y(18)}C${X(18)} ${Y(15.2)} ${X(14.8)} ${Y(13)} ${X(12)} ${Y(13)}Z`;
    return pad+el(5.5,9.6,2,2.6)+el(18.5,9.6,2,2.6)+el(9,6.5,2,3)+el(15,6.5,2,3);
  }

  // Signed distance grid (design units, 1 unit cells, positive inside) per shape (and per cut-out), built once.
  const fields = {};
  function fieldFor(shape, cut) {
    const key = cut ? shape + '+cut' : shape;
    if (fields[key]) return fields[key];
    const o = OUT[shape];
    let rings = flattenPath(o.d, 3);
    if (o.main) rings = rings.slice(0, o.main);   // paw: text only ever goes on the main pad
    if (cut) rings = rings.concat(flattenPath(cutPath(cut), 1.5));   // the hole is another ring: inside it counts as outside the blank
    const pad = 4, gx0 = Math.floor(o.bb[0]) - pad, gy0 = Math.floor(o.bb[1]) - pad;
    const W = Math.ceil(o.bb[2] - o.bb[0]) + 2 * pad + 1, H = Math.ceil(o.bb[3] - o.bb[1]) + 2 * pad + 1;
    const data = new Float32Array(W * H);
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      const px = gx0 + i, py = gy0 + j;
      let best = Infinity, inside = false;
      for (const ring of rings) {
        for (let a = 0, b = ring.length - 1; a < ring.length; b = a++) {
          const ax = ring[b][0], ay = ring[b][1], bx = ring[a][0], by = ring[a][1];
          if ((by > py) !== (ay > py) && px < ((ax - bx) * (py - by)) / (ay - by) + bx) inside = !inside;
          const ex = bx - ax, ey = by - ay, l2 = ex*ex + ey*ey;
          let t = l2 ? ((px - ax) * ex + (py - ay) * ey) / l2 : 0; t = t < 0 ? 0 : t > 1 ? 1 : t;
          const qx = ax + t * ex - px, qy = ay + t * ey - py, d2 = qx*qx + qy*qy;
          if (d2 < best) best = d2;
        }
      }
      data[j * W + i] = inside ? Math.sqrt(best) : -Math.sqrt(best);
    }
    return (fields[key] = { gx0, gy0, W, H, data, at(x, y) {   // bilinear; outside the grid counts as outside the blank
      const fx = x - gx0, fy = y - gy0, i = Math.floor(fx), j = Math.floor(fy);
      if (i < 0 || j < 0 || i >= W - 1 || j >= H - 1) return -99;
      const u = fx - i, v = fy - j, d = data;
      return d[j*W+i]*(1-u)*(1-v) + d[j*W+i+1]*u*(1-v) + d[(j+1)*W+i]*(1-u)*v + d[(j+1)*W+i+1]*u*v;
    } });
  }

  // Sample an opentype path (commands M L Q C Z) into points, about `stepU` design units apart.
  function samplePathCommands(cmds, stepU) {
    const pts = []; let x = 0, y = 0;
    for (const c of cmds) {
      if (c.type === 'M' || c.type === 'L') {
        if (c.type === 'L') { const n = Math.max(1, Math.ceil(Math.sqrt((c.x-x)*(c.x-x)+(c.y-y)*(c.y-y)) / stepU)); for (let k = 1; k <= n; k++) pts.push([x + (c.x-x)*k/n, y + (c.y-y)*k/n]); }
        else pts.push([c.x, c.y]);
        x = c.x; y = c.y;
      } else if (c.type === 'Q') {
        const n = Math.max(2, Math.ceil((Math.abs(c.x1-x)+Math.abs(c.y1-y)+Math.abs(c.x-c.x1)+Math.abs(c.y-c.y1)) / stepU));
        for (let k = 1; k <= n; k++) { const t = k / n, u = 1 - t; pts.push([u*u*x + 2*u*t*c.x1 + t*t*c.x, u*u*y + 2*u*t*c.y1 + t*t*c.y]); }
        x = c.x; y = c.y;
      } else if (c.type === 'C') {
        const n = Math.max(2, Math.ceil((Math.abs(c.x1-x)+Math.abs(c.y1-y)+Math.abs(c.x2-c.x1)+Math.abs(c.y2-c.y1)+Math.abs(c.x-c.x2)+Math.abs(c.y-c.y2)) / stepU));
        for (let k = 1; k <= n; k++) { const t = k / n, u = 1 - t; pts.push([u*u*u*x + 3*u*u*t*c.x1 + 3*u*t*t*c.x2 + t*t*t*c.x, u*u*u*y + 3*u*u*t*c.y1 + 3*u*t*t*c.y2 + t*t*t*c.y]); }
        x = c.x; y = c.y;
      }
    }
    return pts;
  }

  // Layout for one side of one tag. `font` is an already-parsed opentype.js Font (loading stays with the caller).
  // opts.qr (back side only, smart QR tag, built by SDTQR.layoutOpts): { exclude:[rect], backLines:[text], center:{x,y} mm, minFsMm, group:'<g id="qr">..' }.
  // The text block then starts at `center`, may slide any way in 1 mm steps, and never shrinks below minFsMm (a smaller fit reports fit:false).
  // opts (optional, off by default so existing output is untouched): { exclude: [{x0,y0,x1,y1}] } rectangles in mm,
  // measured from the blank's top-left corner (y down), that no glyph or icon point may enter. Used by photo tags
  // to keep text clear of the engraved photo.
  function layout(t, side, font, opts) {
    const qr=opts&&opts.qr&&side==='back'?opts.qr:null;   // smart QR tag (site/tag-qr.js): extra box to avoid, own back lines, own text centre
    const lines=(qr&&qr.backLines?qr.backLines:(side==='front'?t.front:t.back)).filter(Boolean); const fk=fontKey(t);
    const o=OUT[t.shape]||OUT.bone; const shape=OUT[t.shape]?t.shape:'bone'; const [bx0,by0,bx1,by1]=o.bb; const bw=bx1-bx0, bh=by1-by0; const mm=widthMm(t)/bw; // mm per design unit
    const W=(bw*mm).toFixed(2), H=(bh*mm).toFixed(2);
    const L=UPPER[fk]===false?lines:lines.map(l=>l.toUpperCase()); const n=Math.max(1,L.length);
    const icon=side==='front'&&t.icon&&t.icon!=='none'?ICONS[t.icon]:null;
    const cx=qr&&qr.center?bx0+qr.center.x/mm:o.tx.cx, cyMid=qr&&qr.center?by0+qr.center.y/mm:o.tx.cy;
    const cut=cutOf(t), field=fieldFor(shape,cut), hole=o.hole;
    const edge=(fk==='script'?EDGE_CLEAR_SCRIPT_MM:EDGE_CLEAR_MM)/mm, holeMin=hole.r+HOLE_CLEAR_MM/mm, stepU=GLYPH_STEP_MM/mm;
    const ex=[...((opts&&opts.exclude)||[]),...(qr&&qr.exclude||[])].map(e=>({x0:bx0+e.x0/mm,y0:by0+e.y0/mm,x1:bx0+e.x1/mm,y1:by0+e.y1/mm}));
    const free=(x,y)=>{ for(let q=0;q<ex.length;q++){ if(x>=ex[q].x0&&x<=ex[q].x1&&y>=ex[q].y0&&y<=ex[q].y1) return false; } if(field.at(x,y)<edge+GRID_SLACK_U) return false; const dx=x-hole.x, dy=y-hole.y; return dx*dx+dy*dy>=holeMin*holeMin; };
    // block centre candidates: centred first, then +-1 mm steps within the usable band
    const offs=[0]; for(let k=1;k<=(qr?Math.ceil(Number(H)/2):o.tx.nudge);k++){ const d=k/mm; offs.push(d,-d); }
    // a cut-out blank (polished bone) also slides the block left, away from the hole in its right lobe: 1 mm steps, 0 first
    const xs=[0]; if(cut){ for(let k=1;k<=12;k++) xs.push(-k/mm); }
    // a QR tag lets the text block slide both ways (1 mm steps, nearest first) so the letters can settle beside the QR box
    if(qr){ xs.length=0; xs.push(0); for(let k=1;k<=Math.ceil(Number(W)/2);k++){ xs.push(k/mm,-k/mm); } }
    const minFs=qr&&qr.minFsMm?qr.minFsMm/mm:MIN_FS;
    const nlines=L.length;
    // try one icon share; returns the best {fs, cyB, iconH} or null
    function search(share){
      for(let fs=MAX_FS; fs>=(nlines?minFs:MAX_FS); fs-=0.5){
        const lh=fs*1.18;
        let iconH=0; if(icon) iconH=nlines?Math.min(ICON_MAX, share/(1-share)*n*lh):ICON_MAX;
        const total=iconH+(nlines?n*lh:0);
        const glyphs=L.map(l=>{ const w=font.getAdvanceWidth(l,fs); return { pts:samplePathCommands(font.getPath(l,0,0,fs).commands,stepU), w }; });
        for(let attempt=0; attempt<(nlines?1:ICON_MAX-7); attempt++){
          const ih=nlines?iconH:ICON_MAX-attempt, tot=ih+(nlines?n*lh:0);
          for(const xo of xs) for(const off of offs){
            const cxB=cx+xo, cyB=cyMid+off, top=cyB-tot/2; let ok=true;
            if(icon){ const x0=cxB-ih/2, y0=top, m=Math.max(2,Math.ceil(ih/stepU)); for(let k=0;k<=m&&ok;k++){ const f=k/m; if(!free(x0+ih*f,y0)||!free(x0+ih*f,y0+ih)||!free(x0,y0+ih*f)||!free(x0+ih,y0+ih*f)) ok=false; } }
            for(let i=0;i<nlines&&ok;i++){
              const base=top+ih+lh/2+fs*0.36+i*lh, ox=cxB-glyphs[i].w/2, pts=glyphs[i].pts;
              for(let p=0;p<pts.length;p++){ if(!free(ox+pts[p][0],base+pts[p][1])){ ok=false; break; } }
            }
            if(ok) return { fs, cyB, cxB, iconH:ih };
          }
        }
      }
      return null;
    }
    let best=search(icon?0.34:0);
    // a big icon can starve the text; when letters would be tiny, retry with the icon at 20% of the block and keep the better
    if(icon&&nlines&&(!best||best.fs*mm<MIN_ICON_FS_MM)){ const small=search(0.20); if(small&&(!best||small.fs>best.fs)) best=small; }
    const fit=!!best;
    if(!best){ const fs=MIN_FS, lh=fs*1.18, iconH=icon?(nlines?Math.min(ICON_MAX,0.34/0.66*n*lh):ICON_MAX):0; best={ fs, cyB:cyMid, cxB:cx, iconH }; }
    const { fs, cyB, cxB, iconH }=best; const lh=fs*1.18;
    const total=iconH+(nlines?n*lh:0), blockTop=cyB-total/2;
    const top=blockTop+iconH+lh/2+fs*0.36;
    const textPaths=L.map((l,i)=>{ const w=font.getAdvanceWidth(l,fs); return font.getPath(l,cxB-w/2,top+i*lh,fs).toPathData(2); });
    const iconTx=icon?(cxB-iconH/2).toFixed(2):null, iconTy=icon?blockTop.toFixed(2):null, iconK=icon?(iconH/24).toFixed(4):null;
    return { fk, o, bb: [bx0,by0,bx1,by1], bw, bh, s: mm, W, H, cx: cxB, cy: cyB, cutD: cut?cutPath(cut):null, tw: null, th: null, lines: L, n, iconD: icon, iconH, boxH: null, fs, fit, lh, top, textPaths, iconTx, iconTy, iconK };
  }

  // Same clearance rule layout() uses, as a predicate in mm from the blank's top-left corner (y down): true when the point
  // is >= edgeMm inside the outline (default 1.5) and >= 1.0 mm clear of the hanging hole. Photo placement uses it.
  function clearance(t, edgeMm) {
    const shape=OUT[t.shape]?t.shape:'bone', o=OUT[shape], [bx0,by0,bx1]=o.bb, mm=widthMm(t)/(bx1-bx0);
    const field=fieldFor(shape,cutOf(t)), hole=o.hole, edge=(edgeMm==null?EDGE_CLEAR_MM:edgeMm)/mm, holeMin=hole.r+HOLE_CLEAR_MM/mm;
    return (xMm,yMm)=>{ const x=bx0+xMm/mm, y=by0+yMm/mm; if(field.at(x,y)<edge+GRID_SLACK_U) return false; const dx=x-hole.x, dy=y-hole.y; return dx*dx+dy*dy>=holeMin*holeMin; };
  }

  // The exact string the original lightburnSVG() returned (real-size SVG in mm, text as paths).
  // opts is passed to layout(); opts.extra (a string of SVG, photo preview) is appended inside the root element.
  function svg(t, side, font, opts) {
    const r=layout(t, side, font, opts); const [bx0,by0]=r.bb; const {fk,o,bw,bh,W,H,textPaths}=r;
    const iconG=r.iconD?`<g transform="translate(${r.iconTx} ${r.iconTy}) scale(${r.iconK})"><path d="${r.iconD}"/></g>`:'';
    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}mm" height="${H}mm" viewBox="${bx0} ${by0} ${bw} ${bh}">
<!-- Salty Dog Tags ${t.shape} ${side}; outline is for alignment only (set its layer to no-output in LightBurn); text is paths, font ${fk} -->
<g id="outline" fill="none" stroke="#ff0000" stroke-width="0.3"><path d="${o.d}${r.cutD?' '+r.cutD:''}"/></g>
<g id="engrave" fill="#000000">${iconG}${textPaths.map(d=>`<path d="${d}"/>`).join('')}</g>${opts&&opts.qr&&side==='back'&&opts.qr.group?'\n'+opts.qr.group:''}${opts&&opts.extra?'\n'+opts.extra:''}
</svg>`;
  }


  /* ---------- full color UV print (xTool O1 Omni): print layout for tags and ornaments ----------
     Added with the full-color finish. Nothing above this block changed (laser/test/golden still matches byte for byte).
     Geometry is the builder preview's (site/app.js FC_* tables, kept equal by tools/test/site-sync.test.mjs), scaled to millimetres:
     the long edge of the shape's bounding box = the size's inch size (1, 1.5, 2, 2.5 in), or 76.2 mm for the 3 inch ornament disc.
     Three layers, matching Zartan's template: "color" (the art), "white" (the underlay), "raised" (lettering and the rim).
     Every element carries raised: true|false. Lettering and the rim are raised only when the customer bought raised lettering
     (tags) or the ornament includes it. */
  const FC_LONG_MM = { small: 25, medium: 38, large: 51, xl: 64 };
  const ORNAMENT_MM = 76.2;
  const FC_BBOX = { bone: [40, 50, 280, 210], heart: [40, 36, 280, 236], round: [60, 32, 260, 232], military: [20, 62, 300, 202], paw: [58, 22, 262, 228] };
  const FC_TEXT = { bone: { cx: 160, cy: 146, w: 150, h: 60 }, heart: { cx: 160, cy: 150, w: 116, h: 50 }, round: { cx: 160, cy: 186, w: 120, h: 44 }, military: { cx: 190, cy: 178, w: 200, h: 44 }, paw: { cx: 160, cy: 190, w: 104, h: 40 } };
  const FC_BOLD = { bone: { cx: 160, cy: 140, w: 150, h: 70 }, heart: { cx: 160, cy: 148, w: 122, h: 92 }, round: { cx: 160, cy: 150, w: 134, h: 92 }, military: { cx: 190, cy: 134, w: 208, h: 84 }, paw: { cx: 160, cy: 190, w: 116, h: 60 } };
  const FC_HOLE = { bone: { x: 160, y: 92 }, heart: { x: 160, y: 90 }, round: { x: 160, y: 48 }, military: { x: 50, y: 132 }, paw: { x: 160, y: 124 } };
  const FC_RIM_UNITS = 7, FC_HOLE_R_UNITS = 8, FC_LINE_H = 1.18;

  // spec: { product: 'tag'|'ornament', shape, size, lines, back, font, art: 'design'|'upload', style, raised, ornamentTier?,
  //         image?: { file, mime, w, h } (px, optional), rightsAcknowledged, orderId, item }
  // font: anything with getAdvanceWidth(text, fontSizeUnits) (an opentype.js font); without one, a width estimate is used.
  function fullcolorLayout(spec, font) {
    const shape = FC_BBOX[spec.shape] ? spec.shape : 'bone';
    const bb = FC_BBOX[shape], bw = bb[2] - bb[0], bh = bb[3] - bb[1];
    const long = spec.product === 'ornament' ? ORNAMENT_MM : (FC_LONG_MM[spec.size] || FC_LONG_MM.medium);
    const k = long / Math.max(bw, bh);
    const r1 = (n) => Math.round(n * 100) / 100;
    const W = r1(bw * k), H = r1(bh * k);
    const fk = fontKey({ font: spec.font });
    const upper = UPPER[fk] !== false;
    const raised = Boolean(spec.raised);
    const mode = spec.art === 'upload' ? 'upload' : 'design';
    const style = mode === 'design' ? (spec.style || 'bold') : null;
    const hasImage = Boolean(spec.image && spec.image.file);
    const bold = mode === 'design' && style === 'bold';
    const area = bold ? FC_BOLD[shape] : FC_TEXT[shape];
    const toMm = (x, y) => ({ x: r1((x - bb[0]) * k), y: r1((y - bb[1]) * k) });
    const textFit = (lines) => {
      const L = lines.filter(Boolean).map((l) => (upper ? String(l).toUpperCase() : String(l)));
      if (!L.length) return null;
      const adv = (t, fs) => (font && font.getAdvanceWidth ? font.getAdvanceWidth(t, fs) : t.length * fs * 0.62);
      let fs = 24;
      for (; fs > 11; fs--) if (L.every((l) => adv(l, fs) <= area.w) && L.length * fs * FC_LINE_H <= area.h) break;
      return { lines: L, fontSizeMm: r1(fs * k), lineHeightMm: r1(fs * FC_LINE_H * k), centerMm: toMm(area.cx, area.cy), areaMm: { w: r1(area.w * k), h: r1(area.h * k) } };
    };
    const els = [];
    // color layer
    if (mode === 'design' && style !== 'photo') els.push({ id: 'art', type: 'house-style', style, layer: 'color', raised: false, note: style === 'mascot' ? 'uses site/assets/mascot.svg' : undefined });
    if (hasImage) {
      const e = { id: 'image', type: 'image', layer: 'color', raised: false, file: spec.image.file, mime: spec.image.mime || undefined, fit: 'cover', boxMm: { x: 0, y: 0, w: W, h: H } };
      if (spec.image.w > 0 && spec.image.h > 0) { // the part of the source that lands inside the box (cover, centered)
        const sc = Math.max(W / spec.image.w, H / spec.image.h), cw = W / sc, ch = H / sc;
        e.cropPx = { x: Math.round((spec.image.w - cw) / 2), y: Math.round((spec.image.h - ch) / 2), w: Math.round(cw), h: Math.round(ch) };
        e.effectiveDpi = Math.round(25.4 / (W / cw));
      }
      els.push(e);
      if (mode === 'design') els.push({ id: 'legibility-fade', type: 'gradient', layer: 'color', raised: false, fromYFrac: 0.5, toYFrac: 1, toOpacity: 0.6, color: '#000000' });
    }
    els.push({ id: 'white-underlay', type: 'underlay', layer: 'white', raised: false, coversArt: true, note: 'white ink under the whole print on clear or primed stock' });
    // raised layer
    const front = textFit(spec.lines || []);
    if (front) els.push({ id: spec.product === 'ornament' ? 'name-year' : 'saying', type: 'text', side: 'front', layer: 'raised', raised, font: fk, color: bold ? '#09010F' : '#FFF4FA', ...front });
    els.push({ id: 'rim', type: 'rim', layer: 'raised', raised, widthMm: r1(FC_RIM_UNITS * k), note: 'raised rim around the silhouette' });
    const hole = FC_HOLE[shape];
    els.push({ id: 'hole', type: 'hole', layer: 'cut', raised: false, ...toMm(hole.x, hole.y), rMm: r1(FC_HOLE_R_UNITS * k) });
    // back side (tags: dog name and phone; ornaments are single sided)
    const backLines = (spec.back || []).filter(Boolean);
    const backEl = backLines.length ? (() => { const sv = area; const f = textFit(backLines); return f && { id: 'back-text', type: 'text', side: 'back', layer: 'raised', raised, font: fk, color: '#09010F', ...f }; })() : null;
    if (backEl) els.push(backEl);
    return {
      version: 1, kind: 'sdt-fullcolor-print', orderId: spec.orderId || null, item: spec.item || null, product: spec.product || 'tag',
      shape, size: spec.size || null, finish: spec.product === 'ornament' ? (spec.ornamentTier === 'stainless' ? 'ornament-stainless' : 'ornament-acrylic') : 'fullcolor',
      tagMm: [W, H], units: 'mm', origin: 'top-left of the shape bounding box', layers: ['color', 'white', 'raised'],
      art: { mode, style, raisedLettering: raised, rightsAcknowledged: Boolean(spec.rightsAcknowledged) },
      silhouette: { d: OUT[shape].d, viewBox: [bb[0], bb[1], bw, bh], note: 'path is in viewBox units; scale = tagMm / viewBox size' },
      elements: els,
    };
  }

  // House-style backgrounds in viewBox units (same artwork as site/app.js artBackground()).
  function fcHouseArt(style, bb, mascotHref) {
    const [x0, y0, x1, y1] = bb, w = x1 - x0, h = y1 - y0, cx = (x0 + x1) / 2;
    if (style === 'synthwave') {
      const hz = y0 + h * 0.62; let grid = '';
      for (let i = 0; i < 6; i++) { const gy = hz + 4 + i * i * 1.7 + i * 3; if (gy < y1) grid += `<line x1="${x0}" y1="${gy.toFixed(1)}" x2="${x1}" y2="${gy.toFixed(1)}"/>`; }
      for (let i = -6; i <= 6; i++) grid += `<line x1="${(cx + i * w * 0.05).toFixed(1)}" y1="${hz}" x2="${(cx + i * w * 0.22).toFixed(1)}" y2="${y1}"/>`;
      return `<defs><linearGradient id="sk" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#09010F"/><stop offset=".45" stop-color="#7B2CFF"/><stop offset=".8" stop-color="#FF3CAC"/><stop offset="1" stop-color="#FFD166"/></linearGradient><linearGradient id="su" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFD166"/><stop offset="1" stop-color="#FF2E97"/></linearGradient></defs><rect x="${x0}" y="${y0}" width="${w}" height="${h}" fill="url(#sk)"/><circle cx="${cx}" cy="${(hz - h * 0.02).toFixed(1)}" r="${(h * 0.2).toFixed(1)}" fill="url(#su)"/><rect x="${x0}" y="${hz}" width="${w}" height="${(y1 - hz).toFixed(1)}" fill="#09010F"/><g stroke="#2AF5E4" stroke-width="1" opacity=".75">${grid}</g>`;
    }
    if (style === 'mascot') {
      const m = h * 0.62;
      return `<defs><linearGradient id="mb" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1A0B33"/><stop offset="1" stop-color="#251246"/></linearGradient></defs><rect x="${x0}" y="${y0}" width="${w}" height="${h}" fill="url(#mb)"/><image href="${mascotHref || '/assets/mascot.svg'}" x="${(cx - m / 2).toFixed(1)}" y="${(y0 + h * 0.1).toFixed(1)}" width="${m.toFixed(1)}" height="${m.toFixed(1)}"/>`;
    }
    return `<rect x="${x0}" y="${y0}" width="${w}" height="${h}" fill="#FFF4FA"/>`;
  }

  // One SVG at exact size (width/height in mm, viewBox in design units): the print sheet and a printer-ready preview.
  // opts: { imageHref, mascotHref, marks: bool (draw cut outline and mark raised elements) }
  function fullcolorSVG(layout, opts) {
    opts = opts || {};
    const [vx, vy, vw, vh] = layout.silhouette.viewBox, [W, H] = layout.tagMm, k = vw / W; // units per mm
    const els = layout.elements, byId = (id) => els.find((e) => e.id === id);
    const esc2 = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const clipId = 'fcclip';
    let art = '';
    const style = layout.art.style, img = byId('image');
    if (img && opts.imageHref) art += `<rect x="${vx}" y="${vy}" width="${vw}" height="${vh}" fill="#fff"/><image href="${opts.imageHref}" x="${vx}" y="${vy}" width="${vw}" height="${vh}" preserveAspectRatio="xMidYMid slice"/>`;
    else if (byId('art')) art += fcHouseArt(style, [vx, vy, vx + vw, vy + vh], opts.mascotHref);
    else art += `<rect x="${vx}" y="${vy}" width="${vw}" height="${vh}" fill="#251246"/>`;
    if (byId('legibility-fade')) art += `<defs><linearGradient id="fcfade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".6"/></linearGradient></defs><rect x="${vx}" y="${(vy + vh * 0.5).toFixed(1)}" width="${vw}" height="${(vh * 0.5).toFixed(1)}" fill="url(#fcfade)"/>`;
    const textEls = els.filter((e) => e.type === 'text' && e.side === 'front');
    const text = textEls.map((t) => {
      const fs = t.fontSizeMm * k, lh = t.lineHeightMm * k, cx = vx + t.centerMm.x * k, cy = vy + t.centerMm.y * k, n = t.lines.length;
      const top = cy - ((n - 1) * lh) / 2 + fs * 0.36;
      const ff = { block: "'Archivo Black',sans-serif", bungee: 'Bungee,sans-serif', script: 'Pacifico,cursive', slab: "'Alfa Slab One',serif", marker: "'Permanent Marker',cursive" }[t.font] || "'Archivo Black',sans-serif";
      return `<g font-family="${ff}" text-anchor="middle" font-size="${fs.toFixed(2)}" fill="${t.color}" ${t.color === '#FFF4FA' ? 'stroke="#09010F" stroke-width="3" paint-order="stroke" stroke-linejoin="round"' : ''}${t.raised && opts.marks ? ' data-raised="true"' : ''}>${t.lines.map((l, i) => `<text x="${cx.toFixed(2)}" y="${(top + i * lh).toFixed(2)}">${esc2(l)}</text>`).join('')}</g>`;
    }).join('');
    const rim = byId('rim');
    const rimSvg = rim && rim.raised ? `<g fill="none" stroke="#FFF4FA" stroke-width="${(rim.widthMm * k).toFixed(2)}" stroke-linejoin="round" clip-path="url(#${clipId})"><path d="${layout.silhouette.d}"/></g>` : '';
    const hole = byId('hole'), hx = vx + hole.x * k, hy = vy + hole.y * k;
    const marks = opts.marks ? `<g fill="none" stroke="#ff0000" stroke-width="0.6"><path d="${layout.silhouette.d}"/><circle cx="${hx.toFixed(1)}" cy="${hy.toFixed(1)}" r="${(hole.rMm * k).toFixed(2)}"/></g>` : '';
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}mm" height="${H}mm" viewBox="${vx} ${vy} ${vw} ${vh}">
<defs><clipPath id="${clipId}"><path d="${layout.silhouette.d}"/></clipPath><mask id="fchole"><rect x="${vx}" y="${vy}" width="${vw}" height="${vh}" fill="#fff"/><circle cx="${hx.toFixed(1)}" cy="${hy.toFixed(1)}" r="${(hole.rMm * k).toFixed(2)}" fill="#000"/></mask></defs>
<g mask="url(#fchole)"><g clip-path="url(#${clipId})">${art}</g>${rimSvg}<g clip-path="url(#${clipId})">${text}</g></g>${marks}
</svg>`;
  }

  const api = { VERSION: 5, FC_LONG_MM, ORNAMENT_MM, FC_BBOX, FC_TEXT, FC_BOLD, FC_HOLE, fullcolorLayout, fullcolorSVG, FONT_BASE, FONT_TTF, UPPER, ICONS, OUT, widthMm, fontKey, hasOutline, layout, svg, clearance, cutPath: t=>{ const c=cutOf(t); return c?cutPath(c):null; } };
  root.SDTLayout = api;
  if (typeof module === 'object' && module && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
