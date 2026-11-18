# SPEC: Paid orders to LightBurn jobs (`laser/`)

GitHub issue: **#1** (nicholasroper-cloud/salty-dog-tags)
Author: Hi-Tech (architecture) | Implementer: Tollbooth | Reviewer: Flint | Security review: Scarlett
Date: 2026-10-16 | Status: ready to build | Architecture: approved by Nick, not re-opened here

---

## 0. Summary and recommendation

Build a small Node 24 service in `laser/` on the laser Mac. It polls `https://saltydogtags.com/api/orders` and turns each `paid` order into a folder of LightBurn 2.1.03 `.lbrn2` files: one file per tag entry per side, with the outline on Tool layer T1 and text and icon on one Scan layer whose settings come from a material preset. It hands a file to LightBurn over UDP with `FORCELOAD` and **never** sends `START`. A localhost page at `http://127.0.0.1:8150` shows the queue.

**Layout decision (the one open design choice): extract a shared module.** Move the layout math from `site/orders.html` into a new classic script, `site/tag-layout.js`. The browser loads it with a `<script>` tag. The service loads the same file with `createRequire`. Parity is then guaranteed by construction, and golden SVGs captured from the **unmodified** `orders.html` prove the extraction changed nothing (section 5). The service depends only on the file in the repo, not on a deploy, so the `orders.html` edit can ship later without blocking the service.

**Two findings change how this ships. Read section 14 before starting.**

1. **Cloudflare KV free-tier limits.** `GET /api/orders` performs one KV `list` plus one `get` per order. Polling every 60 s is 1,440 list calls a day, but the free plan allows 1,000 list requests and 100,000 reads a day, and once a limit is hit, "further operations of that type will fail with an error" until 00:00 UTC. Reads failing would break **order intake** (`order.js` calls `ORDERS.get`). The service therefore enforces a KV budget guard (section 9.3). The approved 60 s interval only applies once Nick confirms the account is on Workers Paid.
2. **Stored tag shape differs from the brief.** `order.tags[]` items are **flat**: `{shape,size,finish,font,icon,color,colorHue,photo,front[],back[],qty,photoBytes?}`. The `{qty, tag:{...}}` nesting exists only transiently inside `order.js` (line 44 builds `{tag, photoImage}`, and line 46 stores `parsedTags.map(p => p.tag)`). `qty` lives **inside** each tag. `orders.html` reads `t.qty` and `t.front` directly, which confirms this.

---

## 1. Context and verified facts

| Fact | Source |
|---|---|
| Stored order: `{id, at, status, customer{name,email,phone,delivery,address,note}, tags[], prints[], totals, prize?, payment?{status,id?}, checkout?, ownerNote?, updated?}`. `ua`/`ip` are stripped by GET. | `functions/api/order.js` 105, `orders.js` 14 |
| Order id: `SDT-` + 4 chars from `ABCDEFGHJKMNPQRSTUVWXYZ23456789` (no `O`, `I`, `L`, `0`, `1`) | `_lib.js` 16-21 |
| Statuses: `new invoiced paid made shipped done cancelled`. POST `{id,status}` updates. Do not send `ownerNote`. | `orders.js` 4, 22-35 |
| Photo tags: `photo === true`, `front` is forced to `[]`, image at `GET /api/photo?id=<orderId>&t=<index into order.tags>` (Bearer), `content-type` is `image/jpeg|png|webp` | `order.js` 30-40, `photo.js` |
| Colour add-on: `color in {icon,line}` (stainless family only), `colorHue in {blue,gold,purple,bronze}`. The builder labels these "Icon or short line" and "Full line" and does **not** record which line. | `order.js` 28-29, `app.js` 793 |
| `widthMm(t)` uses **shape and finish only**. `size` is never used for geometry. Shapes outside `OUT` fall back to the bone outline in `orders.html`. | `orders.html` 179 |
| LightBurn device: `JCZFiber (USB-Lite)`, galvo field **200 x 200 mm**, `RequireFrameBeforeStart: true`, `StartMarkPortBit: 14` (a hardware start input exists) | `~/Library/Preferences/LightBurn/backup/prefs/20261016_085007.lbprefs` |
| UDP: listens on 19840, replies on 19841. Replies: `OK` = success, `!` = unsuccessful, `?` = invalid. `STATUS` returns `!` if the laser is busy (or not connected). `PING` returns OK only if LightBurn is open **with no dialog showing**. | LightBurn 2.1 docs, "Automation With UDP Commands" |
| lbrn2 path encoding (LightBurn 2.1.03 as written): `VertList` = `V<x> <y>` plus `c0x<x>c0y<y>` (outgoing handle) and/or `c1x<x>c1y<y>` (incoming handle). An absent handle is written `c0x1` / `c1x1`. `PrimList` = concatenated `L<a> <b>` / `B<a> <b>`, and closure is a prim back to vertex `0`. | `Piece of Mind Purple.lbrn2` 46-47, `Thirsty Beaches Dog Tag - Color.lbrn2` 73 |
| Tool layer: `<CutSetting type="Tool">`, index 30 (T1), written by the July hand-made file, which used AppVersion 1.7.03. **Not yet proven on 2.1.03.** This is test gate G1. | `whisky_bone_tag.lbrn2` 30-34 |
| `scanOpt` is absent in default layers and `"individual"` in one of Nick's files. Absent means "fill all shapes at once", which is what gives letter counters (O, A, R) their holes. | Nick's 2.1.03 files |

**`lbrnts` evaluation: rejected.** It is v0.0.24 with 3 GitHub stars and depends on `fast-xml-parser`. Its documented CutSetting fields have no `frequency` or `QPulseWidth` (both galvo-essential), Tool layers are not mentioned, and its bezier-to-VertList mapping is undocumented. Writing XML from a template copied from a LightBurn-saved file is fewer moving parts and fully inspectable.

**Path normalisation: use `svgpath@2.6.0`** (fontello, MIT, zero runtime dependencies). It provides `abs()`, `unarc()` (arcs to cubic beziers), `unshort()` (S/T to C/Q), and `iterate()`. The outlines use `A`, `H`, and `Z`. The icons use relative `a c s l h v z` and implicit repeats. Text uses absolute `M L Q C Z`.

---

## 2. Scope

**In scope:** the polling daemon, generator, lbrn2 writer, presets, UDP handoff, queue UI, CLI, launchd agent, tests, `laser/README.md`, the new `site/tag-layout.js`, and the `site/orders.html` delegation edit (section 5.4).

**Out of scope:** any change to `functions/`, deploying the site (Nick deploys after Flint review), photo engraving, colour-mark layers, outlines for hydrant/fish/cat/star/house, boolean path union (weld), and sending `START` in any form.

**Hard rules (each one is an acceptance criterion):**
- R1. The service never sends `START`. The UDP client refuses any command matching `/^\s*START/i` and throws.
- R2. The service never deletes files. Regeneration **moves** existing files to `<job>/old/<YYYYMMDD-HHMMSS>/`.
- R3. Global limit: at most one `FORCELOAD` per 5 s.
- R4. `state.json` is written atomically (temp file, fsync, rename).
- R5. The HTTP server binds `127.0.0.1` only.
- R6. The admin key never appears in logs, in UI responses, in `state.json`, in `job.json`, or in `.lbrn2` Notes.

---

## 3. File list and module boundaries

```
site/tag-layout.js                 NEW  shared layout math (classic script, browser + Node)
site/orders.html                   EDIT +1 <script> tag; lines 170-199 delegate to SDTLayout (section 5.4)

laser/
  SPEC.md                          this file
  README.md                        operator doc (section 13)
  package.json                     type: module; deps pinned exactly (section 3.1)
  package-lock.json                committed
  .gitignore                       state.json, state.*.json, .lock, logs/, fonts/*.ttf, data/, config.local.json
  config.json                      committed defaults (section 9.1)
  com.saltydogtags.laser.plist     launchd agent (section 12)
  server.mjs                       daemon entry: lock, config, state, scheduler, HTTP, UDP client
  cli.mjs                          CLI entry (section 11)
  lib/config.mjs                   load config.json + config.local.json, expand ~, validate
  lib/log.mjs                      line logger -> logs/laser.log, rotate at 5 MB to laser.log.1
  lib/lock.mjs                     single-writer lock file (.lock, O_EXCL, pid, stale detection)
  lib/state.mjs                    load/save state.json atomically; job transitions (section 9.5)
  lib/api.mjs                      saltydogtags.com client: listOrders, setStatus, getPhoto; backoff
  lib/fonts.mjs                    download/cache TTFs to fonts/, sha256, opentype.parse
  lib/layout.mjs                   createRequire('../../site/tag-layout.js'); re-export
  lib/geometry.mjs                 SVG path string + affine -> LightBurn subpaths (section 6)
  lib/lbrn2.mjs                    XML builder from template (section 7)
  lib/presets.mjs                  load/validate presets, finish->preset map, import from .lbrn2
  lib/generate.mjs                 order -> job folder (files, job.json, previews, photos)
  lib/lightburn.mjs                UDP client (section 10)
  lib/queue.mjs                    orchestration: poll, eligibility, remote-status sync, auto-load
  lib/http.mjs                     UI + JSON API server (section 10.4)
  ui/index.html                    single-file UI, inline CSS/JS, no framework
  presets/anodized.json            seed (untested)
  presets/stainless.json           seed (untested)
  presets/polished.json            seed (untested, equal to stainless)
  presets/brass.json               seed (untested)
  presets/history/                 created by `preset import`, holds previous versions
  data/orders/<id>.json            PII-stripped order snapshots for Regenerate (gitignored)
  fonts/                           cached TTFs (gitignored) + nothing else
  logs/                            gitignored
  test/fixtures/tags.json          12 fixture tags (section 15.2)
  test/fixtures/demo-orders.json   SDT-DEMO and SDT-OOPS (section 11.2)
  test/golden/*.svg                captured from the unmodified orders.html
  test/golden/manifest.json        source commit, opentype version, font sha256s
  test/capture-golden.mjs          one-shot golden capture (section 5.3)
  test/*.test.mjs                  node:test suites (section 15)
```

