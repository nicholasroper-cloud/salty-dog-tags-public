// Shared helpers for the Salty Dog Tags API (Cloudflare Pages Functions).
import { safeEqual, saltedIpHash } from './_security.js';
import { sanitizeSvg } from './_svg.js';
import { inspectRaster } from './_raster.js';
import { SAYINGS } from './_sayings.js';

export const json = (data, status = 200, extra = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra },
  });

export function isAdmin(request, env) {
  const h = request.headers.get('Authorization') || '';
  const token = h.startsWith('Bearer ') ? h.slice(7).trim() : '';
  return Boolean(env.ADMIN_KEY) && Boolean(token) && safeEqual(token, env.ADMIN_KEY);
}

// Short, unambiguous order ids: SDT-7K3Q
const ALPHA = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export function orderId() {
  const buf = new Uint8Array(4);
  crypto.getRandomValues(buf);
  return 'SDT-' + Array.from(buf, (b) => ALPHA[b % ALPHA.length]).join('');
}

export const str = (v, max) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);

// Checkout field rules. site/app.js mirrors these (EMAIL_RE, ADDR_MIN, US_STATES) so the form never
// accepts something the server then rejects.
export const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
export const ADDR_MIN = 10;
export const ZIP_RE = /^\d{5}(-?\d{4})?$/;
export const US_STATES = ['AL','AK','AZ','AR','CA','CO','CT','DE','DC','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','PR','GU','VI','AS','MP','AA','AE','AP'];

/* ---------- order validation helpers (pure, unit-tested in tools/test/order-validation.test.mjs) ----------
   site/app.js enforces the same rules inline; this is the fail-closed copy so a stale or hand-built request
   cannot slip a bad order through. Keep the two in step. */

// Trailer pickup is switched off until the Thirsty Beaches handoff is set up. Must match site/app.js PICKUP_ENABLED.
export const PICKUP_ENABLED = false;

// Shapes with blanks on hand. hydrant, fish, cat, star and house stay in site/app.js (HIDDEN_SHAPES) but are
// not sold until blanks are in stock; the server refuses them so a stale cart cannot order one.
export const ACTIVE_SHAPES = ['bone', 'heart', 'round', 'military', 'paw'];
export const ALL_SHAPES = ['bone', 'heart', 'round', 'military', 'paw', 'hydrant', 'fish', 'cat', 'star', 'house'];

// Every engraved line is capped at 24 characters (the builder's maxlength; the fit loop in app.js sizes to this).
export const MAX_LINE = 24;
export const MAX_BACK_LINE = 24;

// Returns an error string when any line is over the cap, else ''. Lines are checked after whitespace collapse.
export function lineProblem(lines, max = MAX_LINE) {
  for (const l of lines) if (String(l || '').replace(/\s+/g, ' ').trim().length > max) return `Each line is ${max} characters at most.`;
  return '';
}

// Phone on the back of a tag: at least 10 digits, and never a fictional 555-01xx number (the example
// placeholder is 435-555-0123; engraving that on a real dog's tag means the dog never gets home).
export function phoneProblem(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return 'Add a phone number on the back so the dog gets home.';
  if (digits.length < 10) return 'Use a full phone number with area code (10 digits).';
  const local = digits.slice(-7);
  if (local.slice(0, 3) === '555' && local.slice(3, 5) === '01') return 'That is a sample number. Enter your real phone number.';
  return '';
}

