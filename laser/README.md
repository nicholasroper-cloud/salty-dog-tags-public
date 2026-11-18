# Salty Dog Tags: order to LightBurn service

## 1. What it does

- Polls saltydogtags.com for **paid** orders every few minutes.
- For each tag on an order it writes ready-to-load LightBurn files (`.lbrn2`): one per side, outline on a no-output Tool layer (T1), text and icon on one Scan layer with a material preset.
- Shows the queue at **http://127.0.0.1:8150** with previews, quantities, warnings, and Load / Mark engraved buttons.
- Hands a file to LightBurn over its UDP port (19840).
- **It never presses Start.** You check the outline over the blank, frame, and press Start in LightBurn yourself. The code cannot send that command (a test greps the source for it).

Every preset is a **starting point**. Test on a scrap blank first (section 7).

## 2. Install

```sh
export PATH=$HOME/.local/bin:$PATH
cd "/Users/nick/Clover API TB/saltydogtags/laser"
npm ci
mkdir -p logs
node cli.mjs demo            # creates SDT-DEMO and SDT-OOPS in ~/SaltyDog Queue (no network, no LightBurn needed)
```

Then the background service (nothing here is done for you; the plist is not installed):

```sh
cp com.saltydogtags.laser.plist ~/Library/LaunchAgents/
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.saltydogtags.laser.plist
open http://127.0.0.1:8150
```

The service reads the admin key from `../.admin-key` (trimmed, never logged). To try it in the foreground first: `node server.mjs` (Ctrl-C to stop). Run `npm test` any time; it needs no LightBurn and no network.

## 3. Folder permission (TCC)

The default queue folder is **`~/SaltyDog Queue`** in your home folder, which macOS lets background programs write without any permission prompt. If you want it on the Desktop, make a Finder alias: select the folder, File > Make Alias, drag the alias to the Desktop.

Only if you change `queueDir` to a path under `~/Desktop` (or Documents): background programs need permission there and macOS often fails silently. Grant **Files and Folders > Desktop** to the real node binary (`realpath ~/.local/bin/node`), never Full Disk Access (that would extend to every node script on the Mac). The service tests this at startup and before each generation; if the folder is not writable it shows a banner and does not generate anything.

## 4. Start, stop, restart

```sh
launchctl bootout gui/$(id -u)/com.saltydogtags.laser            # stop and unload
launchctl kickstart -k gui/$(id -u)/com.saltydogtags.laser       # restart
launchctl print gui/$(id -u)/com.saltydogtags.laser              # status
```

Logs: `laser/logs/laser.log` (rotates at 5 MB), plus `launchd.out.log` / `launchd.err.log`.

Local overrides go in `laser/config.local.json` (git-ignored); any key from `config.json` can be overridden.

## 5. Where files go

```
~/SaltyDog Queue/SDT-7KQ2/
  SDT-7KQ2-tag1-front.lbrn2   (load this)      SDT-7KQ2-tag1-front.svg   (preview / 1:1 SVG import fallback)
  SDT-7KQ2-tag1-back.lbrn2    SDT-7KQ2-tag1-back.svg
  SDT-7KQ2-tag2-photo.jpg     (the customer's photo, always saved)
  SDT-7KQ2-tag2-front.lbrn2 / -front.svg / -front-halftone.lbrn2 / -back.lbrn2 / -back.svg
                              (photo tags that pass the quality gates; -front-halftone is the same front with LightBurn's
                               halftone dither, to compare on scrap; -back only when the tag has back text)
  job.json
  old/20261016-181500/...     (after a Regenerate)
```