Boundaries:
- **Pure code:** `geometry`, `lbrn2`, `presets` (parse/validate), and `layout`. They do no I/O and are unit-tested.
- **`generate` does file I/O** only under the job dir. Photos arrive through an injected `fetchPhoto` function, so tests run offline.
- **`queue` is the only module that changes job state.** It calls `api`, `generate`, `lightburn`, and `state`.
- **`http` is a thin adapter** that calls `queue` functions and has no business logic.
- **The CLI is also a thin adapter.** When the daemon is running it calls the daemon over HTTP; otherwise it takes the lock and calls `queue` in-process (section 11.1).

### 3.1 package.json

```json
{
  "name": "sdt-laser",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=24" },
  "scripts": {
    "start": "node server.mjs",
    "test": "node --test test/",
    "golden:capture": "node test/capture-golden.mjs"
  },
  "dependencies": {
    "opentype.js": "1.3.4",
    "svgpath": "2.6.0"
  }
}
```

Pin exact versions with no caret. `opentype.js` must be **1.3.4**, the same version `orders.html` loads from cdnjs, because `getAdvanceWidth` and `toPathData(2)` output must match byte for byte. There are no other dependencies. XML well-formedness tests use macOS `/usr/bin/xmllint`.

---

## 4. End-to-end flow

```
saltydogtags.com /api/orders  --(HTTPS GET, Bearer, every pollSeconds)-->  queue.poll()
   for each order with status "paid" and no state entry (oldest `at` first):
      snapshot -> data/orders/<id>.json (PII stripped)
      generate -> ~/Desktop/Laser Files/SaltyDog Queue/<id>/
                    <id>-tag<n>-front.lbrn2 / .svg, <id>-tag<n>-back.lbrn2 / .svg,
                    <id>-tag<n>-photo.<ext>, job.json
      state.jobs[id] = queued | manual | error
   for each existing job: sync remoteStatus; made|shipped|done remotely -> local done
UI (127.0.0.1:8150) -- Load --> lightburn.forceLoad(path) --UDP 19840--> LightBurn --19841--> "OK"
UI -- Mark engraved --> api.setStatus(id,"made") --> state done --> optional auto-load of next job
Operator frames and presses Start in LightBurn (or on the hardware start input). The service never does.
```

Data sensitivity:

| Crossing | Direction | Data | Sensitivity | Auth |
|---|---|---|---|---|
| Service to `/api/orders` GET | out, then in | All orders incl. customer name, email, phone, address | PII | Bearer admin key over TLS |
| Service to `/api/orders` POST | out | `{id, status:"made"}` | low | Bearer |
| Service to `/api/photo` | in | customer photo | PII (image) | Bearer |
| Service to LightBurn UDP | local loopback | command plus absolute file path | low | none (loopback) |
| Browser to service UI | local loopback | customer name, tag text, file names | PII (name) | none, but Host/Origin/header checks (section 10.4) |
| Job folder on Desktop | disk | name, tag text, photo | PII | macOS user account |

PII minimisation: `job.json`, `state.json`, and snapshots keep `customer.name` and `customer.delivery` only. Email, phone, address, and note are **not** persisted locally. `.lbrn2` Notes contain no customer name.

---

## 5. Shared layout module (`site/tag-layout.js`)

### 5.1 Contract

Write it as a classic script (no `import`/`export`) so it works from a `<script>` tag and from `require`:

```js
(function (root) {
  'use strict';
  const FONT_BASE = 'https://cdn.jsdelivr.net/gh/google/fonts@main/';
  const FONT_TTF = { /* moved verbatim from orders.html line 170 */ };
  const UPPER    = { /* line 171 */ };
  const ICONS    = { /* line 172 */ };
  const OUT      = { /* lines 174-178 */ };
  function widthMm(t) { /* line 179 verbatim */ }
  function fontKey(t) { return FONT_TTF[t.font] ? t.font : 'block'; }
  function hasOutline(shape) { return Object.prototype.hasOwnProperty.call(OUT, shape); }
  function layout(t, side, font) { /* section 5.2 */ }
  function svg(t, side, font) { /* returns the exact string lightburnSVG returned */ }
  const api = { VERSION: 1, FONT_BASE, FONT_TTF, UPPER, ICONS, OUT, widthMm, fontKey, hasOutline, layout, svg };
  root.SDTLayout = api;
  if (typeof module === 'object' && module && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
```

Rules:
- Constants and arithmetic are copied **character for character**. Do not reformat numbers, reorder keys, or "fix" anything. `widthMm` ignoring `size` is preserved (see open question Q2).
- `layout()` takes an already-parsed opentype `Font`. Font loading stays in each consumer.
- `svg()` must return exactly what the current `lightburnSVG()` returns, including the comment line and whitespace.
- No package.json may be added at the repo root or in `site/` with `"type":"module"`, because that would break `require` of this `.js` file. Add a test that `require`s it successfully.

### 5.2 `layout(t, side, font)` return value

This replicates `orders.html` lines 183-192 exactly:

```js
{
  fk,                 // fontKey(t)
  o,                  // OUT[t.shape] || OUT.bone
  bb: [bx0,by0,bx1,by1], bw, bh,
  s,                  // widthMm(t)/bw  (mm per design unit, UNROUNDED)
  W, H,               // strings (bw*s).toFixed(2), (bh*s).toFixed(2)
  cx, cy, tw, th,
  lines: L,           // after filter(Boolean) and uppercase rule
  n, iconD,           // ICONS[t.icon] or null (front only, icon != 'none')
  iconH, boxH,
  fs, fit,            // fs from the loop; fit = the fit predicate evaluated AT the final fs
  lh, top,
  textPaths: [ '...', ... ],      // font.getPath(l, cx-w/2, top+i*lh, fs).toPathData(2), one per line
  iconTx: '149.12', iconTy: '105.40', iconK: '0.9067'   // the exact strings placed in the SVG transform
}
```

`fit` is new and informational only. Compute it as `L.every(l => font.getAdvanceWidth(l, fs) <= tw) && n*fs*1.18 <= boxH` **after** the loop, and do not let it alter `fs`. When the loop bottoms out at `fs = 6` without fitting, `fit` is false and the text may overflow. The current code gives no signal for this case, and the service reports it as a warning.

### 5.3 Golden capture (do this FIRST, before editing `orders.html`)

`test/capture-golden.mjs`, run once:
1. Record `git rev-parse HEAD` as `sourceCommit`. Read `site/orders.html` via `git show <sourceCommit>:site/orders.html`, so the script still works after the refactor.
2. Slice the source from the line starting `const FONT_TTF=` up to, but not including, `function download(`. Fail loudly if either marker is missing.
3. Download the 5 TTFs to `laser/fonts/` (section 9.4). Build `fakeFetch(url)` that accepts only `FONT_BASE + FONT_TTF[k]` URLs and returns `{ arrayBuffer: () => localBytes }`.
4. Run the slice in `node:vm` with context `{ opentype: require('opentype.js'), fetch: fakeFetch }`, appending `;globalThis.__lightburnSVG = lightburnSVG;`.
5. For each fixture in `test/fixtures/tags.json` and each side that has lines, write `test/golden/<fixtureId>-<side>.svg`.
6. Write `test/golden/manifest.json`:

```json
{ "sourceCommit": "abc1234", "opentype": "1.3.4", "capturedAt": "2026-10-16T19:00:00Z",
  "fonts": { "block": "sha256:...", "bungee": "sha256:...", "script": "sha256:...", "slab": "sha256:...", "marker": "sha256:..." } }
```

Commit the goldens. They change only through a deliberate re-capture, and the commit message must say why.

### 5.4 `orders.html` edit (last implementation step, not deployed by Tollbooth)

- After line 13 (the opentype script), add `<script src="/tag-layout.js?v=1"></script>`.
- Replace lines 170-199 (from `const FONT_TTF=` through the end of `lightburnSVG`) with:

```js
const fontCache={};
async function loadFont(k){ if(fontCache[k]) return fontCache[k]; const buf=await (await fetch(SDTLayout.FONT_BASE+SDTLayout.FONT_TTF[k])).arrayBuffer(); return fontCache[k]=opentype.parse(buf); }
async function lightburnSVG(t, side){ const font=await loadFont(SDTLayout.fontKey(t)); return SDTLayout.svg(t, side, font); }
```

- Leave `download()`, the button handler, and everything else unchanged.
- Cache: `/tag-layout.js` is outside `/assets/*`, so the 7-day rule in `site/_headers` does not apply. Still bump `?v=` on every future change.
- Rollback: revert this commit and redeploy. The service is unaffected because it reads the repo file.

---

## 6. Geometry: SVG design space to LightBurn mm (Y up)

### 6.1 Coordinate systems

- **Design space (SVG):** units of the 320 x 240 design box, Y **down**. The tag occupies `bb = [bx0,by0,bx1,by1]`.
- **LightBurn space:** millimetres, Y **up**, origin at the bottom-left of the 200 x 200 galvo field. The tag is centred at `placeMm = [Px, Py]`, default `[100, 100]` (field centre, configurable; see Q3).

### 6.2 The transform

```
s  = widthMm(t) / bw            (unrounded; identical to layout().s)
mx = (bx0 + bx1) / 2
my = (by0 + by1) / 2

X = Px + (x - mx) * s
Y = Py - (y - my) * s           <- the Y flip, about the bbox centre

As an SVG-style affine [a b c d e f] (X = a*x + c*y + e, Y = b*x + d*y + f):
M_field = [ s, 0, 0, -s, Px - s*mx, Py + s*my ]
```

Icons are first mapped through their group transform, using the **rounded strings** from `layout()` so that the lbrn2 matches the SVG exactly:

```
k = Number(iconK), tx = Number(iconTx), ty = Number(iconTy)
M_icon  = [ k, 0, 0, k, tx, ty ]
M_total = M_field ∘ M_icon     ->  [ s*k, 0, 0, -s*k, s*tx + Px - s*mx, -s*ty + Py + s*my ]
```

