# Salty Dog Tags — saltydogtags.com

Funny laser-engraved dog tags + small 3D prints. Sibling of Thirsty Beaches (same Cloudflare account, same fonts, daytime palette).

- `site/` — static site. `index.html` (shop + tag builder + order form), `orders.html` (owner admin, needs the admin key).
- `functions/api/` — Cloudflare Pages Functions. `order.js` takes customer orders into KV `ORDERS`; `orders.js` lists/updates them for the owner (Bearer `ADMIN_KEY`).
- Pricing lives in TWO places and must match: `functions/api/_lib.js` (`SIZES` $12/$14/$16/$18 for 1"/1.5"/2"/2.5" (anodized aluminum base), `PREMIUM` +$4 stainless/black/navy/gold/bronze/rainbow stainless and brass, +$6 polished, `COLOR_PRICE` +$4 icon / +$6 full line, `PHOTO_PRICE` +$14, `SHIP`, `FREE_OVER`, multi-tag discount) and `site/app.js` (`PRICES`). Shapes/finishes/dimensions mirror the blanks in `research/tag-blanks.md`. Print items + prices: `site/app.js` (`PRINTS`).

Deploy: `npx wrangler@4 pages deploy site --project-name salty-dog-tags`
Admin key: `npx wrangler@4 pages secret put ADMIN_KEY --project-name salty-dog-tags` (local copy in `.admin-key`, gitignored).
Orders page: https://saltydogtags.com/orders.html — paste the key once, it stays in that browser.

Payment flow (until Clover Hosted Checkout is enabled): customer submits → order lands in KV → owner opens orders page → "Copy for Clover" → Clover web dashboard → Virtual Terminal → Send Invoice → mark Invoiced → mark Paid when Clover says so → make → ship.

## Security settings (2026-11-15 review)

Set these as Pages secrets (`npx wrangler@4 pages secret put NAME --project-name salty-dog-tags`). None of them is committed anywhere.

| Name | Required | What it does |
|---|---|---|
| `PLAY_SECRET` | yes, for the Salty Maze prize codes | Signs the play tokens (`GET /api/scores`). 32+ random characters, NOT the same as `ADMIN_KEY`. Unset = no tokens, no codes (the leaderboard and game still load). |
| `IP_SALT` | yes | Salts the IP hash used for rate limits and the `ipHash` field on orders. 16+ random characters. Unset = orders store no `ipHash` and rate-limit counters fall back to an unsalted hash that expires within hours. |
| `CHECKOUT_LIVE` | no, default off | Set to `true` only after one real test payment works on Clover Hosted Checkout. Until then the page tells the invoice story ("Send my order. Nothing is charged now. Invoice by email.") and no checkout session is created. Having the Clover secrets alone no longer turns it on. |
| `PRIZE_DAILY_CAP` | no, default 150 | Most Maze upgrade codes handed out in a UTC day, site wide. Also capped at 2 per IP per day. |
| `ALLOWED_ORIGINS` | no | Extra exact origins (comma separated, scheme included) allowed to call the AI endpoints from a browser. Default list is saltydogtags.com, www, and local `wrangler pages dev`. There is no `*.pages.dev` wildcard. |

Other behaviors worth knowing:
- Maze prize codes: a token is single use, minted at most 20 times per hour per IP, and must be 45 s to 6 h old. A code redeemed at checkout writes a `prizeclaim:` key before photo storage or Clover run; "invalid" and "already used" show the same message; code guesses are limited to 12 per IP per hour.
- `POST /api/order` no longer accepts `prints` (client-supplied prices). Print and custom work is quoted by email.
- The Clover webhook records payments that arrive on cancelled or done orders (`latePayments` on the order) and pings the owner, ignores non-payment event types (refunds, voids), and flags an approved payment whose amount does not match the order total (it is not marked paid; the owner is pinged).
- `site/_routes.json` keeps `/assets/*`, `/feeds/*` and the root static files (CSS, JS, robots, sitemap, llms) off the Functions worker. HTML, `.md` and `/api/*` still run through it, so the Markdown feature keeps working.
- Admin and relay secret comparisons are constant time.