**Photo tags (issue #3 step 2)** are generated like text tags: the front is the customer's photo (dithered Bitmap on image layer 1, preset `photo-stainless`, **UNTESTED**, nothing has been burned with it) and the back is the normal text layout. The photo window fills the waist of the bone (about 19 mm tall, as wide as the photo's shape allows up to 1.35:1, centred) and the hanging hole notches the top of the picture. The card shows the front preview, the back preview, a Load button for each (front, front halftone, back), and a line like `photo 22.0 x 16.3 mm, 347 x 257 px, stucki, preset photo-stainless (UNTESTED)`. Photos under 250 dpi at the window or very dark/bright get a warning on the card; see section 8 for what sends a photo to manual.

The service **never deletes job files** (the only file it ever unlinks is its own `.lock`). Regenerate moves the old files into `old/<timestamp>/`. Clean up by hand when you like. Only the customer name and delivery method are stored locally; email, phone, address, and notes are not.

Each file's LightBurn **Notes** (menu, not a popup) list the order, tag, **quantity** ("run this file N times"), blank size, the **customer's chosen size**, preset, font, and any warnings. The tag size on the blank follows the shape and finish (same as the orders page); the customer's size choice is shown for reference only.

## 6. Daily workflow

1. Open http://127.0.0.1:8150. New paid orders appear after the next poll (or press **Poll now**).
2. Click **Load in LightBurn** on a side. (It sends FORCELOAD: it replaces whatever is open without asking.)
3. In LightBurn: check the T1 outline over the blank, Frame, press **Start**. Repeat for the quantity shown in big blue type.
4. Load the other side if there is one, same routine.
5. Click **Mark engraved**. This sets the order to `made` on the website. If the order also has 3D prints you get a confirm first.

Tip: Alt+P (Preview) shows the letter holes (A, R, O) as open; if a script-font tag shows gaps, select the text in LightBurn and Weld.

## 7. Presets and tuning

Presets live in `presets/*.json` and map to finishes in `config.json` (`finishPreset`). **All four seeds are UNTESTED.** The layer is named `SDT anodized (UNTESTED)` etc. so you cannot forget. The anodized seed is the least trustworthy: it comes from a colour-mark layer on stainless.

To tune:
1. Use LightBurn's Material Test on a **scrap blank**.
2. Save the winning settings in any `.lbrn2` file (a Scan layer).
3. `node cli.mjs preset import ~/path/best.lbrn2 anodized` (add `--layer N` to pick a layer other than the first Scan layer).

The import marks the preset `tuned`, prints a before/after diff, and moves the previous version to `presets/history/`. Fill-mode overrides (`scanOpt`) and sub-layers are dropped on purpose so letter holes stay open. No restart needed. The PVD stainless finishes (navy, gold, bronze, rainbow, ssblack) currently share `stainless`; give them their own preset by importing under a new name and mapping it in `config.local.json`.

## 8. What "manual" means

A job is **manual** if any tag on it can't be made automatically. Its other tags still get files you can load. A manual job is never auto-loaded.

| Reason shown | Why | What you do |
|---|---|---|
| No laser outline for shape "hydrant" yet | Only bone, heart, round, military, and paw have outlines | Lay it out by hand; the text is shown on the card |
| Unknown finish "x", no material preset | Finish isn't in `finishPreset` | Add a mapping and Regenerate, or do it by hand |
| Colour accent (...) on a photo tag | A photo tag with a paid colour accent: the front is the photo only | Make it by hand (the photo is saved on the card) |
| Photo too small: N x M px, need at least K x L for this tag | The photo would land below 150 dpi at the window size | Ask for a bigger photo, or lay it out by hand (the saved photo and back text are on the card) |
| Photo is low contrast (stddev N) | Grayscale stddev under 18 (0-255); it would dither to a blob | Ask for a better photo, or lay it out by hand |
| Photo could not be read | The file is not a valid image | Ask for another photo |
| No photo window fits this ... blank | The shape is too small for a portrait | Lay it out by hand |
| Photo download failed (...) | The site didn't return the photo | Regenerate to retry |
| Colour accent (...) | Needs colour-mark layers | Lay it out by hand (the black base can't be auto-split) |
| Nothing to engrave on this tag | No text and no icon | Check the order |

## 9. Auto-load

Two separate behaviours, both using LightBurn's **LOADFILE** (it asks before discarding unsaved work), never FORCELOAD:

- `autoLoad` (default `true`): when a poll generates a new job, load it, but only if LightBurn answers, the laser is idle, and no other file was loaded in the last 5 seconds. Set `false` to turn off **all** auto-loading.
- `autoLoadAfterEngraved` (default `true`, needs `autoLoad: true`): after **Mark engraved**, load the next queued job.

The **Load in LightBurn** button and `node cli.mjs load` are explicit operator actions and use **FORCELOAD**, which replaces the open document with no prompt. If you keep unsaved designs in LightBurn, either turn `autoLoad` off or save before a new order is likely to arrive. Auto-load can swap the open file while you are framing a previous tag, so check the file name in LightBurn's title bar before pressing Start. Manual jobs and cancelled orders are never auto-loaded.

### Notifications (`notify`, default `true`)

When a job needs you the service posts a macOS notification (titled "Salty Dog Tags") through `/usr/bin/osascript`:

- a job was auto-loaded: `SDT-XXXX tag1 front loaded in LightBurn. Check outline, Frame, Start (qty N).`
- a new job was generated but not loaded, with the reason in a few words: `SDT-XXXX ready (manual: ...)`, `SDT-XXXX ready, LightBurn not responding`, `SDT-XXXX ready, auto-load is off`.
- generation failed: `SDT-XXXX failed to generate: ... (attempt N of 3)`.

A poll with nothing new, Regenerate, and the `demo` commands never notify. More than 5 new orders in one poll collapse into a summary line. Set `"notify": false` in `config.local.json` to silence it. If macOS shows nothing, allow notifications for **Script Editor** (osascript's host) in System Settings > Notifications. Tests never fire real notifications (`NODE_ENV=test`, and a no-op without an injected stub).

## 10. KV plan (`kvPlan`) and polling

`GET /api/orders` reads every order from Cloudflare KV. On the **free** Workers plan KV allows 1,000 list calls and 100,000 reads per day for the whole account (Thirsty Beaches shares it); hitting the limit breaks order intake. So the poll default is **300 s**, and with `kvPlan` `unknown` or `free` the service never polls faster than 180 s and stretches the interval as orders accumulate. The header shows the budget line.

When you confirm the account is on **Workers Paid**, put `{ "kvPlan": "paid", "pollSeconds": 60 }` in `config.local.json` and restart. (A server-side index of paid orders is follow-up issue #2.)

## 11. Troubleshooting

| Banner or symptom | Cause | Fix |
|---|---|---|
| Admin key rejected by the site | `.admin-key` is stale | Update `../.admin-key`, restart the service |
| Cannot write to the queue folder | Folder permission, or `queueDir` points somewhere unwritable | Section 3; check `queueDir` |
| UDP reply port 19841 busy | Another process (a second copy, or LightBurn tooling) owns the port | Quit it; the service retries every 60 s |
| LightBurn not responding (closed, or a dialog is open) | LightBurn is closed or showing a dialog (Settings, an error, a save prompt) | Close the dialog / open LightBurn |
| Laser busy / not connected | LightBurn STATUS says so (the laser may simply be unplugged) | Load asks for confirmation; use `--force` on the CLI |
| Wait N s between loads | One load per 5 seconds, by design | Wait |
| Order ... was cancelled | Cancelled on the website after generation | Don't engrave it |
| ERROR badge, `fonts unavailable` | Font download failed | Auto-retries on the next polls (3 attempts); then press Regenerate |
| "LightBurn is showing a dialog after loading" | LightBurn raised a prompt/error when loading | Look at the LightBurn window |
| "Another instance is running" in the log | Lock file held by a live process | Normal if the service is already up |

CLI: `node cli.mjs once | gen <SDT-XXXX> | load <file> [--force] | ping | demo [--load] | demo-photo [--photo f] [--dither m] [--no-icon] [--load] | preset import ...`. Real photo orders now generate automatically through the same builder. `demo-photo` is the issue #3 prototype (stainless bone photo tag: front photo, halftone variant, back text; uses `~/SaltyDog Queue/dog-photo.jpg` if present); it is a standalone preview and never queued. With the service running the CLI talks to it; otherwise it runs in-process. `demo --load` uses LOADFILE.

## Verification gates (manual; Flint runs them)

- **G1 LightBurn opens the file**: `node cli.mjs demo --load`, then check layers (`SDT anodized (UNTESTED)` Scan, `T1` Tool), the outline centred at (100, 100) with the W x H in job.json, Preview (Alt+P) letter holes open, Notes via the menu, File > Save works. Run `node cli.mjs gen` for a stainless order to see `crossHatch` recognised.
- **G2 UDP**: `node cli.mjs ping` prints `LightBurn: OK` (exit 0); with LightBurn closed or a dialog open, `not responding` (exit 2).
- **G3 demo end to end**: demo creates both folders; queue page shows SDT-DEMO queued (qty 2) and SDT-OOPS manual with three reasons and a photo thumbnail; Load moves the "In LightBurn now" highlight; a second Load inside 5 s shows the wait toast; Mark engraved on SDT-OOPS asks about prints; on SDT-DEMO it finishes with no network POST (see the log); Regenerate archives to `old/`. Mark both demo jobs engraved afterwards to clear them from the queue.
- **G4 browser parity**: on the live orders page, download a tag's LightBurn SVG and diff it with the service's `.svg` for the same order (identical once `tag-layout.js` is deployed).

## Known quirks

- The marker font URL in the old orders.html pointed at a path that 404s; the shared module uses the right one (`apache/permanentmarker`).
- **Text size** is decided per tag by fitting the real letter outlines against the real blank (`site/tag-layout.js`, layout v3): at least 1.5 mm from every edge (2.0 mm for the script font) and 1.0 mm from the hanging hole, largest size first, sliding the text block up or down within a small band. Letters are capped at size 26 (about 4 mm). Hole positions and sizes were measured from the blank photos in `site/assets/blanks`. A bone with an icon and three lines lands near 2.9 mm letters, three lines without the icon about 2.9 mm, military and round 4 to 4.7 mm. If the icon would squeeze the text below 2.5 mm it shrinks to 20% of the block. `npm test` runs `containment.test.mjs`, an independent exact check that every glyph and icon point of the fixtures and of worst cases (4 lines of 24 characters, all five fonts) stays inside the blank with that clearance, plus a size report. Text that cannot fit even at size 6 gets the `overflow` warning instead.
