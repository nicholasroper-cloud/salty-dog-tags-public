# tools/

Static-site generators, one-off helpers and tests for saltydogtags.com. Node 22+, no dependencies.
`export PATH=$HOME/.local/bin:$PATH` first on this Mac (Node lives in ~/.local).

## The one command

```
npm run build      # runs every generator below, in order. Safe to run twice: the second run changes nothing.
npm test           # node --test 'tools/test/*.test.mjs'
```

Never hand-edit a generated page. Change the source listed here and rebuild.

## Generators (run order matters, `npm run build` already does it)

| # | Tool | Writes | Source of truth |
|---|------|--------|-----------------|
| 1 | `build-breeds.mjs` | `site/<breed>-dog-tags/index.html` (24) and `site/dog-tags-by-breed/index.html` | `tools/breeds/<slug>.json` (words), `tools/breeds/_hub.json` (hub), `tools/data/shape-fits.json` (the "Which shape fits your {breed}" block), `site/app.js` (sayings, prices, finishes) |
| 2 | `build-sayings.mjs` | `site/sayings/index.html` (the 181 clean sayings), `site/sayings/salty/` (18+, noindex, age gate), six theme pages, 30 single-saying pages | `site/app.js` SAYINGS, `tools/data/themes.json`, `tools/data/top-sayings.json`, `tools/out/sayings-count.json` |
| 3 | `build-pages.mjs` | `site/utah-dog-tags/`, `site/st-george-dog-tags/`, the three St. George guides (`site/guides/st-george-dog-license-rules/`, `st-george-dog-parks-and-trails/`, `desert-heat-dog-safety-st-george/`), `site/privacy/`, `site/policies/` | `tools/content/*.md`, `tools/data/utah.json`, `tools/data/st-george.json` (facts, FAQs, titles, license table, move switch), `tools/lib/local.mjs` |
| 3b | `build-ornament.mjs` | `site/ornament/index.html` (the Holiday Pet Photo Ornament page; the live part is `site/ornament.js`) | `PRICES.ornament`, `SHIP_FROM`, `ORNAMENT_CUTOFF`, `ORNAMENT_RAISED_INCLUDED` in `site/app.js` |
| 4 | `polish-pages.mjs` | edits in place: `site/guides/**`, `site/roast/`, `site/wall/`, `site/404.html`, `thanks.html`, `orders.html` (head furniture, fonts, share images, footer, wording) | `tools/lib/shell.mjs` |
| 5 | `build-merchant-feed.mjs` | `site/feeds/google-products.xml` (Google Merchant Center, one item per clean saying; `g:link` is the single-saying page when one exists, else the card `/sayings/#s-N`; price = the page price) | `lib/products.mjs` `sayingProduct()` |
| 6 | `build-sitemap.mjs` | `site/sitemap.xml` (walks `site/` for `index.html`, skips noindex pages, `/sayings/salty/`, `/wall/`, orders, thanks, 404; `lastmod` from git) | the pages themselves |

Not part of the build:

- `render-feed-images.py` draws `site/assets/feed/s<N>.jpg` (feed + single-saying Product images) and `b-<slug>.jpg` (breed Product images, from `tools/out/breed-images.json`). It only redraws images whose saying, shape or finish changed (`tools/out/image-sigs.json`). Needs Pillow and Poppins Bold: `SDT_FONT=/path/to/Poppins-Bold.ttf python3 tools/render-feed-images.py`. Run it after `npm run build` whenever a pick, a saying or a breed's first card changes; `npm test` fails if a Product or feed image is missing.

- `indexnow.mjs` POSTs the sitemap URLs to IndexNow (`--dry-run` prints the payload). Run it by hand after a deploy. The key file is `site/340e80e49fce4613a1997e1801402e13.txt`.
- `credit-jobs.mjs` and `photo-color/` are unrelated helpers.

Shared code is in `tools/lib/`: `appdata.mjs` (reads the tables out of `site/app.js`), `shell.mjs` (head, fonts, share-image tags, nav, footer, `jsonProduct()` with the shipping and return policy), `products.mjs` (the product a saying is sold as, and which breeds a single-saying page links back to), `cards.mjs` (deep links and shape picks), `tagsvg.mjs` (static tag preview), `md.mjs` (tiny Markdown).

## Facts the generators enforce