## Turning on card payments (Clover Hosted Checkout)

The code is live but dormant until the three Clover secrets exist AND `CHECKOUT_LIVE=true` is set (see Security settings). Until then every order goes the invoice route and the page says so.

1. Call Clover/Fiserv merchant support first: add ecommerce / card-not-present to the Thirsty Beaches account (MID MQKMTFBRXFP21) and mention the new product line.
2. Clover Web Dashboard → Account & Setup → Ecommerce → **Ecommerce API Tokens** → create a token for integration type **Hosted Checkout**. Copy the **private** key.
3. Same area → **Hosted Checkout** page settings: set redirect URLs
   - success: `https://saltydogtags.com/thanks.html?pay=ok` (the `?pay=ok` is what lets thanks.html say "Paid" and clear the saved cart; without it the page shows neutral thank-you copy)
   - failure and cancel: `https://saltydogtags.com/?pay=failed`
   - Webhook URL: `https://saltydogtags.com/api/clover-webhook` → Generate → Save → copy the **Signing Secret**.
   - If you make a custom page (logo/colors), copy its Page ID too.
4. Store them (each prompts for the value; paste, enter):
   ```
   npx wrangler@4 pages secret put CLOVER_ECOMM_TOKEN --project-name salty-dog-tags
   npx wrangler@4 pages secret put CLOVER_MERCHANT_ID --project-name salty-dog-tags     # MQKMTFBRXFP21
   npx wrangler@4 pages secret put CLOVER_WEBHOOK_SECRET --project-name salty-dog-tags
   npx wrangler@4 pages secret put CLOVER_PAGE_CONFIG --project-name salty-dog-tags      # optional Page ID
   npx wrangler@4 pages secret put TAX_RATE --project-name salty-dog-tags                # optional, default 7.45 (%) Lehi UT; applied to UT ship/pickup only
   ```
   No redeploy needed; secrets apply to the live deployment.
5. Test with a $12 tag to your own email. The order shows "card APPROVED" on /orders.html when the webhook lands.

Sandbox first? Set `CLOVER_API_BASE=https://apisandbox.dev.clover.com` plus sandbox token + test-merchant id on a preview deployment.

Flow with payments on: order saved → Clover checkout page (15-minute session) → webhook flips status to **paid** → owner engraves. "Something custom" (quote) items always fall back to the invoice route. A customer who bails can come back to `/?pay=failed` and get a fresh link (`/api/pay`, needs order id + the same email). The cart stays in the browser until thanks.html confirms payment, and for 24 hours the site offers "Finish paying" for the saved order (localStorage `sdt-last`) instead of creating a second order.

Ships from Lehi, Utah (owner, 2026-10-11). Utah sales tax on Utah-address and pickup orders; none collected out of state.

## "Your tag shipped" email (tag photo + tracking)

This keeps the Bulldog Promise line "before your tag ships, we send you a photo of the exact tag".

On /orders.html every open order has a **Ship it** box:

1. **Add tag photo**: snap the finished tag, or pick one from the library. The page shrinks it to about 1600px / 300 KB before upload. Photos are stored in KV under `photo:<id>:shipped`. There's no R2 bucket bound in `wrangler.toml`, so KV it is (capped at 700 KB). Bind an R2 bucket as `PHOTOS` and they go there automatically. Retake as many times as you like; each retake gets a new private link.
2. Type or paste the **USPS tracking** number if you have one (optional). Spaces are fine. A number scanned off the label with the `420<ZIP>` prefix gets cleaned up.
3. Leave **Send email** on and tap **Mark shipped**. The status changes to *shipped* with the time, no matter what happens to the email. The box then shows the photo, the tracking link, and either "Emailed …" or why the email didn't go out. **Resend email** sends it again (at most 5 per order, one per minute). Otherwise each order gets one shipped email.

The customer gets "Your tag shipped 🐾": the photo of their exact tag, the saying, the dog's name, a USPS tracking button, and the Promise. Replies go to hello@saltydogtags.com. The photo link (`/api/tag-photo/<order>/<random>`) can't be guessed, and nothing on the site lists those links.