Text paths and outlines use `M_field` directly. Text uses the `toPathData(2)` **strings** (already rounded), not opentype command objects, so the lbrn2 and SVG come from identical numbers.

Bake the transform into vertex coordinates. Every Shape gets `<XForm>1 0 0 1 0 0</XForm>`. Do not rely on LightBurn's XForm semantics.

### 6.3 Worked example (use as a unit test)

Bone, finish `black`: `widthMm = 38`, `bb = [40,50,280,210]`, `bw = 240`, `bh = 160`, `s = 0.158333...`, `mx = 160`, `my = 130`, `P = (100,100)`.
`M_field = [0.1583333, 0, 0, -0.1583333, 74.6666667, 120.5833333]`.

| Design point | LightBurn mm |
|---|---|
| outline start (82, 50) | (87.6500, 112.6667) |
| bbox left/right x = 40 / 280 | X = 81.0000 / 119.0000 (38.00 wide, centred on 100) |
| bbox top/bottom y = 50 / 210 | Y = 112.6667 / 87.3333 (25.33 tall, top has the larger Y) |
| paw icon point (12,13), with iconK 0.9067, iconTx 149.12, iconTy 105.40 | design (160.0004, 117.1871) -> (100.0001, 102.0287) |

### 6.4 Path to LightBurn subpaths (`geometry.toSubpaths(d, M)`)

1. `svgpath(d).abs().unarc().unshort()`, then `.iterate((seg, i, x, y) => ...)`, tracking the current point and subpath start yourself. Apply `M` to every point, including control points. Affine maps preserve bezier-ness.
2. Segment handling, where `prev` is the last vertex of the current subpath:
   - `M x y`: close any open subpath (step 3), then start a new subpath with vertex `{x,y}`.
   - `L x y`, `H x`, `V y`: push a new vertex, prim `L prev new`.
   - `C x1 y1 x2 y2 x y`: `prev.c0 = (x1,y1)`, new vertex with `c1 = (x2,y2)`, prim `B prev new`.
   - `Q qx qy x y`: degree-elevate with `c0 = P0 + 2/3*(Q-P0)` and `c1 = P + 2/3*(Q-P)`, then treat as `C`. Elevating before or after `M` gives the same result.
   - `Z`: close (step 3).
3. **Closing a subpath:**
   - If the last vertex equals vertex 0 within 1e-4 mm (and there is more than one vertex), drop the last vertex. Re-point the final prim to index 0, and move the dropped vertex's `c1` onto vertex 0 as its `c1`.
   - Otherwise append prim `L last 0`.
   - A subpath never closed by `Z` (the outlines and icons always close; open paths are unexpected) is emitted as-is with no closing prim, and a warning is logged.
4. Discard subpaths with fewer than 2 vertices.
5. Output: `[{ verts:[{x,y,c0?:{x,y},c1?:{x,y}}], prims:[{t:'L'|'B', a, b}] }]`. **One `<Shape Type="Path">` per subpath.** Nick's 2.1.03 files only ever contain one closed contour per Path shape, so stay inside that proven pattern.

Winding reverses under the Y flip. That does not matter for the fill (section 7.3).

### 6.5 Number formatting

`fmt(v) = String(Math.round(v * 1e4) / 1e4)`, with `-0` rendered as `0`. Values sit in roughly 50 to 150 mm, so exponent notation cannot occur. Precision is 0.1 µm.

---

## 7. lbrn2 writer (`lib/lbrn2.mjs`)

### 7.0 Photo tags (prototype, issue #3)