- Product JSON-LD: breed pages and single-saying pages carry one `Product` with one `Offer` (price = the price printed on that page, `url` = the page, USPS $4.50 US-only shipping with the $35 free threshold in the description, 1-2 handling days, 3-5 transit days, `MerchantReturnNotPermitted` with the free-remake note). Breed pages describe their first saying card; single-saying pages their own tag (sku `sdt-s<N>` = feed `g:id`). Never add AggregateRating or reviews without real ones.

- Saying counts come from `tools/out/sayings-count.json`; `lib/appdata.mjs` refuses to run if it disagrees with `app.js`.
- Breed saying cards link to the builder with that exact saying: `/#build?s=<index>&shape=&finish=` when the text exists verbatim in SAYINGS (case-insensitive, lines joined by a space), `/#build?t=line1|line2|line3&shape=&finish=` otherwise. The price on the card is the price of that shape and finish. Lines are 24 characters or fewer, three lines at most.
- Breed JSON cards may carry `"shape"` and `"finish"`; without them `lib/cards.mjs` picks deterministically from the breed's size variant (A tiny, B medium, C large, set in `breeds/<slug>.json` as `fit.variant`). The bulldog page has photographed cards (`"file"`) and keeps the pictured shapes. Alt text: `{color} {shape} {breed} dog tag engraved "{saying}"`.
- Add a breed: copy a `tools/breeds/*.json`, set `fit`, add the slug to `breeds/_hub.json`, add its share image (`python3 site/assets/og/make-og.py <slug>`), run `npm run build`.
- Add a theme or top saying: add the entry to `tools/data/themes.json` / `top-sayings.json` (indices are 0-based SAYINGS positions; 18+ indices fail the build).
- Cache busters (logo, `styles.css`) follow whatever `site/index.html` ships.
- Fonts: the home page keeps its seven families; every other page loads Bungee, Archivo, Archivo Black and DM Mono with the non-blocking pattern.
- `/sayings/` pages add one stylesheet, `site/sayings.css`. `site/styles.css` is not touched.
- Origin wording is "engraved in Lehi, Utah", shipping wording is "engraved and shipped in 1-2 business days, USPS 3-5 days in transit, US only". Pickup does not exist on any page (the owner admin page `orders.html` still shows legacy pickup orders).

`functions/api/_sayings.js` is hand maintained; no generator writes to `functions/`.

## St. George / Washington County set (2026-11-16)