Until email is set up, the box says **"Email not set up yet"** and Mark shipped still works. You can email the photo yourself.

### Turning on customer email (Resend, free tier is 3,000/month)

1. Sign up at https://resend.com (use hello@saltydogtags.com or your own email).
2. **Domains → Add domain** → `saltydogtags.com`. Pick region US East.
3. Resend shows 3 or 4 DNS records (an MX and a TXT for `send`, a TXT for `resend._domainkey`, maybe a DMARC TXT). In the **Cloudflare dashboard → saltydogtags.com → DNS → Records → Add record**, add each one exactly as shown. Type, Name and Content are all copy and paste. Set MX/TXT records to **DNS only** (grey cloud, which they are by default). These records only cover sending, so they don't change where your incoming email goes. Back in Resend, tap **Verify**. It's usually green within minutes, but it can take up to a day.
4. Resend → **API Keys → Create API key**, permission **Sending access**, domain saltydogtags.com. Copy it (it starts with `re_`). You only see it once.
5. Store it, plus the From line:
   ```
   npx wrangler@4 pages secret put RESEND_API_KEY --project-name salty-dog-tags
   npx wrangler@4 pages secret put EMAIL_FROM --project-name salty-dog-tags        # Salty Dog Tags <hello@saltydogtags.com>
   ```
   Optional:
   ```
   npx wrangler@4 pages secret put EMAIL_REPLY_TO --project-name salty-dog-tags     # default hello@saltydogtags.com
   npx wrangler@4 pages secret put EMAIL_ORDER_CONFIRM --project-name salty-dog-tags # "true" also sends "Your order is in" at checkout; default off
   ```
   Secrets apply to the live site; reload /orders.html and the "not set up" note is gone.
6. Test: place a $12 order with your own email, add a photo, enter a tracking number, tap Mark shipped. Check that the email arrives (look in spam the first time and mark it "not spam"). Then tap Resend once to see that works too.

If an email fails, the order shows the reason (for example "domain is not verified"). Fix it and tap **Send email**. Safety nets: at most 150 emails a day site-wide, and the optional order-confirm email goes to a given address at most 3 times a day.

## Thirsty Beaches relay (`/api/relay`)

The Thirsty Beaches workers (the station at station.thirstybeaches.com and tb-where) reuse two things this site already has, so no keys get copied anywhere:

- **Phone alerts**: the same Pushover / Twilio channels as order pings (`sendOwner` in `_notify.js`). Station daily report and site-down alerts, quote alerts and 24/72 h quote reminders arrive through them. ntfy is not used, same as order pings.
- **Clover Hosted Checkout**: the station's "Pay on my phone" and "Order ahead" checkouts are created with this site's `CLOVER_ECOMM_TOKEN` / `CLOVER_MERCHANT_ID` (the same merchant, MQKMTFBRXFP21). The customer comes back to the station's tracker, never to Salty Dog pages, and the Salty Dog page branding (`CLOVER_PAGE_CONFIG`) is not used on them.
- **"We're open" texts** (`kind:"sms"`): tb-where's "Tell the list we're open" sends one text to the Thirsty Beaches alert list through this site's Twilio number (`TWILIO_SID` / `TWILIO_TOKEN` / `TWILIO_FROM`). Hard caps: 500 numbers per call, 1 call per 10 minutes, 2000 numbers per UTC day, and the text must end with "Reply STOP to opt out"; anything else is refused. Off on the Thirsty Beaches side until its `BROADCAST_ENABLED` var is `"true"`. Before turning it on, Nick: the texts go out from the Salty Dog Tags Twilio number, so check that number's A2P 10DLC registration covers Thirsty Beaches marketing texts. Pages Functions on the Workers Free plan allow 50 outgoing requests per call, so more than ~45 numbers per send needs Workers Paid.