`node cli.mjs demo-photo [--photo file] [--dither mode] [--no-icon] [--load]` writes `SDT-PHOTO` (the standalone preview; real photo orders go through the poller as in 7.0.1): `-front.lbrn2` (feathered photo window, see 7.0.2; an ellipse with an optional icon to its right on blanks that have no cut-out), `-front-halftone.lbrn2` (same, LightBurn halftone dither, for comparison on scrap), `-back.lbrn2` (the builder's back lines through the normal shape-aware fit). The builder drops front text and the icon when a photo is on. The demo blank is the polished 48 mm bone, whose paw-shaped through-hole (layout v4: `OUT.bone.cut`, finish polished only; 8.9 mm paw centred 40.0 mm from the left end and 24.5 mm from the top, measured on `whisky-tag-real.jpg`, where app.js's older mask is 6 mm) is part of the blank in the shape-aware fit: 1.5 mm clearance for text and photo, text may slide left up to 12 mm, the hole is drawn on Tool layer 30. No engraved icon on such a blank. `POST /api/load` accepts an opt-in `verb: "LOADFILE"` (default stays FORCELOAD) and `/api/health` advertises `caps: ["load-verb"]`. The writer gains an opt-in `image` option: a `<CutSetting_Img type="Image">` layer (index 1) plus `<Shape Type="Bitmap" CutIndex="1" W H File="" SourceHash="0" Data="base64 PNG">` with `<XForm>sx 0 0 sy cx cy</XForm>`. Verified against a user-saved LightBurn 2.0.05 file and a LightBurn 2.1.04 load and re-save: `W = H = pixels / 2.835` (not mm), the XForm scale turns that into real mm, `Data` is an 8-bit grayscale PNG, the centre is in the same Y-up workspace mm as the Path shapes. LightBurn keeps these Image-layer fields: maxPower, maxPower2, speed, frequency, QPulseWidth, numPasses, interval, dpi, ditherMode, negative, angle, bidir, crossHatch, dotWidth, passThrough, halftoneAngle. It silently drops unknown ones (`negativeImage`, `overscan`, `enableLineAngle`, `scanAngle`). `layout()` takes `{ exclude: [{x0,y0,x1,y1}] }` (mm from the blank's top-left) and `SDTLayout.clearance(t)` exposes the 1.5 mm edge / 1.0 mm hole rule. `presets/photo-stainless.json` is UNTESTED.

### 7.0.1 Photo tags (issue #3 step 2)

The poller now generates photo tags with `buildPhotoTag()` (the demo's builder; `lib/photodemo.mjs`). In 8.2 the `t.photo === true` row is no longer unconditionally manual. After the photo is downloaded and saved as `<id>-tag<n>-photo.<ext>` (unchanged), the generator plans the window (`planPhotoWindow`), decodes the source with sharp (`analysePhoto`: pixel size after EXIF rotation, grayscale mean and stddev on 0-255) and applies `photoQuality({ wPx, hPx, stats, windowMm })` (`lib/photo.mjs`, pure):

| Gate | Result |
|---|---|
| the tag also has a colour accent (`color` icon or line) | manual: the same `Colour accent (...)` reason as a text tag, photo saved (the front is the photo only, so the paid accent cannot be made) |
| source px across the window below 150 dpi (cover-cropped to the window aspect) | manual: `Photo too small: <w> x <h> px, need at least <K> x <L> for this tag` |
| grayscale stddev below 18 | manual: `Photo is low contrast (stddev <n>). Lay it out by hand or ask for a better photo` |
| 150 to 250 dpi | warning `Photo is soft at this size` |
| mean below 60 or above 200 | warning `Photo is very dark; check the preview` / `very bright` |
| undecodable image | manual: `Photo could not be read ...` |
| no window fits the blank | manual: `No photo window fits this <shape> blank. Lay it out by hand.` |

The colour accent check runs first, then size, then contrast. Manual photo tags behave as before (photo saved, reason shown, `manualLines` for the text). Passing tags write `<id>-tag<n>-front.lbrn2`, `-front.svg`, `-front-halftone.lbrn2`, and (only when the tag has back text) `-back.lbrn2` and `-back.svg`; the entry is `mode: "auto"`, keeps `photo` as the saved file name, and gains `photoInfo { windowMm {w,h}, wPx, hPx, dpi, preset, presetStatus, layer, dither }`. `files` has the front, then `{ side: "front", variant: "halftone", lbrn2 }` (no svg), then the back. Front text and icon are dropped by the builder contract (a note says so). The Notes name the real order and tag; the halftone file is loadable through `/api/load` and the CLI but is never served by `/files/` (it is a laser file, and `.lbrn2` is not served).

### 7.0.2 Photo window (waist box, issue #3)

Superseded: the 22 x 16.3 mm ellipse. Edge margin for photos is `PHOTO_EDGE_MM` = 0.8 mm (text keeps 1.5; the hole keeps its 1.0 mm ring). Without an icon `planFront` returns the waist box `{ cx, cy, a, b, n: 4 }`: height = the vertical free extent (scanned in 0.05 mm steps with `SDTLayout.clearance(t, 0.8)`) at a column 5 mm left of the blank centre (6.5 to 25.5 = 19.0 mm on the 48 mm polished bone); width = height x clamp(source aspect, 1.0, 1.35), where the source aspect is the EXIF-rotated width / height (`planPhotoWindow(tag, aspect)`); centred horizontally on the blank, vertically on the extent. The box may be wider than the free width. `preparePhoto(bytes, { sizeMm, maskMm })` takes `maskMm(x, y)` in window-local mm and shows the photo only where it is true, then feathers the binary mask with a 0.3 mm blur (`.toColourspace('b-w')` before `.raw()`, else sharp returns 3 channels). The builder's mask is `|x/a|^n + |y/b|^n <= 1` AND `clearance(t, 0.8)`, so the lobes and the paw cut-out clip the picture and the hanging hole notches its top. With an icon (blanks without a cut-out) the plan stays the largest ellipse (n = 2) beside the icon, also at the 0.8 mm edge. The Notes line reads `window 20.9 x 19.0 mm, superellipse, 0.8 mm edge`. The LightBurn XForm maths (flipY, centre in Y-up mm) is unchanged and the SVG preview embeds the same PNG.

### 7.1 Exact skeleton

`{{...}}` are placeholders. Everything else is literal, and indentation is 4 spaces as LightBurn writes it. The `VariableText` and `UIPrefs` blocks are copied verbatim from lines 4-26 of `Thirsty Beaches Dog Tag - Color.lbrn2`. Store them as a constant in `lbrn2.mjs`, not by reading Nick's file at runtime.

```xml
<?xml version="1.0" encoding="UTF-8"?>
<LightBurnProject AppVersion="2.1.03" DeviceName="{{deviceName}}" FormatVersion="1" MaterialHeight="0" MirrorX="False" MirrorY="False" AskForSendName="True">
    <Thumbnail Source=""/>
    <VariableText>
        <Start Value="0"/>
        <End Value="999"/>
        <Current Value="0"/>
        <Increment Value="1"/>
        <AutoAdvance Value="0"/>
    </VariableText>
    <UIPrefs>
        <Optimize_ByLayer Value="0"/>
        <Optimize_ByGroup Value="-1"/>
        <Optimize_ByPriority Value="1"/>
        <Optimize_WhichDirection Value="0"/>
        <Optimize_InnerToOuter Value="1"/>
        <Optimize_ByDirection Value="0"/>
        <Optimize_ReduceTravel Value="1"/>
        <Optimize_HideBacklash Value="0"/>
        <Optimize_ReduceDirChanges Value="0"/>
        <Optimize_ChooseCorners Value="0"/>
        <Optimize_AllowReverse Value="1"/>
        <Optimize_RemoveOverlaps Value="0"/>
        <Optimize_OptimalEntryPoint Value="0"/>
        <Optimize_OverlapDist Value="0.025"/>
    </UIPrefs>
    <CutSetting type="Scan">
        <index Value="0"/>
        <name Value="{{layerName}}"/>
{{presetFieldLines}}
        <priority Value="0"/>
    </CutSetting>
    <CutSetting type="Tool">
        <index Value="30"/>
        <name Value="T1 - tag outline (no output)"/>
        <priority Value="1"/>
    </CutSetting>
{{toolShapes}}
{{scanShapes}}
    <Notes ShowOnLoad="0" Notes="{{notes}}"/>
</LightBurnProject>
```

- `deviceName`: from config, default `JCZFiber (USB-Lite)`. A mismatch may make LightBurn complain on load.
- `layerName`: `SDT <preset>` plus ` (UNTESTED)` when `preset.status === "untested"`, for example `SDT anodized (UNTESTED)`.
- `presetFieldLines`: one line per key of `preset.cutSetting`, in file order: `        <{{key}} Value="{{value}}"/>`.
- Each Shape:

```xml
    <Shape Type="Path" CutIndex="{{30 or 0}}">
        <XForm>1 0 0 1 0 0</XForm>
        <VertList>{{verts}}</VertList>
        <PrimList>{{prims}}</PrimList>
    </Shape>
```

- `verts`: for each vertex, `V{fmt x} {fmt y}`, then `c0x{fmt}c0y{fmt}` if it has `c0` else `c0x1`, then `c1x{fmt}c1y{fmt}` if it has `c1` else `c1x1`. Example: `V87.65 112.6667c0x88.1201c0y114.5503c1x1`.
- `prims`: concatenation of `${t}${a} ${b}` with no separator, for example `B0 1B1 2L2 3B3 0`.
- Omit `VertID`/`PrimID` (LightBurn's de-duplication ids). The July file omits them too. **Contingency:** if gate G1 shows LightBurn 2.1.03 needs them, add `VertID="{{n}}" PrimID="{{n}}"` with a unique sequential `n` per shape and re-test. Do not try other variations without reporting back.
- `notes`: XML-attribute-escaped. Newlines are encoded as `&#10;`. `ShowOnLoad="0"` is mandatory, because a Notes popup would be a modal dialog and would make `PING` fail.

```
SDT-7KQ2  tag 1 of 2  FRONT
Qty: 2  (run this file 2 times)
Blank: bone, black, 38.00 x 25.33 mm  (customer size: Medium 1.5")
Preset: anodized (UNTESTED - tune in LightBurn)
Font: block 14  Fit: ok
Generated 2026-10-16T18:04:11Z by sdt-laser 1.0.0
```

- Escape `& < > " '` in every attribute value. Customer text never appears in XML except inside Notes. Text is geometry, not a string.

### 7.2 Layers

| CutIndex | Type | Contents | Output |
|---|---|---|---|
| 30 | Tool (T1) | outline subpaths | never output (alignment only) |
| 0 | Scan | icon subpaths, then text subpaths (line order, glyph order) | engraves with preset |

### 7.3 Fill semantics

Do **not** write `scanOpt`. Absent means "fill all shapes at once", which applies even-odd fill across the layer and turns glyph counters into holes. `scanOpt="individual"` would fill counters solid, so `preset import` strips it (section 9.2).

Known risk: overlapping contours (connected script glyphs, or fonts whose static TTFs keep overlaps) render as **unfilled slivers** under even-odd. Today's SVG import into LightBurn has the identical behaviour, so parity is preserved. The service warns on every file using fonts `script` or `marker` (section 8.3). Manual gate G1 includes a preview check on `block` and `script`. If slivers show on `block`, report back to Hi-Tech, because the fix (a boolean union) is a design change.

### 7.4 Atomic file writes

Write each output as `<name>.tmp-<pid>`, fsync, then rename to the final name. LightBurn must never be able to load a half-written file.

---

## 8. Generation rules (`lib/generate.mjs`)

### 8.1 Eligibility (in `queue.mjs`)

An order is picked when **all** of these hold:
- `order.status === "paid"`. **Decision: `invoiced` orders, including pickup, do NOT qualify.** Rationale: engraving before payment wastes blanks on cancellations, and pickup timing gives no reason to start early. `gen <orderId>` is the manual override for any non-`cancelled` status and logs a warning when the order is not paid.
- `id` matches `/^SDT-[A-Z0-9]{4}$/`. Otherwise skip it, with WARN logged once per process. The id is used in file paths, so this is a security control.
- `Array.isArray(order.tags) && order.tags.length > 0`. Orders with only prints are skipped silently.
- `state.jobs[id]` does not exist.

Process eligible orders oldest `at` first.

### 8.2 Per tag entry (`i` = index into `order.tags`, `n = i + 1`)

Evaluate in this order. The first match decides the entry's mode:

| Condition | Mode | Files written | Manual reason text |
|---|---|---|---|
| `!SDTLayout.hasOutline(t.shape)` | manual | none | `No laser outline for shape "<shape>" yet. Lay it out by hand.` |
| `presetFor(t.finish)` undefined | manual | none | `Unknown finish "<finish>", no material preset.` |
| `t.photo === true` | auto when the photo passes the gates in 7.0.1; otherwise manual | photo download; lbrn2 + svg when auto | gate reason from 7.0.1 (on download failure: `Photo download failed (<code>). Use Regenerate to retry.`) |
| `t.color === "icon"` or `"line"` | manual | none | `Colour accent (<icon or short line / full line>, <hue>): needs colour-mark layers. Lay out by hand.` |
| otherwise | auto | see below | none |

For **auto** entries:
- **Front:** generate it when `front.filter(Boolean).length > 0`, or when `icon` is set and not `"none"`. If neither holds, write no front file and add an info note: `Front is blank.`
- **Back:** generate it only when `back.filter(Boolean).length > 0`. The icon is never placed on the back (this matches `orders.html`).
- Each generated side writes `<id>-tag<n>-<side>.lbrn2` and `<id>-tag<n>-<side>.svg`. The `.svg` is exactly `SDTLayout.svg(t, side, font)`. It serves as the UI preview, and as a fallback Nick can import at 1:1 the way he does today.

Photo download: `GET /api/photo?id=<id>&t=<i>` with Bearer and a 30 s timeout. Cap the body at 10 MB (abort above that). Map extension by content-type: `image/jpeg` to `jpg`, `image/png` to `png`, `image/webp` to `webp`, anything else to `bin`.

**Job mode:** `manual` if any entry is manual. Otherwise `queued`. Manual jobs still expose their auto files for loading, but they are **never auto-loaded**.

### 8.3 Warnings (per file; shown in the UI and job.json; never block)

| Code | Trigger | Text |
|---|---|---|
| `overflow` | `layout.fit === false` | `Text did not fit even at size 6. Check it in LightBurn before running.` |
| `missing-glyph` | for any non-whitespace char `ch` in the lines, `font.charToGlyphIndex(ch) === 0` | `"<ch>" is not in the <fk> font and will engrave as a box.` |
| `overlap-risk` | `fk` is `script` or `marker` | `Script letters can overlap; if the preview shows gaps, select the text and Weld.` |
| `untested-preset` | `preset.status === "untested"` | `Preset <name> is untested. Run a test tag first.` |

### 8.4 Output layout

```
~/Desktop/Laser Files/SaltyDog Queue/SDT-7KQ2/
  SDT-7KQ2-tag1-front.lbrn2
  SDT-7KQ2-tag1-front.svg
  SDT-7KQ2-tag1-back.lbrn2
  SDT-7KQ2-tag1-back.svg
  SDT-7KQ2-tag2-photo.jpg
  job.json
  old/20261016-181500/...        (only after a Regenerate; nothing is ever deleted)
```

Filenames derive **only** from the validated order id, the tag index, and the side. Customer text never reaches a path.

### 8.5 job.json

```json
{
  "schema": 1,
  "orderId": "SDT-7KQ2",
  "orderAt": 1760638800000,
  "generatedAt": "2026-10-16T18:04:11.000Z",
  "generator": "sdt-laser 1.0.0",
  "layoutVersion": 1,
  "customer": { "name": "Dana Price", "delivery": "ship" },
  "hasPrints": false,
  "printsSummary": [],
  "mode": "manual",
  "tags": [
    {
      "index": 0, "label": "tag1", "qty": 2,
      "shape": "bone", "size": "medium", "finish": "black", "font": "block", "icon": "paw",
      "mode": "auto", "manualReason": null,
      "preset": "anodized", "presetStatus": "untested",
      "blankMm": { "w": 38.0, "h": 25.33 },
      "files": [
        { "side": "front", "lbrn2": "SDT-7KQ2-tag1-front.lbrn2", "svg": "SDT-7KQ2-tag1-front.svg",
          "lines": ["REX", "CALL MY HUMAN", "555-0142"], "fontSize": 14, "fit": true,
          "warnings": [{ "code": "untested-preset", "text": "Preset anodized is untested. Run a test tag first." }] },
        { "side": "back", "lbrn2": "SDT-7KQ2-tag1-back.lbrn2", "svg": "SDT-7KQ2-tag1-back.svg",
          "lines": ["IF FOUND", "CALL 555-0142"], "fontSize": 16, "fit": true, "warnings": [] }
      ],
      "notes": []
    },
    {
      "index": 1, "label": "tag2", "qty": 1,
      "shape": "bone", "size": "medium", "finish": "stainless", "font": "block", "icon": "none",
      "mode": "manual", "manualReason": "Photo engraving: photo saved as SDT-7KQ2-tag2-photo.jpg. Lay out by hand.",
      "photo": "SDT-7KQ2-tag2-photo.jpg",
      "files": [], "notes": []
    }
  ]
}
```

The snapshot at `laser/data/orders/<id>.json` is the API order with `customer.email`, `customer.phone`, `customer.address`, `customer.note`, `checkout`, `payment`, `prize`, and `prizeCode` removed.

---

## 9. Configuration, presets, fonts, polling

### 9.1 config.json (committed defaults; `config.local.json` overrides any key, gitignored)

```json
{
  "apiBase": "https://saltydogtags.com",
  "adminKeyFile": "../.admin-key",
  "queueRoot": "~/Desktop/Laser Files/SaltyDog Queue",
  "pollSeconds": 60,
  "kvPlan": "unknown",
  "eligibleStatuses": ["paid"],
  "ui": { "host": "127.0.0.1", "port": 8150 },
  "lightburn": { "host": "127.0.0.1", "cmdPort": 19840, "replyPort": 19841, "timeoutMs": 2000, "minLoadGapMs": 5000, "pingEverySeconds": 30 },
  "autoLoad": "after-engraved",
  "deviceName": "JCZFiber (USB-Lite)",
  "placeMm": [100, 100],
  "finishPreset": {
    "black": "anodized", "red": "anodized", "royal": "anodized", "sky": "anodized", "green": "anodized",
    "yellow": "anodized", "silver": "anodized", "pink": "anodized", "hotpink": "anodized",
    "stainless": "stainless", "ssblack": "stainless", "navy": "stainless", "gold": "stainless",
    "bronze": "stainless", "rainbow": "stainless",
    "polished": "polished",
    "brass": "brass"
  }
}
```

Validation at startup (exit 1 with a clear message on failure):
- `ui.host` must be `127.0.0.1`.
- `placeMm` must be within 0 to 200.
- Every `finishPreset` value must exist as `presets/<name>.json`.
- The admin key file must exist and be 32 chars after trim.
- `eligibleStatuses` must be a subset of `["paid","invoiced"]`.

Resolve `adminKeyFile` relative to `laser/`. Read the key once, trim it, and keep it in memory only. Warn if the file mode is group- or world-readable.

### 9.2 Presets

Preset file format (`presets/<name>.json`):

```json
{
  "name": "stainless",
  "label": "Stainless deep black",
  "status": "untested",
  "source": "seed: whisky_bone_tag.lbrn2 'Deep black' layer (LightBurn 1.7.03, July 2026)",
  "updatedAt": "2026-10-16",
  "cutSetting": {
    "maxPower": 32,
    "speed": 150,
    "interval": 0.008,
    "frequency": 900000,
    "QPulseWidth": 6,
    "numPasses": 2,
    "crossHatch": 1
  }
}
```

Seed values. All have `"status": "untested"` and must be tuned in LightBurn.

| Preset | cutSetting | Provenance and caveat |
|---|---|---|
| `stainless` | above | Whisky file "Deep black". `minPower` dropped (2.1.03 galvo files do not write it). Confirm `crossHatch` is recognised at gate G1. |
| `polished` | identical to `stainless`; label "Polished stainless (same as stainless until tuned)" | Separate file so it can be tuned independently |
| `brass` | identical to `stainless`; label "Brass (stainless seed)" | No brass reference file exists |
| `anodized` | `{ "maxPower": 70, "maxPower2": 20, "speed": 800, "frequency": 50000, "QPulseWidth": 250, "interval": 0.02 }` | Colour file layer C01. That layer is a **colour mark on stainless**, not anodized aluminium, so this is the least trustworthy seed and should get a test grid before the first real order. |

Validation:
- `cutSetting` keys must match `/^[A-Za-z][A-Za-z0-9_]*$/` and must not be one of the reserved keys `index`, `name`, `priority`, `scanOpt`, `tabCount`, `tabCountMax`.
- Values must be finite numbers or strings of 64 characters or fewer.
- `status` must be `untested` or `tuned`.
- Presets are read fresh for each generation, so no restart is needed after an import.

**`node cli.mjs preset import <file.lbrn2> <name> [--layer <index>]`:**
1. `<name>` must match `/^[a-z][a-z0-9-]{1,30}$/`. If it is not referenced by `finishPreset`, warn "preset will not be used until mapped".
2. Read the file (must end `.lbrn2` and be 50 MB or less). Remove every `<SubLayer ...>...</SubLayer>` block and warn "sub-layers ignored" if any were removed.
3. Select the first `<CutSetting type="Scan">...</CutSetting>` block, or the one whose `<index Value="N"/>` equals `--layer`. If there is none, exit 1 with "no Scan layer found".
4. Extract direct `<(\w+) Value="([^"]*)"/>` pairs and XML-unescape the values. Numeric strings (`/^-?\d+(\.\d+)?$/`) become numbers. Drop reserved keys. If `scanOpt` was present and not `mergeAll`, warn "scanOpt=<v> dropped; fills use fill-all-at-once so letter holes stay open".
5. If `presets/<name>.json` exists, **move** it to `presets/history/<name>-<YYYYMMDD-HHMMSS>.json`.
6. Write the new preset with `status: "tuned"`, `source: "imported from <basename> layer <index> (<AppVersion>)"`, and `updatedAt`. Print a key-by-key diff, old to new.

### 9.3 Polling and the KV budget guard

- Use a `setTimeout` chain, never `setInterval`. There is never more than one poll in flight.
- `GET {apiBase}/api/orders` with `Authorization: Bearer <key>` and a 15 s timeout (`AbortSignal.timeout`). Validate that `Array.isArray(body.orders)`.
- **Effective interval:**

```
base = config.pollSeconds
if kvPlan in ("free", "unknown"):
    base = max(base, 180)                                   # lists: 480/day, leaves headroom for orders.html and other workers
    readsPerDay = lastOrderCount * 86400 / base
    if readsPerDay > 50000: base = ceil(lastOrderCount * 86400 / 50000)
interval = base * 2^consecutiveFailures, capped at 900 s
```

- At startup, and whenever the interval changes, log this line and show it in the UI header:
  `KV budget: plan=<p>, interval=<s>s, ~<lists>/day lists, ~<reads>/day reads (free limits 1,000 lists / 100,000 reads per account)`.
- `kvPlan: "paid"` removes the floor and runs at the approved 60 s. **Nick sets this once he confirms the plan (Q1).** The free limits are per Cloudflare **account**, and Thirsty Beaches shares the account.
- Cost trajectory on Paid: reads equal orders x 1,440 per day. At 1,000 stored orders that is about 43 M reads a month, roughly $16 a month. The structural fix is a server-side paid-queue index, filed as a follow-up issue (section 16).

### 9.4 Fonts

- `fonts.mjs` downloads `FONT_BASE + FONT_TTF[k]` for all 5 keys on first need, saves them as `laser/fonts/<k>.ttf`, and computes sha256.
- If `test/golden/manifest.json` hashes differ from the cached files, log WARN `fonts changed upstream since goldens were captured`. The parity test then fails, which is intended.
- A download failure makes the affected job `error` with `fonts unavailable: <msg>`, which is retried per section 9.5.
- Parse with `opentype.parse(buffer)` and cache in memory.

---

### 9.5 Job state machine (`state.json`)

```json
{
  "schema": 1,
  "createdAt": "2026-10-16T18:00:00Z",
  "lastPoll": { "at": "2026-10-16T18:04:00Z", "ok": true, "error": null, "orderCount": 41, "intervalS": 180 },
  "lastLoaded": { "orderId": "SDT-7KQ2", "file": "SDT-7KQ2-tag1-front.lbrn2", "at": "2026-10-16T18:05:02Z" },
  "jobs": {
    "SDT-7KQ2": {
      "status": "loaded",
      "demo": false,
      "orderAt": 1760638800000,
      "customerName": "Dana Price",
      "remoteStatus": "paid",
      "remoteMissing": false,
      "dir": "/Users/nick/Desktop/Laser Files/SaltyDog Queue/SDT-7KQ2",
      "attempts": 1,
      "error": null,
      "createdAt": "2026-10-16T18:04:11Z",
      "updatedAt": "2026-10-16T18:05:02Z",
      "doneSource": null
    }
  }
}
```

| From | Event | To | Side effects |
|---|---|---|---|
| (none) | eligible, generation ok, no manual entries | `queued` | files, job.json, snapshot |
| (none) | eligible, generation ok, any manual entry | `manual` | same, plus photo download |
| (none) | generation threw | `error` | `error` message, `attempts += 1` |
| `error` | next poll, `attempts < 3` | re-generate (same rules) | |
| `queued` | a FORCELOAD of any of its files returns `OK` | `loaded` | `lastLoaded` updated |
| `manual` | a FORCELOAD of its file returns `OK` | stays `manual` | `lastLoaded` updated |
| `queued`, `loaded`, `manual`, `error` | Mark engraved, and POST `made` returns 200 (demo: no POST) | `done` | `doneSource: "ui"`; auto-load (section 10.3) |
| `queued`, `loaded`, `manual`, `error` | poll sees remote `made`, `shipped`, or `done` | `done` | `doneSource: "remote"` |
| any | Regenerate or `gen` | `queued` / `manual` / `error` | old files moved to `old/<ts>/`; `attempts = 0` |
| any | poll sees remote `cancelled` | unchanged | `remoteStatus = "cancelled"`, red banner, excluded from auto-load |
| any | order absent from API list (non-demo) | unchanged | `remoteMissing = true`, banner |

- `done` jobs are never picked again automatically. Remote `made` is the second idempotency guard: even with a lost `state.json`, engraved orders are not regenerated.
- **Corrupt `state.json` at load:** move it to `state.corrupt-<ts>.json`, try `state.json.bak`, and if that also fails, start empty. Log WARN in each case. Starting empty is safe because only remote-`paid` orders get regenerated and existing files are moved, not overwritten.
- **Save:** copy the current file to `state.json.bak`, write `state.json.tmp-<pid>`, fsync, then rename over `state.json`. Serialise all saves through a single promise chain. Serialise per-order operations through a per-id promise chain, so a poll and a UI Regenerate cannot interleave on one order.

---

## 10. LightBurn handoff

### 10.1 UDP client (`lib/lightburn.mjs`)

- One `dgram` udp4 socket, bound to `127.0.0.1:<replyPort>` (19841), exclusive. It sends to `127.0.0.1:<cmdPort>` (19840). Replies arrive on 19841, so **only one process may own this socket**, which is why the CLI routes through the daemon (section 11.1).
- `send(cmd)`:
  - Throws `Error('START is forbidden')` if `/^\s*START/i.test(cmd)` (R1).
  - Commands are serialised through a mutex. Before sending, discard any queued stale datagrams.
  - Send UTF-8 bytes with no trailing newline. Resolve with the first reply, trimmed of whitespace and NULs, or `'TIMEOUT'` after `timeoutMs` (2000).
  - Return values: `'OK' | '!' | '?' | 'TIMEOUT' | <other string>`.
- `ping()` sends `PING`, and the result is `up = (reply === 'OK')`.
- `status()` sends `STATUS`, where `OK` means connected and idle, and `!` means busy or not connected.
- `forceLoad(absPath)`:
  1. Validate `absPath`: absolute, `path.resolve(absPath)` starts with `queueRoot + path.sep`, ends `.lbrn2`, contains no `\n`, `\r`, or `\0`, and exists.
  2. Rate limit (R3): if `now - lastForceLoadAt < minLoadGapMs`, return `{ok:false, code:'RATE_LIMITED', retryAfterMs}` without sending.
  3. `ping()`. If not up, return `{ok:false, code:'LB_DOWN'}`.
  4. Set `lastForceLoadAt = now`, then send `FORCELOAD:<absPath>`. The path contains spaces, which is fine: it goes in a UDP payload, never a shell.
  5. Reply handling: `OK` succeeds. `!` returns `{ok:false, code:'LB_REFUSED'}`. `?` returns `{ok:false, code:'LB_INVALID'}` and logs ERROR (that would be a bug). `TIMEOUT` returns `{ok:false, code:'LB_TIMEOUT'}`.
  6. On `OK`: wait 1000 ms, then `ping()`. If that is not OK, attach the warning `LightBurn is showing a dialog after loading. Check the LightBurn window.` (a load error or a version prompt).
- There is **no generic `send` exposed** over HTTP or CLI. Only `ping`, `status`, and `forceLoad`.
- `EADDRINUSE` on 19841: the client enters a `disabled` state with UI banner `UDP reply port 19841 busy`, and retries the bind every 60 s.
- Background `ping()` runs every `pingEverySeconds` (30) to keep the UI status fresh. It is skipped while another command is in flight.

### 10.2 Manual load (UI button or CLI `load`)

`status()` runs first. If it returns `!`, the UI shows a confirm dialog: `LightBurn reports the laser busy or not connected. Load anyway?` The CLI requires `--force`. Then `forceLoad`.

### 10.3 Auto-load policy

The setting is `autoLoad: "off" | "after-engraved" | "always"`, default **`after-engraved`**.

Why this default: `FORCELOAD` discards unsaved LightBurn work without a prompt. Loading automatically when a new order arrives could silently destroy a design Nick is editing. `after-engraved` only loads right after the operator clicks Mark engraved, when the open document is a finished job file.

When the trigger fires:
1. Pick the oldest `queued` job (not `manual`, not `error`, `remoteStatus !== 'cancelled'`).
2. Require `ping()` OK **and** `status()` OK.
3. `forceLoad` its first file (tag1 front, or the first file present).
4. If any condition fails, do nothing. The job stays `queued`, and the UI says why.

`always` additionally triggers after a poll generates a new job, but only if no job is `loaded`. Document it in the README as risky.

### 10.4 HTTP server (`lib/http.mjs`)

Use `node:http` bound to `127.0.0.1:8150`. If `EADDRINUSE`, log "another instance is running" and **exit 0**, so launchd `KeepAlive.SuccessfulExit=false` does not loop.

Request guards (security; flag for Scarlett):
- The `Host` header must be exactly `127.0.0.1:8150` or `localhost:8150`. Anything else gets 403. This defends against DNS rebinding.
- Every `POST` must carry `Content-Type: application/json` and `X-SDT-Laser: 1`. The custom header forces a CORS preflight, which the server never answers with CORS headers, so a malicious web page cannot forge requests (CSRF).
- If an `Origin` header is present it must be `http://127.0.0.1:8150` or `http://localhost:8150`.
- JSON bodies are capped at 10 KB.
- No CORS headers are ever sent.
- Responses carry `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, and `X-Frame-Options: DENY`.

| Method and path | Body | Response |
|---|---|---|
| `GET /` | | `ui/index.html` |
| `GET /api/health` | | `{ok, version, uptimeS, lastPoll, lightburn:{up, status, checkedAt, disabled}, counts:{queued,loaded,manual,error,done}, queueWritable, kv:{plan, intervalS, listsPerDay, readsPerDay}}` |
| `GET /api/jobs` | | `{jobs:[JobView], lastLoaded, lightburn, lastPoll, kv, banners:[string]}`. JobView = state entry plus parsed `job.json`, minus `dir`. Includes the last 20 `done` jobs. |
| `GET /files/<orderId>/<name>` | | Previews and photos only; see "File route rules" below |
| `POST /api/load` | `{orderId, file}` or `{path, force?}` (CLI) | `{ok, code?, reply?, warning?, retryAfterMs?}`. HTTP status: 200 on ok, 409 for LB_DOWN/LB_REFUSED/LB_TIMEOUT, 429 for RATE_LIMITED, 400 for validation. |
| `POST /api/reveal` | `{orderId, file?}` | `execFile('/usr/bin/open', ['-R', abs])` with no shell; the path is validated inside `queueRoot` |
| `POST /api/engraved` | `{orderId, confirmPrints?: true}` | If the order `hasPrints` and `confirmPrints` is not true, returns 409 `{code:'HAS_PRINTS', prints:[...]}`. Otherwise it POSTs made (skipped for demo jobs), sets the job `done`, and runs auto-load. `{ok, autoLoaded?: {orderId, file, ok, code}}` |
| `POST /api/regenerate` | `{orderId}` | Re-fetches the order from the API (falls back to the snapshot if the API is down, with a warning) and regenerates |
| `POST /api/poll` | `{}` | Runs one poll now; returns `{ok, picked:[ids]}` |
| `POST /api/ping` | `{}` | `{up, status}` |
| `POST /api/demo` | `{load?: bool}` | section 11.2 |

File route rules for `GET /files/<orderId>/<name>`:
- `orderId` must match `/^SDT-[A-Z0-9]{4}$/`.
- `name` must match one of:
  - `/^SDT-[A-Z0-9]{4}-tag\d{1,2}-(front|back)\.svg$/`
  - `/^SDT-[A-Z0-9]{4}-tag\d{1,2}-photo\.(jpg|png|webp)$/`
- The name's id prefix must equal `orderId`.
- The resolved path must start with `queueRoot + sep`.
- Content-type is set by extension (`image/svg+xml`, `image/jpeg`, `image/png`, `image/webp`).
- Serve SVGs with `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'`, because they are generated, not user-supplied, but still loaded as documents if opened directly.

### 10.5 UI (`ui/index.html`)

This is one file with inline CSS and JS and no external assets. It refreshes `GET /api/jobs` every 5 s and sends POSTs with the two required headers. All customer and tag text is inserted with `textContent` (or an `esc()` helper). Never put API data into `innerHTML` unescaped.

Layout:
- **Header:**
  - LightBurn pill: green "LightBurn ready", amber "Laser busy / not connected" (STATUS `!`), or red "LightBurn not responding (closed, or a dialog is open)".
  - Last poll time and result, plus the KV budget line.
  - A "Poll now" button.
  - Banners: admin key rejected, queue folder not writable, UDP port busy, cancelled orders, and so on.
- **Open jobs** (queued, loaded, manual, error), oldest first. Each order card shows:
  - Header line: order id, customer name, order date, status pill, and remote status if it is not `paid`. A **MANUAL** badge and an **ERROR** badge with the message appear when applicable.
  - Buttons: **Reveal in Finder** (folder), **Mark engraved**, and **Regenerate**. Mark engraved opens a confirm dialog listing print items when the order has prints, then retries with `confirmPrints: true`.
  - One row per tag entry: preview `<img src="/files/...svg">` (or the photo thumbnail), `Tag 1 · bone · black · 38.00 x 25.33 mm · block + paw · Qty 2 · preset anodized (UNTESTED)`. The qty is large and bold.
  - Per file: a **Load in LightBurn** button and a **Reveal** button. The file currently loaded (`lastLoaded`) is highlighted "In LightBurn now".
  - Warnings and the manual reason appear in amber text under the row.
- **Done:** a collapsed list of the last 20.
- Toasts show results such as `Loaded SDT-7KQ2 tag1 front`, `Wait 3 s between loads`, or `LightBurn refused the file (!)`.

---

## 11. CLI (`cli.mjs`)

### 11.1 Routing rule

Every command except `preset import` first calls `GET http://127.0.0.1:8150/api/health` with a 500 ms timeout.
- **Daemon up:** call the matching HTTP endpoint, sending the required headers.
- **Daemon down:** take `laser/.lock` (O_EXCL; stale if the stored pid is not alive, checked with `process.kill(pid, 0)` throwing `ESRCH`), run in-process, and release the lock.

This keeps exactly one owner of `state.json`, UDP port 19841, and the FORCELOAD rate limiter. The daemon holds the same lock for its lifetime.

| Command | Behaviour | Exit codes |
|---|---|---|
| `node cli.mjs once` | One poll and generate. Never auto-loads in local mode. Prints picked ids. | 0 ok, 3 API error |
| `node cli.mjs gen <orderId>` | Validates the id, fetches the order (any status except `cancelled`; warns if not `paid`), and regenerates. | 0, 1 bad id or cancelled, 3 API |
| `node cli.mjs load <file> [--force]` | Path rules from 10.1, then manual load (10.2) | 0, 1 validation, 2 LightBurn down, refused, or timeout |
| `node cli.mjs ping` | Prints `LightBurn: OK` or `LightBurn: not responding`, plus `Laser: idle` or `Laser: busy/not connected` | 0 up, 2 down |
| `node cli.mjs preset import <file> <name> [--layer N]` | Section 9.2. Always local; no lock needed. | 0, 1 |
| `node cli.mjs demo [--load]` | Section 11.2 | 0, 2 if `--load` fails |

### 11.2 Demo

`demo` loads `test/fixtures/demo-orders.json` and generates both orders through the **same** `generate` path, with `fetchPhoto` stubbed to return a tiny bundled JPEG (`test/fixtures/demo-photo.jpg`, 1 KB or less). It never calls the API. State entries get `demo: true`. Mark engraved on demo jobs does not POST. Remote sync ignores demo jobs.

Demo ids contain the letter `O`, which is not in the order-id alphabet, so they can never collide with a real order:
- **`SDT-DEMO`** (status `queued`): tag1 bone/black/block/paw with qty 2 and front plus back; tag2 heart/red/script with no icon, qty 1, front only.
- **`SDT-OOPS`** (status `manual`): tag1 stainless photo tag with back text `CALL 555-0100`; tag2 hydrant (no outline); tag3 stainless with colour `line`/`gold`; plus one print item (exercises the Mark engraved prints confirm).

Per 8.2, a photo entry writes **no** lbrn2 for either side, including its back. The photo is saved, and the back text is listed in the UI so Nick can lay it out.

Running `demo` twice regenerates (moving the old files to `old/`). It is idempotent apart from the archive.

---

## 12. launchd (`com.saltydogtags.laser.plist`)

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.saltydogtags.laser</string>
  <key>ProgramArguments</key>
  <array>
    <string>/Users/nick/.local/bin/node</string>
    <string>/Users/nick/Clover API TB/saltydogtags/laser/server.mjs</string>
  </array>
  <key>WorkingDirectory</key><string>/Users/nick/Clover API TB/saltydogtags/laser</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>ThrottleInterval</key><integer>30</integer>
  <key>StandardOutPath</key><string>/Users/nick/Clover API TB/saltydogtags/laser/logs/launchd.out.log</string>
  <key>StandardErrorPath</key><string>/Users/nick/Clover API TB/saltydogtags/laser/logs/launchd.err.log</string>
</dict>
</plist>
```

- Use the absolute node path, because launchd's PATH does not include `~/.local/bin`. `server.mjs` creates `logs/` before anything else. Note that launchd opens the Std* paths itself, so `logs/` must exist before the first `bootstrap`; the README install step runs `mkdir -p laser/logs`.
- Application logging goes to `logs/laser.log` through `log.mjs`, one line per event: `2026-10-16T18:04:11.012Z INFO poll ok orders=41 picked=1 interval=180s`. Rotate at 5 MB to `laser.log.1`.
- **macOS privacy (TCC):** a launchd agent writing to `~/Desktop` needs Desktop-folder permission for the node binary. Without it, writes fail with `EPERM`, often without any prompt.
  - At startup, and before each generation, the daemon writes `queueRoot/.write-probe.tmp` and renames it to `queueRoot/.write-probe`. This probe is the only file the service writes in `queueRoot` outside the job folders.
  - On failure it sets `queueWritable:false`, shows the banner `Cannot write to the queue folder. Grant node access to Desktop (README, step 3).`, and does **not** pick orders, so nothing is marked as generated when it was not.
  - Grant **Files and Folders > Desktop** to the resolved binary (`realpath ~/.local/bin/node`), **not Full Disk Access**. FDA on node would extend to every node script on the Mac. This is a Scarlett item (Q6).

---

## 13. `laser/README.md` (Tollbooth writes; required sections)

1. **What it does** (5 lines), and the rule that the service never presses Start: you frame and start in LightBurn.
2. **Install:**
   - `cd laser && ~/.local/bin/node ~/.local/bin/npm ci`, then `mkdir -p logs`.
   - First-run demo: `node cli.mjs demo`.
   - Copy the plist to `~/Library/LaunchAgents/`.
   - `launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.saltydogtags.laser.plist`.
   - Grant Desktop access (TCC). Open http://127.0.0.1:8150.
3. **Desktop permission** (TCC) step by step, with the `realpath` command.
4. **Start, stop, and restart:**
   - `launchctl bootout gui/$(id -u)/com.saltydogtags.laser`
   - `launchctl kickstart -k gui/$(id -u)/com.saltydogtags.laser`
   - `launchctl print gui/$(id -u)/com.saltydogtags.laser`
5. **Where files go:** the queue folder layout (8.4), the `old/` archive, and that nothing is ever deleted (clean up by hand).
6. **Daily workflow:**
   - Open the queue page, then Load the file.
   - In LightBurn: check the outline over the blank, frame, and press Start; repeat for the qty.
   - Load the back side, then Mark engraved.
7. **Presets and tuning:**
   - Use LightBurn's Material Test on a scrap blank.
   - Save the winning settings in a `.lbrn2`.
   - Run `node cli.mjs preset import <file> <name>`; the history is kept in `presets/history/`.
   - Explain UNTESTED.
8. **What "manual" means:** the table in 8.2, in plain words, and what to do for each reason.
9. **Auto-load settings** and the FORCELOAD caveat.
10. **KV plan setting** (`kvPlan`) and why the poll is 180 s until set.
11. **Troubleshooting:** each banner text, its cause, and the fix, plus where the logs are.

---

## 14. Failure modes

| # | Failure | Likelihood | Severity | Detection | Mitigation |
|---|---|---|---|---|---|
| F1 | KV free-tier list/read limit exceeded by polling, so order intake and the admin page fail until 00:00 UTC | **High** at 60 s on free | **Critical** (storefront) | KV budget log line | Budget guard 9.3, Q1, follow-up index endpoint |
| F2 | LightBurn 2.1.03 rejects the generated XML (Tool layer, missing VertID) | Medium | High | Gate G1, post-load PING warning | Contingency in 7.1; stop and report if it still fails |
| F3 | Geometry drifts from orders.html | Low with the shared module | High (mis-sized engraving) | Parity test 15.1 | Shared module plus goldens |
| F4 | FORCELOAD discards unsaved LightBurn work | Medium with auto-load | Medium | none | `after-engraved` default, manual loads are explicit |
| F5 | Load while the laser is running | Low | High | STATUS `!` | Auto-load requires STATUS OK; manual load needs confirm/`--force` |
| F6 | Text overflow, missing glyphs | Medium (customer text) | Medium (ruined blank) | Warnings 8.3 | Shown in UI and Notes before running |
| F7 | Overlap slivers under even-odd fill | Medium (script) | Medium | G1 preview, `overlap-risk` warning | Weld in LightBurn; boolean union is a future design item |
| F8 | API down, 5xx, or timeout | Medium | Low | lastPoll, banner | Exponential backoff to 900 s; no state change |
| F9 | Admin key rotated | Low | Medium | 401, banner | Backoff 900 s; README says update `.admin-key` and restart |
| F10 | TCC denies Desktop writes | High on first install | High (silent) | Write probe | Banner; no picks until fixed |
| F11 | `state.json` corrupt or lost | Low | Low | Parse error | `.bak` fallback; remote `made` guard prevents remakes |
| F12 | Two writers (CLI plus daemon) | Medium | Medium | Lock | CLI routes through daemon HTTP (11.1) |
| F13 | Upstream font change (`@main`) | Low | Medium | Hash mismatch WARN, parity failure | Pin to a commit SHA (Q9) |
| F14 | Local web page forges POST to 8150 | Low | Medium (marks orders made) | none | Host/Origin/custom-header guards 10.4 |
| F15 | Order cancelled after generation | Low | Low | remoteStatus sync | Banner; excluded from auto-load |
| F16 | Mark engraved while 3D prints are still open | Medium | Low | `hasPrints` | 409 + confirm |

---

## 15. Tests (node:test; `npm test` from `laser/`)

### 15.1 Automated

| File | Asserts |
|---|---|
| `parity.test.mjs` | **(b)** For every fixture and side: `SDTLayout.svg(t, side, font) === readFile(golden)`, with byte equality. Font hashes equal `manifest.json`. `require('../../site/tag-layout.js')` works. |
| `geometry.test.mjs` | Worked example 6.3 to within 1e-4. Q-to-C elevation on a known quad. Arc outline (round) closes. Paw outline yields 5 subpaths. The closing merge moves `c1` to vertex 0. For each fixture: the bbox of the Tool-layer geometry equals `[Px - W/2, Py - H/2, Px + W/2, Py + H/2]` within 0.05 mm. Compute that bbox by **sampling** every segment at t = 0, 0.01, ..., 1, because the unarc segment endpoints do not land on the curve extremes. |
| `lbrn2.test.mjs` | **(a, automated half)** Generated files pass `/usr/bin/xmllint --noout` (skip with a message if xmllint is absent). Exactly one Scan CutSetting at index 0 and one Tool at index 30. Every Shape has CutIndex 0 or 30. No `scanOpt`. `ShowOnLoad="0"`. VertList matches `/^(V-?[\d.]+ -?[\d.]+(c0x1|c0x-?[\d.]+c0y-?[\d.]+)(c1x1|c1x-?[\d.]+c1y-?[\d.]+))+$/`. PrimList matches `/^([LB]\d+ \d+)+$/`. Prim indices are within range. XML escaping of `& < > " '` in Notes and the layer name. |
| `generate.test.mjs` | Every row of the 8.2 table, plus blank front, back-only, and photo download error. Filenames never contain customer text. job.json matches the 8.5 shape. Regenerate moves files to `old/<ts>/` and deletes nothing (compare directory listings before and after). |
| `presets.test.mjs` | Import from the colour file picks C01 values. `scanOpt` is stripped with a warning. SubLayer is stripped. Reserved keys are dropped. The previous preset is moved to history. A bad name is rejected. |
| `state.test.mjs` | Every transition row in 9.5. Atomic write: a simulated crash between write and rename leaves the old file valid. Corrupt-file recovery path. |
| `http.test.mjs` | Bad Host gets 403. A POST without `X-SDT-Laser` gets 403. A foreign Origin gets 403. Path traversal on `/files/` (`..%2F`, absolute, wrong extension) gets 404. Body over 10 KB gets 413. No `Access-Control-*` headers are present. |
| `lightburn.test.mjs` | Uses a mock LightBurn on random ports (configurable `cmdPort`/`replyPort`). `send('START')` and `send(' start:...')` throw, and the mock receives nothing. The rate limiter returns RATE_LIMITED for a second load within 5 s. TIMEOUT after 2 s with no reply. `!` maps to LB_REFUSED. A path outside queueRoot is rejected before sending. |
| `kv.test.mjs` | Interval math in 9.3 for free/unknown/paid, at order counts of 10, 100, and 500, and with backoff. |

### 15.2 Fixtures (`test/fixtures/tags.json`)

These 12 fixtures cover all 5 outline shapes, all 5 fonts, all 8 icons, every `widthMm` branch, overflow, and blank front. Use the stored-order tag shape (flat, `qty` inside).

| id | shape | finish | font | icon | front | back |
|---|---|---|---|---|---|---|
| f01 | bone | black | block | paw | REX / CALL MY HUMAN / 555-0142 | IF FOUND / CALL 555-0142 |
| f02 | bone | polished | slab | none | WHISKY / YES I LICK MY OWN JUNK | |
| f03 | heart | red | script | heart | Lulu / Princess of naps | |
| f04 | round | black | bungee | star | MAX | |
| f05 | round | brass | marker | none | Biscuit / call mom | 555-0199 |
| f06 | round | sky | block | anchor | A / B / C / D | |
| f07 | military | stainless | block | skull | BRUNO / 12 MAIN ST / LEHI UT / 555-0123 | |
| f08 | military | navy | slab | bolt | ZOOMIES | |
| f09 | paw | pink | block | crown | QUEEN | |
| f10 | bone | green | block | none | SUPERCALIFRAGILISTICEXPIALIDOCIOUS DOG | |
| f11 | bone | black | block | none | (empty) | IF FOUND / I AM LOST / 555-0100 |
| f12 | heart | hotpink | bungee | bone | (empty) | GOOD / BOY / 555-0111 |

`f10` must produce `fit:false` and the `overflow` warning. `f11` must produce no front file. `f12` must produce a front file containing the icon only.

### 15.3 Manual gates (documented in README; Flint runs them)

- **G1 (a): LightBurn opens the file.**
  - With LightBurn 2.1.03 open on the JCZFiber device, run `node cli.mjs demo --load`, then load each `SDT-DEMO` file from the UI.
  - Pass when:
    - no error or version dialog appears;
    - the Layers panel shows `C00 SDT anodized (UNTESTED)` (Scan) and `T1`;
    - the outline is on T1 and is excluded from Preview;
    - the selected outline's W x H equals job.json `blankMm` within 0.05 mm and sits centred at (100, 100);
    - Preview (Alt+P) shows text counters (the R and A in "REX", "CALL") open, not filled;
    - Notes open via the menu, not as a popup;
    - File > Save works;
    - the stainless preset shows cross-hatch on (`crossHatch` recognised) when loading the f07 file generated through `gen`.
  - Record any failure verbatim and **stop**: report to Hi-Tech before trying fixes beyond 7.1's contingency.
- **G2 (c): UDP round trip.** With LightBurn open, `node cli.mjs ping` prints `LightBurn: OK` and exits 0. Close LightBurn, and it prints `not responding` and exits 2. Open any LightBurn dialog (for example Settings), and it prints `not responding`.
- **G3 (d): Demo end to end.**
  - `demo` creates both folders.
  - The UI shows `SDT-DEMO` queued with qty 2 prominent, and `SDT-OOPS` manual with all three reasons and the photo thumbnail.
  - Load works, and the "In LightBurn now" highlight moves.
  - A second Load within 5 s shows the wait toast.
  - Mark engraved on `SDT-OOPS` shows the prints confirm.
  - Mark engraved on `SDT-DEMO` sets it done with no network POST (verify in the log) and, with `autoLoad: after-engraved`, attempts to load the next queued job.
  - Regenerate archives to `old/`.
- **G4: Browser parity spot check.** On live `orders.html` (before and after the 5.4 deploy), download the LightBurn SVG for a real order's tag and diff it against the service's `.svg` for the same order. They must be identical.

---

## 16. Implementation order (each step ends green before the next)

1. Scaffold `laser/` (package.json, .gitignore, config.json, `npm ci`).
2. `capture-golden.mjs`, then commit the goldens from the unmodified `orders.html`.
3. `site/tag-layout.js`, then the parity test passes.
4. `geometry.mjs` and `lbrn2.mjs` with their tests.
5. `presets.mjs` and its seeds, then `generate.mjs` and the demo path. **Run gate G1 now. Stop if it fails.**
6. `lightburn.mjs`, then CLI `ping`/`load`, then gate G2.
7. `state.mjs`, `lock.mjs`, `api.mjs`, `queue.mjs`, `http.mjs`, `ui/index.html`, `server.mjs`, `cli.mjs`.
8. The plist and README, then gate G3.
9. The `orders.html` edit (5.4). Commit it separately. **Do not deploy.**
10. Hand off to Flint with the test output and the G1 to G3 results.

Follow-up issues to file (not this issue):
- A server-side paid-queue index (`GET /api/orders?status=paid` backed by an index key maintained on status change), to remove the per-poll full scan.
- Pin `FONT_BASE` to a google/fonts commit SHA.
- Colour-mark auto-layers.
- Outlines for hydrant/fish/cat/star/house.

## 17. Rollback

- **Service:** `launchctl bootout gui/$(id -u)/com.saltydogtags.laser` and remove the plist from `~/Library/LaunchAgents`. Nothing remote changed except orders explicitly marked `made`, which are reversible on `/orders.html`. Queue files stay on the Desktop.
- **Site:** revert the 5.4 commit and redeploy. `site/tag-layout.js` can stay deployed harmlessly.
- **Presets:** restore from `presets/history/`.

## 18. Acceptance criteria (Definition of Done)

1. `npm test` passes on the laser Mac with LightBurn closed (the live UDP tests are manual).
2. Gates G1, G2, and G3 pass and are recorded in the PR description.
3. Hard rules R1 to R6 are each covered by a named test, or for R5 by the config validation.
4. A paid order placed on the live site (Nick's own $12 test) appears in the UI within one poll interval, generates the correct files, loads into LightBurn from the UI, and Mark engraved flips it to `made` on `/orders.html`.
5. `laser/README.md` covers every section in 13.
6. There are no dependencies beyond `opentype.js@1.3.4` and `svgpath@2.6.0`.
7. No existing file other than `site/orders.html` (5.4) is modified.

## 19. Assumptions

- A1. LightBurn 2.1.03 accepts `type="Tool"` index 30 and Path shapes without `VertID`/`PrimID` (verified only in a 1.7.03-era file; this is gate G1).
- A2. LightBurn's default Scan fill is fill-all-at-once even-odd when `scanOpt` is absent.
- A3. Blanks are one physical size per shape and finish, so ignoring `size` is correct (Q2).
- A4. The galvo field is 200 x 200 with origin bottom-left, and tags are placed at its centre (Q3).
- A5. The LightBurn UDP listener is always on (there is no toggle in prefs). The UDP reply goes to port 19841 on loopback.
- A6. The npm build of opentype.js 1.3.4 produces the same `toPathData(2)` output as the cdnjs build (gate G4 confirms).

## 20. Open questions for Nick

- **Q1 (blocking for the 60 s interval):** is the Cloudflare account on Workers Paid? On free, 60 s polling breaks KV for the whole account within a day. Until answered, the service runs at 180 s or more.
- **Q2:** the laser width ignores the customer's size choice (Small 1" to XL 2.5"). Is that right because each shape and finish only comes in one blank size?
- **Q3:** centre tags at field centre (100, 100), or do you use a jig at a fixed offset?
- **Q4:** for colour-accent tags, would a black-only base file (with the accent element still to be moved to a colour layer) save you time? The current spec writes nothing, per the approved architecture.
- **Q5:** the PVD-coated stainless finishes (ssblack, navy, gold, bronze, rainbow) share the `stainless` preset. They likely need their own once tuned.
- **Q6:** grant node Desktop-folder access (recommended), or move the queue out of `~/Desktop`?
- **Q7:** auto-load default `after-engraved`. OK?
- **Q8:** for orders that also contain 3D prints, Mark engraved asks before setting `made`. OK?
- **Q9:** pin fonts to a google/fonts commit (follow-up)?
