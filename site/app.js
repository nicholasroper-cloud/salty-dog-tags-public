/* Salty Dog Tags — builder, sayings, prints, order. No dependencies.
   Tag renders are modeled on the real blanks in research/tag-blanks.md:
   bone 1.5x1" anodized aluminum (EupHHonycs), heart 1.5x1.3" (MECCANIXITY), round 1.18" (Mozeat Lens),
   military 2x1" (zisiueel), stainless 304 bone 1.96x1.1" (StayMax), solid brass round 1.5" (Ferraycle). */
(function () {
  'use strict';
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (n) => '$' + (Math.round(n * 100) / 100).toFixed(2).replace(/\.00$/, '');
  // Inline validation: message under the field (text, not colour alone), aria-invalid + aria-describedby on the input.
  function addDescribedBy(el, id) { const t = (el.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean); if (!t.includes(id)) t.push(id); el.setAttribute('aria-describedby', t.join(' ')); }
  function removeDescribedBy(el, id) { const t = (el.getAttribute('aria-describedby') || '').split(/\s+/).filter((x) => x && x !== id); if (t.length) el.setAttribute('aria-describedby', t.join(' ')); else el.removeAttribute('aria-describedby'); }
  function setFieldErr(el, msg) {
    const field = el.closest('.field'); if (!field) return;
    const id = el.id + 'Err'; let p = document.getElementById(id);
    if (!p) { p = document.createElement('p'); p.className = 'err'; p.id = id; field.appendChild(p); }
    p.textContent = msg; field.classList.add('is-err');
    el.setAttribute('aria-invalid', 'true'); addDescribedBy(el, id);
  }
  function clearFieldErr(el) {
    const field = el.closest('.field'); if (!field) return;
    field.classList.remove('is-err'); removeDescribedBy(el, el.id + 'Err');
    if (!field.classList.contains('is-fit')) el.removeAttribute('aria-invalid');
  }
  // Mirrors phoneProblem() in functions/api/_lib.js: 10+ digits and never a sample 555-01xx number.
  function phoneIssue(v) {
    const d = String(v || '').replace(/\D/g, '');
    if (!d) return 'Add a phone number so the dog gets home.';
    if (d.length < 10) return 'Use a full phone number with area code (10 digits).';
    const l = d.slice(-7); if (l.slice(0, 3) === '555' && l.slice(3, 5) === '01') return 'That is a sample number. Enter your real phone number.';
    return '';
  }
  const setCnt = (i, v) => { const el = $('#fcnt' + i); if (el) { el.textContent = v.length + '/24'; el.classList.toggle('is-tight', v.length > 16); } };
  // Back lines: same 24-character limit as the front (and functions/api/order.js back1-3).
  const setBCnt = (i, v) => { const el = $('#bcnt' + i); if (el) { el.textContent = v.length + '/24'; el.classList.toggle('is-tight', v.length > 16); } };
  // Checkout field rules: must match functions/api/_lib.js (EMAIL_RE, ADDR_MIN, ZIP_RE).
  const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/, ADDR_MIN = 10, ZIP_RE = /^\d{5}(-?\d{4})?$/, PRIZE_RE = /^SDT-UP-[A-Z0-9]{4}$/i;

  // Must match functions/api/_lib.js
  const PRICES = { fullcolor: { small: 12, medium: 14, large: 16, xl: 18 }, raisedCents: 300, designCents: 200, ornament: { acrylic: 2400, stainless: 3600 }, size: { small: 12, medium: 14, large: 16, xl: 18 }, premium: { stainless: 4, ssblack: 4, navy: 4, gold: 4, bronze: 4, rainbow: 4, polished: 6, brass: 4 }, addon: { icon: 4, line: 6, photo: 14 }, ship: 4.5, freeOver: 35, multiQty: 3, multiOff: 0.15, smartCents: 500 };
  // Smart QR tag add-on: one-time per entry, outside the 15% discount. Mirrors SMART_PRICE / SMART_LINE in functions/api/_lib.js (a test keeps them equal).
  const SMART_LINE = 'Scan-to-find QR with email alerts';
  const SMART = { on: false, price: PRICES.smartCents / 100 };   // on/price come from /api/config
  // Laser color + photo engraving only work on stainless (kind:'stainless' below). Must match _lib.js STAINLESS_FINISHES.
  const isStainlessKind = (finish) => ((FINISHES[finish] || {}).kind === 'stainless');
  /* ---------- full color UV print (xTool O1 Omni) + the holiday ornament ----------
     Prices live in PRICES above (fullcolor per size, raisedCents, ornament in cents). Everything else Nick may change is here.
     Each value mirrors functions/api/_lib.js (FULLCOLOR_SHAPES, ORNAMENT_RAISED_INCLUDED, SHIP_FROM, ART_ACK_TEXT); a test keeps them equal. */
  const FULLCOLOR_SHAPES = ['bone', 'round', 'heart', 'paw', 'military'];
  const ORNAMENT_RAISED_INCLUDED = true;
  const SHIP_FROM = 'Lehi, UT'; // changes after the January move: edit here and in _lib.js
  // Christmas cutoff (Lady Jaye B4, 2026-11-16). The clocks run from PAYMENT (Mail Order Rule), so the pay-by date is part of the promise.
  // Nick's commitment behind it: invoice within 1 business day, ship within 2 business days of payment, through Dec 16. Change the dates here and rebuild.
  const ORNAMENT_CUTOFF = 'Sat, Dec 12';
  const ORNAMENT_PAY_BY = 'Mon, Dec 14';
  const ORNAMENT_SHIP_BY = 'Wed, Dec 16';
  const ORNAMENT_AKHI_BY = 'Fri, Dec 4';
  const USPS_GROUND_DATE = 'Dec 17';
  const ornamentHero = () => `Order by ${ORNAMENT_CUTOFF} and pay your invoice by ${ORNAMENT_PAY_BY} for Christmas in the lower 48.`;
  // Lady Jaye B5. The [text](/path) part renders as a link. Mirrors ART_ACK_TEXT and ART_ACK_VERSION in functions/api/_lib.js.
  const ART_ACK_TEXT = "I took this photo or made this art, or I have permission from whoever did to have it printed. It has no logos, team names or characters I don't have rights to, and everyone in it agreed (a parent or guardian for kids). I agree to the [artwork terms](/policies/#artwork).";
  const ART_REVIEW_NOTE = "We check every upload by hand before you pay. If we can't print it, you pay nothing, or get a full refund.";
  const ackHtml = (t) => esc(t).replace(/\[([^\]]+)\]\((\/[^)\s]*)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  const ORNAMENT_MAX_LINES = 5; // mirrors MAX_ORNAMENT_LINES in _lib.js
  // Master switch (mirrors ORNAMENT_ENABLED in functions/api/_lib.js). false: no ornament page, links or cart lines; the code stays.
  const ORNAMENT_ENABLED = false;
  const UPLOAD_BLOCK_PX = 150, UPLOAD_WARN_PX = 300; // short side of an uploaded raster, in pixels
  // Styles that carry the design fee (PRICES.designCents, once per design). Mirrors DESIGN_FEE_STYLES in functions/api/_lib.js. Bold type stays free.
  const DESIGN_FEE_STYLES = ['mascot', 'synthwave', 'photo'];
  const designFee = (t) => (isFullcolor(t.finish) && t.art === 'design' && DESIGN_FEE_STYLES.includes(t.style) ? PRICES.designCents / 100 : 0);
  const ART_STYLES = { mascot: { n: 'Bulldog mascot', d: 'Our bulldog, your saying' }, synthwave: { n: 'Synthwave', d: 'Neon sunset' }, bold: { n: 'Bold type', d: 'Big plain letters' }, photo: { n: 'Photo + saying', d: 'Your dog, your saying', needsImage: true } };
  const isFullcolor = (finish) => finish === 'fullcolor';
  // Printed tag size: the long edge of the shape is the size tier's inch size (1, 1.5, 2, 2.5 in), the other edge follows the shape.
  const FC_LONG_MM = { small: 25, medium: 38, large: 51, xl: 64 };
  // Shape bounding boxes in the 320x240 preview box (match OUT[shape].bb in tag-layout.js) and the text band used on photos and artwork.
  const FC_BBOX = { bone: [40, 50, 280, 210], heart: [40, 36, 280, 236], round: [60, 32, 260, 232], military: [20, 62, 300, 202], paw: [58, 22, 262, 228] };
  const FC_TEXT = { bone: { cx: 160, cy: 146, w: 150, h: 60 }, heart: { cx: 160, cy: 150, w: 116, h: 50 }, round: { cx: 160, cy: 186, w: 120, h: 44 }, military: { cx: 190, cy: 178, w: 200, h: 44 }, paw: { cx: 160, cy: 190, w: 104, h: 40 } };
  const FC_BOLD = { bone: { cx: 160, cy: 140, w: 150, h: 70 }, heart: { cx: 160, cy: 148, w: 122, h: 92 }, round: { cx: 160, cy: 150, w: 134, h: 92 }, military: { cx: 190, cy: 134, w: 208, h: 84 }, paw: { cx: 160, cy: 190, w: 116, h: 60 } };
  const fcDims = (shape, size) => { const b = FC_BBOX[shape] || FC_BBOX.bone, w = b[2] - b[0], h = b[3] - b[1], k = (FC_LONG_MM[size] || FC_LONG_MM.medium) / Math.max(w, h); return [Math.round(w * k * 10) / 10, Math.round(h * k * 10) / 10]; };
  const COLOR_HUES = { blue: { n: 'Blue', c: '#1E4FD8' }, gold: { n: 'Gold', c: '#D4AF4A' }, purple: { n: 'Purple', c: '#9C6BD6' }, bronze: { n: 'Bronze', c: '#B5885A' } };

  const SHAPES = { bone: { n: 'Bone' }, heart: { n: 'Heart' }, round: { n: 'Round' }, military: { n: 'Military' }, paw: { n: 'Paw' }, hydrant: { n: 'Hydrant' }, fish: { n: 'Fish' }, cat: { n: 'Cat' }, star: { n: 'Star' }, house: { n: 'House' } };
  // Shapes with no blanks on hand: kept in code (art, templates, server enum) but not offered. Must match ACTIVE_SHAPES in functions/api/_lib.js.
  const HIDDEN_SHAPES = ['hydrant', 'fish', 'cat', 'star', 'house'];
  // Trailer pickup is off until the Thirsty Beaches handoff exists. Must match PICKUP_ENABLED in functions/api/_lib.js.
  const PICKUP_ENABLED = false;
  // sizes are price tiers (key -> $), the label a customer sees comes from the real blank (BLANK_MM)
  const SIZES = { small: { n: 'Small', d: '1"' }, medium: { n: 'Medium', d: '1.5"' }, large: { n: 'Large', d: '2"' }, xl: { n: 'XL', d: '2.5"' } };
  // Real blank sizes in mm [w, h]. Mirrors assets/shapes/shapes.json blank_mm (overwritten from it once loaded; a test keeps them equal).
  const US_STATES = ['AL','AK','AZ','AR','CA','CO','CT','DE','DC','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','PR','GU','VI','AS','MP','AA','AE','AP']; // 50 + DC; must match functions/api/_lib.js
  const BLANK_MM = { bone: [38, 25], heart: [38, 33], round: [32, 32], military: [51, 29], paw: [37, 38], hydrant: [30.2, 33.3], fish: [38, 24], cat: [23, 23], star: [36, 35], house: [38, 35] };
  const fmtNum = (n) => String(Math.round(n * 10) / 10).replace(/\.0$/, '');
  const dimsOf = (shape, size, finish) => (isFullcolor(finish) ? fcDims(shape, size) : BLANK_MM[shape]);
  const mmLabel = (shape, size, finish) => {
    const b = dimsOf(shape, size, finish); if (!b) return '';
    return (b[0] === b[1] ? fmtNum(b[0]) : fmtNum(b[0]) + ' \u00D7 ' + fmtNum(b[1])) + ' mm';
  };
  const inLabel = (shape, size, finish) => {
    const b = dimsOf(shape, size, finish); if (!b) return '';
    const i = (n) => fmtNum(n / 25.4);
    return (b[0] === b[1] ? i(b[0]) : i(b[0]) + ' \u00D7 ' + i(b[1])) + ' in';
  };
  // What each shape actually comes in (from research/tag-blanks.md). Key = finish kind or '*'.
  const SIZE_AVAIL = { bone: { '*': ['medium'], polished: ['large'] }, heart: { '*': ['medium'] }, round: { '*': ['small'], black: ['medium'], brass: ['medium'] }, military: { '*': ['large'] }, paw: { '*': ['medium'] } };
  const sizesFor = (shape, finish) => { if (isFullcolor(finish)) return Object.keys(SIZES); const a = SIZE_AVAIL[shape] || { '*': ['medium'] }; return a[finish] || a[(FINISHES[finish] || {}).kind] || a['*']; };
  // Anodized: the laser strips the colour and exposes bright silver, so the ink is always bright (ink:'light').
  // Light colours (lum >= .6: sky, yellow, silver, light pink) show lower contrast; lowContrast() flags them in the picker.
  // The ten colors in the EupHHonycs/MBAIYO 100-packs (seen on the listing photo 2026-10-11). ink = what a MOPA mark looks like on it.
  const FINISHES = {
    black: { n: 'Black', c: '#1E2124', kind: 'anodized', ink: 'light' },
    red: { n: 'Red', c: '#E23B3B', kind: 'anodized', ink: 'light' },
    royal: { n: 'Royal blue', c: '#2F5FD8', kind: 'anodized', ink: 'light' },
    sky: { n: 'Sky blue', c: '#5CB9EA', kind: 'anodized', ink: 'light' },
    green: { n: 'Green', c: '#4FC27C', kind: 'anodized', ink: 'light' },
    yellow: { n: 'Yellow', c: '#F4C83F', kind: 'anodized', ink: 'light' },
    silver: { n: 'Silver', c: '#DADDE1', kind: 'anodized', ink: 'light' },
    pink: { n: 'Light pink', c: '#F4BBD2', kind: 'anodized', ink: 'light' },
    hotpink: { n: 'Hot pink', c: '#EE5FA6', kind: 'anodized', ink: 'light' },
    stainless: { n: 'Stainless +$4', c: '#C9CED4', kind: 'stainless', ink: 'dark' },
    ssblack: { n: 'Black stainless +$4', c: '#2B2E33', kind: 'stainless', ink: 'light' },
    navy: { n: 'Navy stainless +$4', c: '#1F3A6E', kind: 'stainless', ink: 'light' },
    gold: { n: 'Gold stainless +$4', c: '#D4AF4A', kind: 'stainless', ink: 'dark' },
    bronze: { n: 'Bronze stainless +$4', c: '#B5885A', kind: 'stainless', ink: 'dark' },
    rainbow: { n: 'Rainbow stainless +$4', c: '#9C6BD6', kind: 'stainless', ink: 'dark' },
    polished: { n: 'Polished stainless +$6', c: '#E4E7EA', kind: 'stainless', ink: 'dark' },
    brass: { n: 'Brass +$4', c: '#D2AB5C', kind: 'brass', ink: 'dark' },
    fullcolor: { n: 'Full color print', c: '#FFFFFF', kind: 'fullcolor', ink: 'dark' },
  };
  const finishOk = (finish, shape) => (isFullcolor(finish) ? FULLCOLOR_SHAPES.includes(shape) : Boolean(BLANK_PHOTOS[shape + '-' + finish]));
  // Light anodized colours: bright silver engraving has less contrast against them.
  const lowContrast = (finish) => { const f = FINISHES[finish]; if (!f || f.kind !== 'anodized') return false; const h = f.c.replace('#', ''); return (0.299 * parseInt(h.slice(0, 2), 16) + 0.587 * parseInt(h.slice(2, 4), 16) + 0.114 * parseInt(h.slice(4, 6), 16)) / 255 >= 0.6; };
  const sizeLabel = (size, shape, finish) => { if (shape && BLANK_MM[shape]) return mmLabel(shape, size, finish) + ' (' + inLabel(shape, size, finish) + ')'; const z = SIZES[size] || SIZES.medium; return z.n + ' ' + z.d; };

  const SAYINGS = [
    { c: 'bulldog', l: ['I snore.', "It's not", 'a medical thing.'] },
    { c: 'bulldog', l: ['Drool', 'happens.'] },
    { c: 'bulldog', l: ['Built like', 'a loaf.'] },
    { c: 'bulldog', l: ["Can't swim.", 'Still at', 'the beach.'] },
    { c: 'bulldog', l: ['Underbite.', 'Overlove.'] },
    { c: 'bulldog', l: ['Stubborn.', 'Call my mom.'] },
    { c: 'bulldog', l: ['Runs on', 'naps and spite.'] },
    { c: 'bulldog', l: ['Low rider.', 'High', 'maintenance.'] },
    { c: 'bulldog', l: ['Wrinkly.', 'Still cute.'] },
    { c: 'bulldog', l: ['Professional', 'snuggler.'] },
    { c: 'lost', l: ["I'm lost.", "Also I'm", 'an idiot.'] },
    { c: 'lost', l: ['Call my mom.', "She's", 'freaking out.'] },
    { c: 'lost', l: ['Microchipped.', 'Still dumb.'] },
    { c: 'lost', l: ['If found,', 'bring snacks.'] },
    { c: 'lost', l: ['Escape artist.', 'Please return.'] },
    { c: 'lost', l: ["Don't follow me.", "I'm lost too."] },
    { c: 'lost', l: ["If I'm alone,", 'I screwed up.'] },
    { c: 'lost', l: ['Reward:', 'one (1) kiss.'] },
    { c: 'attitude', l: ['Certified', 'menace.'] },
    { c: 'attitude', l: ['Zero chill.', 'Full chaos.'] },
    { c: 'attitude', l: ['I bite.', '(Sandwiches.)'] },
    { c: 'attitude', l: ["I know I'm cute.", 'Call my', 'mom anyway.'] },
    { c: 'attitude', l: ['Ask me about', 'my ball.'] },
    { c: 'attitude', l: ['Emotional', 'support human', 'at home.'] },
    { c: 'family', l: ['Has 2 moms.', 'Both worried.'] },
    { c: 'family', l: ['My people are', 'helpless', 'without me.'] },
    { c: 'family', l: ["Dad's favorite.", "Don't tell mom."] },
    { c: 'beach', l: ['Beach bum.', 'Return to sand.'] },
    { c: 'beach', l: ['Stay salty.'] },
    { c: 'beach', l: ['Sandy paws,', 'salty heart.'] },
    { c: 'beach', l: ['Lifeguard', '(off duty).'] },
    { c: 'bulldog', l: ['Wheezes', 'with purpose.'] },
    { c: 'bulldog', l: ['Breathing', 'is my cardio.'] },
    { c: 'bulldog', l: ['Built for', 'comfort,', 'not speed.'] },
    { c: 'bulldog', l: ['Gas is', 'a feature.'] },
    { c: 'attitude', l: ['Not lost.', 'Exploring', 'without consent.'] },
    { c: 'attitude', l: ['Return for', 'reward.', 'Reward is me.'] },
    { c: 'attitude', l: ['I have', 'a lawyer.', "She's my mom."] },
    { c: 'attitude', l: ['Allergic to', 'responsibility.'] },
    { c: 'attitude', l: ['Good boy', '(legally', 'disputed).'] },
    { c: 'attitude', l: ['I licked it.', "It's mine."] },
    { c: 'attitude', l: ['I came.', 'I saw.', 'I napped.'] },
    { c: 'attitude', l: ['Treats', 'accepted', 'as bribes.'] },
    { c: 'attitude', l: ['My other tag', 'is also lost.'] },
    { c: 'attitude', l: ['If you can', 'read this,', "I'm a flight risk."] },
    { c: 'attitude', l: ['Outside is', 'overrated.', 'Take me home.'] },
    { c: 'attitude', l: ['Will work for', 'belly rubs.', 'Union rules.'] },
    { c: 'cute', l: ["I'm somebody's", 'whole heart.'] },
    { c: 'cute', l: ['Small. Loud.', 'Deeply loved.'] },
    { c: 'cute', l: ['Pocket-sized', 'problem.'] },
    { c: 'cute', l: ['Here for', 'the snacks.'] },
    { c: 'cute', l: ['Velcro dog.', 'Will not detach.'] },
    { c: 'cute', l: ['Big feelings.', 'Tiny body.'] },
    { c: 'cute', l: ['Needs a nap', 'and a hug.'] },
    { c: 'attitude', l: ['Toots with', 'confidence.'] },
    { c: 'attitude', l: ['Barks first.', 'Thinks never.'] },
    { c: 'attitude', l: ['Tiny.', 'Mighty.', 'Farty.'] },
    { c: 'bulldog', l: ['Snorts.', 'Means it.'] },
    { c: 'lost', l: ['Mom has', 'the snacks.', 'Find her.'] },
    { c: 'family', l: ['The baby.', 'Everyone', 'knows it.'] },
    { c: 'family', l: ["Grandma's", 'favorite.'] },
    { c: 'beach', l: ['Salty dog.', 'Sandy butt.'] },
    { c: 'beach', l: ['Sun-dried', 'and spoiled.'] },
    { c: 'attitude', l: ['Does not', 'come when called.', 'Try snacks.'] },
    { c: 'attitude', l: ['Barks at', 'the mailman.', 'Daily.'] },
    { c: 'attitude', l: ['Selective', 'hearing.', 'Perfect smell.'] },
    { c: 'attitude', l: ['Ate homework.', 'Was delicious.'] },
    { c: 'attitude', l: ['Chaos', 'coordinator.'] },
    { c: 'lost', l: ['Lost again.', 'Not sorry.'] },
    { c: 'lost', l: ["I know where", "I live.", "I just won't say."] },
    { c: 'lost', l: ['Call my dad.', "Mom's", 'already crying.'] },
    { c: 'lost', l: ['Wandered off.', 'Saw a squirrel.'] },
    { c: 'attitude', l: ['Treat me', 'or leave me.'] },
    { c: 'attitude', l: ['Cute but', 'will steal', 'your sandwich.'] },
    { c: 'attitude', l: ['Boss of', 'this house.'] },
    { c: 'attitude', l: ['Small dog.', 'Big mouth.'] },
    { c: 'family', l: ['My humans', 'are lost.', 'Please help them.'] },
    { c: 'family', l: ['Raised by', 'cats.', 'Explains a lot.'] },
    { c: 'family', l: ['Firstborn.', 'Still the', 'favorite.'] },
    { c: 'cute', l: ['Professional', 'good boy.'] },
    { c: 'cute', l: ['Will sit', 'for cheese.'] },
    { c: 'cute', l: ['Soft. Sweet.', 'Slightly', 'unhinged.'] },
    { c: 'beach', l: ['Surf dog.', 'Zero skills.'] },
    { c: 'beach', l: ['Salt water', 'and snacks.'] },
    { c: 'bulldog', l: ['Snores louder', 'than dad.'] },
    { c: 'bulldog', l: ['Runs the house.', "Can't run."] },
    { c: 'lost', l: ['If found,', 'feed me.', 'Then call.'] },
    { c: 'lost', l: ['Not lost.', 'Taking a tour.'] },
    { c: 'cute', l: ['Professional', 'couch warmer.'] },
    { c: 'cute', l: ['Smol.', 'Loud.', 'Yours.'] },
    { c: 'family', l: ['Not a cat.', 'Call my mom.'] },
    // 18+ — only shown after the visitor confirms they're an adult (localStorage sdt-adult)
    { c: 'adult', x: true, l: ['Yes, I lick my own junk.', "We can't all be perfect."] },
    { c: 'adult', x: true, l: ["I'm not fat.", "I'm fucking fluffy."] },
    { c: 'adult', x: true, l: ['Not lost.', 'On a bender.'] },
    { c: 'adult', x: true, l: ['Neutered.', 'Still a dick.'] },
    { c: 'adult', x: true, l: ['Humps first.', 'Asks never.'] },
    { c: 'adult', x: true, l: ['If found, I already', 'shit in your house.'] },
    { c: 'adult', x: true, l: ['Zero fucks.', 'Zero balls. Same day.'] },
    { c: 'adult', x: true, l: ['Call my mom.', "She's shitfaced too."] },
    { c: 'adult', x: true, l: ['Barks at nothing.', 'Fucks with everything.'] },
    { c: 'adult', x: true, l: ['Not microchipped.', 'Just thick.'] },
    { c: 'adult', x: true, l: ['I ate the couch.', 'Worth it.'] },
    { c: 'adult', x: true, l: ['Bad bitch.', 'Literally.'] },
    { c: 'adult', x: true, l: ["I'd return myself", "but I'm an asshole."] },
    { c: 'adult', x: true, l: ['Licks butts.', 'Judges you.'] },
    { c: 'adult', x: true, l: ['Ran off.', 'Shit got boring.'] },
    { c: 'adult', x: true, l: ['Snores. Farts.', 'Still your problem.'] },
    { c: 'adult', x: true, l: ['Pet me', 'or fuck off.'] },
    { c: 'adult', x: true, l: ['Certified good boy.', 'Also an ass.'] },
    { c: 'adult', x: true, l: ['My balls are gone.', "My attitude isn't."] },
    { c: 'adult', x: true, l: ['Lost my shit.', 'Then ate it.'] },
    { c: 'adult', x: true, l: ["I'm why", 'mom drinks.'] },
    { c: 'adult', x: true, l: ["Dad's drunk.", 'Call mom.'] },
    { c: 'adult', x: true, l: ['Sniffed your crotch.', 'No regrets.'] },
    { c: 'adult', x: true, l: ['Stole a steak.', 'Would again.'] },
    { c: 'adult', x: true, l: ['Escaped. Again.', 'You suck at this.'] },
    { c: 'adult', x: true, l: ['Lost as fuck.', 'Call my people.'] },
    { c: 'adult', x: true, l: ['Son of a bitch.', 'Obviously.'] },
    { c: 'adult', x: true, l: ['Legally', 'a little shit.'] },
    { c: 'adult', x: true, l: ['Fuck around.', 'Find out.'] },
    { c: 'adult', x: true, l: ['Drools on', 'everything you love.'] },
    { c: 'adult', x: true, l: ['Ate a sock.', "It's fine. Probably."] },
    { c: 'adult', x: true, l: ['Shit happens.', 'Mostly on the rug.'] },
    { c: 'adult', x: true, l: ['Licks balls.', "Doesn't have any."] },
    { c: 'adult', x: true, l: ['Humps legs.', 'Takes requests.'] },
    { c: 'adult', x: true, l: ['Big dick energy.', 'Small dick.'] },
    { c: 'adult', x: true, l: ["I've seen", 'my mom naked.', 'Daily.'] },
    { c: 'adult', x: true, l: ['Eats ass.', 'Literally.', 'Cat litter box.'] },
    { c: 'adult', x: true, l: ['Sniffs crotches.', 'Rates them.'] },
    { c: 'adult', x: true, l: ['Horny.', 'Neutered.', 'Confused.'] },
    { c: 'adult', x: true, l: ['Mom calls me', 'baby.', "Dad calls me shithead."] },
    { c: 'adult', x: true, l: ['Will hump', 'your pillow.', "You've been warned."] },
    { c: 'adult', x: true, l: ['Got my balls cut.', 'Still a bigger man', 'than your ex.'] },
    { c: 'adult', x: true, l: ['Fucks a', 'stuffed duck.', 'No shame.'] },
    { c: 'adult', x: true, l: ['Third wheel', 'in the bedroom.', 'Watches.'] },
    { c: 'adult', x: true, l: ['Cockblocker.', 'Professional.'] },
    { c: 'adult', x: true, l: ['Nut-free', 'since the vet.'] },
    { c: 'adult', x: true, l: ['Drops a deuce', 'then stares', 'at you.'] },
    { c: 'adult', x: true, l: ['Farts in bed.', 'Blames dad.'] },
    { c: 'adult', x: true, l: ["Mom's drunk.", "Dad's high.", "I'm the adult."] },
    { c: 'adult', x: true, l: ['Butt scoots', 'on your couch.'] },
    { c: 'adult', x: true, l: ['Licks the', 'toilet. Then', 'kisses you.'] },
    { c: 'adult', x: true, l: ['Shits outside.', 'Still classier', 'than you.'] },
    { c: 'adult', x: true, l: ['Rolls in', 'dead shit.', 'Smells great.'] },
    { c: 'adult', x: true, l: ['Good boy.', 'Terrible', 'fucking influence.'] },
    { c: 'adult', x: true, l: ["Vet took my balls.", "Mom took my dignity.", "Dad took the credit."] },
    { c: 'adult', x: true, l: ["Balls removed.", "Hump drive intact."] },
    { c: 'adult', x: true, l: ["Two balls short", "of a good time."] },
    { c: 'adult', x: true, l: ["Shooting blanks", "since the vet.", "Still aiming at you."] },
    { c: 'adult', x: true, l: ["Snipped at six months.", "Peaked at five."] },
    { c: 'adult', x: true, l: ["Got fixed.", "Still broken."] },
    { c: 'adult', x: true, l: ["My balls? Ask the vet.", "He has a jar."] },
    { c: 'adult', x: true, l: ["Ran off.", "Looking for my balls.", "Vet knows something."] },
    { c: 'adult', x: true, l: ["I'm fixed.", "Dad should be too.", "Ask mom."] },
    { c: 'adult', x: true, l: ["Not lost.", "Avoiding the vet.", "He wants my balls."] },
    { c: 'adult', x: true, l: ["Pillow's pregnant.", "Not my problem."] },
    { c: 'adult', x: true, l: ["Will hump for treats.", "Will hump for free.", "Will hump regardless."] },
    { c: 'adult', x: true, l: ["The stuffed bear", "said no.", "Bear's a liar."] },
    { c: 'adult', x: true, l: ["Humps the ottoman.", "It's complicated."] },
    { c: 'adult', x: true, l: ["Dry humps only.", "Vet's orders."] },
    { c: 'adult', x: true, l: ["Your leg is my type.", "Don't move."] },
    { c: 'adult', x: true, l: ["Humped a lamp.", "Lamp's name is Karen.", "We're not talking."] },
    { c: 'adult', x: true, l: ["Lasts four seconds.", "Longer than dad."] },
    { c: 'adult', x: true, l: ["Ate the vibrator.", "Still buzzing."] },
    { c: 'adult', x: true, l: ["I sleep in their bed.", "Nothing happens.", "I've checked."] },
    { c: 'adult', x: true, l: ["Mom's single.", "Best man in her life.", "Has four legs."] },
    { c: 'adult', x: true, l: ["Dad's ex hated me.", "Guess who stayed."] },
    { c: 'adult', x: true, l: ["I watch them do it.", "It's quick."] },
    { c: 'adult', x: true, l: ["Mom swipes right.", "I sniff them first.", "Most fail."] },
    { c: 'adult', x: true, l: ["Their bed, my spot.", "Date night's cancelled."] },
    { c: 'adult', x: true, l: ["Farted.", "Walked away.", "Left mom to explain."] },
    { c: 'adult', x: true, l: ["Poops mid-walk.", "Full eye contact."] },
    { c: 'adult', x: true, l: ["Farted on the baby.", "Baby started it."] },
    { c: 'adult', x: true, l: ["Ate poop.", "Kissed grandma.", "Both on purpose."] },
    { c: 'adult', x: true, l: ["I know what", "you had for dinner.", "I sniffed it twice."] },
    { c: 'adult', x: true, l: ["Pooped in the shoe.", "The nice one."] },
    { c: 'adult', x: true, l: ["Butt juice on the rug.", "Glands, look it up."] },
    { c: 'adult', x: true, l: ["Stepped in shit.", "Tracked it to bed.", "Your side."] },
    { c: 'adult', x: true, l: ["Mom's three wines deep.", "I'm the sober one."] },
    { c: 'adult', x: true, l: ["Dad puked.", "I ate it.", "Team effort."] },
    { c: 'adult', x: true, l: ["If found, try the bar.", "Mom's the loud one."] },
    { c: 'adult', x: true, l: ["Hungover parents.", "Walked at 2pm.", "Pissed on the bed."] },
    { c: 'adult', x: true, l: ["Mom drinks.", "Dad drinks.", "I eat the evidence."] },
    { c: 'adult', x: true, l: ["If found", "don't call mom", "she's on a date."] },
    { c: 'adult', x: true, l: ["I left on purpose.", "Dad's girlfriend", "is the worst."] },
    { c: 'adult', x: true, l: ["Reward if found:", "mom's number", "she's recently single."] },
    { c: 'adult', x: true, l: ["If found, I'm fine.", "Just humped a stranger", "and panicked."] },
    { c: 'adult', x: true, l: ["Dad's emotional", "support animal.", "Also his wingman."] },
    { c: 'adult', x: true, l: ["Dog years, I'm 49.", "Divorced twice."] },
    { c: 'adult', x: true, l: ["Drools on crotches.", "Don't stand still."] },
    // ---- 2026-10-12 batch: Opus-generated, Cover Girl-curated (b = breed) ----
    { c: "attitude", l: ["Hears cheese", "from three rooms."] },
    { c: "attitude", l: ["Knocked it over.", "On purpose.", "Eye contact."] },
    { c: "family", l: ["Mom's favorite.", "Dad's problem."] },
    { c: "lost", l: ["Ran away.", "Came back", "for dinner."] },
    { c: "beach", l: ["Stole your sandwich.", "Beach rules."] },
    { c: "cute", l: ["Will sit on you.", "Not a request."] },
    { c: "adult", x: true, l: ["Snack-motivated", "little bastard."] },
    { c: "adult", x: true, l: ["Dinner's late.", "Shit's about", "to get ugly."] },
    { c: "adult", x: true, l: ["Wandered off.", "Found trouble.", "Liked it."] },
    { c: "breed", b: "aussie", l: ["Herded your kids.", "You're welcome."] },
    { c: "breed", b: "aussie", l: ["I don't bark.", "I file complaints."] },
    { c: "lost", b: "aussie", l: ["Not lost.", "Herding traffic."] },
    { c: "adult", x: true, b: "aussie", l: ["Australian Shepherd.", "Never seen a", "fucking sheep."] },
    { c: "adult", x: true, b: "aussie", l: ["Herded my humans.", "Lost one at the bar."] },
    { c: "breed", b: "basset", l: ["Not sad.", "Face just", "does this."] },
    { c: "breed", b: "basset", l: ["Will not walk.", "Am now", "furniture."] },
    { c: "cute", b: "basset", l: ["Ears drag.", "Dignity too."] },
    { c: "adult", x: true, b: "basset", l: ["Sad eyes.", "Zero fucks."] },
    { c: "breed", b: "beagle", l: ["Nose on.", "Brain off."] },
    { c: "lost", b: "beagle", l: ["Not lost.", "Tracking a", "sandwich."] },
    { c: "breed", b: "beagle", l: ["I don't bark.", "I bay.", "There's a difference."] },
    { c: "adult", x: true, b: "beagle", l: ["Beagle.", "AKA loud asshole", "with a nose."] },
    { c: "adult", x: true, b: "beagle", l: ["Stubborn as hell.", "Loud as hell.", "Hungry as hell."] },
    { c: "attitude", b: "bernese", l: ["Swiss.", "Neutral on", "everything but snacks."] },
    { c: "breed", b: "bernese", l: ["Wears a tuxedo.", "Has no plans."] },
    { c: "lost", b: "bernese", l: ["If found melting,", "return to snow."] },
    { c: "adult", x: true, b: "bernese", l: ["I shed on everything.", "Your black pants", "are fucked."] },
    { c: "adult", x: true, b: "bernese", l: ["Bred to haul cheese.", "Now I haul ass", "toward the fridge."] },
    { c: "adult", x: true, b: "bernese", l: ["It's hot as balls.", "I'm a fur coat.", "Take me home."] },
    { c: "attitude", b: "border-collie", l: ["Knows 200 words.", "Ignores all of them."] },
    { c: "breed", b: "border-collie", l: ["Herds the Roomba.", "Roomba hates it."] },
    { c: "beach", b: "border-collie", l: ["Herded the waves.", "Ocean won."] },
    { c: "adult", x: true, b: "border-collie", l: ["Don't make eye contact.", "I will fucking win."] },
    { c: "adult", x: true, b: "border-collie", l: ["Retired sheepdog.", "Now I herd", "your drunk friends."] },
    { c: "breed", b: "boxer", l: ["Wags whole body.", "Tail is", "just a rumor."] },
    { c: "breed", b: "boxer", l: ["Class clown.", "Never graduated."] },
    { c: "adult", x: true, b: "boxer", l: ["My face is", "permanently", "\"what the fuck.\""] },
    { c: "adult", x: true, b: "boxer", l: ["Matured at 3.", "Kidding. Still an idiot."] },
    { c: "bulldog", b: "bulldog", l: ["Walk ended.", "I lay down.", "Negotiate."] },
    { c: "bulldog", b: "bulldog", l: ["Breathes like", "a broken", "vacuum."] },
    { c: "bulldog", b: "bulldog", l: ["Will not fetch.", "Will watch you fetch."] },
    { c: "bulldog", b: "bulldog", l: ["Face like a fist.", "Heart like a pillow."] },
    { c: "bulldog", b: "bulldog", l: ["Sounds like a pig.", "Thinks he's a lion."] },
    { c: "adult", x: true, b: "bulldog", l: ["Walked 10 feet.", "Fuck cardio."] },
    { c: "adult", x: true, b: "bulldog", l: ["Snores like a", "drunk uncle.", "Farts like one too."] },
    { c: "adult", x: true, b: "bulldog", l: ["Ugly as shit.", "Mom thinks I'm", "a goddamn angel."] },
    { c: "adult", x: true, b: "bulldog", l: ["Face full of wrinkles.", "Ass full of gas."] },
    { c: "lost", b: "cat", l: ["If found,", "you're the", "staff now."] },
    { c: "breed", b: "cat", l: ["Maine Coon.", "Not a raccoon.", "Mostly."] },
    { c: "adult", x: true, b: "cat", l: ["Bit the vet.", "Fuck that guy."] },
    { c: "adult", x: true, b: "cat", l: ["If found:", "high as shit", "on catnip."] },
    { c: "breed", b: "cattle-dog", l: ["Nips heels.", "It's called", "management."] },
    { c: "attitude", b: "cattle-dog", l: ["One-person dog.", "You are not", "the person."] },
    { c: "adult", x: true, b: "cattle-dog", l: ["Part dingo.", "All asshole."] },
    { c: "adult", x: true, b: "cattle-dog", l: ["Born white, turned blue.", "Been pissed ever since."] },
    { c: "breed", b: "chihuahua", l: ["Not scared.", "Shaking with rage."] },
    { c: "breed", b: "chihuahua", l: ["Will outlive", "us all.", "Out of spite."] },
    { c: "beach", b: "chihuahua", l: ["Beach?", "Sand is lava.", "Carry me."] },
    { c: "adult", x: true, b: "chihuahua", l: ["6 lbs of", "pure fucking rage."] },
    { c: "adult", x: true, b: "chihuahua", l: ["Shaking isn't fear.", "I'm just pissed."] },
    { c: "lost", b: "corgi", l: ["Couldn't have", "gone far.", "Look at my legs."] },
    { c: "breed", b: "corgi", l: ["Royal lineage.", "Eats socks."] },
    { c: "cute", b: "corgi", l: ["Loaf-shaped.", "Fully baked."] },
    { c: "adult", x: true, b: "corgi", l: ["Royal bloodline.", "Shits like a peasant."] },
    { c: "adult", x: true, b: "corgi", l: ["Ran away.", "Got 40 feet.", "Fuck these legs."] },
    { c: "breed", b: "dachshund", l: ["Long dog.", "Short temper."] },
    { c: "breed", b: "dachshund", l: ["Bred to hunt badgers.", "Now hunts blankets."] },
    { c: "cute", b: "dachshund", l: ["Half a dog tall.", "A dog and a half long."] },
    { c: "adult", x: true, b: "dachshund", l: ["Wiener dog.", "Bigger wiener", "than your ex."] },
    { c: "adult", x: true, b: "dachshund", l: ["Will bite your ankles.", "That's as high", "as I can reach, bitch."] },
    { c: "breed", b: "doberman", l: ["Bred by a", "tax collector.", "Will take your sandwich."] },
    { c: "family", b: "doberman", l: ["Mailman's", "worst nightmare.", "Mom's baby."] },
    { c: "adult", x: true, b: "doberman", l: ["Guard dog.", "Guards jack shit."] },
    { c: "adult", x: true, b: "doberman", l: ["Former K9.", "Fired for", "eating the evidence."] },
    { c: "breed", b: "doodle", l: ["Hypoallergenic.", "Allegedly."] },
    { c: "attitude", b: "doodle", l: ["Designer dog.", "Thrift store", "behavior."] },
    { c: "breed", b: "doodle", l: ["Poodle smarts.", "Retriever focus.", "Neither showed up."] },
    { c: "adult", x: true, b: "doodle", l: ["Expensive as hell.", "Dumb as a mop."] },
    { c: "adult", x: true, b: "doodle", l: ["Call me a sheep", "one more fucking time."] },
    { c: "breed", b: "frenchie", l: ["Can't swim.", "Sinks with style."] },
    { c: "breed", b: "frenchie", l: ["Snores", "with an accent."] },
    { c: "attitude", b: "frenchie", l: ["Ate a pillow.", "C'est la vie."] },
    { c: "adult", x: true, b: "frenchie", l: ["Farts in French.", "Still stinks."] },
    { c: "adult", x: true, b: "frenchie", l: ["Legs spread.", "It's called", "a sploot, pervert."] },
    { c: "adult", x: true, b: "frenchie", l: ["My face is flat.", "My give-a-shit", "is flatter."] },
    { c: "breed", b: "german-shepherd", l: ["German shedder.", "Return with", "lint roller."] },
    { c: "breed", b: "german-shepherd", l: ["Guarded the house", "from a leaf.", "Twice."] },
    { c: "breed", b: "german-shepherd", l: ["Screamed at the vet.", "Over a nail trim."] },
    { c: "adult", x: true, b: "german-shepherd", l: ["I bark at leaves.", "Leaves are", "shady as fuck."] },
    { c: "breed", b: "golden", l: ["Would show a burglar", "where the TV is."] },
    { c: "breed", b: "golden", l: ["Retriever.", "Not a returner."] },
    { c: "cute", b: "golden", l: ["Brain: empty.", "Heart: enormous."] },
    { c: "adult", x: true, b: "golden", l: ["Mom's golden boy.", "Dad's hairy asshole."] },
    { c: "breed", b: "great-dane", l: ["Lap dog.", "Ask any lap."] },
    { c: "breed", b: "great-dane", l: ["Counter surfer.", "No board needed."] },
    { c: "lost", b: "great-dane", l: ["If found,", "bring a bigger car."] },
    { c: "adult", x: true, b: "great-dane", l: ["Not a horse.", "Hung like one though."] },
    { c: "adult", x: true, b: "great-dane", l: ["Lost.", "Bring a truck,", "you cheap bastard."] },
    { c: "breed", b: "greyhound", l: ["45 mph.", "Mostly to the couch."] },
    { c: "lost", b: "greyhound", l: ["Saw a squirrel.", "See you in", "another county."] },
    { c: "adult", x: true, b: "greyhound", l: ["Lost the race.", "Won the fucking couch."] },
    { c: "adult", x: true, b: "greyhound", l: ["Chased a bunny", "for years.", "It was fake as shit."] },
    { c: "breed", b: "husky", l: ["I don't shed.", "I snow."] },
    { c: "breed", b: "husky", l: ["Escape artist.", "Fence was a suggestion."] },
    { c: "beach", b: "husky", l: ["Built for snow.", "Lives in Florida.", "Please send ice."] },
    { c: "adult", x: true, b: "husky", l: ["Talks back.", "Mostly profanity."] },
    { c: "adult", x: true, b: "husky", l: ["Thinks I'm a wolf.", "Scared of a fucking", "plastic bag."] },
    { c: "breed", b: "lab", l: ["Genetically", "starving.", "Ask science."] },
    { c: "breed", b: "lab", l: ["Ate a sock.", "Vet bill: $3k.", "Would again."] },
    { c: "lost", b: "lab", l: ["If found, I'm wet", "and I love you."] },
    { c: "adult", x: true, b: "lab", l: ["Fucks around.", "Fetches out."] },
    { c: "adult", x: true, b: "lab", l: ["Friendly to everyone.", "Total slut for pets."] },
    { c: "breed", b: "mutt", l: ["Breed:", "Yes."] },
    { c: "breed", b: "mutt", l: ["Part lab.", "Part shepherd.", "Part raccoon."] },
    { c: "family", b: "mutt", l: ["Mom paid $99", "to learn I'm", "a dog."] },
    { c: "adult", x: true, b: "mutt", l: ["Pedigree:", "Some dog behind", "a Taco Bell."] },
    { c: "adult", x: true, b: "mutt", l: ["Shelter said", "house trained.", "Shelter lied."] },
    { c: "adult", x: true, b: "mutt", l: ["Who rescued who?", "Who gives a shit.", "Feed me."] },
    { c: "breed", b: "newfoundland", l: ["Will rescue you.", "Didn't ask.", "Too late."] },
    { c: "breed", b: "newfoundland", l: ["Drool is", "complimentary."] },
    { c: "family", b: "newfoundland", l: ["Unpaid nanny.", "Call my mom."] },
    { c: "adult", x: true, b: "newfoundland", l: ["Will drag your drunk ass", "out of the lake."] },
    { c: "adult", x: true, b: "newfoundland", l: ["Outweighs your man.", "Less of a dick."] },
    { c: "breed", b: "pit-bull", l: ["Velvet hippo.", "Return to couch."] },
    { c: "breed", b: "pit-bull", l: ["Guard dog.", "Will lick burglar.", "Thoroughly."] },
    { c: "cute", b: "pit-bull", l: ["Cinder block head.", "Marshmallow heart."] },
    { c: "adult", x: true, b: "pit-bull", l: ["Bad reputation.", "Good boy.", "Fuck your stereotypes."] },
    { c: "adult", x: true, b: "pit-bull", l: ["Thug life.", "Scared of", "my own farts."] },
    { c: "breed", b: "pomeranian", l: ["7 pounds.", "5 are hair."] },
    { c: "lost", b: "pomeranian", l: ["I'm a dog.", "Not a hat.", "Call my mom."] },
    { c: "cute", b: "pomeranian", l: ["Spins when happy.", "Always happy.", "Always dizzy."] },
    { c: "adult", x: true, b: "pomeranian", l: ["Will start shit", "with a Rottweiler.", "Won't finish it."] },
    { c: "breed", b: "poodle", l: ["The pom-poms", "were for ducks.", "Look it up."] },
    { c: "breed", b: "poodle", l: ["Not a doodle.", "I'm the reason", "doodles exist."] },
    { c: "adult", x: true, b: "poodle", l: ["Doodles are", "just poodles", "with daddy issues."] },
    { c: "adult", x: true, b: "poodle", l: ["My haircut cost", "more than yours.", "Bitch."] },
    { c: "lost", b: "pug", l: ["Not lost.", "Got winded at", "the mailbox."] },
    { c: "breed", b: "pug", l: ["Not fat.", "Big boned.", "Also fat."] },
    { c: "cute", b: "pug", l: ["Head tilt is a", "manipulation tactic."] },
    { c: "adult", x: true, b: "pug", l: ["Can't breathe.", "Still talks shit."] },
    { c: "adult", x: true, b: "pug", l: ["Face looks punched.", "Still prettier", "than your ex."] },
    { c: "adult", x: true, b: "pug", l: ["Emperor's dog.", "Treated like a", "peasant. Bullshit."] },
    { c: "breed", b: "rottweiler", l: ["I'm not growling.", "It's a purr.", "Relax."] },
    { c: "breed", b: "rottweiler", l: ["Eyebrows do", "all the talking."] },
    { c: "family", b: "rottweiler", l: ["Our insurance", "hates me.", "Mom doesn't."] },
    { c: "adult", x: true, b: "rottweiler", l: ["Landlord said no.", "Mom said", "fuck the landlord."] },
    { c: "adult", x: true, b: "rottweiler", l: ["If found, don't run.", "I'll think it's", "a fucking game."] },
    { c: "lost", b: "shih-tzu", l: ["Not lost.", "Bangs in my eyes."] },
    { c: "breed", b: "shih-tzu", l: ["Former palace dog.", "Current couch", "occupant."] },
    { c: "adult", x: true, b: "shih-tzu", l: ["Yes, it's pronounced", "shit zu.", "Fitting."] },
    { c: "adult", x: true, b: "shih-tzu", l: ["I don't do", "walks.", "Carry my ass."] },
    { c: "breed", b: "yorkie", l: ["Honks like a goose.", "It's a yorkie thing."] },
    { c: "cute", b: "yorkie", l: ["Wearing a bow.", "Still dangerous."] },
    { c: "adult", x: true, b: "yorkie", l: ["Hair done.", "Nails done.", "Still a bitch."] },
    { c: "adult", x: true, b: "yorkie", l: ["Humps the big dogs.", "Size is a mindset."] },
  ];
  // The clean (non-18+) saying count: the one number the home page, meta description and generators use. tools/out/sayings-count.json mirrors it.
  const CLEAN_COUNT = SAYINGS.filter((s) => !s.x).length;
  let adultOn = false; try { adultOn = localStorage.getItem('sdt-adult') === '1'; } catch {}
  let askAdult = () => Promise.resolve(false); // replaced in init() once the gate dialog is wired
  const visible = () => SAYINGS.map((s, i) => ({ ...s, i })).filter((s) => !s.x || adultOn);
  const FONTS = {
    block: { n: 'Block', css: "'Archivo Black','Archivo',sans-serif", ttf: 'ofl/archivoblack/ArchivoBlack-Regular.ttf' },
    bungee: { n: 'Bungee', css: "'Bungee',Impact,sans-serif", ttf: 'ofl/bungee/Bungee-Regular.ttf' },
    script: { n: 'Script', css: "'Pacifico',cursive", ttf: 'ofl/pacifico/Pacifico-Regular.ttf', upper: false, lh: 1.3 },
    slab: { n: 'Slab', css: "'Alfa Slab One',serif", ttf: 'ofl/alfaslabone/AlfaSlabOne-Regular.ttf' },
    marker: { n: 'Marker', css: "'Permanent Marker',cursive", ttf: 'ofl/permanentmarker/PermanentMarker-Regular.ttf', upper: false },
  };
  // small icons (24x24 paths) engraved above the text
  const ICONS = {
    none: { n: 'No icon', d: '' },
    paw: { n: 'Paw', d: 'M12 13c-2.8 0-6 2.2-6 5 0 1.7 1.3 2.5 2.6 2.5 1.2 0 2-.6 3.4-.6s2.2.6 3.4.6c1.3 0 2.6-.8 2.6-2.5 0-2.8-3.2-5-6-5zM5.5 7a2 2.6 0 1 0 0 5.2 2 2.6 0 1 0 0-5.2zm13 0a2 2.6 0 1 0 0 5.2 2 2.6 0 1 0 0-5.2zM9 3.5a2 3 0 1 0 0 6 2 3 0 1 0 0-6zm6 0a2 3 0 1 0 0 6 2 3 0 1 0 0-6z' },
    bone: { n: 'Bone', d: 'M6 7.5a2.5 2.5 0 0 1 4.3-1.7L13.7 9.2 17 6a2.5 2.5 0 1 1 3.5 3.5L19 11l1.5 1.5A2.5 2.5 0 1 1 17 16l-3.3-3.2L10.3 16A2.5 2.5 0 1 1 6.8 12.5L8.3 11 6.8 9.5A2.5 2.5 0 0 1 6 7.5z' },
    heart: { n: 'Heart', d: 'M12 21s-7.5-4.6-9.5-9.3C1 8 3.4 4.5 6.8 4.5c2 0 3.6 1.1 5.2 3 1.6-1.9 3.2-3 5.2-3 3.4 0 5.8 3.5 4.3 7.2C19.5 16.4 12 21 12 21z' },
    star: { n: 'Star', d: 'M12 2l2.9 6.3 6.9.8-5.1 4.7 1.4 6.8L12 17.3 5.9 20.6l1.4-6.8L2.2 9.1l6.9-.8z' },
    anchor: { n: 'Anchor', d: 'M12 2a3 3 0 0 1 1 5.8V9h4v2h-4v8.9c3.2-.4 5.8-2.6 6.6-5.9h2.2c-.9 4.6-4.9 8-9.8 8s-8.9-3.4-9.8-8h2.2c.8 3.3 3.4 5.5 6.6 5.9V11H7V9h4V7.8A3 3 0 0 1 12 2zm0 2a1 1 0 1 0 0 2 1 1 0 0 0 0-2z' },
    bolt: { n: 'Bolt', d: 'M13 2L4 14h6l-1 8 9-12h-6z' },
    crown: { n: 'Crown', d: 'M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5z' },
    skull: { n: 'Skull', d: 'M12 2C7 2 3 5.6 3 10c0 2.6 1.3 4.9 3.3 6.3V20h3v-2h1.4v2h2.6v-2h1.4v2h3v-3.7C19.7 14.9 21 12.6 21 10c0-4.4-4-8-9-8zm-3.5 7a2 2 0 1 1 0 4 2 2 0 0 1 0-4zm7 0a2 2 0 1 1 0 4 2 2 0 0 1 0-4zM12 13l1 2h-2z' },
  };
  // measure text with the real font (canvas), falls back to a width heuristic
  const _cv = document.createElement('canvas').getContext('2d');
  function textW(str, fontKey, px) { const f = FONTS[fontKey] || FONTS.block; _cv.font = `${px}px ${f.css}`; const w = _cv.measureText(str).width; return w > 0 ? w : str.length * px * 0.62; }
  const CATS = { all: 'All', bulldog: 'Bulldog life', cute: 'Certified cute', lost: 'Lost & found', attitude: 'Attitude', family: 'Family', beach: 'Beach', breed: 'By breed', adult: 'Salty 18+' };

  /* ---------- color helpers ---------- */
  const hex = (c) => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
  const rgb = (a) => '#' + a.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
  const mix = (c, t, amt) => rgb(hex(c).map((v, i) => v + (hex(t)[i] - v) * amt));
  const lighten = (c, a) => mix(c, '#ffffff', a), darken = (c, a) => mix(c, '#000000', a);

  /* ---------- photo add-on preview ----------
     Replaces the front engraving with either the customer's (already grayscaled, client-resized) photo
     clipped into the text-safe area, or — before a photo is attached — a dashed placeholder so the
     builder still shows where it lands. Shared by both render paths (BLANK_PHOTOS vector and Zartan's
     templates): both already compute a text-safe `area` rect, so this only needs that rect + a unique id. */
  function photoOverlayMarkup(dataURL, area, idNum) {
    const x = (area.cx - area.w / 2).toFixed(1), y = (area.cy - area.h / 2).toFixed(1);
    const w = area.w.toFixed(1), h = area.h.toFixed(1);
    const clipId = 'ph' + idNum;
    const defs = `<clipPath id="${clipId}"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6"/></clipPath>`;
    if (!dataURL) {
      const cx = area.cx, cy = area.cy - area.h * 0.08;
      const body = `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6" fill="rgba(0,0,0,.18)" stroke="rgba(255,255,255,.45)" stroke-width="1.2" stroke-dasharray="4 3"/>` +
        `<g transform="translate(${cx} ${cy})" fill="none" stroke="rgba(255,255,255,.7)" stroke-width="1.5"><rect x="-11" y="-7" width="22" height="16" rx="2"/><path d="M-5 -7 l2 -3 h6 l2 3"/><circle cx="0" cy="1" r="4.2"/></g>` +
        `<text x="${area.cx}" y="${(area.cy + area.h / 2 - 5).toFixed(1)}" text-anchor="middle" font-family="Archivo,sans-serif" font-size="7.5" fill="rgba(255,255,255,.75)" style="letter-spacing:.05em">PHOTO PROOF</text>`;
      return { defs, body };
    }
    const body = `<g clip-path="url(#${clipId})"><image href="${dataURL}" x="${x}" y="${y}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid slice"/></g><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6" fill="none" stroke="rgba(0,0,0,.4)" stroke-width="1"/>`;
    return { defs, body };
  }

  /* ---------- realistic tag renderer (320 x 240 box) ----------
     Lit with SVG lighting filters (bevel + specular), brushed texture via turbulence, split ring, contact shadow.
     BLANK_PHOTOS: drop real photos in site/assets/blanks/<shape>-<finish>.png (flat lay, transparent background,
     tag filling a 320x240 frame) and list them here; the photo replaces the drawn body and the text is laid on top. */
  // Real photos of the blanks (from the supplier listings until our own are shot). Only combos with a photo are offered.
  const BLANK_PHOTOS = Object.fromEntries(["bone-black", "bone-bronze", "bone-gold", "bone-green", "bone-hotpink", "bone-navy", "bone-pink", "bone-polished", "bone-rainbow", "bone-red", "bone-royal", "bone-silver", "bone-sky", "bone-ssblack", "bone-stainless", "bone-yellow", "heart-black", "heart-green", "heart-pink", "heart-red", "heart-royal", "heart-sky", "heart-stainless", "heart-yellow", "military-black", "military-green", "military-hotpink", "military-pink", "military-red", "military-royal", "military-sky", "military-stainless", "military-yellow", "paw-black", "paw-green", "paw-hotpink", "paw-pink", "paw-red", "paw-royal", "paw-silver", "paw-sky", "paw-yellow", "hydrant-black", "hydrant-green", "hydrant-hotpink", "hydrant-pink", "hydrant-red", "hydrant-royal", "hydrant-silver", "hydrant-sky", "hydrant-yellow", "fish-black", "fish-green", "fish-hotpink", "fish-pink", "fish-red", "fish-royal", "fish-silver", "fish-sky", "fish-yellow", "cat-black", "cat-green", "cat-hotpink", "cat-pink", "cat-red", "cat-royal", "cat-silver", "cat-sky", "cat-yellow", "star-black", "star-green", "star-hotpink", "star-pink", "star-red", "star-royal", "star-silver", "star-sky", "star-yellow", "house-black", "house-green", "house-hotpink", "house-pink", "house-red", "house-royal", "house-silver", "house-sky", "house-yellow", "round-black", "round-brass", "round-green", "round-hotpink", "round-pink", "round-red", "round-royal", "round-sky", "round-yellow"].map((k) => [k, '/assets/blanks/' + k + '.png?v=32']));
  let uid = 0;
  function shapeSpec(shape) {
    switch (shape) {
      case 'round': return { body: '<circle cx="160" cy="132" r="100"/>', area: { w: 160, h: 120, cx: 160, cy: 140 }, hole: { x: 160, y: 48 }, dir: 'top' };
      case 'heart': return { body: '<path d="M160 236 C 100 190 40 150 40 96 C 40 60 68 36 100 36 C 128 36 150 52 160 72 C 170 52 192 36 220 36 C 252 36 280 60 280 96 C 280 150 220 190 160 236 Z"/>', area: { w: 176, h: 94, cx: 160, cy: 140 }, hole: { x: 160, y: 90 }, dir: 'top' };
      case 'military': return { body: '<rect x="20" y="62" width="280" height="140" rx="42"/>', area: { w: 200, h: 100, cx: 182, cy: 132 }, hole: { x: 50, y: 132 }, dir: 'left' };
      case 'paw': return { body: '<path d="M82 166 C 82 128 118 104 160 104 C 202 104 238 128 238 166 C 238 204 204 228 160 228 C 116 228 82 204 82 166 Z M58 96 C 58 76 70 62 84 62 C 100 62 110 80 110 100 C 110 120 98 130 84 130 C 70 130 58 116 58 96 Z M108 56 C 108 36 120 22 134 22 C 150 22 160 40 160 60 C 160 80 148 92 134 92 C 120 92 108 76 108 56 Z M160 60 C 160 40 170 22 186 22 C 200 22 212 36 212 56 C 212 76 200 92 186 92 C 172 92 160 80 160 60 Z M210 100 C 210 80 220 62 236 62 C 250 62 262 76 262 96 C 262 116 250 130 236 130 C 222 130 210 120 210 100 Z"/>', area: { w: 128, h: 90, cx: 160, cy: 172 }, hole: { x: 160, y: 124 }, dir: 'top' };
      case 'hydrant': return { body: '<path d="M118 232 H202 V210 H216 V190 H202 V140 H214 A8 8 0 0 0 214 124 H202 V104 Q202 70 160 56 Q118 70 118 104 V124 H106 A8 8 0 0 0 106 140 H118 V190 H104 V210 H118 Z M138 56 Q160 30 182 56 Z"/>', area: { w: 76, h: 84, cx: 160, cy: 174 }, hole: { x: 160, y: 74 }, dir: 'top' };
      case 'fish': return { body: '<path d="M34 130 C 80 60 180 50 232 110 L 290 60 L 272 130 L 290 200 L 232 150 C 180 210 80 200 34 130 Z"/>', area: { w: 150, h: 70, cx: 142, cy: 134 }, hole: { x: 66, y: 130 }, dir: 'left' };
      case 'cat': return { body: '<path d="M60 150 C 60 90 90 70 100 68 L 92 26 L 134 56 Q 160 50 186 56 L 228 26 L 220 68 C 230 70 260 90 260 150 C 260 210 215 238 160 238 C 105 238 60 210 60 150 Z"/>', area: { w: 150, h: 84, cx: 160, cy: 160 }, hole: { x: 160, y: 86 }, dir: 'top' };
      case 'star': return { body: '<path d="M160 30 L190 110 L276 114 L208 166 L232 248 L160 200 L88 248 L112 166 L44 114 L130 110 Z"/>', area: { w: 110, h: 60, cx: 160, cy: 156 }, hole: { x: 160, y: 62 }, dir: 'top' };
      case 'house': return { body: '<path d="M160 30 L278 120 L252 120 L252 236 L68 236 L68 120 L42 120 Z"/>', area: { w: 150, h: 96, cx: 160, cy: 170 }, hole: { x: 160, y: 66 }, dir: 'top' };
      default: return { body: '<path d="M82 50 A42 42 0 0 1 121.6 78 L198.4 78 A42 42 0 1 1 255.9 130 A42 42 0 1 1 198.4 182 L121.6 182 A42 42 0 1 1 64.1 130 A42 42 0 0 1 82 50 Z"/>', area: { w: 206, h: 84, cx: 160, cy: 136 }, hole: { x: 160, y: 92 }, dir: 'top' };
    }
  }
  // Engraving PROOF, not a product photo: the real shape outline, the exact text and layout, a finish label.
  // When BLANK_PHOTOS has a photo for shape-finish, the photo is used with the text laid over it instead.
  function tagSVGVector(o) {
    const f = FINISHES[o.finish] || FINISHES.black;
    const lines = (o.lines || []).filter(Boolean).slice(0, 4);
    const sp = shapeSpec(o.shape);
    const { body, area, hole } = sp;
    const maxLen = Math.max(1, ...lines.map((l) => l.length));
    const n = Math.max(1, lines.length);
    let fs = Math.min(30, area.w / (maxLen * 0.64), area.h / (n * 1.2));
    fs = Math.max(11, Math.floor(fs));
    const lh = fs * 1.18;
    const top = area.cy - ((n - 1) * lh) / 2 + fs * 0.36;
    const text = lines.map((l, i) => `<text x="${area.cx}" y="${(top + i * lh).toFixed(1)}" text-anchor="middle" font-size="${fs}">${esc(l.toUpperCase())}</text>`).join('');
    const photo = BLANK_PHOTOS[o.shape + '-' + o.finish];
    const finishName = f.n.replace(/ \+\$\d/, '') + (f.kind === 'anodized' ? ' anodized' : '');
    if (photo) {
      const ink = f.ink === 'light' ? '#F2F4F6' : '#23262B';
      const sh = f.ink === 'light' ? 'rgba(0,0,0,.55)' : 'rgba(255,255,255,.55)';
      const PA = {"bone-black": [160.0, 127.4, 170.5, 72.8], "bone-bronze": [160.0, 127.4, 170.5, 72.8], "bone-gold": [160.0, 127.4, 170.5, 72.8], "bone-green": [160.0, 127.4, 170.5, 72.8], "bone-hotpink": [160.0, 127.4, 170.5, 72.8], "bone-navy": [160.0, 127.4, 170.5, 72.8], "bone-pink": [160.0, 127.4, 170.5, 72.8], "bone-polished": [160.0, 127.4, 170.5, 72.8], "bone-rainbow": [160.0, 127.4, 170.5, 72.8], "bone-red": [160.0, 127.4, 170.5, 72.8], "bone-royal": [160.0, 127.4, 170.5, 72.8], "bone-silver": [160.0, 127.4, 170.5, 72.8], "bone-sky": [160.0, 127.4, 170.5, 72.8], "bone-ssblack": [160.0, 127.4, 170.5, 72.8], "bone-stainless": [160.0, 127.4, 170.5, 72.8], "bone-yellow": [160.0, 127.4, 170.5, 72.8], "heart-black": [159.2, 107.1, 138.6, 81.7], "heart-green": [159.2, 107.1, 138.6, 81.7], "heart-pink": [159.2, 107.1, 138.6, 81.7], "heart-red": [159.2, 107.1, 138.6, 81.7], "heart-royal": [159.2, 107.1, 138.6, 81.7], "heart-sky": [159.2, 107.1, 138.6, 81.7], "heart-stainless": [159.2, 107.1, 138.6, 81.7], "heart-yellow": [159.2, 107.1, 138.6, 81.7], "military-black": [180.6, 119.8, 176.4, 92.7], "military-green": [180.6, 119.8, 176.4, 92.7], "military-hotpink": [180.6, 119.8, 176.4, 92.7], "military-pink": [180.6, 119.8, 176.4, 92.7], "military-red": [180.6, 119.8, 176.4, 92.7], "military-royal": [180.6, 119.8, 176.4, 92.7], "military-sky": [180.6, 119.8, 176.4, 92.7], "military-stainless": [180.6, 119.8, 176.4, 92.7], "military-yellow": [180.6, 119.8, 176.4, 92.7], "paw-black": [160.0, 162.8, 96.1, 64.2], "paw-green": [160.0, 162.8, 96.1, 64.2], "paw-hotpink": [160.0, 162.8, 96.1, 64.2], "paw-pink": [160.0, 162.8, 96.1, 64.2], "paw-red": [160.0, 162.8, 96.1, 64.2], "paw-royal": [160.0, 162.8, 96.1, 64.2], "paw-silver": [160.0, 162.8, 96.1, 64.2], "paw-sky": [160.0, 162.8, 96.1, 64.2], "paw-yellow": [160.0, 162.8, 96.1, 64.2], "round-black": [159.8, 126.2, 141.8, 106.8], "round-brass": [159.8, 126.2, 141.8, 106.8], "round-green": [159.8, 126.2, 141.8, 106.8], "round-hotpink": [159.8, 126.2, 141.8, 106.8], "round-pink": [159.8, 126.2, 141.8, 106.8], "round-red": [159.8, 126.2, 141.8, 106.8], "round-royal": [159.8, 126.2, 141.8, 106.8], "round-sky": [159.8, 126.2, 141.8, 106.8], "round-yellow": [159.8, 126.2, 141.8, 106.8]};
      const pa = { cx: area.cx, cy: area.cy, w: area.w, h: area.h };
      const fk = FONTS[o.font] ? o.font : 'block'; const F = FONTS[fk]; const LH = F.lh || 1.18;
      const L = F.upper === false ? lines : lines.map((l) => l.toUpperCase());
      const icon = ICONS[o.icon] && o.icon !== 'none' ? ICONS[o.icon] : null;
      const iconH = icon ? Math.min(pa.h * 0.34, 26) : 0;
      const boxH = pa.h - iconH;
      let pfs = 24;
      for (; pfs > 11; pfs--) { if (L.every((l) => textW(l, fk, pfs) <= pa.w) && n * pfs * LH <= boxH) break; }
      const plh = pfs * LH; const ptop = pa.cy + iconH / 2 - ((n - 1) * plh) / 2 + pfs * 0.36;
      let ptext = L.map((l, i) => `<text x="${pa.cx}" y="${(ptop + i * plh).toFixed(1)}" text-anchor="middle" font-size="${n === 4 && i === 0 ? Math.round(pfs * 1.2) : pfs}">${esc(l)}</text>`).join('');
      let picon = icon ? `<g transform="translate(${pa.cx - iconH / 2} ${pa.cy - pa.h / 2 + 1}) scale(${iconH / 24})"><path d="${icon.d}" fill="${ink}"/><path d="${icon.d}" fill="${sh}" transform="translate(0,${f.ink === 'light' ? 0.6 : -0.5})" opacity=".6"/></g>` : '';
      // Photo add-on: the dog photo (or a placeholder before one is attached) replaces the text entirely.
      // Otherwise, a color add-on recolors either just the icon (icon mode, icon present), the whole
      // front text block (icon mode with no icon — stands in for "a short line"), or always the whole
      // block for line mode.
      let photoDefs = '', photoBody = '';
      if (o.photo) {
        const ov = photoOverlayMarkup(o.photoData, pa, ++uid);
        photoDefs = ov.defs; photoBody = ov.body; picon = ''; ptext = '';
      } else if (o.colorMode === 'icon' && icon) {
        picon = `<g transform="translate(${pa.cx - iconH / 2} ${pa.cy - pa.h / 2 + 1}) scale(${iconH / 24})"><path d="${icon.d}" fill="${o.colorHex}"/></g>`;
      } else if (o.colorMode === 'icon' || o.colorMode === 'line') {
        ptext = `<g fill="${o.colorHex}">${ptext}</g>`;
      }
      const base = o.finish === 'polished' ? '#D9DDE2' : o.finish === 'gold' ? '#D4B04A' : o.finish === 'bronze' ? '#9A6B3C' : f.kind === 'stainless' ? '#BFC5CC' : f.kind === 'brass' ? '#C9A24E' : o.finish === 'black' ? '#1B1D21' : o.finish === 'ssblack' ? '#17181C' : (f.c || '#333');
      const id = ++uid; const metal = /^(stainless|polished|silver|brass|gold|bronze|ssblack)$/.test(o.finish);
      const dark = /^(black|ssblack|navy)$/.test(o.finish);
      const lum = (() => { const h = base.replace('#', ''); const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16); return (0.299 * r + 0.587 * g + 0.114 * b) / 255; })();
      const lightInk = f.kind === 'anodized' || lum < 0.5; // anodized: laser strips the colour, exposes bright silver
      const ringC = sp.dir === 'left' ? { x: hole.x - 10, y: hole.y } : { x: hole.x, y: hole.y - 10 };
      return `<svg viewBox="0 0 320 240" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${esc(lines.join(' '))}">
        <defs>
          <clipPath id="c${id}">${body}</clipPath>
          <mask id="m${id}"><g fill="#fff">${body}</g><circle cx="${hole.x}" cy="${hole.y}" r="8" fill="#000"/></mask>
          <filter id="ds${id}" x="-20%" y="-20%" width="140%" height="150%"><feDropShadow dx="0" dy="10" stdDeviation="8" flood-color="#000" flood-opacity=".55"/></filter>
          <filter id="bl${id}"><feGaussianBlur stdDeviation="1.4"/></filter>
          <linearGradient id="gl${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="${dark ? .10 : .42}"/><stop offset=".48" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="${dark ? .5 : .3}"/></linearGradient>
          <linearGradient id="br${id}" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="3" spreadMethod="repeat"><stop offset="0" stop-color="#fff" stop-opacity=".16"/><stop offset=".35" stop-color="#fff" stop-opacity="0"/><stop offset=".6" stop-color="#000" stop-opacity=".10"/><stop offset="1" stop-color="#fff" stop-opacity=".12"/></linearGradient>
          <linearGradient id="rg${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#F4F6F8"/><stop offset=".5" stop-color="#9AA1A9"/><stop offset="1" stop-color="#E3E6EA"/></linearGradient>
          <linearGradient id="en${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FBFCFE"/><stop offset=".55" stop-color="#C9CED6"/><stop offset="1" stop-color="#EDF0F4"/></linearGradient>
          ${photoDefs}
        </defs>
        <circle cx="${ringC.x}" cy="${ringC.y}" r="13" fill="none" stroke="url(#rg${id})" stroke-width="4.2"/>
        <g filter="url(#ds${id})"><g mask="url(#m${id})">
          <rect width="320" height="240" fill="${base}"/>
          ${metal ? `<rect width="320" height="240" fill="url(#br${id})"/>` : ``}
          <rect width="320" height="240" fill="url(#gl${id})"/>
          <g clip-path="url(#c${id})" fill="none" stroke-linejoin="round">
            <g transform="translate(2.2 2.2)" stroke="#fff" stroke-opacity="${dark ? .16 : .55}" stroke-width="3.5" filter="url(#bl${id})">${body}</g>
            <g transform="translate(-2.2 -2.2)" stroke="#000" stroke-opacity=".38" stroke-width="3.5" filter="url(#bl${id})">${body}</g>
          </g>
          <g fill="none" stroke="#000" stroke-opacity=".35" stroke-width="1.2">${body}</g>
        </g></g>
        <circle cx="${hole.x}" cy="${hole.y}" r="8" fill="none" stroke="#000" stroke-opacity=".45" stroke-width="1.6"/>
        <circle cx="${ringC.x}" cy="${ringC.y}" r="13" fill="none" stroke="url(#rg${id})" stroke-width="4.2" clip-path="url(#h${id})"/>
        <clipPath id="h${id}"><circle cx="${hole.x}" cy="${hole.y}" r="7.2"/></clipPath>
        ${photoBody}${picon}<g font-family="${F.css.replace(/"/g, '&quot;')}" font-weight="400" style="letter-spacing:.01em">${lightInk ? `<g fill="rgba(0,0,0,.55)" transform="translate(0,-1)">${ptext}</g><g fill="rgba(255,255,255,.35)" transform="translate(0,1)">${ptext}</g><g fill="url(#en${id})">${ptext}</g>` : `<g fill="rgba(255,255,255,.5)" transform="translate(0,0.9)">${ptext}</g><g fill="#1F2327">${ptext}</g>`}</g>
      </svg>`;
    }
    const fill = f.kind === 'stainless' ? '#C9CED4' : f.kind === 'brass' ? '#D2AB5C' : f.c;
    const edge = f.kind === 'stainless' ? '#7F868F' : f.kind === 'brass' ? '#8A6A2A' : darken(f.c, .4);
    const ink = f.ink === 'light' ? '#EDEFF2' : '#26292E';
    const inkShadow = f.ink === 'light' ? 'rgba(0,0,0,.55)' : 'rgba(255,255,255,.55)';
    const hiLite = f.kind === 'anodized' ? lighten(f.c, .25) : '#FFFFFF';
    return `<svg viewBox="0 0 320 240" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Engraving proof: ${esc(lines.join(' '))}">
      <defs><linearGradient id="g${++uid}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${hiLite}" stop-opacity=".55"/><stop offset=".45" stop-color="${hiLite}" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".18"/></linearGradient><clipPath id="c${uid}">${body}</clipPath></defs>
      <ellipse cx="160" cy="224" rx="110" ry="9" fill="#0E2A47" opacity=".10"/>
      <g fill="${fill}" stroke="${edge}" stroke-width="2" stroke-linejoin="round">${body}</g>
      <g clip-path="url(#c${uid})"><rect width="320" height="240" fill="url(#g${uid})"/></g>
      <circle cx="${hole.x}" cy="${hole.y}" r="6.5" fill="#FFFBF2" stroke="${edge}" stroke-width="1.6"/>
      <g font-family="Archivo,'Helvetica Neue',Arial,sans-serif" font-weight="700" style="letter-spacing:.015em">
        <g fill="${inkShadow}" transform="translate(0,${f.ink === 'light' ? 1 : -0.8})">${text}</g><g fill="${ink}">${text}</g>
      </g>
      <g font-family="'DM Mono',ui-monospace,monospace" font-size="8.5" fill="#5C6B7E" style="letter-spacing:.14em">
        <text x="8" y="232">PROOF · ${esc(finishName.toUpperCase())}</text>
        <text x="312" y="232" text-anchor="end">NOT A PHOTO</text>
      </g>
    </svg>`;
  }

  /* ---------- Zartan's template art (assets/shapes/*.svg + shapes.json) ----------
     Each template is a 320x240 shape (shadow, ring-back, edge, body, hole, bevel, ring-front in paint
     order) with a single evenodd body path (fill="currentColor") and a real split ring that passes
     through the hole. We fetch them once, rewrite the handful of layer ids that repeat across files
     (shadow/ring-back/edge/body/hole/bevel/ring-front — the internal ids like bone-clip are already
     unique per shape), and splice the result into an <svg style="color:<finish>"> with the engraved
     text/icon laid on top using shapes.json's text-safe area. Until a shape's template has loaded and
     passed its sanity check, tagSVG() renders the old hand-drawn vector body instead — nothing flashes
     empty, and the gallery/preview/hero re-render once templates are in.
     Paw readiness: Zartan is still iterating on assets/shapes/paw.svg, so paw is opt-in — it only
     switches to template art when shapes.json has shapes.paw.ready === true (exactly, not just
     truthy/absent). bone/heart/round/military are opt-out: they use the template as soon as it loads
     and passes the sanity check, unless shapes.json explicitly sets ready:false for that shape. */
  const TEMPLATE_SHAPES = ['bone', 'heart', 'round', 'military', 'paw', 'hydrant', 'fish', 'cat', 'star', 'house'];
  const TEMPLATE_LAYER_IDS = ['shadow', 'ring-back', 'edge', 'body', 'hole', 'bevel', 'ring-front'];
  const TEMPLATES = {}; // shape -> { inner, area, hole, ready }
  // Shared paint-server defs for the engraved look. Fixed, non-instance ids are safe here: every value
  // is objectBoundingBox or viewBox-relative (not shape-geometry-specific), so even though only the
  // first <svg> in the document "owns" the id, every other inline instance's url(#sdt-*) still resolves
  // against that definition using its *own* bounding box/userSpace — verified with 8+ tags on one page.
  const TEMPLATE_SHARED_DEFS = '<linearGradient id="sdt-en" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FBFCFE"/><stop offset=".55" stop-color="#C9CED6"/><stop offset="1" stop-color="#EDF0F4"/></linearGradient>' +
    '<linearGradient id="sdt-br" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="3" spreadMethod="repeat"><stop offset="0" stop-color="#fff" stop-opacity=".16"/><stop offset=".35" stop-color="#fff" stop-opacity="0"/><stop offset=".6" stop-color="#000" stop-opacity=".10"/><stop offset="1" stop-color="#fff" stop-opacity=".12"/></linearGradient>';
  const METAL_FINISH_RE = /^(stainless|polished|silver|brass|gold|bronze|ssblack)$/;
  function finishBaseColor(finish, f) {
    return finish === 'polished' ? '#D9DDE2' : finish === 'gold' ? '#D4B04A' : finish === 'bronze' ? '#9A6B3C'
      : f.kind === 'stainless' ? '#BFC5CC' : f.kind === 'brass' ? '#C9A24E'
      : finish === 'black' ? '#1B1D21' : finish === 'ssblack' ? '#17181C' : (f.c || '#333');
  }
  function luminanceOf(hexColor) {
    const h = hexColor.replace('#', '');
    const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  }
  // Fits lines + optional icon inside a text-safe area the same way the old renderer did: shrink the
  // font until every line fits the width and the stack fits the height, bias row 1 larger on 4-liners.
  function engraveLayout(lines, area, fontKey, iconKey) {
    const fk = FONTS[fontKey] ? fontKey : 'block'; const F = FONTS[fk]; const LH = F.lh || 1.18;
    const L = F.upper === false ? lines : lines.map((l) => l.toUpperCase());
    const n = Math.max(1, L.length);
    const icon = ICONS[iconKey] && iconKey !== 'none' ? ICONS[iconKey] : null;
    const iconH = icon ? Math.min(area.h * 0.34, 26) : 0;
    const boxH = area.h - iconH;
    let fs = 24;
    const fits = (px) => L.every((l) => textW(l, fk, px) <= area.w) && n * px * LH <= boxH;
    for (; fs > 11; fs--) { if (fits(fs)) break; }
    const overflow = !fits(fs); // the loop bottomed out at the 11px floor and it still does not fit
    const lh = fs * LH; const top = area.cy + iconH / 2 - ((n - 1) * lh) / 2 + fs * 0.36;
    const textSvg = L.map((l, i) => `<text x="${area.cx}" y="${(top + i * lh).toFixed(1)}" text-anchor="middle" font-size="${n === 4 && i === 0 ? Math.round(fs * 1.2) : fs}">${esc(l)}</text>`).join('');
    return { textSvg, iconInfo: icon ? { icon, iconH } : null, F, overflow };
  }
  function engraveIconMarkup(iconInfo, area, f, colorHex) {
    if (!iconInfo) return '';
    const { icon, iconH } = iconInfo;
    if (colorHex) return `<g transform="translate(${area.cx - iconH / 2} ${area.cy - area.h / 2 + 1}) scale(${iconH / 24})"><path d="${icon.d}" fill="${colorHex}"/></g>`;
    const ink = f.ink === 'light' ? '#F2F4F6' : '#23262B';
    const sh = f.ink === 'light' ? 'rgba(0,0,0,.55)' : 'rgba(255,255,255,.55)';
    return `<g transform="translate(${area.cx - iconH / 2} ${area.cy - area.h / 2 + 1}) scale(${iconH / 24})"><path d="${icon.d}" fill="${ink}"/><path d="${icon.d}" fill="${sh}" transform="translate(0,${f.ink === 'light' ? 0.6 : -0.5})" opacity=".6"/></g>`;
  }
  function engraveTextMarkup(textSvg, lightInk, colorHex) {
    if (!textSvg) return '';
    if (colorHex) return `<g fill="rgba(0,0,0,.4)" transform="translate(0,-0.8)">${textSvg}</g><g fill="${colorHex}">${textSvg}</g>`;
    return lightInk
      ? `<g fill="rgba(0,0,0,.55)" transform="translate(0,-1)">${textSvg}</g><g fill="rgba(255,255,255,.35)" transform="translate(0,1)">${textSvg}</g><g fill="url(#sdt-en)">${textSvg}</g>`
      : `<g fill="rgba(255,255,255,.5)" transform="translate(0,0.9)">${textSvg}</g><g fill="#1F2327">${textSvg}</g>`;
  }
  function templatePrefixLayerIds(svgText, shape) {
    let out = svgText;
    for (const id of TEMPLATE_LAYER_IDS) out = out.split(`id="${id}"`).join(`id="${shape}-${id}"`);
    return out;
  }
  // Sanity check before trusting a fetched template: right viewBox, has a body path and this shape's
  // clip id. Fails closed — if a file is malformed, that shape just keeps using the old vector path.
  function templateParse(svgText, shape) {
    if (!svgText) return null;
    const vb = /viewBox="([^"]+)"/.exec(svgText);
    if (!vb || vb[1].trim() !== '0 0 320 240') return null;
    if (svgText.indexOf('id="body"') === -1 || svgText.indexOf(`id="${shape}-clip"`) === -1) return null;
    const close = svgText.lastIndexOf('</svg>'); if (close === -1) return null;
    return templatePrefixLayerIds(svgText.slice(svgText.indexOf('>') + 1, close), shape);
  }
  let heroRefresh = null;
  function onTemplatesReady() {
    if (document.readyState === 'loading') return; // init() hasn't run yet; it'll see TEMPLATES fresh
    try { if ($('#sizeOpts')) renderOpts(); renderPreview(); renderSayings(renderSayings._cat || 'all'); if (heroRefresh) heroRefresh(); } catch {}
    try { dispatchEvent(new Event('sdt:templates')); } catch {} // roast.js re-renders its tag
  }
  function loadTemplates() {
    Promise.all([
      fetch('/assets/shapes/shapes.json?v=59', { priority: 'low' }).then((r) => r.json()),
      ...TEMPLATE_SHAPES.map((s) => HIDDEN_SHAPES.includes(s) ? Promise.resolve(null) : fetch(`/assets/shapes/${s}.svg?v=59`, { priority: 'low' }).then((r) => (r.ok ? r.text() : null)).catch(() => null)),
    ]).then(([geoDoc, ...svgTexts]) => {
      TEMPLATE_SHAPES.forEach((shape, i) => {
        const geo = (geoDoc.shapes || {})[shape];
        if (geo && Array.isArray(geo.blank_mm) && geo.blank_mm.length === 2) BLANK_MM[shape] = geo.blank_mm; // real blank sizes feed the size labels
        const inner = templateParse(svgTexts[i], shape);
        if (!geo || !inner) return; // stays unset -> vector fallback
        const ready = shape === 'paw' ? geo.ready === true : geo.ready !== false;
        TEMPLATES[shape] = { inner, area: geo.area, hole: geo.hole, ready };
      });
      onTemplatesReady();
    }).catch(() => { /* offline/blocked fetch: keep the vector fallback, no user-facing error */ });
  }
  // Lazy builder assets (fix/sdt-site): the 10 shape SVGs (~650KB) and the builder-only fonts used to load on every
  // visit. Now they load when the saying gallery/builder comes near, when a deep link or roast handoff needs them, or
  // when a roast is submitted. Until then tagSVG() draws the vector fallback, so the hero/roast example renders at once.
  const BUILDER_FONTS = 'https://fonts.googleapis.com/css2?family=Pacifico&family=Alfa+Slab+One&family=Permanent+Marker&display=swap';
  let builderAssetsOn = false;
  function loadBuilderAssets() {
    if (builderAssetsOn) return; builderAssetsOn = true;
    loadTemplates();
    if (!document.getElementById('build')) return; // /roast/ has no font picker
    const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = BUILDER_FONTS;
    l.onload = () => { // re-fit the preview once the picked font's real metrics exist
      if (!document.fonts || !document.fonts.load) return;
      Promise.all(["16px 'Pacifico'", "16px 'Alfa Slab One'", "16px 'Permanent Marker'"].map((f) => document.fonts.load(f).catch(() => {})))
        .then(() => { try { renderPreview(); } catch {} });
    };
    document.head.appendChild(l);
  }
  function lazyBuilderAssets() {
    let handoff = null; try { handoff = sessionStorage.getItem('sdt-roast-handoff'); } catch {}
    const h = location.hash || '';
    if (handoff || (h && !/^#(roast|main)?$/.test(h)) || !('IntersectionObserver' in window)) { loadBuilderAssets(); return; }
    document.addEventListener('submit', (e) => { if (e.target && e.target.id === 'roastForm') loadBuilderAssets(); }, true);
    addEventListener('hashchange', loadBuilderAssets, { once: true });
    const arm = () => {
      const near = ['sayingGrid', 'build'].map((id) => document.getElementById(id)).filter(Boolean);
      if (!near.length) return; // /roast/: waits for a submit
      const io = new IntersectionObserver((es) => { if (es.some((en) => en.isIntersecting)) { io.disconnect(); loadBuilderAssets(); } }, { rootMargin: '600px 0px' });
      near.forEach((el) => io.observe(el));
    };
    document.readyState === 'complete' ? arm() : addEventListener('load', arm, { once: true });
  }
  function tagSVGTemplate(o, tpl) {
    const f = FINISHES[o.finish] || FINISHES.black;
    const lines = (o.lines || []).filter(Boolean).slice(0, 4);
    const area = o.area ? o.area : (o.shape === 'bone' && o.finish === 'polished') ? { ...tpl.area, cx: tpl.area.cx - tpl.area.w * 0.11, w: tpl.area.w * 0.72 } : tpl.area;
    const { textSvg, iconInfo, F } = engraveLayout(lines, area, o.font, o.icon);
    const base = finishBaseColor(o.finish, f);
    const metal = METAL_FINISH_RE.test(o.finish);
    const lightInk = f.kind === 'anodized' || luminanceOf(base) < 0.5; // anodized: laser strips the colour, exposes bright silver
    let photoDefs = '', photoBody = '';
    let picon, ptext;
    if (o.photo) {
      const ov = photoOverlayMarkup(o.photoData, area, ++uid);
      photoDefs = ov.defs; photoBody = ov.body; picon = ''; ptext = '';
    } else if (o.colorMode === 'icon' && iconInfo) {
      picon = engraveIconMarkup(iconInfo, area, f, o.colorHex);
      ptext = engraveTextMarkup(textSvg, lightInk);
    } else if (o.colorMode === 'icon' || o.colorMode === 'line') {
      picon = engraveIconMarkup(iconInfo, area, f);
      ptext = engraveTextMarkup(textSvg, lightInk, o.colorHex);
    } else {
      picon = engraveIconMarkup(iconInfo, area, f);
      ptext = engraveTextMarkup(textSvg, lightInk);
    }
    const brush = metal ? `<rect clip-path="url(#${o.shape}-clip)" width="320" height="240" fill="url(#sdt-br)"/>` : '';
    // Polished stainless bone = the paw cut-out blank (Whisky's tag): punch a paw-shaped hole through the right lobe.
    const cut = (o.shape === 'bone' && o.finish === 'polished');
    const cutId = cut ? 'cut' + (++uid) : '';
    const PAW_D = 'M12 13c-2.8 0-6 2.2-6 5 0 1.7 1.3 2.5 2.6 2.5 1.2 0 2-.6 3.4-.6s2.2.6 3.4.6c1.3 0 2.6-.8 2.6-2.5 0-2.8-3.2-5-6-5zM5.5 7a2 2.6 0 1 0 0 5.2 2 2.6 0 1 0 0-5.2zm13 0a2 2.6 0 1 0 0 5.2 2 2.6 0 1 0 0-5.2zM9 3.5a2 3 0 1 0 0 6 2 3 0 1 0 0-6zm6 0a2 3 0 1 0 0 6 2 3 0 1 0 0-6z';
    const pawT = `translate(236.8 172.6) scale(1.756) translate(-12 -12)`;
    const cutDefs = cut ? `<mask id="${cutId}"><rect width="320" height="240" fill="#fff"/><path d="${PAW_D}" transform="${pawT}" fill="#000"/></mask>` : '';
    const cutRim = cut ? `<path d="${PAW_D}" transform="${pawT}" fill="none" stroke="#000" stroke-opacity=".55" stroke-width="2.2"/><path d="${PAW_D}" transform="${pawT}" fill="none" stroke="#fff" stroke-opacity=".35" stroke-width="1" style="transform:${pawT} translate(0,-0.6px)"/>` : '';
    const body = cut ? `<g mask="url(#${cutId})">${tpl.inner}${brush}</g>${cutRim}` : `${tpl.inner}${brush}`;
    return `<svg viewBox="0 0 320 240" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" role="img" aria-label="${esc(lines.join(' '))}" style="color:${base}">
      <defs>${TEMPLATE_SHARED_DEFS}${cutDefs}${photoDefs}</defs>
      ${body}
      ${photoBody}<g font-family="${F.css.replace(/"/g, '&quot;')}" font-weight="400" style="letter-spacing:.01em">${picon}${ptext}</g>
    </svg>`;
  }
  function tagSVG(o) {
    const tpl = TEMPLATES[o.shape];
    if (tpl && tpl.ready) return tagSVGTemplate(o, tpl);
    return tagSVGVector(o);
  }


  /* ---------- full color print preview (xTool O1 Omni) ----------
     The front of a full-color tag or ornament: the art clipped to the real silhouette, the saying (or name and year)
     on top, an optional "raised" emboss look, and for uploads a dashed print-safe area. Layers match the print job:
     color (art), white (underlay), raised (lettering + rim). Same geometry as tag-layout.js fullcolorLayout().
     o: { shape, lines, font, art: 'design'|'upload', style, imgData, raised, showSafe, ornament } */
  function artBackground(style, id, bb) {
    const [x0, y0, x1, y1] = bb, w = x1 - x0, h = y1 - y0, cx = (x0 + x1) / 2;
    if (style === 'synthwave') {
      const hz = y0 + h * 0.62;
      const defs = `<linearGradient id="sk${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#09010F"/><stop offset=".45" stop-color="#7B2CFF"/><stop offset=".8" stop-color="#FF3CAC"/><stop offset="1" stop-color="#FFD166"/></linearGradient><linearGradient id="su${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFD166"/><stop offset="1" stop-color="#FF2E97"/></linearGradient>`;
      let grid = ''; for (let k = 0; k < 6; k++) { const gy = hz + 4 + k * k * 1.7 + k * 3; if (gy < y1) grid += `<line x1="${x0}" y1="${gy.toFixed(1)}" x2="${x1}" y2="${gy.toFixed(1)}"/>`; }
      for (let k = -6; k <= 6; k++) grid += `<line x1="${(cx + k * w * 0.05).toFixed(1)}" y1="${hz}" x2="${(cx + k * w * 0.22).toFixed(1)}" y2="${y1}"/>`;
      const body = `<rect x="${x0}" y="${y0}" width="${w}" height="${h}" fill="url(#sk${id})"/><circle cx="${cx}" cy="${(hz - h * 0.02).toFixed(1)}" r="${(h * 0.2).toFixed(1)}" fill="url(#su${id})"/><rect x="${x0}" y="${hz}" width="${w}" height="${(y1 - hz).toFixed(1)}" fill="#09010F"/><g stroke="#2AF5E4" stroke-width="1" opacity=".75">${grid}</g>`;
      return { defs, body };
    }
    if (style === 'mascot') {
      const defs = `<linearGradient id="mb${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1A0B33"/><stop offset="1" stop-color="#251246"/></linearGradient>`;
      const m = h * 0.62;
      return { defs, body: `<rect x="${x0}" y="${y0}" width="${w}" height="${h}" fill="url(#mb${id})"/><image href="/assets/mascot.svg" x="${(cx - m / 2).toFixed(1)}" y="${(y0 + h * 0.1).toFixed(1)}" width="${m.toFixed(1)}" height="${m.toFixed(1)}"/>` };
    }
    return { defs: '', body: `<rect x="${x0}" y="${y0}" width="${w}" height="${h}" fill="#FFF4FA"/>` }; // bold
  }
  function tagSVGFullcolor(o) {
    const shape = FC_BBOX[o.shape] ? o.shape : 'bone';
    const sp = shapeSpec(shape), bb = FC_BBOX[shape], [x0, y0, x1, y1] = bb, bw = x1 - x0, bh = y1 - y0, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const id = ++uid, hole = sp.hole;
    const mode = o.art === 'upload' ? 'upload' : 'design';
    const style = ART_STYLES[o.style] ? o.style : 'bold';
    const needsImg = mode === 'upload' || Boolean(ART_STYLES[style].needsImage);
    const lines = (o.lines || []).filter(Boolean).slice(0, 4);
    const lightText = !(mode === 'design' && style === 'bold');
    let defs = `<clipPath id="fb${id}">${sp.body}</clipPath><mask id="fm${id}"><g fill="#fff">${sp.body}</g><circle cx="${hole.x}" cy="${hole.y}" r="8" fill="#000"/></mask>`;
    let art = '';
    if (needsImg && o.imgData) {
      art = `<rect x="${x0}" y="${y0}" width="${bw}" height="${bh}" fill="#fff"/><image href="${o.imgData}" x="${x0}" y="${y0}" width="${bw}" height="${bh}" preserveAspectRatio="xMidYMid slice"/>`;
      if (mode === 'design') { defs += `<linearGradient id="fd${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".6"/></linearGradient>`; art += `<rect x="${x0}" y="${(y0 + bh * 0.5).toFixed(1)}" width="${bw}" height="${(bh * 0.5).toFixed(1)}" fill="url(#fd${id})"/>`; }
    } else if (needsImg) {
      const label = mode === 'upload' ? 'YOUR IMAGE' : 'YOUR DOG PHOTO';
      art = `<rect x="${x0}" y="${y0}" width="${bw}" height="${bh}" fill="#251246"/><g transform="translate(${cx} ${(cy - 8).toFixed(1)})" fill="none" stroke="rgba(255,244,250,.75)" stroke-width="2"><rect x="-16" y="-11" width="32" height="23" rx="3"/><path d="M-7 -11 l3 -5 h8 l3 5"/><circle cx="0" cy="1" r="6"/></g><text x="${cx}" y="${(cy + 30).toFixed(1)}" text-anchor="middle" font-family="Archivo,sans-serif" font-size="9" fill="rgba(255,244,250,.8)" style="letter-spacing:.08em">${label}</text>`;
    } else {
      const bg = artBackground(style, id, bb); defs += bg.defs; art = bg.body;
    }
    // Lettering: the text band, or (bold type) a bigger centered block. Raised = highlight + shadow copies and a rim.
    const raised = Boolean(o.raised);
    const area = mode === 'design' && style === 'bold' ? (FC_BOLD[shape] || FC_BOLD.bone) : (FC_TEXT[shape] || FC_TEXT.bone);
    const { textSvg, F } = lines.length ? engraveLayout(lines, area, o.font, 'none') : { textSvg: '', F: FONTS.block };
    const fill = lightText ? '#FFF4FA' : '#09010F', stroke = lightText ? (style === 'synthwave' && mode === 'design' ? '#7B2CFF' : '#09010F') : 'none';
    let text = '';
    if (textSvg) {
      const base = `<g fill="${fill}" stroke="${stroke}" stroke-width="${lightText ? 3.2 : 0}" stroke-linejoin="round" paint-order="stroke">${textSvg}</g>`;
      text = raised
        ? `<g fill="rgba(0,0,0,.5)" transform="translate(1,1.7)">${textSvg}</g><g fill="rgba(255,255,255,.85)" transform="translate(-.6,-.9)">${textSvg}</g>${base}`
        : base;
      text = `<g font-family="${F.css.replace(/"/g, '&quot;')}" font-weight="400" style="letter-spacing:.01em">${text}</g>`;
    }
    const rim = raised
      ? `<g clip-path="url(#fb${id})" fill="none" stroke-linejoin="round"><g stroke="rgba(0,0,0,.45)" stroke-width="9" transform="translate(.8 1.2)">${sp.body}</g><g stroke="#FFF4FA" stroke-width="7" stroke-opacity=".92">${sp.body}</g><g stroke="rgba(255,255,255,.9)" stroke-width="1.6" transform="translate(-1.4 -1.4)" opacity=".8">${sp.body}</g></g>`
      : `<g fill="none" stroke="rgba(0,0,0,.35)" stroke-width="1.2">${sp.body}</g>`;
    const safe = o.showSafe && mode === 'upload'
      ? `<g transform="translate(${cx} ${cy}) scale(.88) translate(${-cx} ${-cy})" fill="none" stroke-dasharray="6 4"><g stroke="#09010F" stroke-opacity=".7" stroke-width="3.6">${sp.body}</g><g stroke="#2AF5E4" stroke-width="1.8">${sp.body}</g></g><text x="${cx}" y="${(y1 + 14).toFixed(1)}" text-anchor="middle" font-family="DM Mono,monospace" font-size="8.5" fill="#2AF5E4" style="letter-spacing:.12em">PRINT-SAFE AREA</text>`
      : '';
    const ribbon = o.ornament ? `<path d="M${hole.x - 3} ${hole.y - 4} C ${hole.x - 22} ${hole.y - 34} ${hole.x - 4} ${hole.y - 42} ${hole.x} ${hole.y - 22} C ${hole.x + 4} ${hole.y - 42} ${hole.x + 22} ${hole.y - 34} ${hole.x + 3} ${hole.y - 4} Z" fill="#FF3CAC" stroke="#09010F" stroke-opacity=".4" stroke-width="1"/>` : '';
    const label = lines.join(' ') || (o.ornament ? 'Ornament' : 'Full color tag');
    return `<svg viewBox="0 0 320 ${o.ornament || safe ? 250 : 240}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Full color print: ${esc(label)}">
      <defs>${defs}<filter id="fs${id}" x="-20%" y="-20%" width="140%" height="150%"><feDropShadow dx="0" dy="8" stdDeviation="6" flood-color="#000" flood-opacity=".5"/></filter></defs>
      <g filter="url(#fs${id})"><g mask="url(#fm${id})"><g clip-path="url(#fb${id})">${art}</g>${rim}</g></g>
      <circle cx="${hole.x}" cy="${hole.y}" r="8" fill="none" stroke="#000" stroke-opacity=".45" stroke-width="1.6"/>
      ${ribbon}<g mask="url(#fm${id})" clip-path="url(#fb${id})">${text}</g>${safe}
    </svg>`;
  }

  /* ---------- state ---------- */
  const FIN_TABS = { anodized: { n: 'Anodized', help: 'Color coat, engraves to bright silver.' }, stainless: { n: 'Stainless', help: 'Heavier, dark engraving, built for years of collar abuse.' }, brass: { n: 'Brass', help: 'Warm gold tone, dark engraving.' }, fullcolor: { n: 'Full color', help: 'UV-printed in full color on acrylic or white aluminum. Printed color wears faster than engraving on a busy collar. For years of collar abuse, pick stainless.' } };
  let finTab = null, finSeen = null; // active finish tab, and the finish it was last synced to
  const tag = { shape: 'bone', size: 'medium', finish: 'red', font: 'block', icon: 'none', qty: 1, front: ['Built like', 'a loaf.', '', ''], back: ['', '', ''] /* empty: the example name/phone are input placeholders only, never real values */, smart: false, color: 'none', colorHue: 'blue', photo: false, photoData: null, photoName: '',
    // Full color print: art path ('design' = we make it from a house style, 'upload' = the customer's image), the image, the rights tick, paid raised lettering.
    adult: false, art: 'design', style: 'bold', artData: null, artName: '', artW: 0, artH: 0, artSvg: false, artAck: false, raised: false, showSafe: true };
  let cart = [];
  try { cart = JSON.parse(localStorage.getItem('sdt-cart') || '[]'); } catch { cart = []; }
  cart = cart.filter((i) => i && i.kind && (i.kind !== 'tag' || (FINISHES[i.finish] && SIZES[i.size])) && (i.kind !== 'ornament' || ORNAMENT_ENABLED));
  // A tag saved in an earlier session in a shape we no longer sell (no blanks on hand) is dropped; init() tells the visitor.
  const cartBefore = cart.length;
  cart = cart.filter((i) => i.kind !== 'tag' || !HIDDEN_SHAPES.includes(i.shape));
  const cartDropped = cartBefore - cart.length;
  // A photo tag can blow the ~5 MB localStorage quota. Then the cart lives in memory only (it still
  // works until the tab closes) and the receipt says so, instead of silently losing it on reload.
  let cartMemOnly = false;
  const saveCart = () => {
    try { localStorage.setItem('sdt-cart', JSON.stringify(cart)); cartMemOnly = false; }
    catch { cartMemOnly = cart.some((i) => i.photoData); try { localStorage.removeItem('sdt-cart'); } catch {} }
    return !cartMemOnly;
  };
  // Lines that would engrave exactly the same tag merge into one line with a bigger qty.
  const lineKey = (i) => JSON.stringify([i.kind, i.shape, i.size, i.finish, i.font, i.icon, i.color, i.color && i.color !== 'none' ? i.colorHue : '', Boolean(i.photo), i.photo ? i.photoData : '', i.front, i.back, i.art, i.style, Boolean(i.raised), i.tier, i.oname, i.year, Boolean(i.smart)]);
  // Last order (sdt-last): { id, email, at, mode: 'card'|'invoice', sig, items, total, paid }. Set when an
  // order is saved, marked paid by thanks.html on Clover's success redirect.
  const LAST_TTL = 24 * 60 * 60 * 1000;
  const readLast = () => { try { return JSON.parse(localStorage.getItem('sdt-last') || 'null'); } catch { return null; } };
  const writeLast = (v) => { try { localStorage.setItem('sdt-last', JSON.stringify(v)); } catch {} };
  const pendingLast = () => { const l = readLast(); return l && l.id && l.email && l.mode === 'card' && !l.paid && Date.now() - (l.at || 0) < LAST_TTL ? l : null; };

  // Base price (size + finish premium) and add-on price (color/photo), kept separate because add-ons
  // are excluded from the 15%-off-3+ discount and the Salty Maze prize credit. Must match _lib.js.
  const tagUnitBase = (t) => (isFullcolor(t.finish) ? (PRICES.fullcolor[t.size] || PRICES.fullcolor.medium) : (PRICES.size[t.size] || PRICES.size.medium) + (PRICES.premium[t.finish] || 0));
  const tagAddon = (t) => {
    if (isFullcolor(t.finish)) return t.raised ? PRICES.raisedCents / 100 : 0; // paid raised lettering; the photo is the product, not an add-on
    if (!isStainlessKind(t.finish)) return 0;
    let a = 0;
    if (t.color === 'icon') a += PRICES.addon.icon; else if (t.color === 'line') a += PRICES.addon.line;
    if (t.photo) a += PRICES.addon.photo;
    return a;
  };
  const tagUnit = (t) => tagUnitBase(t) + tagAddon(t);
  // Ornament unit price in dollars (server: ornamentUnit in _lib.js). Raised name and year are included in the acrylic tier while ORNAMENT_RAISED_INCLUDED.
  const ornamentUnit = (o) => PRICES.ornament[o.tier] / 100 + (o.tier === 'acrylic' && !ORNAMENT_RAISED_INCLUDED && o.raised ? PRICES.raisedCents / 100 : 0);
  function totals(delivery) {
    // The Salty Maze code is only checked server side (one use, in KV), so the receipt never subtracts it.
    const prizeOk = false;
    let sub = 0, tagCount = 0, tagBaseSub = 0;
    for (const i of cart) {
      sub += i.unit * i.qty + (i.kind === 'tag' && i.smart ? SMART.price : 0) + (i.kind === 'tag' ? designFee(i) : 0);   // one fee per smart entry / per design, never discounted
      if (i.kind === 'tag') { tagCount += i.qty; tagBaseSub += (i.unitBase != null ? i.unitBase : i.unit) * i.qty; }
    }
    const discount = tagCount >= PRICES.multiQty ? Math.round(tagBaseSub * PRICES.multiOff * 100) / 100 : 0;
    const prize = prizeOk ? Math.max(0, ...cart.filter((i) => i.kind === 'tag').map((i) => PRICES.premium[i.finish] || 0)) : 0;
    const after = sub - discount - prize;
    const ship = delivery === 'pickup' || after >= PRICES.freeOver || after === 0 ? 0 : PRICES.ship;
    return { sub, discount, prize, ship, total: after + ship, after, tagCount };
  }
  // What adding one more of the cheapest tag on the receipt would do (used by the receipt nudge).
  function totalsPlusOne(delivery) {
    const tags = cart.filter((i) => i.kind === 'tag'); if (!tags.length) return null;
    const cheap = tags.reduce((a, b) => (b.unit < a.unit ? b : a));
    cart.push({ ...cheap, qty: 1 });
    try { return totals(delivery); } finally { cart.pop(); }
  }

  /* ---------- render ---------- */
  // "includes $6 color" style add-on wording for the price line
  function addonName(t) {
    const bits = [];
    if (isFullcolor(t.finish) && t.raised) bits.push('raised lettering');
    if (isStainlessKind(t.finish) && (t.color === 'icon' || t.color === 'line')) bits.push('color');
    if (isStainlessKind(t.finish) && t.photo) bits.push('photo');
    return bits.join(' and ');
  }
  // Text-fit check: the same fit loop the preview uses, so "it fits on screen" and "we can engrave it" agree.
  function shapeArea(shape, finish) {
    if (isFullcolor(finish)) return FC_TEXT[shape] || FC_TEXT.bone;
    const tpl = TEMPLATES[shape];
    if (tpl && tpl.ready) { const a = tpl.area; return (shape === 'bone' && finish === 'polished') ? { ...a, cx: a.cx - a.w * 0.11, w: a.w * 0.72 } : a; }
    return shapeSpec(shape).area;
  }
  const overflows = (lines, t, icon) => { const l = lines.filter(Boolean); return l.length ? engraveLayout(l, shapeArea(t.shape, t.finish), t.font, icon).overflow : false; };
  // Visible shapes where these lines fit at this finish/font, best-first (bone and military have the roomiest text areas).
  const FIT_ORDER = ['bone', 'military', 'heart', 'round', 'paw'];
  function shapesThatFit(lines, t, icon) {
    return FIT_ORDER.filter((sh) => !HIDDEN_SHAPES.includes(sh) && !overflows(lines, { shape: sh, finish: finishOk(t.finish, sh) ? t.finish : 'black', font: t.font }, icon));
  }
  const fit = { front: false, back: false };
  function updateFit() {
    fit.front = !tag.photo && overflows(tag.front, tag, tag.icon);
    fit.back = overflows(tag.back, tag, 'none');
    [['front', 'frontFit', ['f1', 'f2', 'f3']], ['back', 'backFit', ['b1', 'b2', 'b3']]].forEach(([k, id, inputs]) => {
      const el = document.getElementById(id); if (el) {
        el.hidden = !fit[k];
        if (k === 'front' && fit.front) {
          const alts = shapesThatFit(tag.front, tag, tag.icon).map((sh) => SHAPES[sh].n);
          el.textContent = 'Too long for this shape.' + (alts.length ? ' It fits on the ' + alts.join(' or ') + ', or shorten a line.' : ' Shorten a line or pick a narrower font.');
        }
      }
      inputs.forEach((i) => {
        const inp = document.getElementById(i); if (!inp) return;
        const field = inp.closest('.field'); field.classList.toggle('is-fit', fit[k]);
        if (fit[k]) { inp.setAttribute('aria-invalid', 'true'); addDescribedBy(inp, id); }
        else { removeDescribedBy(inp, id); if (!field.classList.contains('is-err')) inp.removeAttribute('aria-invalid'); }
      });
    });
  }
  /* ---------- smart QR tag (site/tag-qr.js is the single source for where the QR goes) ----------
     The toggle shows only when /api/config says smart tags are on AND the real blank, finish and the typed text can carry one.
     The server re-checks everything (functions/api/order.js); this only decides what to offer and draws the placeholder. */
  const smartCache = new Map();
  const cleanLine = (l) => String(l || '').replace(/\s+/g, ' ').trim();
  function smartCheck() {
    if (!SMART.on || typeof SDTQR === 'undefined' || isFullcolor(tag.finish) || HIDDEN_SHAPES.includes(tag.shape)) return { ok: false, reason: 'off' };
    const key = [tag.shape, tag.finish, tag.font, ...tag.back.map(cleanLine)].join('~');
    if (!smartCache.has(key)) {
      let r;
      try { r = SDTQR.checkTag({ shape: tag.shape, finish: tag.finish, font: tag.font, back: tag.back.map(cleanLine) }); } catch { r = { ok: false, reason: 'off' }; }
      smartCache.set(key, r);
      if (smartCache.size > 60) smartCache.delete(smartCache.keys().next().value);
    }
    return smartCache.get(key);
  }
  function smartBlank() { try { return SMART.on && typeof SDTQR !== 'undefined' && !isFullcolor(tag.finish) && SDTQR.qrEligibility(tag.shape, tag.finish).eligible; } catch { return false; } }
  function updateSmartUI() {
    const box = $('#smartBox'); if (!box) return;
    const blankOk = smartBlank(), chk = blankOk ? smartCheck() : { ok: false };
    box.hidden = !blankOk;
    const on = $('#smartOn'), note = $('#smartNote');
    if (!blankOk) { tag.smart = false; return; }
    $('#smartPrice').textContent = SMART.price > 0 ? '+' + money(SMART.price) + ' one time' : 'free';
    const textBad = !chk.ok;
    on.disabled = textBad;
    if (textBad) tag.smart = false;
    on.checked = Boolean(tag.smart);
    note.hidden = !textBad; note.textContent = textBad ? (chk.message || SDTQR.MESSAGES.text) : '';
  }
  // The back preview for a smart tag: a clearly fake QR where the real one will go, and the back text re-fitted around it.
  function smartBackSVG(plan, ghost) {
    const b = SDTQR.blankOf({ shape: tag.shape, finish: tag.finish });
    const lines = ghost ? ['Dog name', 'Your phone'] : SDTQR.backLinesFor({ back: tag.back.map(cleanLine) }, plan.phoneSplit);
    const area = { cx: b.bx0 + plan.textCenter.x * b.k, cy: b.by0 + plan.textCenter.y * b.k, w: Math.max(20, plan.textBoxMm.w * b.k), h: Math.max(10, plan.textBoxMm.h * b.k) };
    const svg = tagSVG({ shape: tag.shape, finish: tag.finish, lines, font: tag.font, area });
    return svg.replace(/<\/svg>\s*$/, SDTQR.placeholderGroup(plan) + '</svg>');
  }
  function renderPreview() {
    const colorHex = tag.color !== 'none' && isStainlessKind(tag.finish) ? COLOR_HUES[tag.colorHue].c : null;
    const fc = isFullcolor(tag.finish);
    const front = fc
      ? tagSVGFullcolor({ shape: tag.shape, lines: tag.front, font: tag.font, art: tag.art, style: tag.style, imgData: tag.artData, raised: tag.raised, showSafe: tag.showSafe })
      : tagSVG({ shape: tag.shape, finish: tag.finish, lines: tag.photo ? [] : tag.front, font: tag.font, icon: tag.photo ? 'none' : tag.icon, photo: tag.photo, photoData: tag.photoData, colorMode: tag.photo ? null : tag.color, colorHex: tag.photo ? null : colorHex });
    // Nothing typed on the back yet: show a dimmed example so it never looks like a real engraving.
    const ghost = !tag.back.some(Boolean);
    updateSmartUI();
    const sm = tag.smart ? smartCheck() : null;
    const back = sm && sm.ok ? smartBackSVG(sm.plan, ghost) : tagSVG({ shape: tag.shape, finish: tag.finish, lines: ghost ? ['Dog name', 'Your phone'] : tag.back, font: tag.font });
    $('#preview').innerHTML = `<div class="two"><div>${front}<span class="side">Front</span></div><div${ghost ? ' class="is-ghost"' : ''}>${back}<span class="side">Back${ghost ? ' (example)' : ''}</span></div></div>`;
    const addon = tagAddon(tag), an = addonName(tag);
    const addonNote = (addon ? ` <b class="price__addon">(includes ${money(addon)} ${an})</b>` : '') + (tag.smart && SMART.price > 0 ? ` <b class="price__addon">+ ${money(SMART.price)} one-time scan-to-find QR</b>` : '') + (designFee(tag) ? ` <b class="price__addon">+ ${money(designFee(tag))} custom design, once</b>` : '');
    $('#tagPrice').innerHTML = money(tagUnit(tag)) + addonNote + ` <small>${esc(SHAPES[tag.shape].n)} · ${esc(sizeLabel(tag.size, tag.shape, tag.finish))} · ${esc(FINISHES[tag.finish].n.replace(/ \+\$\d/, ''))} · ${fc ? 'both sides printed' : 'both sides engraved'}</small>`;
    updateFit();
    renderQtySave();
  }
  // Live multi-tag saving next to the quantity stepper: counts what's already on the receipt plus this tag.
  function renderQtySave() {
    const el = $('#qtySave'); if (!el) return;
    const inCart = cart.filter((i) => i.kind === 'tag');
    const count = inCart.reduce((n, i) => n + i.qty, 0) + tag.qty;
    const base = inCart.reduce((n, i) => n + (i.unitBase != null ? i.unitBase : i.unit) * i.qty, 0) + tagUnitBase(tag) * tag.qty;
    if (count >= PRICES.multiQty) {
      el.className = 'qty-save is-on';
      el.innerHTML = `<b>15% off${inCart.length ? ' with this one' : ''}:</b> you save ${money(Math.round(base * PRICES.multiOff * 100) / 100)} on the order`;
    } else {
      const need = PRICES.multiQty - count;
      el.className = 'qty-save';
      el.textContent = `${need} more tag${need === 1 ? '' : 's'} and the whole order is 15% off${inCart.length ? ` (${inCart.reduce((n, i) => n + i.qty, 0)} already on the receipt)` : ''}.`;
    }
  }
  function renderOpts() {
    $('#shapeOpts').innerHTML = Object.entries(SHAPES).filter(([k]) => !HIDDEN_SHAPES.includes(k)).map(([k, s]) =>
      `<label class="opt"><input type="radio" name="shape" value="${k}" ${k === tag.shape ? 'checked' : ''}><span>${s.n}</span></label>`).join('');
    const avail = sizesFor(tag.shape, tag.finish); if (!avail.includes(tag.size)) tag.size = avail[0];
    // One size per shape. The label is the real blank (mm, with inches), the key only sets the price tier.
    $('#sizeOpts').innerHTML = avail.map((k) => `<label class="opt"><input type="radio" name="size" value="${k}" ${k === tag.size ? 'checked' : ''}><span>${esc(mmLabel(tag.shape, k, tag.finish))} <i class="dim">${esc(inLabel(tag.shape, k, tag.finish))} · $${(isFullcolor(tag.finish) ? PRICES.fullcolor : PRICES.size)[k]}</i></span></label>`).join('');
    $('#fontOpts').innerHTML = Object.entries(FONTS).map(([k, f]) => `<label class="opt"><input type="radio" name="font" value="${k}" ${k === tag.font ? 'checked' : ''}><span style="font-family:${f.css}">${f.n}</span></label>`).join('');
    $('#iconOpts').innerHTML = Object.entries(ICONS).map(([k, i]) => `<label class="opt" title="${esc(i.n)}"><input type="radio" name="icon" value="${k}" aria-label="${esc(i.n)}" ${k === tag.icon ? 'checked' : ''}><span>${i.d ? `<svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><path d="${i.d}" fill="currentColor"/></svg>` : 'None'}</span></label>`).join('');
    const finChip = ([k, f]) => {
      const ok = finishOk(k, tag.shape); const full = f.n.replace(/ \+\$\d+$/, ''); const name = full.replace(/ stainless$/, ''); const up = PRICES.premium[k] || 0;
      const lc = lowContrast(k);
      return `<label class="opt ${ok ? '' : 'is-off'}"><input type="radio" name="finish" value="${k}" aria-label="${esc(full + (up ? ', plus $' + up : '') + (lc ? ', light colour, lower contrast' : ''))}" ${k === tag.finish ? 'checked' : ''} ${ok ? '' : 'disabled'}><span><i class="swatch sw-${f.kind}" style="--c:${f.c}"></i>${esc(name)}${up ? `<i class="fin__up">+$${up}</i>` : ''}${lc ? '<i class="fin__lc" title="Light colour: lower contrast" aria-hidden="true">light</i>' : ''}</span></label>`;
    };
    // Finish tabs: a tab is only a view. Switching tabs never changes tag.finish; tapping a pill does.
    const fins = Object.entries(FINISHES);
    const tabs = Object.keys(FIN_TABS).filter((t) => fins.some(([k, f]) => f.kind === t && finishOk(k, tag.shape)));
    const selKind = FINISHES[tag.finish].kind;
    if (finSeen !== tag.finish || !tabs.includes(finTab)) { finTab = tabs.includes(selKind) ? selKind : tabs[0]; finSeen = tag.finish; }
    const T = FIN_TABS[finTab];
    $('#finishOpts').innerHTML =
      `<div class="fintabs" role="tablist" aria-label="Finish type">${tabs.map((t) => `<button type="button" class="fintab" role="tab" id="fintab-${t}" data-fintab="${t}" aria-controls="finPanel" aria-selected="${t === finTab}" tabindex="${t === finTab ? 0 : -1}">${FIN_TABS[t].n}${t === selKind ? '<i class="fintab__dot" aria-hidden="true"></i><span class="sr-only"> (your pick)</span>' : ''}</button>`).join('')}</div>`
      + `<p class="help fins__help" id="finHelp">${T.help}</p>`
      + `<div role="tabpanel" id="finPanel" aria-labelledby="fintab-${finTab}" aria-describedby="finHelp"><div class="opts opts--fin" role="radiogroup" aria-labelledby="finishLbl">${fins.filter(([, f]) => f.kind === finTab).map(finChip).join('')}</div></div>`
      + (lowContrast(tag.finish) ? `<p class="help fins__lc" id="finLc"><b>Light colour:</b> the bright silver engraving shows lower contrast on this one. Dark colours read best.</p>` : '');
    const fn = $('#finishName'); if (fn) fn.textContent = FINISHES[tag.finish].n;

    // Color + photo add-ons: only ever valid on a stainless-kind finish. Reset instead of leaving stale
    // state a resubmit could carry — the server re-validates this too, but the UI should not lie about it.
    const stainlessSel = isStainlessKind(tag.finish);
    if (!stainlessSel) tag.color = 'none';
    const photoAvail = stainlessSel && finishOk('polished', tag.shape);
    if (!photoAvail) tag.photo = false;
    const colorField = $('#colorField');
    if (colorField) {
      colorField.hidden = !stainlessSel;
      if (stainlessSel) {
        const colorPill = (val, label, up) => `<label class="opt"><input type="radio" name="color" value="${val}" ${tag.color === val ? 'checked' : ''}><span>${esc(label)}${up ? `<i class="fin__up">+$${up}</i>` : ''}</span></label>`;
        $('#colorOpts').innerHTML = colorPill('none', 'None', 0) + colorPill('icon', 'Icon or short line', PRICES.addon.icon) + colorPill('line', 'Full line', PRICES.addon.line);
        const hueField = $('#colorHueField');
        if (hueField) {
          hueField.hidden = tag.color === 'none';
          if (tag.color !== 'none') {
            $('#colorHueOpts').innerHTML = Object.entries(COLOR_HUES).map(([k, c]) =>
              `<label class="opt" title="${esc(c.n)}"><input type="radio" name="colorHue" value="${k}" aria-label="${esc(c.n)}" ${tag.colorHue === k ? 'checked' : ''}><span><i class="swatch" style="--c:${c.c}"></i>${esc(c.n)}</span></label>`).join('');
          }
        }
      }
    }
    const photoField = $('#photoField');
    if (photoField) {
      photoField.hidden = !photoAvail;
      const po = $('#photoOn'); if (po) po.checked = tag.photo;
      const pak = $('#photoAck'); if (pak) pak.checked = tag.artAck;
      const pu = $('#photoUpload'); if (pu) pu.hidden = !tag.photo;
      renderPhotoThumb();
    }
    const sayingFields = $('#sayingFields');
    if (sayingFields) sayingFields.hidden = tag.photo;
    // Full color print: art path + upload, raised lettering (paid), the material note. Nothing here is shown for other finishes.
    const fcSel = isFullcolor(tag.finish);
    if (fcSel) tag.icon = 'none';
    const iconField = $('#iconField'); if (iconField) iconField.hidden = fcSel;
    const sizeHelp = $('#sizeHelp'); if (sizeHelp) sizeHelp.textContent = fcSel ? 'Four sizes in full color. The size is the long edge of the tag.' : 'One size per shape. One less decision.';
    const artField = $('#artField'); if (artField) { artField.hidden = !fcSel; if (fcSel) renderArt(); }
    const raisedField = $('#raisedField');
    if (raisedField) {
      raisedField.hidden = !fcSel;
      const ro = $('#raisedOn'); if (ro) ro.checked = Boolean(tag.raised);
      const rp = $('#raisedPrice'); if (rp) rp.textContent = '+' + money(PRICES.raisedCents / 100);
    }
  }
  /* ---------- full color: art path, upload, rights tick ---------- */
  const artNeedsImage = (t) => t.art === 'upload' || Boolean(ART_STYLES[t.style] && ART_STYLES[t.style].needsImage);
  function renderArt() {
    const modeBox = $('#artModeOpts');
    if (!modeBox.firstChild) modeBox.innerHTML = [['design', 'We design it'], ['upload', 'Upload your own']].map(([k, n]) => `<label class="opt"><input type="radio" name="artMode" value="${k}"><span>${n}</span></label>`).join('');
    $$('input[name=artMode]', modeBox).forEach((r) => { r.checked = r.value === tag.art; });
    const styleBox = $('#styleOpts');
    if (!styleBox.firstChild) styleBox.innerHTML = Object.entries(ART_STYLES).map(([k, st]) => `<label class="opt"><input type="radio" name="artStyle" value="${k}"><span>${esc(st.n)}<i class="dim">${esc(st.d)}${DESIGN_FEE_STYLES.includes(k) ? ' &middot; +' + money(PRICES.designCents / 100) : ' &middot; free'}</i></span></label>`).join('');
    $$('input[name=artStyle]', styleBox).forEach((r) => { r.checked = r.value === tag.style; });
    const needs = artNeedsImage(tag);
    $('#artDesign').hidden = tag.art !== 'design';
    $('#artUploadBox').hidden = !needs;
    $('#artFileTxt').textContent = tag.artData ? 'Change image' : (tag.art === 'upload' ? 'Choose a photo or artwork' : 'Choose your dog photo');
    $('#artHelp').textContent = tag.art === 'upload' ? 'PNG, JPG or SVG, up to 1.5 MB. It fills the tag: keep what matters inside the dashed line.' : 'This style uses your dog photo. JPG or PNG.';
    $('#safeRow').hidden = tag.art !== 'upload';
    const sw = $('#safeOn'); if (sw) sw.checked = tag.showSafe;
    $('#ackField').hidden = !needs;
    const ak = $('#artAck'); if (ak) ak.checked = tag.artAck;
    const th = $('#artThumb'); if (th) { if (tag.artData) { th.src = tag.artData; th.hidden = false; } else { th.removeAttribute('src'); th.hidden = true; } }
    const lead = $('#artLead'); if (lead) lead.textContent = tag.art === 'upload' ? 'Print your own photo or finished artwork. The saying is optional.' : 'We make it from the saying you pick above (or write below) in one of our house styles. We start once your invoice is paid, email you a proof, and include one round of changes. Bold type is free; the other styles add ' + money(PRICES.designCents / 100) + ' per design.';
  }
  /* Full color uploads: a photo or finished artwork. Raster: blocked under UPLOAD_BLOCK_PX on the short side, warned under
     UPLOAD_WARN_PX (measured on the source, for a 2-inch tag). SVG: read as text and sent as is; the server sanitizes it. */
  async function processArt(file) {
    const type = String(file.type || '').toLowerCase();
    if (type === 'image/svg+xml' || /\.svg$/i.test(file.name || '')) {
      const text = await file.text();
      if (text.length > 1.5 * 1024 * 1024) throw new Error('That SVG is too large. Use a file under 1.5 MB.');
      if (!/<svg[\s>]/i.test(text)) throw new Error('That file does not look like an SVG image.');
      return { dataUrl: 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(text))), w: 0, h: 0, svg: true, warn: '' };
    }
    if (!/^image\/(png|jpeg)$/.test(type)) throw new Error('Use a PNG, JPG or SVG file.');
    const img = await loadImageFile(file);
    const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
    URL.revokeObjectURL(img.src);
    if (!w || !h) throw new Error('Could not read that image. Try a PNG or JPG.');
    const short = Math.min(w, h);
    if (short < UPLOAD_BLOCK_PX) throw new Error(`That image is too small to print: ${w} x ${h} px, and we need at least ${UPLOAD_BLOCK_PX} px on the short side.`);
    const warn = short < UPLOAD_WARN_PX ? `Heads up: ${w} x ${h} px is low for a 2-inch print (aim for ${UPLOAD_WARN_PX} px or more on the short side). It will print soft.` : '';
    const scale = Math.min(1, 1600 / Math.max(w, h));
    const cw = Math.max(1, Math.round(w * scale)), ch = Math.max(1, Math.round(h * scale));
    const cv = document.createElement('canvas'); cv.width = cw; cv.height = ch;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cw, ch); // transparent areas print as white
    ctx.drawImage(img, 0, 0, cw, ch);
    const cap = 1.5 * 1024 * 1024;
    let dataUrl = '';
    if (type === 'image/png') { dataUrl = cv.toDataURL('image/png'); if (dataUrl.length * 0.75 > cap) dataUrl = ''; } // keep flat artwork crisp when it fits
    if (!dataUrl) { let q = 0.88; dataUrl = cv.toDataURL('image/jpeg', q); while (dataUrl.length * 0.75 > cap && q > 0.45) { q -= 0.1; dataUrl = cv.toDataURL('image/jpeg', q); } }
    return { dataUrl, w, h, svg: false, warn };
  }
  const GALLERY_FIN = ['black', 'polished', 'rainbow', 'red', 'stainless', 'royal', 'gold', 'yellow', 'ssblack', 'green', 'navy', 'hotpink', 'bronze', 'sky', 'brass', 'silver', 'pink'];
  const GALLERY_SHAPE = ['bone', 'heart', 'round', 'military', 'bone', 'paw', 'heart', 'bone', 'round', 'military', 'paw'];
  function renderSayings(cat) {
    let list = visible().filter((s) => cat === 'all' || s.c === cat);
    if (cat === 'all') { // interleave categories so the top of the grid isn't one breed's jokes
      const by = {}; list.forEach((s) => (by[s.c] = by[s.c] || []).push(s));
      const order = Object.keys(CATS).filter((k) => by[k]); const out = [];
      for (let i = 0; out.length < list.length; i++) order.forEach((k) => { if (by[k][i]) out.push(by[k][i]); });
      list = out;
    }
    const PAGE = 8; const shown = renderSayings._shown = (renderSayings._cat === cat ? (renderSayings._shown || PAGE) : PAGE); renderSayings._cat = cat;
    const rest = Math.max(0, list.length - shown); list = list.slice(0, shown);
    $('#sayingGrid').innerHTML = (list.length ? '' : '<p class="note say__none">Nothing here yet. The dogs are workshopping it.</p>') + list.map((s, pos) => {
      let shape = GALLERY_SHAPE[s.i % GALLERY_SHAPE.length], fin = GALLERY_FIN[(s.i * 3) % GALLERY_FIN.length];
      if (pos === 1) { shape = 'bone'; fin = 'polished'; } // second card on every page: the paw cut-out polished stainless bone
      if (!finishOk(fin, shape)) { const alt = Object.keys(FINISHES).find((k) => finishOk(k, shape)); fin = alt || 'black'; }
      return `<button type="button" class="say" data-i="${s.i}" data-shape="${shape}" data-fin="${fin}"><span class="say__photo">${tagSVG({ shape, finish: fin, lines: s.l })}</span><span class="say__name">${esc(s.l.join(' '))}</span><span class="say__t"><span>${money((PRICES.size[sizesFor(shape, fin)[0]] || PRICES.size.medium) + (PRICES.premium[fin] || 0))}</span><b>Use this &rarr;</b></span></button>`;
    }).join('');
    if (rest) $('#sayingGrid').insertAdjacentHTML('beforeend', `<button type="button" class="btn btn--ghost say__more" data-more="1">Show ${Math.min(rest, PAGE)} more <span class="dim">(${rest} in the vault)</span></button>`);
  }
  function renderFilters(active) {
    $('#filters').innerHTML = Object.entries(CATS).map(([k, n]) => `<button type="button" class="chip ${k === 'adult' ? 'chip--adult' : ''}" data-cat="${k}" aria-pressed="${k === active}">${k === 'adult' && !adultOn ? '\uD83D\uDD12 ' : ''}${n}</button>`).join('');
  }
  const deliveryVal = () => (($('input[name=delivery]:checked') || $('input[name=delivery]') || {}).value) || 'ship';
  // Utah sales tax applies only to orders shipped to Utah (the server computes it from the same state).
  const shipState = () => (($('#state') || {}).value) || '';
  const taxedNow = () => deliveryVal() === 'pickup' || shipState() === 'UT';
  function renderCart() {
    const c = $('#cart');
    const buyBar = $('#buyBar');
    const of = $('#orderForm');
    renderQtySave();
    // Header button: "Build a tag" until there is something on the receipt (an empty checkout is a dead end), then "Order (n)".
    const navCta = $('#navCta');
    if (navCta) { const n = cart.reduce((a, i) => a + (i.qty || 1), 0); navCta.textContent = n ? 'Order (' + n + ')' : 'Build a tag'; navCta.setAttribute('href', n ? '#order' : '#build'); }
    if (!cart.length) {
      c.innerHTML = '<h3>Your order</h3><p class="empty">Nothing on the receipt yet. The printer is bored. <a href="#sayings">Pick a saying</a> or <a href="#build">build a tag</a>.</p>';
      if (buyBar) buyBar.hidden = true;
      if (of) of.hidden = true; // nothing to check out yet: the form waits behind the receipt
      return;
    }
    if (of) of.hidden = false;
    const delivery = deliveryVal();
    const t = totals(delivery);
    if (buyBar) { buyBar.hidden = false; $('#buyBarTot').textContent = money(t.total); }
    const btn = $('#sendBtn');
    if (btn && !btn.disabled) btn.textContent = sendLabel(t.total);
    const taxNote = $('#taxNote');
    if (taxNote) taxNote.hidden = window.PAY_ON !== true || !(delivery === 'pickup' || (($('#state') || {}).value || 'UT') === 'UT');
    // Nudges: two tags -> what the third costs and what it unlocks; otherwise the gap to free shipping.
    let nudge = '';
    if (t.tagCount === 2) {
      const p1 = totalsPlusOne(delivery);
      const extra = p1.total - t.total;
      const freeShip = delivery !== 'pickup' && t.ship > 0 && p1.ship === 0;
      nudge = `Add 1 more tag for ${extra > 0 ? '+' + money(extra) : 'free'}: 15% off${freeShip ? ' + free shipping' : ' the whole order'}.`;
    } else if (delivery !== 'pickup' && t.ship > 0 && t.after < PRICES.freeOver) {
      nudge = `${money(PRICES.freeOver - t.after)} to free shipping.`;
    }
    const prizeCode = (($('#prize') || {}).value || '').trim();
    const fcOf = (i) => i.kind === 'tag' && isFullcolor(i.finish);
    const artNote = (i) => (i.art === 'upload' ? 'Your own image' : 'We design it: ' + ((ART_STYLES[i.style] || {}).n || 'Bold type')) + (i.photo && i.art !== 'upload' ? ' (your photo)' : '');
    c.innerHTML = '<h3>Your order</h3><ul>' + cart.map((i, idx) => {
      if (i.kind === 'ornament') {
        const tl = i.tier === 'stainless' ? 'engraved stainless bone' : 'full-color printed acrylic';
        const nt = i.tier === 'stainless' ? 'Photo engraved in grayscale' : (i.art === 'upload' ? 'Your own image' : 'We design it: ' + ((ART_STYLES[i.style] || {}).n || '')) + (i.raised ? ', raised name and year' : '');
        return `<li><span>${i.qty}&times; Holiday pet photo ornament &middot; ${esc(tl)}<br><span class="note">${esc(i.oname)}, ${esc(i.year)} &nbsp;|&nbsp; ${esc(nt)}</span></span><span style="white-space:nowrap">${money(i.unit * i.qty)} <button type="button" data-rm="${idx}" aria-label="Remove ${i.qty} ornament for ${esc(i.oname)}">remove</button></span></li>`;
      }
      const addonBits = i.kind === 'tag' ? [i.photo && !fcOf(i) ? 'photo' : null, i.color && i.color !== 'none' ? `${i.color === 'line' ? 'colored line' : 'colored icon'} (${(COLOR_HUES[i.colorHue] || {}).n || i.colorHue})` : null].filter(Boolean) : [];
      if (fcOf(i) && i.raised) addonBits.push('raised');
      const label = i.kind === 'tag'
        ? `${SHAPES[i.shape].n} tag &middot; ${esc(sizeLabel(i.size, i.shape, i.finish))} &middot; ${FINISHES[i.finish].n.replace(/ \+\$\d/, '')} &middot; ${(FONTS[i.font] || FONTS.block).n}${i.icon && i.icon !== 'none' ? ' + ' + ICONS[i.icon].n : ''}${addonBits.length ? ' &middot; <b>' + esc(addonBits.join(' + ')) + '</b>' : ''}<br><span class="note">${fcOf(i) ? esc(artNote(i)) + (i.front.some(Boolean) ? ' &middot; ' + esc(i.front.filter(Boolean).join(' / ')) : '') : i.photo ? 'Photo on front' : esc(i.front.filter(Boolean).join(' / '))} &nbsp;|&nbsp; ${esc(i.back.filter(Boolean).join(' / '))}</span>`
        : `${esc(i.name)}${i.note ? `<br><span class="note">${esc(i.note)}</span>` : ''}`;
      // Paid raised lettering is its own receipt line, so the price of the print and the price of the option stay readable.
      const rl = fcOf(i) && i.raised;
      const shown = rl ? (i.unitBase != null ? i.unitBase : i.unit) : i.unit;
      return `<li><span>${i.qty}&times; ${label}</span><span style="white-space:nowrap">${i.unit ? money(shown * i.qty) : 'quote'} <button type="button" data-rm="${idx}" aria-label="Remove ${i.qty} ${i.kind === 'tag' ? SHAPES[i.shape].n.toLowerCase() + ' tag' : esc(i.name)}">remove</button></span></li>`
        + (rl ? `<li class="cart__sub"><span>&nbsp;&nbsp;Raised lettering, ${i.qty}&times; ${money(PRICES.raisedCents / 100)}</span><span>${money(PRICES.raisedCents / 100 * i.qty)}</span></li>` : '')
        + (i.kind === 'tag' && i.smart ? `<li class="cart__sub"><span>&nbsp;&nbsp;${esc(SMART_LINE)}</span><span>${SMART.price > 0 ? money(SMART.price) : 'free'}</span></li>` : '')
        + (i.kind === 'tag' && designFee(i) ? `<li class="cart__sub"><span>&nbsp;&nbsp;Custom design (proof after payment, one round of changes)</span><span>${money(designFee(i))}</span></li>` : '');
    }).join('') +
      `<li><span>Subtotal</span><span>${money(t.sub)}</span></li>` +
      (t.discount ? `<li><span>3+ tags, 15% off</span><span>&minus;${money(t.discount)}</span></li>` : '') +
      (PRIZE_RE.test(prizeCode) ? `<li><span>Salty Maze upgrade code</span><span class="cart__chk">checked at payment</span></li>` : '') +
      `<li><span>Shipping</span><span>${t.ship ? money(t.ship) : 'Free'}</span></li>` +
      `<li class="tot"><span>${taxedNow() ? 'Total (before tax)' : 'Total'}</span><span>${money(t.total)}</span></li></ul>` +
      (nudge ? `<p class="cart__nudge">${esc(nudge)}</p>` : '') +
      (cartMemOnly ? '<p class="cart__warn" role="alert">Your photo is too big to save on this device, so this order only lives in this tab. Finish checkout before you close it.</p>' : '');
  }
  function sendLabel(total) {
    const btn = $('#sendBtn'); if (!btn) return '';
    const base = window.PAY_ON === true ? btn.dataset.pay : btn.dataset.invoice; // invoice copy until /api/config says checkout is live
    return cart.length ? `${base} · $${(Math.round(total * 100) / 100).toFixed(2)}` : base;
  }
  function renderPhotoThumb() {
    const th = $('#photoThumb'), tx = $('#photoBtnTxt'); if (!th || !tx) return;
    if (tag.photoData) { th.src = tag.photoData; th.hidden = false; tx.textContent = 'Change photo'; }
    else { th.removeAttribute('src'); th.hidden = true; tx.textContent = 'Choose a photo'; }
  }
  /* Phones: the sticky preview (~220px) plus the nav (60px) cover the field you're typing in once the
     keyboard is up. While a builder text field has focus, shrink the preview to just the side being
     edited (~90px), then make sure the field's label, input and counter sit below it. */
  function wirePreviewCollapse(form) {
    const pv = $('.preview'); if (!pv) return;
    const small = matchMedia('(max-width: 900px)');
    const isText = (el) => el && el.matches && el.matches('#tagForm input[type=text], #tagForm input[type=tel]');
    let cur = null;
    const fit = () => {
      if (!cur || document.activeElement !== cur) return;
      const field = cur.closest('.field') || cur;
      const top = field.getBoundingClientRect().top, bar = pv.getBoundingClientRect().bottom;
      if (top < bar + 8) scrollBy(0, top - bar - 8);
      else { const vb = (window.visualViewport ? visualViewport.height : innerHeight); const bot = cur.getBoundingClientRect().bottom; if (bot > vb - 4) scrollBy(0, Math.min(bot - vb + 12, top - bar - 8)); }
    };
    form.addEventListener('focusin', (e) => {
      if (!small.matches || !isText(e.target)) return;
      cur = e.target;
      pv.classList.add('is-typing');
      pv.dataset.side = /^back/.test(e.target.name) ? 'back' : 'front';
      requestAnimationFrame(fit); setTimeout(fit, 350);
    });
    // The keyboard opens (and resizes the viewport) on its own schedule: re-fit whenever it does.
    (window.visualViewport || window).addEventListener('resize', () => setTimeout(fit, 60));
    form.addEventListener('focusout', (e) => {
      if (isText(e.relatedTarget)) return; // hopping Line 1 -> Line 2: stay collapsed, no jump
      cur = null; pv.classList.remove('is-typing'); delete pv.dataset.side;
    });
  }
  function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('is-on'); clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('is-on'), 2200); }

  /* ---------- photo add-on: client-side resize before it ever leaves the browser ----------
     Rejects a photo that's too small to engrave well (shortest side under 600px, measured on the
     *source* image, not after we shrink it), then draws it grayscaled onto a canvas capped at 1600px
     on the long side, and steps JPEG quality down until the data URL is under ~1.5 MB. Returns a data
     URL, or throws with a message meant to be shown to the customer directly. */
  function loadImageFile(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Could not read that photo. Try a JPG or PNG.'));
      img.src = url;
    });
  }
  async function processPhoto(file) {
    if (!/^image\//.test(file.type)) throw new Error('That file is not a photo. Try a JPG, PNG or HEIC.');
    const img = await loadImageFile(file);
    const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
    URL.revokeObjectURL(img.src);
    if (!w || !h) throw new Error('Could not read that photo. Try a JPG or PNG.');
    if (Math.min(w, h) < 600) throw new Error('That photo is too small to engrave well. Use one at least 600px on the short side.');
    const scale = Math.min(1, 1600 / Math.max(w, h));
    const cw = Math.max(1, Math.round(w * scale)), ch = Math.max(1, Math.round(h * scale));
    const cv = document.createElement('canvas'); cv.width = cw; cv.height = ch;
    const ctx = cv.getContext('2d');
    try { ctx.filter = 'grayscale(1)'; } catch {} // engraving is grayscale; this is a preview of that, not a requirement
    ctx.drawImage(img, 0, 0, cw, ch);
    let q = 0.85, dataUrl = cv.toDataURL('image/jpeg', q);
    while (dataUrl.length * 0.75 > 1.5 * 1024 * 1024 && q > 0.45) { q -= 0.1; dataUrl = cv.toDataURL('image/jpeg', q); }
    return dataUrl;
  }

  /* ---------- hero cycling tag ---------- */
  function startHero() {
    const el = $('#heroTag'); if (!el) return;
    const combos = [['bone', 'red'], ['round', 'brass'], ['military', 'black'], ['heart', 'black'], ['bone', 'stainless'], ['round', 'hotpink'], ['bone', 'royal'], ['military', 'yellow'], ['round', 'black'], ['heart', 'pink']];
    let i = 0;
    const clean = SAYINGS.filter((s) => !s.x);
    // Fallback only: the hero product shot hides itself and unhides #heroTag if the image fails to load.
    const show = () => { if (el.hidden) return; const s = clean[(i * 7) % clean.length]; const [shape, finish] = combos[i % combos.length]; el.innerHTML = tagSVG({ shape, finish, lines: s.l }); i++; };
    heroRefresh = show;
    show();
    new MutationObserver(show).observe(el, { attributes: true, attributeFilter: ['hidden'] });
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) setInterval(show, 3200);
  }

  /* ---------- wire up ---------- */
  function setShape(shape) {
    if (HIDDEN_SHAPES.includes(shape)) shape = 'bone';
    tag.shape = shape;
    if (!finishOk(tag.finish, shape)) { tag.finish = 'black'; toast('That finish is not made in this shape. Switched to black.'); }
    renderOpts(); renderPreview();
  }
  function loadSaying(idx, shape, fin) {
    const s = SAYINGS[idx]; if (!s) return;
    // 18+ sayings never load without the age gate: not from a gallery card, a #build?s= link, or the WHISKY egg.
    if (s.x && !adultOn) { Promise.resolve().then(() => askAdult()).then((ok) => { if (ok) loadSaying(idx, shape, fin); }); return; } // microtask: on a deep link init() has not wired the gate yet
    tag.front = [s.l[0] || '', s.l[1] || '', s.l[2] || '', ''];
    tag.adult = Boolean(s.x); // Lady Jaye C4: 18+ wording is recorded on the order
    tag.photo = false; tag.photoData = null; tag.photoName = ''; // a saying is text on the front; drop any photo in progress
    const pf = $('#photoFile'); if (pf) pf.value = '';
    ['f1', 'f2', 'f3', 'f4'].forEach((id, i) => { $('#' + id).value = tag.front[i]; if (i < 3) setCnt(i + 1, tag.front[i]); });
    if (shape && SHAPES[shape] && !HIDDEN_SHAPES.includes(shape)) tag.shape = shape;
    if (fin && FINISHES[fin] && finishOk(fin, tag.shape) && !isFullcolor(tag.finish)) tag.finish = fin; // a full color tag stays full color
    // A saying that cannot fit the card's default shape (paw and round have small text areas) moves to the first shape it does fit.
    let moved = false;
    if (overflows(tag.front, tag, tag.icon)) {
      const alt = shapesThatFit(tag.front, tag, tag.icon)[0];
      if (alt) { tag.shape = alt; moved = true; if (!finishOk(tag.finish, alt)) tag.finish = Object.keys(FINISHES).find((k) => finishOk(k, alt) && FINISHES[k].kind === FINISHES[tag.finish].kind) || 'black'; { const av = sizesFor(tag.shape, tag.finish); if (!av.includes(tag.size)) tag.size = av[0]; } }
    }
    renderOpts(); renderPreview();
    document.getElementById('build').scrollIntoView({ behavior: 'smooth', block: 'start' });
    toast(moved ? `Loaded on the ${SHAPES[tag.shape].n.toLowerCase()}: it needs more room than the card's shape has.` : 'Loaded on the front. Name and number go on the back.');
  }

  function scrollToField(id) {
    const el = document.getElementById(id) || document.getElementById('build');
    el.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' });
  }
  // Picker overrides from a deep link (?shape=&finish=&font=). Only valid values apply; anything else is ignored.
  function pickersFrom(q, base) {
    const out = { shape: base.shape, finish: base.finish, font: base.font };
    const sh = q.get('shape'); if (sh && SHAPES[sh] && !HIDDEN_SHAPES.includes(sh)) out.shape = sh;
    const fi = q.get('finish');
    if (fi && FINISHES[fi] && finishOk(fi, out.shape)) out.finish = fi;
    else if (!finishOk(out.finish, out.shape)) out.finish = Object.keys(FINISHES).find((k) => finishOk(k, out.shape)) || 'black';
    const fo = q.get('font'); if (fo && FONTS[fo]) out.font = fo;
    return out;
  }
  function applyBuildLink(hash) {
    const m = /^#build\?(.+)$/.exec(hash || ''); if (!m) return false;
    const q = new URLSearchParams(m[1]);
    // t=line1|line2|line3|line4: the front lines, verbatim (breed pages link here). t wins over s.
    const tRaw = q.get('t');
    if (tRaw != null) {
      const parts = tRaw.split('|').map((x) => x.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 24)).slice(0, 4);
      while (parts.length < 4) parts.push('');
      if (parts.some(Boolean)) {
        const pk = pickersFrom(q, tag);
        Object.assign(tag, pk);
        { const av = sizesFor(tag.shape, tag.finish); if (!av.includes(tag.size)) tag.size = av[0]; }
        tag.front = parts; tag.photo = false; tag.photoData = null; tag.photoName = '';
        const pf = $('#photoFile'); if (pf) pf.value = '';
        ['f1', 'f2', 'f3', 'f4'].forEach((id, i) => { $('#' + id).value = tag.front[i]; if (i < 3) setCnt(i + 1, tag.front[i]); });
        renderOpts(); renderPreview();
        document.getElementById('build').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
        toast('Loaded on the front. Name and number go on the back.');
        return true;
      }
    }
    // #build?text=Line1|Line2(|Line3): breed-page cards carry their own lines (they aren't in SAYINGS).
    // Plain text only: control chars and <> are dropped, values go into inputs/esc()'d SVG, never innerHTML.
    const tx = q.get('text');
    if (tx != null) {
      const MAX = 24;
      let lines = tx.split('|').map((l) => l.replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim()).filter(Boolean);
      if (!lines.length) return false;
      if (lines.length > 3 || lines.some((l) => l.length > MAX)) { // re-wrap on word boundaries so nothing gets cut mid-word
        const out = [];
        lines.join(' ').split(' ').forEach((w) => {
          const last = out.length ? out[out.length - 1] : null;
          if (last !== null && (last + ' ' + w).length <= MAX) out[out.length - 1] = last + ' ' + w; else out.push(w);
        });
        lines = out;
      }
      lines = lines.slice(0, 3).map((l) => l.slice(0, MAX));
      tag.front = [lines[0] || '', lines[1] || '', lines[2] || '', ''];
      tag.photo = false; tag.photoData = null; tag.photoName = '';
      const pf = $('#photoFile'); if (pf) pf.value = '';
      ['f1', 'f2', 'f3', 'f4'].forEach((id, i) => { const el = $('#' + id); if (el) el.value = tag.front[i]; if (i < 3) setCnt(i + 1, tag.front[i]); });
      renderOpts(); renderPreview();
      const toBuild = (smooth) => document.getElementById('build').scrollIntoView({ behavior: smooth && !matchMedia('(prefers-reduced-motion: reduce)').matches ? 'smooth' : 'auto', block: 'start' });
      toBuild(document.readyState === 'complete');
      // Arriving from another page: images, fonts and shape templates above still shift the layout; land again once settled.
      if (document.readyState !== 'complete') {
        const again = () => { if (Math.abs(document.getElementById('build').getBoundingClientRect().top) > 80) toBuild(false); };
        addEventListener('load', () => setTimeout(again, 50), { once: true });
        addEventListener('sdt:templates', () => setTimeout(again, 50), { once: true });
      }
      toast('Loaded on the front. Name and number go on the back.');
      return true;
    }
    const sm = /^\d+$/.exec(q.get('s') || '');
    if (sm) {
      const idx = +sm[0];
      if (!SAYINGS[idx]) return false;
      let shape = GALLERY_SHAPE[idx % GALLERY_SHAPE.length];
      let fin = GALLERY_FIN[(idx * 3) % GALLERY_FIN.length];
      if (!finishOk(fin, shape)) fin = Object.keys(FINISHES).find((k) => finishOk(k, shape)) || 'black';
      const pk = pickersFrom(q, { shape, finish: fin, font: tag.font });
      tag.font = pk.font;
      loadSaying(idx, pk.shape, pk.finish);
      return true;
    }
    if (q.get('photo') === '1') {
      if (!finishOk('polished', tag.shape)) tag.shape = 'bone'; // photo is polished-bone only today
      tag.finish = 'polished'; tag.color = 'none'; tag.photo = true;
      renderOpts(); renderPreview();
      scrollToField('photoField');
      toast('Photo tag: polished stainless bone. Add your photo below.');
      return true;
    }
    const mode = q.get('color');
    if (mode === 'line' || mode === 'icon') {
      if (!finishOk('stainless', tag.shape)) tag.shape = 'bone';
      tag.finish = 'stainless'; tag.color = mode;
      const hue = q.get('hue'); if (hue && COLOR_HUES[hue]) tag.colorHue = hue;
      tag.photo = false; tag.photoData = null; tag.photoName = '';
      const pf = $('#photoFile'); if (pf) pf.value = '';
      const ps = $('#photoStatus'); if (ps) { ps.className = 'note'; ps.textContent = ''; }
      renderOpts(); renderPreview();
      scrollToField('colorField');
      toast(`Laser color on stainless: ${COLOR_HUES[tag.colorHue].n.toLowerCase()} ${mode === 'line' ? 'full line' : 'icon or short line'}.`);
      return true;
    }
    if (q.has('shape') || q.has('finish') || q.has('font')) { // pickers only: shape=bone&finish=red&font=bungee
      Object.assign(tag, pickersFrom(q, tag));
      { const av = sizesFor(tag.shape, tag.finish); if (!av.includes(tag.size)) tag.size = av[0]; }
      renderOpts(); renderPreview();
      document.getElementById('build').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
      return true;
    }
    return false;
  }

  // Phone nav (<760px): a menu button that opens a sheet with Sayings, Build, How it works, FAQ.
  function initNavMenu() {
    const btn = $('#navMenu'), sheet = $('#navSheet'); if (!btn || !sheet) return;
    const set = (open) => { sheet.hidden = !open; btn.setAttribute('aria-expanded', String(open)); btn.classList.toggle('is-open', open); };
    btn.addEventListener('click', () => { const open = sheet.hidden; set(open); if (open) { const a = $('a', sheet); if (a) a.focus(); } });
    sheet.addEventListener('click', (e) => { if (e.target.closest('a')) set(false); });
    document.addEventListener('click', (e) => { if (!sheet.hidden && !e.target.closest('#navSheet') && !e.target.closest('#navMenu')) set(false); });
    addEventListener('keydown', (e) => { if (e.key === 'Escape' && !sheet.hidden) { set(false); btn.focus(); } });
    matchMedia('(min-width:761px)').addEventListener('change', (m) => { if (m.matches) set(false); });
  }

  function init() {
    // /roast/ landing page (v65) has the roast and the age gate but no builder, gallery or checkout: run the lite path.
    const lite = !document.getElementById('build');
    $$('[data-say-count]').forEach((el) => { el.textContent = CLEAN_COUNT; }); // static HTML carries the same number for crawlers; this keeps it honest if sayings are added
    initNavMenu();
    $$('[data-ship-from]').forEach((el) => { el.textContent = SHIP_FROM; });
    $$('[data-ornament-hero]').forEach((el) => { el.textContent = ornamentHero(); });
    const promo = $('#ornPromoArt'); // home-page ornament card: a live preview, not a photo
    if (promo) promo.innerHTML = tagSVGFullcolor({ shape: 'round', ornament: true, lines: ['Whisky', '2026'], font: 'bungee', art: 'design', style: 'synthwave', raised: true });
    if (!lite) { renderOpts(); renderFilters('all'); renderSayings('all'); renderPreview(); renderCart(); startHero(); takeRoastHandoff(); if (cartDropped) toast('A saved tag was removed: that shape is not available right now.'); }
    // Deep links into the builder (from /sayings/, the photo & color section, or anywhere):
    //   #build?s=<index>               pre-fills that saying with the gallery card's default shape/finish
    //   #build?photo=1                 polished stainless bone + photo add-on on (upload field opens)
    //   #build?color=line|icon&hue=<h> stainless + laser color (hue: blue, gold, purple, bronze)
    applyBuildLink(location.hash);
    addEventListener('hashchange', () => applyBuildLink(location.hash));
    // In-page links: the hash may already be the same (no hashchange), so handle the click directly.
    document.addEventListener('click', (e) => {
      const a = e.target.closest('a[href^="#build?"]'); if (!a) return;
      if (applyBuildLink(a.getAttribute('href'))) { e.preventDefault(); history.replaceState(null, '', a.getAttribute('href')); }
    });
    const tk = $('#ticker'); // the ticker strip was retired in v48; kept guarded in case it comes back
    if (tk) tk.innerHTML = (SAYINGS.filter((s) => !s.x).slice(0, 16).map((s) => `<span>${esc(s.l.join(' '))}</span>`).join('')).repeat(2);
    // Section fade-ins. Skipped entirely for reduced motion or old browsers, so content is never hidden.
    if ('IntersectionObserver' in window && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      const io = new IntersectionObserver((es) => es.forEach((en) => { if (en.isIntersecting) { en.target.classList.add('is-in'); io.unobserve(en.target); } }), { rootMargin: '0px 0px -8% 0px' });
      $$('[data-reveal]').forEach((el) => { el.classList.add('rv'); io.observe(el); });
    }

    const adultGate = $('#adultGate');
    let pendingCat = 'adult';
    function unlockAdult(cat) {
      adultOn = true; try { localStorage.setItem('sdt-adult', '1'); } catch {}
      toast('Salty mode on. The dogs are not responsible.');
      if (!lite) { renderFilters(cat); renderSayings(cat); }
    }
    if (!lite) $('#filters').addEventListener('click', (e) => {
      const b = e.target.closest('[data-cat]'); if (!b) return;
      if (b.dataset.cat === 'adult' && !adultOn) {
        pendingCat = b.dataset.cat;
        if (adultGate && adultGate.showModal) adultGate.showModal();
        else unlockAdult(b.dataset.cat);
        return;
      }
      renderFilters(b.dataset.cat); renderSayings(b.dataset.cat);
    });
    // askAdult(): resolves true when the visitor is (or just became) confirmed 18+, false on "No thanks"/Esc.
    // Used by the roast section's Salty 18+ pill so it shares this exact gate and the same sdt-adult flag.
    let askDone = null;
    askAdult = () => new Promise((resolve) => {
      if (adultOn) { resolve(true); return; }
      if (askDone) askDone(false);
      askDone = resolve;
      pendingCat = ($('.chip[aria-pressed="true"]') || {}).dataset?.cat || 'all'; // keep the gallery where it is
      if (adultGate && adultGate.showModal) adultGate.showModal();
      else { askDone = null; unlockAdult(pendingCat); resolve(true); }
    });
    if (adultGate) {
      $('#adultYes').addEventListener('click', () => { const d = askDone; askDone = null; adultGate.close(); unlockAdult(pendingCat); if (d) d(true); });
      $('#adultNo').addEventListener('click', () => adultGate.close());
      adultGate.addEventListener('close', () => { if (askDone) { const d = askDone; askDone = null; d(false); } }); // No thanks or Esc
    }
    if (lite) { // /roast/: only the sticky nav; everything below needs the builder/gallery/checkout
      const nav = $('#nav'); if (nav) { const s = () => nav.classList.toggle('is-stuck', scrollY > 8); addEventListener('scroll', s, { passive: true }); s(); }
      return;
    }
    $('#sayingGrid').addEventListener('click', (e) => {
      if (e.target.closest('[data-more]')) { renderSayings._shown = (renderSayings._shown || 8) + 8; renderSayings(renderSayings._cat || 'all'); return; }
 const b = e.target.closest('[data-i]'); if (b) loadSaying(+b.dataset.i, b.dataset.shape, b.dataset.fin); });

    const form = $('#tagForm');
    form.addEventListener('change', (e) => {
      if (e.target.name === 'shape') { setShape(e.target.value); return; }
      if (e.target.name === 'finish') { const had = document.activeElement === e.target; tag.finish = e.target.value; { const av = sizesFor(tag.shape, tag.finish); if (!av.includes(tag.size)) tag.size = av[0]; } renderOpts(); const r = had && $('#finishOpts input[value="' + tag.finish + '"]'); if (r) r.focus(); }
      if (e.target.name === 'size') tag.size = e.target.value;
      if (e.target.name === 'font') tag.font = e.target.value;
      if (e.target.name === 'icon') tag.icon = e.target.value;
      if (e.target.name === 'color') { tag.color = e.target.value; renderOpts(); }
      if (e.target.name === 'colorHue') tag.colorHue = e.target.value;
      if (e.target.name === 'artMode') {
        tag.art = e.target.value;
        // Finished artwork starts with no lettering: the untouched sample saying must not print over a customer's image.
        if (tag.art === 'upload' && tag.front.every((l, i) => l === ['Built like', 'a loaf.', '', ''][i])) {
          tag.front = ['', '', '', ''];
          ['f1', 'f2', 'f3', 'f4'].forEach((id, i) => { const el = $('#' + id); if (el) el.value = ''; if (i < 3) setCnt(i + 1, ''); });
        }
        renderArt();
      }
      if (e.target.id === 'photoAck') { tag.artAck = e.target.checked; clearFieldErr(e.target); }
      if (e.target.name === 'artStyle') { tag.style = e.target.value; renderArt(); }
      if (e.target.id === 'raisedOn') tag.raised = e.target.checked;
      if (e.target.id === 'safeOn') tag.showSafe = e.target.checked;
      if (e.target.id === 'artAck') { tag.artAck = e.target.checked; clearFieldErr(e.target); }
      if (e.target.id === 'photoOn') {
        tag.photo = e.target.checked;
        if (tag.photo && tag.finish !== 'polished') {
          if (finishOk('polished', tag.shape)) { tag.finish = 'polished'; toast('Photo needs mirror-polished stainless. Switched finish to polished.'); }
          else { tag.photo = false; }
        }
        renderOpts();
      }
      renderPreview();
    });
    $('#photoFile').addEventListener('change', async (e) => {
      const file = e.target.files && e.target.files[0];
      const status = $('#photoStatus');
      if (!file) return;
      status.className = 'note'; status.textContent = 'Reading photo…';
      try {
        tag.photoData = await processPhoto(file);
        tag.photoName = file.name; clearFieldErr(e.target);
        status.textContent = `Loaded ${file.name}. We'll email a proof before we engrave.`;
        renderPreview();
      } catch (err) {
        tag.photoData = null;
        status.className = 'note note--err';
        status.textContent = err.message || 'Could not use that photo.';
        e.target.value = '';
        renderPreview();
      }
      renderPhotoThumb();
    });
    renderPhotoThumb();
    $('#artFile').addEventListener('change', async (e) => {
      const file = e.target.files && e.target.files[0];
      const status = $('#artStatus');
      if (!file) return;
      status.className = 'note'; status.textContent = 'Reading image…';
      try {
        const r = await processArt(file);
        Object.assign(tag, { artData: r.dataUrl, artName: file.name, artW: r.w, artH: r.h, artSvg: r.svg });
        clearFieldErr(e.target);
        status.textContent = `Loaded ${file.name}.` + (r.warn ? ' ' + r.warn : '');
        if (r.warn) status.classList.add('note--warn');
      } catch (err) {
        Object.assign(tag, { artData: null, artName: '', artW: 0, artH: 0, artSvg: false });
        status.className = 'note note--err';
        status.textContent = err.message || 'Could not use that image.';
        e.target.value = '';
      }
      renderArt(); renderPreview();
    });
    $('#artAckTxt').innerHTML = ackHtml(ART_ACK_TEXT);
    const pa = $('#photoAckTxt'); if (pa) pa.innerHTML = ackHtml(ART_ACK_TEXT);
    $$('[data-review-note]').forEach((el) => { el.textContent = ART_REVIEW_NOTE; });
    const finBox = $('#finishOpts');
    // Re-render rebuilds the strip, so hand focus back only if it was already in there (keyboard, or a click that focused).
    const showFinTab = (t) => { const had = finBox.contains(document.activeElement); finTab = t; renderOpts(); const b = had && $('#fintab-' + t); if (b) b.focus(); };
    finBox.addEventListener('click', (e) => { const b = e.target.closest('[data-fintab]'); if (b && b.dataset.fintab !== finTab) showFinTab(b.dataset.fintab); });
    finBox.addEventListener('keydown', (e) => {
      const b = e.target.closest('[data-fintab]'); if (!b) return;
      const all = $$('[data-fintab]', finBox).map((x) => x.dataset.fintab); const i = all.indexOf(b.dataset.fintab);
      const j = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: all.length - 1 }[e.key]; if (j === undefined) return;
      e.preventDefault(); showFinTab(all[(j + all.length) % all.length]);
    });
    form.addEventListener('input', (e) => {
      const m = /^(front|back)([1234])$/.exec(e.target.name); if (!m) return;
      tag[m[1]][+m[2] - 1] = e.target.value;
      if (m[1] === 'front' && +m[2] <= 3) setCnt(+m[2], e.target.value);
      if (m[1] === 'back') setBCnt(+m[2], e.target.value);
      renderPreview();
    });
    ['f1', 'f2', 'f3', 'f4'].forEach((id, i) => { $('#' + id).value = tag.front[i]; if (i < 3) setCnt(i + 1, tag.front[i]); });
    ['b1', 'b2', 'b3'].forEach((id, i) => { $('#' + id).value = tag.back[i]; setBCnt(i + 1, tag.back[i] || ''); });
    const smartOn = $('#smartOn'); if (smartOn) smartOn.addEventListener('change', () => { tag.smart = smartOn.checked && smartCheck().ok; renderPreview(); });
    $$('.count button').forEach((b) => b.addEventListener('click', () => { tag.qty = Math.min(20, Math.max(1, tag.qty + +b.dataset.d)); $('#tagQty').value = tag.qty; renderQtySave(); }));
    wirePreviewCollapse(form);

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      // Inline errors under each field (text + aria-invalid), first bad field gets focus, toast is the secondary cue.
      ['f1', 'b1', 'b2', 'photoFile', 'photoAck', 'artFile', 'artAck'].forEach((id) => { const el = document.getElementById(id); if (el) clearFieldErr(el); });
      const bad = []; // [elementId, message]
      const fcNow = isFullcolor(tag.finish), needsImg = fcNow && artNeedsImage(tag);
      if (tag.photo) {
        if (!tag.photoData) bad.push(['photoFile', 'Upload a photo, or turn the photo add-on off.']);
        else if (!tag.artAck) bad.push(['photoAck', 'Tick the box to confirm the photo rules.']);
      } else {
        // Full color + "Upload your own": the saying is optional (finished artwork may carry its own words).
        if (!tag.front.some(Boolean)) { if (!(fcNow && tag.art === 'upload')) bad.push(['f1', 'Pick a saying for the front, or write your own.']); }
        else if (fit.front) bad.push(['f1', 'Too long for this shape. Shorten a line or pick another shape.']);
      }
      if (needsImg) {
        if (!tag.artData) bad.push(['artFile', tag.art === 'upload' ? 'Upload a photo or finished artwork.' : 'This style uses your dog photo. Upload one, or pick another style.']);
        else if (!tag.artAck) bad.push(['artAck', 'Tick the box to confirm you own the image or have permission to use it.']);
      }
      if (!String(tag.back[0] || '').trim()) bad.push(['b1', 'Add the dog’s name.']);
      else if (fit.back) bad.push(['b1', 'Too long for this shape. Shorten the name or number.']);
      const pe = phoneIssue(tag.back[1]); if (pe) bad.push(['b2', pe]);
      if (bad.length) {
        bad.forEach(([id, msg]) => { const el = document.getElementById(id); if (el) setFieldErr(el, msg); });
        const first = document.getElementById(bad[0][0]); if (first) first.focus();
        toast(bad[0][1]);
        return;
      }
      const line = {
        kind: 'tag', shape: tag.shape, size: tag.size, finish: tag.finish, font: tag.font, icon: tag.icon, qty: tag.qty,
        front: [...tag.front], back: [...tag.back],
        color: tag.color, colorHue: tag.colorHue, photo: tag.photo, photoData: tag.photo ? tag.photoData : null, photoName: tag.photo ? tag.photoName : '',
        unitBase: tagUnitBase(tag), unitAddon: tagAddon(tag), unit: tagUnit(tag), smart: Boolean(tag.smart && smartCheck().ok),
      };
      line.adult = tag.adult || SAYINGS.some((x) => x.x && x.l.join(' ').toLowerCase() === tag.front.filter(Boolean).join(' ').toLowerCase());
      if (tag.photo) line.ack = tag.artAck;
      if (fcNow) { // Full color: the image (if the chosen path uses one) rides in photoData; icon never applies
        Object.assign(line, { icon: 'none', art: tag.art, style: tag.art === 'design' ? tag.style : undefined, raised: tag.raised, photo: needsImg, photoData: needsImg ? tag.artData : null, photoName: needsImg ? tag.artName : '', ack: needsImg ? tag.artAck : false });
      }
      const same = cart.find((i) => lineKey(i) === lineKey(line));
      if (same) same.qty = Math.min(20, same.qty + line.qty); else cart.push(line);
      const saved = saveCart(); renderCart();
      toast(!saved ? 'Added. Photo too big to save on this device: finish checkout in this tab.' : same ? `Added. That design is now ${same.qty}× on the receipt.` : 'Added. Build another or scroll to send.');
      document.getElementById('order').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    const of = $('#orderForm');
    const payPanel = $('#payPanel');
    const FRIENDLY = 'Couldn’t send your order. Nothing was charged. Try again or email hello@saltydogtags.com.';
    const readJson = async (r) => { try { return await r.json(); } catch { return null; } }; // a 502 HTML page is not JSON
    const ERR_FIELDS = ['name', 'email', 'street', 'city', 'state', 'zip', 'prize'];
    const fieldOf = (id) => { const el = $('#' + id); return el && el.closest('.field'); };
    function setOrderErr(id, text) {
      const el = $('#' + id), f = fieldOf(id); if (!el || !f) return null;
      f.classList.add('is-err'); el.setAttribute('aria-invalid', 'true');
      const er = f.querySelector('.err'); if (er && text) er.textContent = text;
      if (id === 'prize') { const d = el.closest('details'); if (d) d.open = true; }
      return el;
    }
    function clearOrderErr(id) { const el = $('#' + id), f = fieldOf(id); if (f) f.classList.remove('is-err'); if (el) el.removeAttribute('aria-invalid'); }
    // Server errors carry `field` (functions/api/order.js); older deployments only send text, so guess from it.
    const serverField = (d) => d.field === 'address' ? 'street' : ERR_FIELDS.includes(d.field) ? d.field
      : /upgrade code|free upgrade/i.test(d.error) ? 'prize' : /email/i.test(d.error) ? 'email' : /address/i.test(d.error) ? 'street' : /name/i.test(d.error) ? 'name' : null;
    const isPickup = () => (($('input[name=delivery]:checked') || {}).value || 'ship') === 'pickup';
    // Same order twice (back from Clover, hit pay again) must not create a second order: fingerprint it.
    function orderSig(p) {
      const str = JSON.stringify(p, (k, v) => (k === 'photoImage' && v ? v.length + ':' + v.slice(-64) : k === 'website' ? undefined : v));
      let h = 5381; for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
      return (h >>> 0).toString(36);
    }
    const cartSummary = () => cart.map((i) => (i.kind === 'ornament'
      ? { qty: i.qty, name: `Holiday ornament · ${i.tier === 'stainless' ? 'engraved stainless' : 'printed acrylic'}`, line: `${i.oname}, ${i.year}` }
      : { qty: i.qty, name: i.kind === 'tag' ? `${SHAPES[i.shape].n} tag · ${FINISHES[i.finish].n.replace(/ \+\$\d+$/, '')}` : i.name, line: i.kind === 'tag' ? (isFullcolor(i.finish) ? i.front.filter(Boolean).join(' / ') : i.photo ? 'Photo on front' : i.front.filter(Boolean).join(' / ')) : '' }));
    function hidePay() { payPanel.className = 'paypanel msg'; payPanel.innerHTML = ''; const b = $('#payBanner'); if (b) b.remove(); }
    function showPay(kind, last) {
      const id = esc(last.id), tot = last.total ? ` (${money(last.total)} plus any tax)` : '';
      payPanel.className = 'paypanel msg msg--bad is-on';
      payPanel.innerHTML = (kind === 'failed'
        ? `<strong>Payment didn’t go through.</strong> Order <code>${id}</code> is saved, nothing was charged${tot}.`
        : `<strong>Finish paying for <code>${id}</code>.</strong> Your order is saved and nothing has been charged yet${tot}.`)
        + `<div class="paypanel__acts"><button type="button" class="btn btn--coral" data-retry>Try paying again</button><button type="button" class="btn btn--ghost" data-paylater>Not now</button></div><p class="paypanel__err" role="alert"></p>`;
    }
    function payBanner(last) {
      const nav = $('#nav'); if (!nav || $('#payBanner')) return;
      const b = document.createElement('div'); b.className = 'paybanner'; b.id = 'payBanner'; b.setAttribute('role', 'region'); b.setAttribute('aria-label', 'Unpaid order');
      b.innerHTML = `<span>Finish paying for <b>${esc(last.id)}</b>. Nothing charged yet.</span><button type="button" class="btn btn--coral" data-retry>Finish paying</button><button type="button" class="paybanner__x" data-paylater aria-label="Dismiss">&times;</button>`;
      nav.insertAdjacentElement('afterend', b);
    }
    // POST /api/pay {id, email} -> fresh 15-minute Clover link for the saved order (functions/api/pay.js).
    async function retryPay(btn) {
      const last = readLast(); if (!last || !last.id) return;
      const errEl = $('.paypanel__err', payPanel);
      const fail = (t) => { if (errEl && payPanel.classList.contains('is-on')) errEl.textContent = t; else toast(t); };
      if (btn) { btn.disabled = true; btn.textContent = 'Opening Clover…'; }
      try {
        const r = await fetch('/api/pay', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: last.id, email: last.email }) });
        const d = await readJson(r);
        if (r.ok && d && d.payUrl) { location.href = d.payUrl; return; }
        if (r.status === 409 && d && /already paid/i.test(d.error || '')) { // the webhook beat us to it
          writeLast({ ...last, paid: true }); cart = []; saveCart(); renderCart(); hidePay();
          payPanel.className = 'paypanel msg msg--ok is-on'; payPanel.innerHTML = `<strong>Order <code>${esc(last.id)}</code> is already paid.</strong> Thank you. We're making it now.`;
          return;
        }
        if (r.status === 404) writeLast({ ...last, mode: 'gone' }); // not ours any more: stop offering it
        fail((d && d.error) || 'Couldn’t reach checkout. Nothing was charged. Try again or email hello@saltydogtags.com.');
      } catch { fail('Couldn’t reach checkout. Nothing was charged. Try again or email hello@saltydogtags.com.'); }
      if (btn) { btn.disabled = false; btn.textContent = 'Try paying again'; }
    }
    document.addEventListener('click', (e) => {
      const r = e.target.closest('[data-retry]'); if (r) { retryPay(r); return; }
      if (e.target.closest('[data-paylater]')) { hidePay(); try { sessionStorage.setItem('sdt-paylater', (readLast() || {}).id || '1'); } catch {} }
    });

    $('#cart').addEventListener('click', (e) => { const b = e.target.closest('[data-rm]'); if (!b) return; cart.splice(+b.dataset.rm, 1); saveCart(); renderCart(); });

    // Delivery: shipping only until PICKUP_ENABLED. The pickup choice is built here, never present in the static HTML.
    const shipNote = $('#shipNote');
    if (PICKUP_ENABLED) {
      const fixed = $('#deliveryFixed');
      if (fixed) fixed.outerHTML = '<div class="opts opts--stack" role="radiogroup" aria-labelledby="deliveryLbl"><label class="opt"><input type="radio" name="delivery" value="ship" checked><span><b>Ship it</b><i class="dim">$4.50, free over $35</i></span></label><label class="opt"><input type="radio" name="delivery" value="pickup"><span><b>Pick up at the Thirsty Beaches trailer</b><i class="dim">Free</i></span></label></div>';
      if (shipNote) shipNote.hidden = true;
    }
    of.addEventListener('input', (e) => {
      if (e.target.name === 'prize') renderCart();
      if (ERR_FIELDS.includes(e.target.id)) clearOrderErr(e.target.id);
    });
    of.addEventListener('change', (e) => {
      if (e.target.id === 'state') { clearOrderErr('state'); renderCart(); }
      if (e.target.name === 'delivery') {
        const pickup = e.target.value === 'pickup';
        $('#addrField').hidden = pickup;
        if (pickup) ['street', 'city', 'state', 'zip'].forEach(clearOrderErr);
        renderCart();
      }
      if (e.target.name === 'state') { clearOrderErr('state'); renderCart(); }
    });
    of.addEventListener('submit', async (e) => {
      e.preventDefault();
      const msg = $('#orderMsg'); msg.className = 'msg'; msg.setAttribute('role', 'status');
      if (!cart.length) { toast('Your order is empty.'); return; }
      const fd = new FormData(of);
      const v = (k) => String(fd.get(k) || '').trim();
      ERR_FIELDS.forEach(clearOrderErr);
      const bad = [];
      if (!v('name')) bad.push(['name']);
      if (!EMAIL_RE.test(v('email'))) bad.push(['email']);
      const pickup = PICKUP_ENABLED && fd.get('delivery') === 'pickup';
      const address = pickup ? '' : `${v('street')}${v('addr2') ? ', ' + v('addr2') : ''}, ${v('city')}, ${v('state')} ${v('zip')}`;
      if (!pickup) {
        if (v('street').length < 3 || address.length < ADDR_MIN) bad.push(['street']);
        if (!v('city')) bad.push(['city']);
        if (!v('state')) bad.push(['state']);
        if (!ZIP_RE.test(v('zip'))) bad.push(['zip']);
      }
      if (v('prize') && !PRIZE_RE.test(v('prize'))) bad.push(['prize', 'Codes look like SDT-UP-XXXX. Leave it empty if you don’t have one.']);
      if (bad.length) {
        bad.forEach(([id, t]) => setOrderErr(id, t));
        msg.setAttribute('role', 'alert'); msg.className = 'msg msg--bad is-on'; msg.textContent = 'Please fix the highlighted fields.';
        const first = $('#' + bad[0][0]); if (first) first.focus();
        return;
      }
      const payload = {
        name: v('name'), email: v('email'), phone: v('phone'), delivery: pickup ? 'pickup' : 'ship',
        street: pickup ? undefined : v('street'), addr2: pickup ? undefined : v('addr2'), city: pickup ? undefined : v('city'), state: pickup ? undefined : v('state'), zip: pickup ? undefined : v('zip'),
        address, note: fd.get('note'), website: fd.get('website'), prize: v('prize').toUpperCase(),
        tags: cart.filter((i) => i.kind === 'tag').map((i) => ({
          shape: i.shape, size: i.size, finish: i.finish, font: i.font || 'block', icon: i.icon || 'none', qty: i.qty,
          front1: i.front[0], front2: i.front[1], front3: i.front[2], front4: i.front[3], back1: i.back[0], back2: i.back[1], back3: i.back[2],
          color: i.color || 'none', colorHue: i.colorHue || 'blue', photo: Boolean(i.photo), photoImage: i.photo ? i.photoData : undefined,
          ack: Boolean(i.ack), adult: Boolean(i.adult), ...(i.smart ? { smart: true } : {}),
          // Full color only. The server decides every price and re-checks the rights tick; these are the choices, not amounts.
          ...(isFullcolor(i.finish) ? { art: i.art, style: i.art === 'design' ? i.style : undefined, raised: Boolean(i.raised) } : {}),
        })),
        ornaments: cart.filter((i) => i.kind === 'ornament').map((i) => ({
          tier: i.tier, name: i.oname, year: i.year, qty: i.qty, art: i.art, style: i.art === 'design' ? i.style : undefined,
          raised: Boolean(i.raised), ack: Boolean(i.ack), photoImage: i.photoData || undefined,
        })),
        prints: [],
      };
      const sig = orderSig(payload);
      const btn = $('#sendBtn');
      const pend = pendingLast();
      if (pend && pend.sig === sig) { // already saved as pend.id: just get a fresh payment link
        btn.disabled = true; btn.textContent = 'Opening Clover…';
        showPay('pending', pend); await retryPay(null);
        btn.disabled = false; renderCart(); return;
      }
      const taxed = taxedNow();
      btn.disabled = true; btn.textContent = 'Sending…';
      try {
        let r, d;
        try { r = await fetch('/api/order', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) }); }
        catch { throw new Error(FRIENDLY); }
        d = await readJson(r);
        if (!r.ok || !d || !d.ok) {
          const f = d && d.error ? serverField(d) : null;
          if (f) { setOrderErr(f, d.error); const el = $('#' + f); if (el) el.focus(); }
          throw new Error(d && d.error ? d.error : FRIENDLY);
        }
        const total = d.totals && typeof d.totals.total === 'number' ? d.totals.total : totals(fd.get('delivery')).total;
        writeLast({ id: d.id, email: payload.email.toLowerCase(), at: Date.now(), mode: d.payUrl ? 'card' : 'invoice', sig, items: cartSummary(), total, dog: ((cart.find((i) => i.kind === 'tag') || {}).back || [])[0] || '', paid: false });
        try { sessionStorage.removeItem('sdt-paylater'); } catch {}
        hidePay();
        if (d.payUrl) {
          // Keep the cart until thanks.html confirms payment: a cancel or Back from Clover finds it intact.
          msg.className = 'msg msg--ok is-on';
          msg.innerHTML = `<strong>Order <code>${esc(d.id)}</code> saved.</strong> Sending you to Clover's secure page to pay ${money(total)}${taxed ? ' plus tax' : ''}…<br><a class="btn btn--coral" style="margin-top:.6rem" href="${esc(d.payUrl)}">Pay now</a>`;
          msg.scrollIntoView({ behavior: 'smooth', block: 'center' });
          setTimeout(() => { location.href = d.payUrl; }, 1200);
        } else {
          cart = []; saveCart(); of.reset(); $('#addrField').hidden = false; renderCart();
          msg.className = 'msg'; msg.textContent = '';
          payPanel.className = 'paypanel msg msg--ok is-on';
          payPanel.innerHTML = `<strong>Got it.</strong> Order <code>${esc(d.id)}</code> &middot; ${money(total)}${taxed ? ' before tax' : ''}.<br>Watch ${esc(payload.email)} for a Clover invoice within a day. We start making it when it’s paid.`;
          payPanel.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      } catch (err) {
        msg.setAttribute('role', 'alert'); msg.className = 'msg msg--bad is-on'; msg.textContent = err.message || FRIENDLY;
      } finally { btn.disabled = false; renderCart(); if (!cart.length) btn.textContent = sendLabel(0); }
    });

    // easter eggs: type WHISKY anywhere -> the first tag; the Konami code -> unlocks Salty 18+
    let typed = '';
    addEventListener('keydown', (e) => {
      if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
      typed = (typed + (e.key.length === 1 ? e.key.toUpperCase() : e.key)).slice(-100); // the Konami string alone is 71 characters
      if (typed.endsWith('WHISKY')) { typed = ''; loadSaying(SAYINGS.findIndex((x) => x.l[0] === 'Yes, I lick my own junk.'), 'bone', 'polished'); if (adultOn) toast('Whisky. The original.'); } // loadSaying runs the 18+ gate first
      if (typed.endsWith('ArrowUpArrowUpArrowDownArrowDownArrowLeftArrowRightArrowLeftArrowRightba') || typed.endsWith('ArrowUpArrowUpArrowDownArrowDownArrowLeftArrowRightArrowLeftArrowRightBA')) { typed = ''; askAdult().then((ok) => { if (!ok) return; renderFilters('adult'); renderSayings('adult'); document.getElementById('sayings').scrollIntoView(); toast('Konami. Salty mode unlocked.'); }); } // same 18+ confirm as the Salty chip
    });
    // tap the bulldog logo 7 times: the whole pack barks
    let taps = 0; $('.nav__mark').addEventListener('click', (e) => { taps++; if (taps >= 7) { e.preventDefault(); taps = 0; toast('WOOF WOOF WOOF WOOF WOOF WOOF WOOF. (All seven.)'); } });
    const nav = $('#nav'); const orderSec = $('#order');
    // The phone buy bar is redundant once the checkout itself is on screen.
    const onScroll = () => {
      nav.classList.toggle('is-stuck', scrollY > 8);
      const r = orderSec.getBoundingClientRect();
      document.body.classList.toggle('in-order', r.top < innerHeight * 0.7 && r.bottom > 0);
    };
    addEventListener('scroll', onScroll, { passive: true }); onScroll();

    // Card checkout on? Swap the invoice copy for payment copy.
    // The static copy tells the invoice story (nothing charged now, invoice by email). Only when /api/config reports
    // checkout live (CHECKOUT_LIVE=true plus the Clover secrets) does it switch to the pay-now wording.
    fetch('/api/config').then((r) => r.json()).then((c) => {
      window.PAY_ON = Boolean(c && c.pay === true);
      SMART.on = Boolean(c && c.smart && typeof SDTQR !== 'undefined');
      if (SMART.on) { SMART.price = (Number(c.smart.price) || 0) / 100; SDTQR.configure({ finishes: c.smart.finishes, base: c.smart.base }); smartCache.clear(); }
      else { cart.forEach((i) => { delete i.smart; }); tag.smart = false; }   // rolled back: a saved cart line must not ask for a QR we no longer sell
      try { renderPreview(); } catch {}
      const key = c && c.pay === true ? 'pay' : 'invoice';
      $$('[data-' + key + ']').forEach((el) => { el.textContent = el.dataset[key]; });
      renderCart(); // the send button carries the total
    }).catch(() => {});

    // Unpaid card order from the last 24h. Clover's cancel/failure redirect lands on /?pay=failed#order;
    // Back from Clover lands here with no flag (often from the back/forward cache). Either way: offer a
    // fresh link for the SAME saved order at the top of the checkout, and a banner if the page opened fresh.
    // html has scroll-behavior:smooth, and lazy images/fonts above shift the layout: jump instantly, then
    // re-anchor once things settle so the message really ends up at the top of the screen.
    const jumpTo = (el) => {
      const go = () => { if (Math.abs(el.getBoundingClientRect().top - (nav ? nav.offsetHeight : 60) - 16) > 24) el.scrollIntoView({ block: 'start', behavior: 'instant' }); };
      go(); el.focus({ preventScroll: true });
      setTimeout(go, 300); addEventListener('load', () => setTimeout(go, 50), { once: true });
    };
    const recover = (restored) => {
      const failed = new URLSearchParams(location.search).get('pay') === 'failed';
      const last = pendingLast();
      const btn = $('#sendBtn'); if (btn) btn.disabled = false;
      const msg = $('#orderMsg'); if (restored && msg) { msg.className = 'msg'; msg.textContent = ''; }
      renderCart();
      if (failed) {
        history.replaceState(null, '', '/#order');
        if (last) showPay('failed', last);
        else { payPanel.className = 'paypanel msg msg--bad is-on'; payPanel.innerHTML = '<strong>Payment didn’t go through.</strong> Nothing was charged. Your order is saved; we’ll email you an invoice instead.'; }
        jumpTo(payPanel);
        return;
      }
      let later = null; try { later = sessionStorage.getItem('sdt-paylater'); } catch {}
      if (!last || later === last.id) return;
      showPay('pending', last);
      if (restored) jumpTo(payPanel);
      else payBanner(last);
    };
    recover(false);
    addEventListener('pageshow', (e) => { if (e.persisted) recover(true); });
  }
  /* ---------- hooks for roast.js ("Roast my dog") ----------
     Read-only render helpers plus one entry point that drops a roast saying into the builder. */
  // 555-0100..0199 is the fictional range (our placeholder is 435-555-0123): never engrave it.
  function fakePhone(v) { let d = String(v || '').replace(/\D/g, ''); if (d.length === 11 && d[0] === '1') d = d.slice(1); return /^(\d{3})?55501\d\d$/.test(d); }
  // Inline prompt under the Phone field (stays until they type in it), focus without the browser's own jump.
  function askPhone(msg) {
    const b2 = $('#b2'); if (!b2) return;
    const f = b2.closest('.field'); let p = $('#b2Ask');
    if (!p) { p = document.createElement('p'); p.id = 'b2Ask'; p.className = 'field__ask'; p.setAttribute('role', 'status'); f.appendChild(p); b2.setAttribute('aria-describedby', 'b2Ask'); b2.addEventListener('input', () => { f.classList.remove('is-ask'); p.textContent = ''; }); }
    p.textContent = msg; f.classList.add('is-ask');
    try { b2.focus({ preventScroll: true }); } catch { b2.focus(); }
    b2.scrollIntoView({ block: 'center', behavior: 'auto' });
  }
  // Land on the back of the tag: preview + phone field in view, phone focused. On a fresh page load (the /roast/ handoff)
  // fonts, images and the shape templates are still moving things around, so wait for them, then re-check once.
  function landOnPhone(settle) {
    const go = () => { if (!tag.back[1]) askPhone('Add your phone number so whoever finds the dog can call you.'); else { const pv = $('#preview'); if (pv) pv.scrollIntoView({ block: 'start' }); } };
    if (!settle) { requestAnimationFrame(go); return; }
    const loaded = document.readyState === 'complete' ? Promise.resolve() : new Promise((r) => addEventListener('load', r, { once: true }));
    const fonts = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
    Promise.race([Promise.all([loaded, fonts]), new Promise((r) => setTimeout(r, 2500))]).then(() => requestAnimationFrame(() => requestAnimationFrame(() => {
      go();
      const b2 = $('#b2'), y0 = b2 ? b2.getBoundingClientRect().top : 0;
      setTimeout(() => { if (b2 && Math.abs(b2.getBoundingClientRect().top - y0) > 8 && document.activeElement === b2) b2.scrollIntoView({ block: 'center', behavior: 'auto' }); }, 450);
    })));
  }
  /* ---------- hooks for roast.js ("Roast my dog") ----------
     Read-only render helpers plus one entry point that drops a roast saying into the builder. */
  function loadRoast(lines, shape, fin, name, handoff) {
    // /roast/ has no builder (v65): hand the roast to the homepage builder via sessionStorage, picked up in init().
    if (!document.getElementById('build')) {
      try { sessionStorage.setItem('sdt-roast-handoff', JSON.stringify({ lines, shape, fin, name })); } catch {}
      location.href = '/#build'; return;
    }
    tag.front = [lines[0] || '', lines[1] || '', lines[2] || '', ''].map((l) => String(l).slice(0, 24));
    tag.photo = false; tag.photoData = null; tag.photoName = '';
    const pf = $('#photoFile'); if (pf) pf.value = '';
    ['f1', 'f2', 'f3', 'f4'].forEach((id, i) => { $('#' + id).value = tag.front[i]; if (i < 3) setCnt(i + 1, tag.front[i]); });
    if (shape && SHAPES[shape] && !HIDDEN_SHAPES.includes(shape)) tag.shape = shape;
    if (fin && FINISHES[fin] && finishOk(fin, tag.shape)) tag.finish = fin; else if (!finishOk(tag.finish, tag.shape)) tag.finish = 'black';
    if (overflows(tag.front, tag, tag.icon)) {
      const alt = shapesThatFit(tag.front, tag, tag.icon)[0];
      if (alt) { tag.shape = alt; if (!finishOk(tag.finish, alt)) tag.finish = 'black'; }
    }
    { const av = sizesFor(tag.shape, tag.finish); if (!av.includes(tag.size)) tag.size = av[0]; }
    if (name) { tag.back[0] = String(name).slice(0, 18); $('#b1').value = tag.back[0]; }
    renderOpts(); renderPreview();
    landOnPhone(Boolean(handoff));
  }
  function takeRoastHandoff() {
    let h = null; try { h = JSON.parse(sessionStorage.getItem('sdt-roast-handoff') || 'null'); sessionStorage.removeItem('sdt-roast-handoff'); } catch {}
    if (h && Array.isArray(h.lines)) loadRoast(h.lines, h.shape, h.fin, h.name, true);
  }
  // Ornament page -> shared cart. `o` carries choices only; the unit price is recomputed here and again on the server.
  function addOrnament(o) {
    if (!ORNAMENT_ENABLED) return { ok: false, error: 'Ornaments are not available right now.' };
    const line = { kind: 'ornament', tier: o.tier, oname: o.oname, year: o.year, qty: Math.min(20, Math.max(1, o.qty || 1)), art: o.art, style: o.art === 'design' ? o.style : undefined,
      raised: o.tier === 'acrylic' && (ORNAMENT_RAISED_INCLUDED || Boolean(o.raised)), photoData: o.photoData || null, photoName: o.photoName || '', ack: Boolean(o.ack), unit: 0 };
    line.unit = ornamentUnit(line);
    const same = cart.find((i) => lineKey(i) === lineKey(line));
    if (!same && cart.filter((i) => i.kind === 'ornament').length >= ORNAMENT_MAX_LINES) return { ok: false, error: `An order holds ${ORNAMENT_MAX_LINES} ornament lines at most. Check out first, or raise the quantity on an existing line.` };
    if (same) same.qty = Math.min(20, same.qty + line.qty); else cart.push(line);
    return { ok: true, saved: saveCart() };
  }
  window.SDT = {
    tagSVGFullcolor, processArt, addOrnament, ornamentUnit,
    ackHtml,
    cfg: { PRICES, ORNAMENT_ENABLED, ORNAMENT_RAISED_INCLUDED, SHIP_FROM, ORNAMENT_CUTOFF, ART_REVIEW_NOTE, ART_ACK_TEXT, ART_STYLES, UPLOAD_BLOCK_PX, UPLOAD_WARN_PX },
    tagSVG, finishOk, FONTS,
    sayings: () => SAYINGS.map((s, i) => ({ i, c: s.c, l: s.l.slice(), x: s.x })).filter((s) => !s.x).map(({ x, ...s }) => s),
    sayingAt: (i) => (SAYINGS[i] && !SAYINGS[i].x ? SAYINGS[i].l.slice() : null),
    price: (shape, finish) => tagUnitBase({ size: sizesFor(shape, finish)[0], finish }),
    money, loadRoast, toast: (m) => toast(m), sayingCount: () => CLEAN_COUNT,
    overflows: (lines, shape, finish, font, icon) => overflows(lines, { shape, finish: finish || 'black', font: font || 'block' }, icon || 'none'),
    askAdult: () => askAdult(), isAdult: () => adultOn,
  };

  lazyBuilderAssets();
  document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', init) : init();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { try { renderPreview(); renderSayings(($('.chip[aria-pressed="true"]') || {}).dataset?.cat || 'all'); } catch {} });
})();