It is off (the URL answers 404) until the `RELAY_KEY` secret exists. Nothing to do by hand: run **Actions → "Set up relay key" → Run workflow** in the thirsty-beaches-website repo once. It makes a random key and stores it here and on both Workers. Running it again replaces the key everywhere (rotation); then run this repo's **Deploy site** workflow so the live site gets the new key (until then relay calls are refused and the Thirsty Beaches side falls back cleanly).

Order: run that workflow, then deploy this site (merging to main does it). **Pages secrets only reach the next deployment**, so the relay starts working with that deploy. After that, deploy the station and tb-where.

Check: `{"kind":"ping"}` with the key answers `{ok:true, pay, alerts}` (the setup workflow does this at the end).

Safety limits, all fixed in `functions/api/relay.js`: Bearer key checked in constant time; checkouts 1–30 lines, $0.01–$100 per line, qty 1–20, $200 total, return pages only on `https://station.thirstybeaches.com/`, and the station's merchant id must match; budgets of 120 checkouts and 60 alerts per hour (all callers together). Clover errors come back as a short code only, and the keys are never logged or returned.

Test: `node tests/relay.test.mjs` (no network).

## Smart QR tag (scan-to-find QR on the back)

Built from the ADR `shared/intel/2026-11-16-adr-smart-qr-tag.md`. A tag with the add-on carries a QR on the back that opens `saltydogtags.com/t/<id>`. The owner activates it with the code on the packing slip, and gets a text and an email when someone scans it, shares a location, or writes a message. The engraved phone number is still mandatory (a QR is useless with no signal).

**Nothing changes on the live site until you do step 1 and step 2.** Without the D1 database the builder hides the QR toggle and orders behave exactly as before.

| Piece | Where |
|---|---|
| QR geometry, eligibility, finish gates | `site/tag-qr.js` (vendored encoder: `site/vendor/qrcodegen.js`, MIT, license beside it) |
| Per-finish on/off flags (you flip these) | `site/tag-qr-finishes.json` |
| Database | D1 `sdt-tags`, schema in `migrations/0001_smart_tags.sql` (migrations only ever add) |
| Finder page | `functions/t/[id].js`, `site/t.js`, `site/t.css` |
| Scan, location, message | `functions/api/tag/{scan,location,message}.js` |
| Claim, sign-in, dashboard | `site/claim.html`, `site/my.html`, `functions/api/tag/claim.js`, `functions/api/auth/*`, `functions/api/my/[action].js` |
| Alerts | `functions/api/_tagnotify.js`, STOP webhook `functions/api/tag-sms-inbound.js` |
| Orders page tools | `site/orders-smart.js` (status column, Mint QR id, Scan check, Print slips), `functions/api/tags/*` |
| Scheduled jobs | `worker-sdt-tag-cron/` |
| Laser | `laser/lib/generate.mjs` (QR layer, manual gate), `laser/lib/qrmatrix.mjs`, `laser/presets/qr-*.json` |

### Smart QR tag: setup (you run these, in order)

All commands run from the repo root unless a folder is shown. `npx wrangler login` first if you have not.

**1. Create the database and connect it**
```
npx wrangler d1 create sdt-tags
```
Copy the `database_id` it prints. In `wrangler.toml` uncomment the `[[d1_databases]]` block and paste the id. Paste the same id into `worker-sdt-tag-cron/wrangler.toml`. Then create the tables:
```
npx wrangler d1 migrations apply sdt-tags --remote
```
(Add `--local` to try it on your machine first.) Check: `npx wrangler d1 execute sdt-tags --remote --command "select name from sqlite_master where type='table'"` lists tags, owners, contacts, scans, alerts, sessions, login_tokens, sms_codes, counters, meta.

