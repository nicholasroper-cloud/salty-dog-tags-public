// POST /api/order — a customer places an order.
// Stored in KV. If Clover Hosted Checkout is configured and nothing needs a quote,
// a checkout session is created and the customer is sent to pay. Otherwise the owner invoices from the orders page.
import { notifyOrder } from './_notify.js';
import { smartEnabled, qrConfig } from './_tagsettings.js';
import { mintOrderTags } from './_tagdb.js';
import { readObject, saltedIpHash } from './_security.js';
import { json, orderId, str, price, SIZES, STAINLESS_FINISHES, storePhoto, payEnabled, canPayOnline, createCheckout, parseAddress, rateLimitIp, PICKUP_ENABLED, ACTIVE_SHAPES, ALL_SHAPES, MAX_LINE, lineProblem, phoneProblem, EMAIL_RE, ADDR_MIN, ZIP_RE, US_STATES,
  own, ackRecord, adultText, ornamentsOn, PHOTO_TTL_SECONDS, FULLCOLOR_FINISH, FULLCOLOR_SHAPES, ART_STYLES, ART_STYLES_NEED_IMAGE, ART_MODES, ORNAMENT_PRICE_CENTS, ORNAMENT_RAISED_INCLUDED, ORNAMENT_PHOTO_BASE, MAX_ORNAMENT_LINES, YEAR_RE } from './_lib.js';

// Text-only bodies are small; a photo add-on ships a resized JPEG data URL (client caps ~1.5 MB, which
// is ~2 MB once base64-encoded). Cap the whole request well above that so a couple of photo tags in one
// order still fit, but far below anything that looks like abuse.
const MAX_BODY = 9_000_000;