const CITY_RE = /^[A-Za-z][A-Za-z .'\-]*$/;
export function formatAddress(a) {
  return [a.line1, a.line2, a.city, `${a.state} ${a.zip}`].filter(Boolean).join(', ');
}

// Validates the structured shipping address. Returns { ok: true, address, formatted } or { ok: false, error, field }.
// `body` carries street (or addr1), addr2, city, state, zip. A request that only has the old single `address`
// string (a stale cached page) is refused with a message to refresh, never guessed at.
export function parseAddress(body) {
  const a = {
    line1: str(body.street !== undefined ? body.street : body.addr1, 120),
    line2: str(body.addr2, 40),
    city: str(body.city, 60),
    state: str(body.state, 2).toUpperCase(),
    zip: str(body.zip, 10),
  };
  if (!a.line1 && !a.city && !a.state && !a.zip && body.address) return { ok: false, field: 'street', error: 'The checkout form was updated. Refresh the page and enter the shipping address again.' };
  if (a.line1.length < 3) return { ok: false, field: 'street', error: 'Enter the street address.' };
  if (!a.city || a.city.length < 2 || !CITY_RE.test(a.city)) return { ok: false, field: 'city', error: 'Enter the city.' };
  if (!US_STATES.includes(a.state)) return { ok: false, field: 'state', error: 'Pick a state.' };
  if (!ZIP_RE.test(a.zip)) return { ok: false, field: 'zip', error: 'Enter a 5-digit ZIP code.' };
  return { ok: true, address: a, formatted: formatAddress(a) };
}

/* ---------- pricing (must match site/app.js PRICES) ---------- */
export const SIZES = { small: 12, medium: 14, large: 16, xl: 18 }; // 1" / 1.5" / 2" / 2.5"
export const PREMIUM = { stainless: 4, ssblack: 4, navy: 4, gold: 4, bronze: 4, rainbow: 4, polished: 6, brass: 4 };
export const SHIP = 4.5, FREE_OVER = 35, MULTI_QTY = 3, MULTI_OFF = 0.15;

// Laser color marking and photo engraving only work on stainless steel (the MOPA fiber can color-mark
// stainless and titanium; not anodized aluminum, not brass). These are the finish keys with kind:'stainless'
// in site/app.js FINISHES.
export const STAINLESS_FINISHES = ['stainless', 'ssblack', 'navy', 'gold', 'bronze', 'rainbow', 'polished'];
export const COLOR_PRICE = { icon: 4, line: 6 };

/* ---------- smart QR tag add-on (ADR 2026-11-16; Nick: one-time fee) ----------
   A tag entry with t.smart set carries a QR on the back and a finder page. The fee is one-time per smart entry (the copies of an
   entry share one id), kept OUT of the 15% multi-tag discount and the Salty Maze prize credit like the other add-ons. Set
   SMART_PRICE to 0 to give it away; site/app.js mirrors both constants and tools/test/smart-price.test.mjs fails if they drift.
   No "forever" (Lady Jaye, ADR 5.6) and no promise of texts: owner texts stay off until carrier registration, so customer copy says email (2026-11-17, Nick). */
export const SMART_PRICE = 500;                      // cents, per smart entry
export const SMART_LINE = 'Scan-to-find QR with email alerts';
export const SMART_PRICE_PER_COPY = false;           // true = charge every copy, not every entry
const smartUnits = (t) => (t.smart ? (SMART_PRICE_PER_COPY ? t.qty : 1) : 0);
export const PHOTO_PRICE = 14;

/* ---------- full-color UV print (xTool O1 Omni) and the holiday ornament ----------
   Everything Nick may want to change lives in this block. site/app.js mirrors each value (PRICES.fullcolor,
   PRICES.raisedCents, PRICES.ornament, FULLCOLOR_SHAPES, ORNAMENT_RAISED_INCLUDED) and tools/test/site-sync.test.mjs
   fails if the two copies drift. */
export const FULLCOLOR_FINISH = 'fullcolor';
// Full-color tag base price per size. Defaults to the aluminum price: change a number here (and in app.js) to reprice.
export const FULLCOLOR_PRICE = { small: 12, medium: 14, large: 16, xl: 18 };
// Shapes sold in full color: every active shape, in all four sizes. The xTool O1 Omni camera-scans the placed blank, masks its shape and prints on it,
// so no shape needs its own template. Keep the constant so the list can be trimmed later (it must stay a subset of ACTIVE_SHAPES).
export const FULLCOLOR_SHAPES = ['bone', 'round', 'heart', 'paw', 'military'];
// Raised (textured) lettering on a full-color tag is a paid option, charged per tag, only when the client sends raised:true.
export const RAISED_UPCHARGE_CENTS = 300;
// "We design it" on a full-color tag (Nick, 2026-11-17): we make the art after the order is paid (Gemini image model, about $0.04 to
// $0.13 per try), email a proof, and include one round of changes. One fee per design (the copies of an entry share it), never
// discounted, kept out of the Salty Maze credit like the other add-ons. Bold type is free: it is also the fallback if the proof is
// declined. site/app.js mirrors these (PRICES.designCents, DESIGN_FEE_STYLES) and tools/test/fullcolor.test.mjs keeps them equal.
export const DESIGN_FEE_CENTS = 200;
export const DESIGN_FEE_STYLES = ['mascot', 'synthwave', 'photo'];
export const DESIGN_NOTE = 'Custom design: we make it after payment and email a proof. One round of changes included.';
export const designFeeUnits = (t) => (t.finish === FULLCOLOR_FINISH && t.art === 'design' && DESIGN_FEE_STYLES.includes(t.style) ? 1 : 0);
// Holiday pet photo ornament, cents. The stainless tier is the premium: acrylic + 12 dollars.
export const ORNAMENT_PRICE_CENTS = { acrylic: 2400, stainless: 3600 };
// true: the raised name and year on the acrylic ornament are part of the $24 price. false: they cost RAISED_UPCHARGE_CENTS extra.
export const ORNAMENT_RAISED_INCLUDED = true;
// Orders ship from here. It changes after the January move: edit this one line (and SHIP_FROM in site/app.js).
export const SHIP_FROM = 'Lehi, UT';
// Ornament photos are stored next to tag photos under an index that cannot collide with a tag (an order holds 10 tags at most).
export const ORNAMENT_PHOTO_BASE = 100;
export const MAX_ORNAMENT_LINES = 5;
// "We design it" house art styles (rendered by site/app.js, tools/lib, and the orders-page print sheet). A style that
// needs the customer's dog photo is listed in ART_STYLES_NEED_IMAGE.
export const ART_STYLES = ['mascot', 'synthwave', 'bold', 'photo'];
export const ART_STYLES_NEED_IMAGE = ['photo'];
export const ART_MODES = ['design', 'upload'];
// Shown on the page and stored with the order whenever the customer sends an image (Lady Jaye B5, 2026-11-16).
// The [artwork terms](...) part is rendered as a link to /policies/#artwork. Keep in step with site/app.js ART_ACK_TEXT.
// ART_ACK_VERSION is stored on every acknowledgment as ack.v, with a SHA-256 of the exact wording (ack.h): change the text, bump the version.
export const ART_ACK_VERSION = 'b5-2026-11-16';
export const ART_ACK_TEXT = "I took this photo or made this art, or I have permission from whoever did to have it printed. It has no logos, team names or characters I don't have rights to, and everyone in it agreed (a parent or guardian for kids). I agree to the [artwork terms](/policies/#artwork).";
// Uploaded images: deleted 120 days after the order. A declined image is deleted immediately (policy says within 7 days).
export const PHOTO_TTL_SECONDS = 120 * 24 * 60 * 60;
export async function sha256Hex(input) {
  const data = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}
// The acknowledgment record stored with every image: who agreed, when, to which wording.
export async function ackRecord() {
  return { ownRights: true, at: Date.now(), v: ART_ACK_VERSION, h: (await sha256Hex(ART_ACK_TEXT)).slice(0, 16) };
}
export const YEAR_RE = /^20\d\d$/;
// Master switch for the holiday ornament (Nick, 2026-11-16: "not doing ornaments as of now"). Mirrors ORNAMENT_ENABLED in site/app.js.
// false: /ornament/ is not built, no link to it exists, and POST /api/order refuses an ornament with a 400. All ornament code stays.
// ORNAMENTS_ON=true in the environment turns the server side on (tests, staging) without editing this file; the site flag must match.
export const ORNAMENT_ENABLED = false;
export const ornamentsOn = (env) => ORNAMENT_ENABLED || String((env && env.ORNAMENTS_ON) || '').trim().toLowerCase() === 'true';
export const isFullcolor = (finish) => finish === FULLCOLOR_FINISH;
// Own-property lookup only: 'constructor' and '__proto__' are inherited keys and must never pass as a size.
export const own = (table, key) => (typeof key === 'string' && Object.hasOwn(table, key) ? table[key] : undefined);

// Server price of one ornament line item (per piece), in dollars. The client never supplies a price.
export function ornamentUnit(o) {
  const base = (own(ORNAMENT_PRICE_CENTS, o.tier) ?? ORNAMENT_PRICE_CENTS.acrylic) / 100;
  return base + (o.tier === 'acrylic' && !ORNAMENT_RAISED_INCLUDED && o.raised ? RAISED_UPCHARGE_CENTS / 100 : 0);
}

// Base unit price for a tag (size + finish premium), before add-ons. Add-ons are deliberately kept out
// of this number: they are excluded from the 15%-off-3+ discount and from the Salty Maze prize credit
// (see photo-color-pricing.md section 3, "Discount interaction, important").
export function tagUnitBase(t) {
  if (isFullcolor(t.finish)) return own(FULLCOLOR_PRICE, t.size) ?? FULLCOLOR_PRICE.medium;
  return (own(SIZES, t.size) ?? SIZES.medium) + (own(PREMIUM, t.finish) ?? 0);
}
export function tagAddonUnit(t) {
  // Full color: the photo is the product (no photo add-on), and the only add-on is the paid raised lettering.
  if (isFullcolor(t.finish)) return t.raised === true ? RAISED_UPCHARGE_CENTS / 100 : 0;
  if (!STAINLESS_FINISHES.includes(t.finish)) return 0;
  let addon = 0;
  if (t.color === 'icon') addon += COLOR_PRICE.icon;
  else if (t.color === 'line') addon += COLOR_PRICE.line;
  if (t.photo) addon += PHOTO_PRICE;
  return addon;
}

export function price(tags, prints, delivery, prizeOk, ornaments = []) {
  let tagBaseSub = 0, addonSub = 0;
  for (const t of tags) { tagBaseSub += tagUnitBase(t) * t.qty; addonSub += tagAddonUnit(t) * t.qty + (SMART_PRICE / 100) * smartUnits(t) + (DESIGN_FEE_CENTS / 100) * designFeeUnits(t); }
  const tagSub = tagBaseSub + addonSub;
  const tagCount = tags.reduce((n, t) => n + t.qty, 0);
  // Discount and prize apply to the base tag price only, never to color/photo add-ons.
  const discount = tagCount >= MULTI_QTY ? +(tagBaseSub * MULTI_OFF).toFixed(2) : 0;
  let sub = tagSub;
  for (const p of prints) sub += p.price * p.qty;
  // Ornaments are their own product: they never count toward the 3-tag discount and never take it.
  for (const o of ornaments) sub += ornamentUnit(o) * o.qty;
  const prize = prizeOk ? Math.max(0, ...tags.map((t) => PREMIUM[t.finish] ?? 0)) : 0;
  const after = sub - discount - prize;
  const shipping = delivery === 'pickup' || after >= FREE_OVER || after === 0 ? 0 : SHIP;
  return { subtotal: +sub.toFixed(2), discount, prize, shipping, total: +(after + shipping).toFixed(2), multi: tagCount >= MULTI_QTY };
}

/* ---------- Clover Hosted Checkout ---------- */
// Card checkout is live only when the two Clover secrets exist AND CHECKOUT_LIVE is explicitly "true". Having the
// secrets is not enough: Hosted Checkout can be configured but not yet enabled on the merchant account, and the page
// copy (config.js) must promise only what actually works. Flip CHECKOUT_LIVE after one real test payment succeeds.
export const payEnabled = (env) => Boolean(env.CLOVER_ECOMM_TOKEN && env.CLOVER_MERCHANT_ID) && String(env.CHECKOUT_LIVE || '').trim().toLowerCase() === 'true';

// Shipping from Lehi, Utah: Utah sales tax is collected only when the order ships to a Utah address.
// Lehi combined rate is 7.45% (state 4.85 + Utah County 1 + Lehi 1.1 + special 0.5). Clover rate units: 10% = 1000000.
// Override with the TAX_RATE secret (e.g. "7.45"). Out-of-state orders: no tax collected until a nexus threshold is reached.
// The state comes from the checkout's own State field (customer.state). Orders saved before that field
// existed only have the free-text address, so they keep the old text match.
export function taxApplies(customer) {
  if (customer.delivery === 'pickup') return true;
  if (customer.state) return customer.state === 'UT';
  return /\bUT\b|utah/i.test(customer.address || '');
}
export const shipsToUtah = taxApplies;
function taxRates(env, order) {
  const inUT = shipsToUtah(order.customer);
  if (!inUT) return [];
  const pct = parseFloat(env.TAX_RATE || '7.45');
  return [{ name: 'UT sales tax', rate: Math.round(pct * 100000) }];
}

// What the full-color art is, for the Clover note (the customer sees it on the hosted checkout).
export const RAISED_NOTE = 'Raised lettering and rim, built up in layers of UV ink.';
export function fcArtLabel(t) {
  if (t.art === 'upload') return 'customer image or artwork';
  const names = { mascot: 'bulldog mascot style', synthwave: 'synthwave style', bold: 'bold type style', photo: 'photo + saying' };
  return own(names, t.style) || 'house style';
}
export function checkoutLineItems(env, order) {
  const items = [];
  const tax = taxRates(env, order);
  const off = order.totals.multi ? 1 - MULTI_OFF : 1;
  for (const t of order.tags) {
    const unit = tagUnitBase(t);
    const fc = isFullcolor(t.finish);
    items.push({
      name: `Dog tag · ${t.shape} ${t.size} · ${fc ? 'Full color print' : t.finish}${order.totals.multi ? ' (15% multi-tag off)' : ''}`,
      unitQty: t.qty,
      price: Math.round(unit * off * 100),
      note: `${fc ? 'FULL COLOR print, ' + fcArtLabel(t) + (t.raised ? ', RAISED lettering' : '') + ' | ' : ''}Front: ${t.front.join(' / ') || '-'} | Back: ${t.back.join(' / ') || '-'}`.slice(0, 250),
      taxRates: tax,
    });
    if (fc && t.raised) {
      items.push({ name: 'Raised lettering', unitQty: t.qty, price: RAISED_UPCHARGE_CENTS, note: RAISED_NOTE, taxRates: tax });
    }
    // Add-ons are their own line items, at full price, never discounted: Clover should show exactly
    // what the color/photo work cost, and the 15%-off-3+ multiplier must not touch them.
    if (STAINLESS_FINISHES.includes(t.finish) && (t.color === 'icon' || t.color === 'line')) {
      items.push({
        name: `Color accent · ${t.color === 'line' ? 'full line' : 'icon'}${t.colorHue ? ' (' + t.colorHue + ')' : ''}`,
        unitQty: t.qty,
        price: Math.round((t.color === 'line' ? COLOR_PRICE.line : COLOR_PRICE.icon) * 100),
        taxRates: tax,
      });
    }
    if (STAINLESS_FINISHES.includes(t.finish) && t.photo) {
      items.push({ name: 'Photo engraving', unitQty: t.qty, price: Math.round(PHOTO_PRICE * 100), taxRates: tax });
    }
    if (t.smart && SMART_PRICE > 0) {
      items.push({ name: SMART_LINE, unitQty: smartUnits(t), price: SMART_PRICE, note: 'One-time add-on. QR on the back of the tag; email alerts.', taxRates: tax });
    }
    if (designFeeUnits(t) && DESIGN_FEE_CENTS > 0) {
      items.push({ name: 'Custom design', unitQty: designFeeUnits(t), price: DESIGN_FEE_CENTS, note: DESIGN_NOTE, taxRates: tax });
    }
  }
  for (const o of (order.ornaments || [])) {
    const stainless = o.tier === 'stainless';
    items.push({
      name: `Holiday pet photo ornament · ${stainless ? 'engraved stainless bone' : 'full-color printed acrylic'}`,
      unitQty: o.qty,
      price: Math.round((ORNAMENT_PRICE_CENTS[o.tier] ?? ORNAMENT_PRICE_CENTS.acrylic)),
      note: `Name: ${o.name} | Year: ${o.year}${!stainless && o.raised ? ' | RAISED name and year' : ''}`.slice(0, 250),
      taxRates: tax,
    });
    if (!stainless && o.raised && !ORNAMENT_RAISED_INCLUDED) {
      items.push({ name: 'Raised name and year', unitQty: o.qty, price: RAISED_UPCHARGE_CENTS, note: RAISED_NOTE, taxRates: tax });
    }
  }
  for (const p of order.prints) {
    items.push({ name: p.item, unitQty: p.qty, price: Math.round(p.price * 100), note: (p.note || '').slice(0, 250), taxRates: tax });
  }
  if (order.totals.prize > 0) items.push({ name: 'Free upgrade credit', unitQty: 1, price: -Math.round(order.totals.prize * 100), taxRates: [] });
  if (order.totals.shipping > 0) items.push({ name: 'USPS shipping', unitQty: 1, price: Math.round(order.totals.shipping * 100), taxRates: [] });
  return items;
}

export async function createCheckout(env, order) {
  const base = env.CLOVER_API_BASE || 'https://api.clover.com';
  const [firstName, ...rest] = order.customer.name.split(' ');
  const body = {
    customer: { email: order.customer.email, firstName, lastName: rest.join(' ') || '-', phoneNumber: order.customer.phone || undefined },
    shoppingCart: { lineItems: checkoutLineItems(env, order) },
  };
  // Per-request return pages, so the Thirsty Beaches kiosk (same Clover merchant) can send its customers
  // somewhere else. Clover's dashboard Redirect URLs override these, so those should be left blank.
  const site = env.SITE_URL || 'https://saltydogtags.com';
  body.redirectUrls = { success: site + '/thanks.html?pay=ok', failure: site + '/?pay=failed' };
  if (env.CLOVER_PAGE_CONFIG) body.pageConfigUuid = env.CLOVER_PAGE_CONFIG;
  const r = await fetch(base + '/invoicingcheckoutservice/v1/checkouts', {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json', 'X-Clover-Merchant-Id': env.CLOVER_MERCHANT_ID, authorization: 'Bearer ' + env.CLOVER_ECOMM_TOKEN },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  let data; try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 500) }; }
  if (!r.ok || !data.href) throw new Error('Clover checkout failed (' + r.status + '): ' + (data.message || data.raw || JSON.stringify(data)).slice(0, 300));
  return { id: data.checkoutSessionId, href: data.href, created: data.createdTime, expires: data.expirationTime };
}

// Custom quote items and anything that carries a customer image go through invoice: every upload is checked by hand
// BEFORE the customer pays (Lady Jaye B6), so card checkout is never opened for an order with one.
export const hasCustomerImage = (order) => (order.tags || []).some((t) => t.photo === true || t.art === 'upload' || t.style === 'photo')
  || (order.ornaments || []).some((o) => o.photo === true || o.art === 'upload' || o.style === 'photo');
// Lady Jaye C4 (server side): 18+ wording is flagged for review even when the customer typed it themselves. Two signals:
// the lines match a saying the site files as 18+ (the SAYINGS mirror, x:true), or they contain a word from this list. Every
// word here appears in the 18+ catalog (a test checks), which is the list this is drawn from. It only sets a review flag.
const ADULT_WORDS = /\b(?:f+u+c+k\w*|sh[i1]+t\w*|bitch\w*|asshole\w*|dick(?:s|head\w*)?|cock(?:s|blocker\w*)?|piss\w*|bastard\w*|slut\w*)\b/i;
const norm = (l) => String(l || '').toLowerCase().replace(/\s+/g, ' ').trim();
const ADULT_LINES = new Set(SAYINGS.filter((x) => x.x).map((x) => norm(x.l.join(' '))));
export function adultText(lines) {
  const joined = norm((lines || []).filter(Boolean).join(' '));
  if (!joined) return false;
  return ADULT_LINES.has(joined) || ADULT_WORDS.test(joined);
}
export const ADULT_WORDS_RE = ADULT_WORDS;
export const canPayOnline = (order) => (order.prints || []).every((p) => p.price > 0) && !hasCustomerImage(order);

/* ---------- photo add-on storage ----------
   Customer dog photos arrive from the builder as a data URL, already resized client-side on canvas
   (max 1600px, JPEG q0.85, capped ~1.5 MB). We never store the data URL inside the order JSON: it's
   pulled out, decoded, and written to R2 (binding PHOTOS) if that binding exists, otherwise to the
   ORDERS KV namespace as base64 under photo:<orderId>:<tagIndex> (KV values cap at 25 MB; our hard
   cap below is far under that). Fails closed: anything that doesn't parse as one of these mime types,
   or anything over the cap, is rejected rather than stored. */
export const PHOTO_MAX_BYTES = 1_800_000; // client caps ~1.5 MB; this leaves headroom before we reject
const PHOTO_DATA_URL_RE = /^data:image\/(jpeg|jpg|png|webp);base64,([A-Za-z0-9+/=]+)$/;

export function hasR2Photos(env) {
  return Boolean(env.PHOTOS && typeof env.PHOTOS.put === 'function');
}

const SVG_DATA_URL_RE = /^data:image\/svg\+xml;base64,([A-Za-z0-9+/=]+)$/;

// Returns { bytes, mime, sha256, w, h } on success or { error } on failure. Never throws.
// `opts.allowSvg` (full-color artwork only): an SVG is decoded, run through the allow-list sanitizer in _svg.js, and the
// CLEANED markup is what gets stored. Engraved photos never take SVG: the fiber laser needs a raster.
// Raster bytes are inspected (_raster.js): the signature must be a real PNG, JPEG or WebP and the size is capped, whatever the
// data URL claimed. KV copies expire after PHOTO_TTL_SECONDS (120 days).
export async function storePhoto(env, orderId, tagIndex, dataUrl, opts = {}) {
  const raw = String(dataUrl || '');
  const svgM = SVG_DATA_URL_RE.exec(raw);
  const m = svgM ? null : PHOTO_DATA_URL_RE.exec(raw);
  if (!m && !(svgM && opts.allowSvg)) return { error: svgM ? 'SVG is only accepted for full-color artwork. Use a JPG or PNG photo here.' : 'That photo upload looks corrupted. Please re-upload it.' };
  const b64 = (m || svgM)[m ? 2 : 1];
  const approxBytes = Math.floor((b64.length * 3) / 4);
  if (approxBytes > PHOTO_MAX_BYTES) return { error: 'That photo is too large. Please use a smaller image.' };
  let bytes, mime, w = 0, h = 0;
  try { bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)); }
  catch { return { error: 'That photo upload looks corrupted. Please re-upload it.' }; }
  if (svgM) {
    const clean = sanitizeSvg(new TextDecoder('utf-8', { fatal: false }).decode(bytes));
    if (!clean.ok) return { error: clean.error };
    bytes = new TextEncoder().encode(clean.svg);
    mime = 'image/svg+xml';
  } else {
    const info = inspectRaster(bytes);
    if (!info.ok) return { error: info.error };
    mime = info.mime; w = info.w; h = info.h; // the detected type wins over whatever the data URL said
  }
  let out = '';
  for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  const storeB64 = svgM ? btoa(out) : b64;
  const sha256 = await sha256Hex(bytes);
  if (hasR2Photos(env)) {
    // R2 has no per-object TTL in code: add a lifecycle rule (delete after 120 days) on this bucket in the dashboard.
    await env.PHOTOS.put(`${orderId}/${tagIndex}`, bytes, { httpMetadata: { contentType: mime } });
  } else {
    await env.ORDERS.put(`photo:${orderId}:${tagIndex}`, storeB64, { metadata: { mime }, expirationTtl: PHOTO_TTL_SECONDS });
  }
  return { bytes: bytes.length, mime, sha256, w, h };
}

// Removes a stored image (a declined upload, or a deletion request). Never throws.
export async function deletePhoto(env, orderId, tagIndex) {
  try {
    if (hasR2Photos(env) && typeof env.PHOTOS.delete === 'function') await env.PHOTOS.delete(`${orderId}/${tagIndex}`);
    await env.ORDERS.delete(`photo:${orderId}:${tagIndex}`);
    return true;
  } catch { return false; }
}

// Returns { bytes: Uint8Array|ArrayBuffer-ish, mime } or null if nothing is stored for that tag.
export async function getPhoto(env, orderId, tagIndex) {
  if (hasR2Photos(env)) {
    const obj = await env.PHOTOS.get(`${orderId}/${tagIndex}`);
    if (!obj) return null;
    return { bytes: obj.body, mime: (obj.httpMetadata && obj.httpMetadata.contentType) || 'image/jpeg' };
  }
  const { value, metadata } = await env.ORDERS.getWithMetadata(`photo:${orderId}:${tagIndex}`, 'text');
  if (!value) return null;
  const bytes = Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
  return { bytes, mime: (metadata && metadata.mime) || 'image/jpeg' };
}

/* ---------- CORS (exact origins only) ----------
   The site and the API share an origin in production, so this only matters for local dev and the www host.
   Cross-origin requests from anywhere else are refused rather than echoed: an exact allow-list of full origins
   (scheme + host + port), no wildcard hostnames. Notably NOT *.pages.dev: anyone can host a page there and call the
   AI endpoints from a visitor's browser. Extra origins for a test deployment: ALLOWED_ORIGINS (comma separated). */
const ALLOWED_ORIGINS = new Set([
  'https://saltydogtags.com',
  'https://www.saltydogtags.com',
  'http://localhost:8788', 'http://127.0.0.1:8788', // wrangler pages dev
]);
function originAllowed(origin, env) {
  if (!origin) return true; // no Origin header: same-origin navigation or a non-browser caller, not a CORS request
  if (ALLOWED_ORIGINS.has(origin)) return true;
  const extra = env && typeof env.ALLOWED_ORIGINS === 'string' ? env.ALLOWED_ORIGINS.split(',').map((x) => x.trim()).filter(Boolean) : [];
  return extra.includes(origin);
}
export function corsHeaders(request, env) {
  const origin = request.headers.get('Origin');
  if (!origin || !originAllowed(origin, env)) return {};
  return { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' };
}
// Shared OPTIONS handler for the AI endpoints: 204 if the origin is allowed (or absent), 403 otherwise.
export function handlePreflight(request, env) {
  const origin = request.headers.get('Origin');
  if (origin && !originAllowed(origin, env)) return new Response(null, { status: 403 });
  return new Response(null, {
    status: 204,
    headers: {
      ...corsHeaders(request, env),
      'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
      'Access-Control-Allow-Headers': 'content-type',
      'Access-Control-Max-Age': '86400',
    },
  });
}

/* ---------- AI request guardrails (roast.js, portrait.js, ai-health.js) ---------- */

// SHA-256 of the connecting IP, hex-truncated. We rate-limit by IP but never store the IP itself.
export async function hashHex(input) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('').slice(0, 24);
}

// Hash of the caller's IP for counters. Uses the IP_SALT secret when it is set (so the stored value cannot be
// reversed by trying every IPv4 address); counters expire within hours, so the unsalted fallback only keeps
// rate limiting working if the secret is missing. Anything stored long term must use saltedIpHash() instead.
export async function ipKey(env, request) {
  const salted = await saltedIpHash(env, request);
  if (salted) return salted;
  return hashHex(request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || '0.0.0.0');
}

// Fixed-ish window limiter in KV: `limit` calls per `windowSeconds` per IP, key ai:ip:<hash>.
// Fails closed on KV errors (treated as rate-limited) rather than silently allowing unlimited AI spend.
// `prefix` keeps separate counters per feature; the default 'ai:ip:' is the roast's own budget.
export async function rateLimitIp(env, request, limit, windowSeconds, prefix = 'ai:ip:') {
  const key = prefix + (await ipKey(env, request));
  try {
    const raw = await env.ORDERS.get(key);
    const count = raw ? parseInt(raw, 10) || 0 : 0;
    if (count >= limit) return { ok: false, count };
    await env.ORDERS.put(key, String(count + 1), { expirationTtl: windowSeconds });
    return { ok: true, count: count + 1 }; // 1-based: this request's number within the window
  } catch {
    return { ok: false };
  }
}

// Races a Workers AI call against a hard deadline so one slow model never ties up a request.
// Rejects with Error('ai-timeout') rather than hanging; callers decide the fallback.
export async function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('ai-timeout')), ms); });
  try { return await Promise.race([promise, timeout]); } finally { clearTimeout(timer); }
}