**2. Secrets and settings for the Pages project** (each command asks for the value; none go in git)
```
openssl rand -base64 32                                  # make a TAG_CLAIM_KEY, then SAVE IT in Keychain
npx wrangler pages secret put TAG_CLAIM_KEY      --project-name salty-dog-tags
npx wrangler pages secret put RESEND_API_KEY     --project-name salty-dog-tags   # already set if customer email works
npx wrangler pages secret put TWILIO_SID         --project-name salty-dog-tags
npx wrangler pages secret put TWILIO_TOKEN       --project-name salty-dog-tags
npx wrangler pages secret put TAG_TWILIO_MSID    --project-name salty-dog-tags   # the new Messaging Service SID (MG...), see "Before the first text"
npx wrangler pages secret put IP_SALT            --project-name salty-dog-tags   # already set; needed for rate limits
```
Optional settings (use `pages secret put` for these too, so they work with `wrangler.toml` in charge):

| Name | Default | What it does |
|---|---|---|
| `SMS_ALERTS_ENABLED` | `true` | `false` stops every owner text; email keeps going |
| `SMART_ENABLED` | `true` | `false` hides the toggle and stops minting; existing finder pages keep working (the rollback switch) |
| `TAG_BASE_URL` | `HTTPS://SALTYDOGTAGS.COM/T/` | QR payload base, upper case. A future short domain goes here; tags already minted keep their stored payload |
| `EMAIL_REPLY_TO` | unset (no reply-to) | set to `hello@saltydogtags.com` only after Email Routing exists |
| `SMART_PLAN` | `free` | `annual` turns on `planAllows()` (texts and contact 2 need `paid_through`) |
| `PUSHOVER_TOKEN`, `PUSHOVER_USER` | already set | claim-lockout page to your phone |

Redeploy after changing secrets (push to `main`, or `npx wrangler pages deploy site --project-name salty-dog-tags --branch main`).

**3. Deploy the cron Worker** (retry failed alerts every 15 min; purge and canary daily)
```
cd worker-sdt-tag-cron
npx wrangler deploy
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put TWILIO_SID
npx wrangler secret put TWILIO_TOKEN
npx wrangler secret put TAG_TWILIO_MSID
npx wrangler secret put PUSHOVER_TOKEN
npx wrangler secret put PUSHOVER_USER
```
Check: `curl https://worker-sdt-tag-cron.<your-subdomain>.workers.dev/` returns `{"ok":true,"lastPurgeAt":...}` after the first daily run (the canary failing pushes your phone).

**4. Cloudflare dashboard clicks** (zone `saltydogtags.com`)
1. **Transform Rule (required):** Rules, Transform Rules, Rewrite URL, Create rule. Name `QR upper case path`. When: custom filter expression `starts_with(http.request.uri.path, "/T/")`. Then: Rewrite path, Dynamic, `concat("/t/", substring(http.request.uri.path, 3))`. Keep query string unchanged. Deploy. Why: the QR says `/T/` in capitals (that keeps it to one alphanumeric segment, which is what lets the code be small); the file system here ignores case so only `/t/` exists. Test: `curl -sI https://saltydogtags.com/T/CANARY0000` should show `x-sdt-finder: 1`. The daily canary checks this and pushes your phone if the rule is ever removed.
2. **WAF rate limit (recommended):** Security, WAF, Rate limiting rules. When URI path starts with `/api/tag/`, 60 requests per 1 minute per IP, action Block for 10 minutes.
3. **Email DNS for Resend:** add the SPF and DKIM records Resend shows for `saltydogtags.com` (Resend dashboard, Domains), so `alerts@saltydogtags.com` is accepted. `hello@` has no MX record yet: turn on Email Routing (Cloudflare, Email, Email Routing) and forward `hello@` to your inbox before setting `EMAIL_REPLY_TO`.
4. **Robots:** already handled (`Disallow: /t/`, `/my`, `/claim`).

### Before the first text (SMS is ON by default, so do this before the first order with a QR)

US carriers block unregistered business texting, so until this list is done, the texts fail (the alert engine logs the failure, marks the text failed, and the email still goes out, so nothing breaks, owners just get email only).