export async function onRequestPost({ request, env, waitUntil }) {
  if ((request.headers.get('content-type') || '').indexOf('application/json') < 0) return json({ error: 'json only' }, 415);
  const parsed = await readObject(request, MAX_BODY);
  if (parsed.error) return json({ error: parsed.error }, parsed.status);
  const body = parsed.body;
  if (body.website) return json({ ok: true, id: 'SDT-SPAM', totals: { total: 0 } }); // honeypot
  // Every order writes KV and pings the owner's phone (Pushover, Twilio): cap how many one network can create.
  const orderRl = await rateLimitIp(env, request, 10, 3600, 'rl:order:');
  if (!orderRl.ok) return json({ error: 'Too many orders from this network. Try again in a little while, or email hello@saltydogtags.com.' }, 429);

  // Parsed alongside each tag's raw photo image (kept out of the tag object itself: it's large, and it
  // doesn't belong in the stored order JSON). Index-aligned with tagsRaw so it survives the filter below.
  const tagsRaw = (Array.isArray(body.tags) ? body.tags : []).slice(0, 10).filter((t) => t && typeof t === 'object' && !Array.isArray(t));
  // Fail closed on a shape we cannot make right now: coercing it to a bone would engrave the wrong tag.
  const unavailable = tagsRaw.find((t) => ALL_SHAPES.includes(t.shape) && !ACTIVE_SHAPES.includes(t.shape));
  if (unavailable) return json({ error: 'That tag shape is not available right now. Remove it from the order and pick another shape.' }, 400);
  // Full color is only sold on the shapes in FULLCOLOR_SHAPES; refuse instead of quietly re-shaping the tag.
  const fcBadShape = tagsRaw.find((t) => t.finish === FULLCOLOR_FINISH && !FULLCOLOR_SHAPES.includes(t.shape));
  if (fcBadShape) return json({ error: 'Full color is not available in that shape. Pick bone, round, heart, paw or military.' }, 400);
  const parsedTags = tagsRaw.map((t) => {
    const shape = ACTIVE_SHAPES.includes(t.shape) ? t.shape : 'bone';
    const finish = ['black','red','royal','sky','green','yellow','silver','pink','hotpink','stainless','ssblack','navy','gold','bronze','rainbow','polished','brass',FULLCOLOR_FINISH].includes(t.finish) ? t.finish : 'black';
    const fc = finish === FULLCOLOR_FINISH;
    const stainlessOk = STAINLESS_FINISHES.includes(finish);
    // Fail closed: color and photo only ever apply to a stainless-kind finish, no matter what the client sent.
    const color = stainlessOk && ['icon', 'line'].includes(t.color) ? t.color : 'none';
    const colorHue = color !== 'none' && ['blue', 'gold', 'purple', 'bronze'].includes(t.colorHue) ? t.colorHue : (color !== 'none' ? 'blue' : undefined);
    // Full color: "We design it" (a house style, optionally the dog photo) or "Upload your own" (photo or finished artwork).
    // An image is only ever kept when the chosen path needs one, and then it must come with the rights acknowledgment.
    const art = fc ? (t.art === 'upload' ? 'upload' : 'design') : undefined;
    const style = fc && art === 'design' ? (ART_STYLES.includes(t.style) ? t.style : null) : undefined;
    const wantsImage = fc && (art === 'upload' || ART_STYLES_NEED_IMAGE.includes(style));
    const photo = fc ? wantsImage : Boolean(stainlessOk && t.photo === true);
    // Lines are measured as sent (after whitespace collapse), not truncated: an over-long line is rejected
    // below rather than silently engraved shorter than the customer saw it.
    const rawFront = [t.front1, t.front2, t.front3, t.front4].map((l) => str(l, 200));
    const rawBack = [t.back1, t.back2, t.back3].map((l) => str(l, 200));
    const tag = {
      shape,
      size: own(SIZES, t.size) ? t.size : 'medium', // own property only: 'constructor' / '__proto__' are not sizes
      finish,
      font: ['block','bungee','script','slab','marker'].includes(t.font) ? t.font : 'block',
      icon: ['none','paw','bone','heart','star','anchor','bolt','crown','skull'].includes(t.icon) ? t.icon : 'none',
      color,
      colorHue,
      photo,
      front: photo && !fc ? [] : rawFront.filter(Boolean),
      back: rawBack.filter(Boolean),
      qty: Math.min(20, Math.max(1, parseInt(t.qty, 10) || 1)),
    };
    // Paid raised lettering: only a full-color tag that sent raised:true gets it (price lives in _lib.js, never the client).
    if (fc) Object.assign(tag, { art, ...(style ? { style } : {}), raised: t.raised === true });
    // Lady Jaye C4: record when 18+ wording is on the tag, so a person who may be under 18 in the image can be caught at review.
    if (t.adult === true || adultText([...rawFront, ...rawBack])) tag.adult = true; // client flag, or the server's own check of what was typed
    return { tag, fc, art, style, wantSmart: t.smart === true, wantsImage: fc ? wantsImage : photo, ack: t.ack === true, rawFront: photo && !fc ? [] : rawFront, rawBack, photoImage: photo && typeof t.photoImage === 'string' ? t.photoImage : null };
  }).filter((p) => p.tag.front.length || p.tag.back.length || p.tag.photo);
  const tags = parsedTags.map((p) => p.tag);

  // Text rules, enforced here as well as in the builder: lines fit the 24-character cap, and the back
  // carries a dog name and a real phone number (>= 10 digits, never a sample 555-01xx number).
  for (let i = 0; i < parsedTags.length; i++) {
    const p = parsedTags[i], n = i + 1;
    const tooLong = lineProblem([...p.rawFront, ...p.rawBack], MAX_LINE);
    if (tooLong) return json({ error: `Tag ${n}: ${tooLong}` }, 400);
    if (p.fc && p.art === 'design' && !p.style) return json({ error: `Tag ${n}: pick an art style.` }, 400);
    if (p.fc && p.art === 'design' && !p.tag.front.length) return json({ error: `Tag ${n}: pick a saying for the front.` }, 400);
    if (p.wantsImage && p.photoImage && !p.ack) return json({ error: `Tag ${n}: tick the box to confirm the photo or artwork rules.`, field: 'artAck' }, 400);
    if (!p.rawBack[0]) return json({ error: `Tag ${n}: add the dog's name on the back.` }, 400);
    const phoneErr = phoneProblem(p.rawBack[1]);
    if (phoneErr) return json({ error: `Tag ${n}: ${phoneErr}` }, 400);
  }

  // Smart QR tag (ADR 2026-11-16): the client only says "I want it"; the server re-checks eligibility with the real text and decides
  // the version, error correction, module size and position. It never trusts a client-sent geometry. Fail closed with a 400.
  for (let i = 0; i < parsedTags.length; i++) {
    const p = parsedTags[i];
    if (!p.wantSmart) continue;
    if (!smartEnabled(env)) return json({ error: `Tag ${i + 1}: the scan-to-find QR is not available right now. Turn it off for that tag and order again.`, field: 'smart' }, 400);
    const ck = qrConfig(env).checkTag({ shape: p.tag.shape, finish: p.tag.finish, font: p.tag.font, back: p.rawBack });
    if (!ck.ok) return json({ error: `Tag ${i + 1}: ${ck.message}`, field: 'smart', reason: ck.reason }, 400);
    p.tag.smart = { id: null, url: null, ...ck.smart };
  }

  // Prints are not sold through this endpoint: every price here comes from the server tables in _lib.js, and a
  // client-supplied print price was the one number the server used to trust. Custom print work is quoted by email.
  if (Array.isArray(body.prints) ? body.prints.length : body.prints) return json({ error: 'Custom print items are quoted by email. Write hello@saltydogtags.com.' }, 400);
  const prints = [];

  // Holiday ornaments (kind "ornament"): priced from ORNAMENT_PRICE_CENTS in _lib.js, never from the request.
  if (Array.isArray(body.ornaments) && body.ornaments.length && !ornamentsOn(env)) return json({ error: 'Ornaments are not available right now. Remove the ornament from the order.' }, 400);
  if (Array.isArray(body.ornaments) && body.ornaments.length > MAX_ORNAMENT_LINES) return json({ error: `An order holds ${MAX_ORNAMENT_LINES} ornament lines at most. Remove one, or send a second order.` }, 400);
  const ornRaw = (Array.isArray(body.ornaments) ? body.ornaments : []).slice(0, MAX_ORNAMENT_LINES).filter((o) => o && typeof o === 'object' && !Array.isArray(o));
  const ornParsed = [];
  for (let j = 0; j < ornRaw.length; j++) {
    const o = ornRaw[j], n = j + 1;
    const tier = o.tier === 'stainless' ? 'stainless' : o.tier === 'acrylic' ? 'acrylic' : null;
    if (!tier) return json({ error: `Ornament ${n}: pick the acrylic or the stainless tier.` }, 400);
    const name = str(o.name, 200), year = str(o.year, 8);
    if (!name) return json({ error: `Ornament ${n}: add the dog's name.` }, 400);
    if (lineProblem([name], MAX_LINE)) return json({ error: `Ornament ${n}: the name is ${MAX_LINE} characters at most.` }, 400);
    if (!YEAR_RE.test(year)) return json({ error: `Ornament ${n}: enter the year as four digits, like 2026.` }, 400);
    // Stainless is always the engraved photo (one upload either way). Acrylic is "we design it" or "upload your own".
    const art = tier === 'stainless' ? 'upload' : (ART_MODES.includes(o.art) ? o.art : 'design');
    const style = tier === 'acrylic' && art === 'design' ? (ART_STYLES.includes(o.style) ? o.style : null) : undefined;
    if (tier === 'acrylic' && art === 'design' && !style) return json({ error: `Ornament ${n}: pick an art style.` }, 400);
    const wantsImage = tier === 'stainless' || art === 'upload' || ART_STYLES_NEED_IMAGE.includes(style);
    const photoImage = wantsImage && typeof o.photoImage === 'string' ? o.photoImage : null;
    if (wantsImage && !photoImage) return json({ error: `Ornament ${n}: upload the photo.` }, 400);
    if (wantsImage && o.ack !== true) return json({ error: `Ornament ${n}: tick the box to confirm the photo or artwork rules.`, field: 'artAck' }, 400);
    ornParsed.push({
      o: { tier, name, year, ...(adultText([name]) ? { adult: true } : {}), qty: Math.min(20, Math.max(1, parseInt(o.qty, 10) || 1)), art, ...(style ? { style } : {}),
        // Raised name and year are part of the acrylic tier while ORNAMENT_RAISED_INCLUDED; otherwise only when the client asked.
        raised: tier === 'acrylic' && (ORNAMENT_RAISED_INCLUDED || o.raised === true), photo: wantsImage },
      photoImage, wantsImage, allowSvg: tier === 'acrylic' && art === 'upload',
    });
  }
  const ornaments = ornParsed.map((p) => p.o);

  if (!tags.length && !prints.length && !ornaments.length) return json({ error: 'Nothing in the order.' }, 400);

  // Photo is on but nothing came with it: reject before we even look at the rest of the order.
  const missingPhotoAt = tags.findIndex((t, i) => t.photo && !parsedTags[i].photoImage);
  if (missingPhotoAt !== -1) return json({ error: parsedTags[missingPhotoAt].fc
    ? `Tag ${missingPhotoAt + 1} needs an image for the full-color print. Upload one, or pick a style that does not need it.`
    : `The photo add-on is on for tag ${missingPhotoAt + 1} but no photo was uploaded. Add a photo or turn the add-on off.` }, 400);

  const wantsPickup = body.delivery === 'pickup';
  if (wantsPickup && !PICKUP_ENABLED) return json({ error: 'Trailer pickup is not available online right now. Choose shipping.' }, 400);
  const customer = {
    name: str(body.name, 60),
    email: str(body.email, 120).toLowerCase(),
    phone: str(body.phone, 30),
    delivery: wantsPickup ? 'pickup' : 'ship',
    address: '',
    note: str(body.note, 500),
  };
  // `field` tells the checkout which input to flag. Older clients just show `error`.
  if (!customer.name) return json({ error: 'Enter your name.', field: 'name' }, 400);
  if (!EMAIL_RE.test(customer.email)) return json({ error: 'Enter a real email, like you@example.com.', field: 'email' }, 400);
  if (customer.delivery === 'ship') {
    const a = parseAddress(body);
    if (!a.ok) return json({ error: a.error, field: a.field }, 400);
    // The structured parts drive tax; the formatted single string is what the invoice route and orders page read.
    Object.assign(customer, { street: a.address.line1, addr2: a.address.line2, city: a.address.city, state: a.address.state, zip: a.address.zip, address: a.formatted });
  }

  // free-upgrade code from the Salty Maze (one use). One error text for "no such code" and "already used", so the
  // form cannot be used to find out which codes are outstanding, and a per-IP cap slows down guessing.
  const prizeCode = str(body.prize, 16).toUpperCase();
  const PRIZE_BAD = 'That upgrade code is not valid or was already used.';
  let prizeRec = null;
  if (prizeCode) {
    const rl = await rateLimitIp(env, request, 12, 3600, 'prize:try:');
    if (!rl.ok) return json({ error: 'Too many code attempts. Try again in a while.', field: 'prize' }, 429);
    if (!/^SDT-UP-[A-Z0-9]{4}$/.test(prizeCode)) return json({ error: PRIZE_BAD, field: 'prize' }, 400);
    try { prizeRec = JSON.parse((await env.ORDERS.get('prize:' + prizeCode)) || 'null'); } catch {}
    if (!prizeRec || prizeRec.used || await env.ORDERS.get('prizeclaim:' + prizeCode)) return json({ error: PRIZE_BAD, field: 'prize' }, 400);
    if (!tags.some((t) => (t.finish !== 'black') && ['stainless','ssblack','navy','gold','bronze','rainbow','polished','brass'].includes(t.finish))) return json({ error: 'The free upgrade needs a stainless, polished or brass tag in the order. Pick one and the upgrade is free.', field: 'prize' }, 400);
  }

  // The server decides the price; a total that is not a real number is refused before anything is stored.
  { const probe = price(tags, prints, customer.delivery, false, ornaments); if (![probe.subtotal, probe.total].every((n) => Number.isFinite(n))) return json({ error: 'Something in the order could not be priced. Refresh the page and try again.' }, 400); }
  let id = orderId();
  let collided = await env.ORDERS.get('order:' + id);
  for (let i = 0; i < 5 && collided; i++) { id = orderId(); collided = await env.ORDERS.get('order:' + id); }
  if (collided) return json({ error: 'Busy, please resubmit.' }, 503);

  // Burn the code FIRST, with its own per-redemption KV key written before anything slow runs (photo storage awaits,
  // Clover checkout). KV has no compare-and-swap, so check-then-write cannot be made fully atomic; putting the claim
  // key down before the awaits closes the window to the gap between two KV round trips instead of seconds, and the
  // per-IP attempt cap above bounds what is left. The claim is released if the order fails before it is saved.
  const claimKey = prizeRec ? 'prizeclaim:' + prizeCode : null;
  if (claimKey) await env.ORDERS.put(claimKey, id, { expirationTtl: 60 * 60 * 24 * 90 });

  // Store each tag's photo (if any) under the now-final order id. A storage failure releases the claim, so a
  // corrupt upload does not burn a one-use upgrade code.
  for (let i = 0; i < tags.length; i++) {
    if (!tags[i].photo) continue;
    const res = await storePhoto(env, id, i, parsedTags[i].photoImage, { allowSvg: parsedTags[i].fc && parsedTags[i].art === 'upload' });
    if (res.error) { if (claimKey) await env.ORDERS.delete(claimKey); return json({ error: res.error }, 400); }
    Object.assign(tags[i], { photoBytes: res.bytes, photoMime: res.mime, photoSha256: res.sha256, photoPx: res.w ? [res.w, res.h] : undefined, photoExpiresAt: Date.now() + PHOTO_TTL_SECONDS * 1000, ack: await ackRecord() });
  }
  // Ornament photos live under ORNAMENT_PHOTO_BASE + line index, so /api/photo?t=<n> reaches them like a tag photo.
  for (let j = 0; j < ornParsed.length; j++) {
    if (!ornParsed[j].wantsImage) continue;
    const res = await storePhoto(env, id, ORNAMENT_PHOTO_BASE + j, ornParsed[j].photoImage, { allowSvg: ornParsed[j].allowSvg });
    if (res.error) { if (claimKey) await env.ORDERS.delete(claimKey); return json({ error: res.error }, 400); }
    Object.assign(ornaments[j], { photoBytes: res.bytes, photoMime: res.mime, photoSha256: res.sha256, photoPx: res.w ? [res.w, res.h] : undefined, photoExpiresAt: Date.now() + PHOTO_TTL_SECONDS * 1000, photoIndex: ORNAMENT_PHOTO_BASE + j, ack: await ackRecord() });
  }

  if (prizeRec) {
    prizeRec.used = true; prizeRec.order = id;
    await env.ORDERS.put('prize:' + prizeCode, JSON.stringify(prizeRec), { expirationTtl: 60 * 60 * 24 * 90 });
  }

  const totals = price(tags, prints, customer.delivery, Boolean(prizeRec), ornaments);

  const order = { id, at: Date.now(), status: 'new', customer, tags, prints, ...(ornaments.length ? { ornaments } : {}), totals,
    prize: prizeRec ? prizeCode : undefined, prizeCode: prizeRec ? prizeCode : undefined,
    // Privacy: no raw IP and no user agent are stored. A salted hash is enough to spot one source flooding the
    // form. IP_SALT is required for this: without it the hash would be reversible over the IPv4 space, so the
    // field is simply left out instead of stored weakly.
    ipHash: (await saltedIpHash(env, request)) || undefined };

  let payUrl = null, payError = null;
  if (payEnabled(env) && canPayOnline(order) && totals.total > 0) {
    try {
      const cs = await createCheckout(env, order);
      order.checkout = cs;
      order.payment = { status: 'pending' };
      payUrl = cs.href;
      await env.ORDERS.put('cs:' + cs.id, id, { expirationTtl: 60 * 60 * 24 * 30 });
    } catch (e) {
      payError = String(e.message || e).slice(0, 300);
      order.payError = payError; // owner sees it; customer gets the invoice path
    }
  }
  // Mint the QR ids now that the order id is final. If D1 is down the order still saves with smart.id null, and the orders page
  // shows a "Mint QR id" button (POST /api/tags/mint is idempotent). A failure here must never block an order.
  if (tags.some((t) => t.smart)) { try { await mintOrderTags(env, order); } catch (e) { console.warn('mint failed', String((e && e.message) || e).slice(0, 80)); } }
  await env.ORDERS.put('order:' + id, JSON.stringify(order));
  notifyOrder({ waitUntil }, env, order, 'new');
  return json({ ok: true, id, totals, payUrl, mode: payUrl ? 'card' : 'invoice' });
}