/* ---------- Claude API client (roast.js, mix.js, ai-health.js) ----------
   Tiny fetch wrapper, no SDK. Secret: ANTHROPIC_API_KEY (Pages secret). Every caller treats a throw as
   "fall back to Workers AI", so this never returns partial data: it returns the model's text or throws.
   Errors carry only a short code (status or reason), never the response body or the key. */
export const CLAUDE_URL = 'https://api.anthropic.com/v1/messages';
export const CLAUDE_VERSION = '2023-06-01';
export const CLAUDE_TIMEOUT_MS = 8000;

export const hasClaude = (env) => typeof env.ANTHROPIC_API_KEY === 'string' && env.ANTHROPIC_API_KEY.trim().length > 0;

// `messages` is the Anthropic messages array (content may be a string or an array of blocks, including
// base64 image blocks). Uses AbortController so a slow call is actually cancelled, not just abandoned.
export async function callClaude(env, { model, system, messages, maxTokens = 600, timeoutMs = CLAUDE_TIMEOUT_MS }) {
  if (!hasClaude(env)) throw new Error('claude-no-key');
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(CLAUDE_URL, {
      method: 'POST',
      signal: ctl.signal,
      headers: {
        'content-type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY.trim(),
        'anthropic-version': CLAUDE_VERSION,
      },
      body: JSON.stringify({ model, max_tokens: maxTokens, system, messages }),
    });
    if (!r.ok) throw new Error('claude-http-' + r.status);
    const data = await r.json();
    if (data && data.stop_reason === 'refusal') throw new Error('claude-refusal');
    const text = ((data && data.content) || []).filter((b) => b && b.type === 'text').map((b) => b.text).join('').trim();
    if (!text) throw new Error('claude-empty:' + String(data && data.stop_reason) + ':' + ((data && data.content) || []).map((b) => b && b.type).join('+'));
    return text;
  } catch (e) {
    if (e && e.name === 'AbortError') throw new Error('ai-timeout');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}