1. In Twilio: Messaging, Services, Create. Name `SDT owner alerts`. Use case "Notify my users". Copy the **Messaging Service SID** (`MG...`) into `TAG_TWILIO_MSID` (step 2 above). This is deliberately a different service from the Thirsty Beaches marketing number.
2. Register the **A2P 10DLC brand** (Twilio, Messaging, Regulatory Compliance, A2P 10DLC: sole proprietor or your business) and an **"Account notifications" campaign** for that service. Sample message to paste: `Whisky's tag was scanned Mon 2:42 PM. Never send money or read a code to a finder. Reply STOP to end alerts.` Opt-in: owner ticks a box with the consent text on saltydogtags.com/my (the text is `SMS_CONSENT_TEXT` in `functions/api/_tagsettings.js`). Alternative: **toll-free verification** for a toll-free number, which skips 10DLC but has its own form.
3. **Attach a number** to the Messaging Service (Sender Pool). Wait for the campaign to show Approved.
4. Set the **inbound webhook** on the service (Integration, "Send a webhook"): `https://saltydogtags.com/api/tag-sms-inbound`, HTTP POST. Leave Twilio's default STOP handling on. (The handler checks Twilio's signature with `TWILIO_TOKEN`.)
5. **Send one test alert to your own number:** claim a test tag (or use any claimed tag), on `/my` add your phone, tick the consent box, "Text me a code", confirm it, then "Send a test alert". You should get the text and the email. Then reply `STOP` and `START` from your phone and confirm `/my` shows the stop state.
6. Pages still **needs the legal pieces**: Lady Jaye's SMS terms and a "no forever claims" line in the ToS (see "Open items").

If you need texts off in a hurry: `npx wrangler pages secret put SMS_ALERTS_ENABLED --project-name salty-dog-tags` with `false` and redeploy.

### Owner runbook (daily use)

**The order flow.** Builder: the customer ticks "Scan-to-find QR on the back" (shown only when the blank, the finish, and their text can carry one). The server re-checks, mints a random 10 character id, and the order shows a QR badge. If D1 was down, the order is saved anyway and the card shows **Mint QR id**: tap it (safe to tap twice).

**Engraving.** `node laser/cli.mjs` flow is unchanged. A smart tag is auto-generated only when it has an id, its finish is switched `on`, AND its `qr-*` preset is tuned (see the matrix below). Anything else lands in **manual** with the reason. The QR is its own LightBurn layer (index 2, crosshatch) and the text is re-fitted around it. The orders page "LightBurn SVG" button also writes the QR group (`<g id="qr">`, exact mm, separate from `#engrave`).

**Mark engraved** in the laser UI sets the tags to `engraved`.

**Scan check (QC), required for every smart tag before it ships.** On the orders page tap **Scan check**: point the camera at the engraved tag (or "Check a photo"). The page decodes it and it must equal the tag's payload exactly. Then scan the tag once with the iPhone camera and open the link (that is the second check: the finder page's beacon marks `native_scan_seen_at`). Both done = **QC passed**. **Mark shipped** is blocked until every smart tag has passed (an override exists and is recorded on the order). If a tag fails: tap "Mark QC failed", re-engrave the SAME id on a new blank, destroy the bad one, check again.

**Packing slip.** Tap **Print slip** on the order: one page per smart tag with the dog name, the tag URL, the activation code, a claim QR, and 3 steps. Print at 100%. The code is derived from `TAG_CLAIM_KEY` and the tag id, never stored, so you can reprint it any time. The shipped email tells the customer to use the code on the slip (the code is never in the email, so gifts stay safe).

**Lost, stolen, or leaked code.** Disable a tag: set its row `status='disabled'` (`npx wrangler d1 execute sdt-tags --remote --command "update tags set status='disabled' where id='ABCDEFGHJK'"`): the finder page then shows the generic "call the number" page and nothing is delivered. To retire a printed code and let the owner claim again, bump `claim_ver` (`update tags set claim_ver = claim_ver + 1 where id='...'`) and reprint the slip. A cancelled order disables its tags automatically.

**Health.** `GET /api/tags/health` with your admin key: scans in 24 h, alerts sent/failed/capped per channel, last cron run, canary. Breaker polls this. `purgeStale: true` means the cron Worker has not purged in 48 h: check `npx wrangler tail worker-sdt-tag-cron`.