One city page and three topic guides, not a page per town (towns are sections inside the guides). Every local fact (fees, deadlines,
dog limits, park names and addresses, leash and trail rules, heat figures) was read on the linked official page on the `checked` date
in `tools/data/st-george.json`; the page links it. Rules differ by city: never copy one city's rule into another city's section.
Re-check the sources before changing `checked` (St. George renewals are due February 28, and Hurricane's page carries 2026 dates).

- Words: `tools/content/st-george-intro.md`, `st-george-outro.md`, `guide-<slug>.md`. Lines that start with `<` pass through, so
  `<!--cta-->` (the in-article build button) and `<!--table:license-->` (the comparison table from `licenseTable`) are markers.
- Saying cards: `sayings` in `st-george.json` (forced `t=` builder links, like the Utah cards). Not in `SAYINGS`, so counts and the feed don't change.
- Links in: home page explore row (hand-edited), Utah page (`utah-outro.md` + related row), and three hand-written pages patched by
  `polish-pages.mjs` `SG_INSERTS` (guides hub, Utah license guide, Utah County parks guide).
- Share images: `python3 site/assets/og/make-og.py st-george st-george-dog-license-rules st-george-dog-parks-and-trails desert-heat-dog-safety-st-george`.
  Pass slugs: a no-argument run rewrites the README's hand-edited "Wire-up" line and re-describes `utah.jpg` (pre-existing drift).
- Tests: `tools/test/st-george.test.mjs`.

### Move day (Lehi to St. George, about mid-January 2027)

The switch for this set is `SHIP_FROM`: set it to `'St. George, UT'` in `site/app.js` **and** `functions/api/_lib.js`, then
`npm run build && python3 tools/build-agent-files.py && npm test`. The St. George page swaps `move.before` for `move.after`
(H1, description, origin and shipping lines, the "where are tags engraved" answer). Until then the pages say "moving to St. George
in early 2027" and "engraved in Lehi"; a test fails if any of them claims a St. George base, St. George engraving or pickup early.

The rest of the site's Lehi wording is not on that switch. Same day, change by hand (then rebuild): footer and legal line in
`tools/lib/shell.mjs` and `site/index.html` (plus its meta description and the two ship notes), `tools/data/utah.json` and
`tools/content/utah-*.md` (the Utah page becomes a statewide page from St. George), `tools/breeds/*.json`, `tools/data/themes.json`,
the feed text in `tools/build-merchant-feed.mjs`, `functions/api/_email.js`, `tools/content/policies.md` and `privacy.md`,
`tools/agent-config.json`, the "Engraved in Lehi" rule in `tools/polish-pages.mjs` and the origin rule above, and the home/Utah share
images (`make-og.py`, `FALLBACK_SUB`). Sales tax locality is an accounting change, not a wording one; check it before the first
St. George shipment. No page may offer pickup unless that is decided and built.

## Full color print + holiday ornament (xTool O1 Omni)

Everything Nick can change is a constant. Each lives in two places that a test keeps equal (`tools/test/fullcolor.test.mjs`):

| What | Server (`functions/api/_lib.js`) | Browser (`site/app.js`) |
|---|---|---|
| Full-color tag price per size | `FULLCOLOR_PRICE` (default 12/14/16/18, same as aluminum) | `PRICES.fullcolor` |
| Raised lettering upcharge | `RAISED_UPCHARGE_CENTS = 300` | `PRICES.raisedCents` |
| Ornament prices (cents) | `ORNAMENT_PRICE_CENTS` (2400 / 3600) | `PRICES.ornament` |
| **Ornament master switch** (off: no `/ornament/` page, no links on any page, server answers 400 to an ornament; all code stays) | `ORNAMENT_ENABLED = false` (env `ORNAMENTS_ON=true` turns the server side on for tests or staging) | `ORNAMENT_ENABLED` (and the build reads it: flip it and run `npm run build`) |
| Raised name and year included in the $24 tier | `ORNAMENT_RAISED_INCLUDED = true` (false = +$3) | `ORNAMENT_RAISED_INCLUDED` |
| Shapes sold in full color (every active shape: the O1 scans the placed blank and masks it) | `FULLCOLOR_SHAPES` | `FULLCOLOR_SHAPES` |
| Ship-from city | `SHIP_FROM` | `SHIP_FROM` |
| Christmas order cutoff (display only) | n/a | `ORNAMENT_CUTOFF` |
| Rights acknowledgment wording | `ART_ACK_TEXT` | `ART_ACK_TEXT` |

After changing a browser constant run `npm run build` (the ornament page and the nav bake in prices and dates) and `python3 tools/build-agent-files.py`.

- Prices are decided on the server only: `order.js` ignores any client price. The raised upcharge applies only to a `fullcolor` tag that sends `raised: true`.
- Uploads: raster 1.5 MB cap in the browser, 1.8 MB on the server; blocked under 150 px and warned under 300 px on the short side. SVG is sanitized server-side by `functions/api/_svg.js` (allow-list re-emit; scripts, foreignObject, animation, external references and DOCTYPE are removed or refused) before it is stored. An image is only accepted with `ack: true`, and the acknowledgment (`ack.ownRights`, `ack.at`) is stored on the order.
- Print files: orders page, per full-color item: `Print layout JSON`, `Print sheet`, `Art file`. Layout comes from `SDTLayout.fullcolorLayout()` in `site/tag-layout.js`; three layers (color, white, raised), every element carries `raised`.
- Claims: the full-color finish says only what has been tested. A test (`fullcolor.test.mjs`) fails on placeholder markers and on "wear-tested", "sealed", "protective rim" and "varnish" until the wear test has been done and the copy is reviewed.
- Uploads (Lady Jaye): every upload is checked by hand before the customer pays (`canPayOnline()` is false for an order with an image). Images are deleted after 120 days (`PHOTO_TTL_SECONDS`); the orders page has a Decline action that deletes the image at once and emails the customer. R2 has no per-object TTL: if `PHOTOS` is ever bound, add a 120-day lifecycle rule.

## Cloudflare (dashboard settings, not in this repo; Nick owns them)

Nothing here changes Cloudflare. As of 2026-11-15 these still need a decision in the dashboard: Scrape Shield Email Address Obfuscation is ON for the zone (it injects `email-decode.min.js` on every page; turning it off is the SEO-clean choice since the address is public anyway), Web Analytics is not enabled, and the www to apex 301 is a zone Redirect Rule (keep it; don't move it back into `_middleware.js`).