**Canary alert.** "Smart tag canary FAILED": the `/T/` Transform Rule is missing or the site is down. Restore the rule (step 4.1). Shipped QR codes do not work until you do.

**Lost `TAG_CLAIM_KEY`.** Restore it from Keychain. If it is truly gone, set a new key; every printed code stops working, so run `update tags set claim_ver = claim_ver + 1` and reprint slips for unclaimed tags (claimed tags are unaffected: owners sign in by email).

**Rollback / kill switch.** `SMART_ENABLED=false` (hides the toggle, stops minting). Existing finder pages keep working. Hawk's kill path (no new QRs, existing tags show a basic page) is the same switch. Migrations only add, so there is nothing to undo in the database.

**Privacy facts to keep true.** Finder location is collected only after a tap, a consent sheet, and the browser prompt; sent once; deleted after 30 days. No cookies, analytics, or IP geolocation on the finder page; a salted IP hash is kept 24 h for rate limits only. Scans, messages and locations purge at 30 days unless the owner pins them (max 20 per tag). Logs hold counts only.

### Laser test matrix (task 4, you run this)

1. `cd laser && node cli.mjs qr-matrix` writes 32 files to `<queue folder>/qr-matrix/` (add `--out <folder>` to choose): one per finish and polarity, each holding 10 test codes on a flat coupon (5 module sizes 0.35, 0.40, 0.45, 0.50, 0.60 mm, each at error correction M and Q), plus `INDEX.csv`.
2. For each finish you care about, engrave the `dark` file and the `inverse` file on a scrap of that finish. `dark` = the dark modules are engraved (steel, polished, brass, light anodized). `inverse` = the light modules and the quiet zone are engraved and the dark modules stay as the original surface (dark anodized, coated). The notes in each file say which code is which (row by row).
3. Tune the layer in LightBurn until it looks right, then save and import it as the preset: `node cli.mjs preset import <file>.lbrn2 qr-anodized --layer 2` (use `qr-stainless`, `qr-polished`, or `qr-brass` for the others). Layer 2 is the QR layer in every matrix file. That marks the preset tuned, which unlocks auto-generation.
4. Scan every code with 3 phones (a current iPhone, an iPhone 4+ years old, a mid-range Android) at 10 to 30 cm, indoors and in daylight. A finish passes when the smallest module size you will ship decodes on the first try on all three.
5. Edit `site/tag-qr-finishes.json`: set the finish to `"on"` (or back to `"test"`/`"off"`), commit, deploy. If the matrix says 0.40 mm is unreliable, raise `MODULE_MIN_MM` in `site/tag-qr.js` (one constant; the eligibility table recomputes). `QR_INSET_MM` (0.02 mm per edge) is the anneal-spread correction: tune it from the same test.

Default gates today: stainless, polished, black, royal, red, green are `on`; silver, sky, yellow, pink, hotpink, ssblack, navy, gold, bronze, brass are `test` (off until the matrix passes); rainbow and full color are `off`. Blanks 1.5 inch and up only (bone 38 and heart 38 get a two-line phone), the 1 inch round, the 33 mm paw and the 25/30 mm rounds stay phone-only.

### Local preview
`node tools/dev/smart-dev-server.mjs` serves the site and runs the real Functions in-process on `http://localhost:8799` with an in-memory D1 and KV. Every Resend, Twilio, Pushover and Clover call is captured (see `/__outbox`), never sent. That is how the 390 px screenshots in `shared/intel/2026-11-16-smart-tag-screens/` were made.

### Open items for other agents
- Lady Jaye: confirm geolocation handling (ADR 5.1); marketing opt-in wording (a placeholder is in `MARKETING_TEXT`, `functions/api/my/[action].js`); SMS terms text and the page it should live on (the consent text points at `/policies` and `/privacy` until then); ToS wording for how long the finder page is kept up. The add-on line "Scan-to-find QR, free alerts forever" is Nick's wording; Lady Jaye's note was to avoid "forever" claims (ADR 5.6).
- Scarlett and Tunnel Rat: ADR task 15.
