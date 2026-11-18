/* Salty Dog Tags — "Roast my dog".
   Photo + name + vibe -> POST /api/roast -> a description and five two-line sayings, rendered as a real tag
   (tagSVG from app.js) you can flick around, plus a 1080x1350 PNG made on the phone for the group chat.
   On localhost / *.pages.dev previews a local mock answers when /api/roast is missing (404/405/501, offline, not JSON);
   on the real site those show an inline error card with Try again instead of a fake roast.
   API contract this file assumes (Tollbooth owns it; adjust normalize() only):
     request  JSON { name, vibe, photo: "data:image/jpeg;base64,..." | null, attempt, adult?: true }
              (the Salty 18+ pill sends vibe 'savage' + adult:true, only after the shared age gate says yes)
     response JSON { description, matches: [{ index, l1, l2, score }] x3, custom: [{ l1, l2 }] x2,
                     sayings?: [{ l1, l2 }] (older shape, still accepted), shape?: "bone"|"heart"|..., portrait?: "data:..."|"https://..." }
              matches = existing sayings ranked for this dog (index = SAYINGS index in app.js; l1/l2 win if both are sent),
              custom  = lines written for this dog by name.
              error: non-2xx with { error: "message for the customer" } */
(function () {
  'use strict';
  const root = document.getElementById('roast');
  const S = window.SDT;
  if (!root || !S) return;
  const $ = (s, r) => (r || root).querySelector(s);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const RM = matchMedia('(prefers-reduced-motion: reduce)');
  const SHAPES_OK = ['bone', 'heart', 'round', 'military', 'paw'];
  const SITE = 'https://saltydogtags.com/roast/';

  /* ---------- mock roast (preview hosts only, see PREVIEW_HOST) ---------- */
  const VIBE_CATS = { couch: ['bulldog', 'cute'], chaos: ['attitude', 'lost'], food: ['bulldog', 'attitude'], drama: ['attitude', 'family'], velcro: ['family', 'cute'], escape: ['lost', 'attitude'], salty: ['attitude', 'bulldog'] };
  const VIBE_LINES = {
    couch: '{N} has two speeds: asleep and about to be. Moves for cheese, the fridge door, and nothing else.',
    chaos: '{N} is less a dog and more a weather event. The couch has filed a formal complaint.',
    food: '{N} has never once been full. Would sell the whole family out for a crouton and sleep fine.',
    drama: '{N} sighs like a divorced uncle. Every nail trim is a hostage negotiation.',
    velcro: '{N} needs to know where you are at all times. The bathroom is not a private place anymore.',
    escape: '{N} has seen the other side of the fence and has notes. The gate is treated as a suggestion.',
    salty: '{N} licks things in public and has never once apologized. The ottoman has stopped making eye contact.',
  };
  const CUSTOM = {
    couch: [['{N} is resting.', 'Do not disturb.'], ['{N} has 2 speeds:', 'nap and snack.']],
    chaos: [['{N} did it.', 'Whatever it was.'], ['Caution: {N}', 'is off the leash.']],
    food: [['{N} ate it.', 'No regrets.'], ['Feed {N}.', 'Then call my mom.']],
    drama: [['{N} is upset.', 'About nothing.'], ['{N} sighs.', 'Loudly. On purpose.']],
    velcro: [['{N} misses you.', "You've been gone 4 min."], ['Return {N}', 'to the nearest lap.']],
    escape: [['{N} left.', 'On purpose.'], ['If found, {N}', 'has a plan.']],
    salty: [['{N} farted.', 'Blamed the guests.'], ['{N} shit in', "the neighbor's yard."]], // offline 18+ mock
  };
  const customFor = (name, vibe) => (CUSTOM[vibe] || CUSTOM.couch).map(([a, b]) => { const l1 = a.split('{N}').join(name); return l1.length <= 24 ? { l1, l2: b } : { l1: name + '.', l2: b }; });
  function seeded(str) { let h = 2166136261; for (const ch of str) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return () => { h += 0x6D2B79F5; let t = h; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function mockRoast(name, vibe, attempt) {
    const rnd = seeded(name.toLowerCase() + '|' + vibe + '|' + attempt);
    const all = S.sayings().filter((s) => s.l.every((l) => l.length <= 24));
    const want = VIBE_CATS[vibe] || ['bulldog'];
    const pool = all.filter((s) => want.includes(s.c)).sort(() => rnd() - 0.5);
    const rest = all.filter((s) => !want.includes(s.c)).sort(() => rnd() - 0.5);
    const top = pool.concat(rest).slice(0, 3);
    return {
      description: (VIBE_LINES[vibe] || VIBE_LINES.couch).split('{N}').join(name),
      matches: top.map((s, k) => ({ index: s.i, l1: s.l[0], l2: s.l[1], l3: s.l[2], score: [94, 81, 77][k] })),
      custom: customFor(name, vibe),
      shape: ['bone', 'heart', 'military', 'bone'][Math.floor(rnd() * 4)], mock: true,
    };
  }

  /* ---------- normalize whatever the API sends into one shape ---------- */
  // -> { name, description, items: [{ lines, score, kind: 'match'|'custom' }], top, shape, portrait }
  //    items = up to 3 matches (best first) then up to 2 custom lines; top = the best match's score (or null).
  function normalize(d, name, adult) {
    d = d || {};
    const toLines = (s) => (Array.isArray(s) ? s : [s && s.l1, s && s.l2, s && s.l3])
      .filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim().slice(0, 24)).slice(0, 3);
    const toScore = (v) => { if (v == null || v === '') return null; const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.max(1, Math.min(99, n)) : null; };
    const rawM = Array.isArray(d.matches) ? d.matches : [];
    let matches = rawM.map((m) => {
      let l = toLines(m || {});
      // A match is one of our sayings: when the index agrees with l1 (or l1 is missing), use the full saying so a 3-line one keeps line 3.
      const site = m && Number.isInteger(m.index) ? S.sayingAt(m.index) : null;
      if (site && (!l.length || site[0] === l[0])) l = site;
      return l.length ? { lines: l, score: toScore(m.score), kind: 'match' } : null;
    }).filter(Boolean).slice(0, 3);
    let custom = (Array.isArray(d.custom) ? d.custom : []).map(toLines).filter((l) => l.length).slice(0, 2).map((l) => ({ lines: l, score: null, kind: 'custom' }));
    const legacy = (d.sayings || d.tags || []).map(toLines).filter((l) => l.length);
    if (!matches.length) matches = legacy.slice(0, 3).map((l) => ({ lines: l, score: null, kind: 'match' }));
    if (!custom.length && !rawM.length) custom = legacy.slice(3, 5).map((l) => ({ lines: l, score: null, kind: 'custom' }));
    matches.sort((a, b) => (b.score || 0) - (a.score || 0));
    const items = matches.concat(custom);
    if (!items.length) throw new Error('The roast came back empty. Try again.');
    const portrait = typeof d.portrait === 'string' && /^(data:image\/(png|jpe?g|webp);|https:\/\/)/.test(d.portrait) ? d.portrait : null;
    const shape = SHAPES_OK.includes(d.shape) ? d.shape : 'bone';
    // One finish per roast: the API's finish_hint when it is made in this shape, else black. Picking a line never changes it.
    const hint = d.finish_hint || d.finish;
    const finish = typeof hint === 'string' && S.finishOk(hint, shape) ? hint : 'black';
    return { name, description: String(d.description || '').trim().slice(0, 260), items, top: matches.length ? matches[0].score : null, shape, finish, portrait, mock: Boolean(d.mock), adult: Boolean(adult), rid: typeof d.rid === 'string' ? d.rid : null };
  }
  const aOrAn = (n) => (/^8/.test(String(n)) || n === 11 || n === 18 ? 'an' : 'a'); // "an 81% match", "a 94% match"
  const matchLine = (r) => (r.top != null ? `${r.name} is ${aOrAn(r.top)} ${r.top}% match` : `${r.name}'s top match`);

  // The pill value 'salty' is a client-side vibe: the wire gets vibe 'savage' plus adult:true. The mock keeps 'salty'.
  // The offline mock only answers on local/preview hosts. On the real site a failure is an error card, never a fake roast.
  const PREVIEW_HOST = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname) || /\.pages\.dev$/.test(location.hostname);
  const ROAST_LIMIT = 5; // keep in sync with RATE_LIMIT in functions/api/roast.js (roasts per visitor per hour)
  const TIMEOUT_MS = 60000;
  function roastErr(kind, status, msg) { const e = new Error(msg || ''); e.kind = kind; e.status = status || 0; return e; }
  async function askRoast(name, vibe, photo, attempt, notes, signal) {
    const adult = vibe === 'salty';
    let r;
    try {
      const payload = { name, vibe: adult ? 'savage' : vibe, photo, attempt };
      if (notes) payload.notes = notes;
      if (adult) payload.adult = true;
      r = await fetch('/api/roast', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload), signal });
    } catch (err) {
      if (err && err.name === 'AbortError') throw roastErr('timeout');
      if (PREVIEW_HOST) return mockRoast(name, vibe, attempt);
      throw roastErr('network');
    }
    const ct = r.headers.get('content-type') || '';
    if ([404, 405, 501].includes(r.status) || !/json/.test(ct)) {
      if (PREVIEW_HOST) return mockRoast(name, vibe, attempt);
      throw roastErr('server', r.status);
    }
    const d = await r.json().catch(() => null);
    if (!r.ok) throw roastErr('http', r.status, d && d.error);
    return d;
  }
  // Customer copy for a failed roast. act = what the card's button does: retry | photo (pick another) | browse (sayings).
  function errCopy(err) {
    const s = err.status || 0, m = String(err.message || '');
    if (err.kind === 'timeout') return { msg: 'That one took too long. The roast machine is slammed right now. Try again in a minute.', act: 'retry' };
    if (err.kind === 'network') return { msg: "Couldn't reach the roast machine. Check your connection and try again.", act: 'retry' };
    if (s === 429) return { msg: `That's your ${ROAST_LIMIT} free roasts this hour. Come back in a bit, or browse the sayings while you wait.`, act: 'browse' };
    if (s === 413 || (s === 400 && /photo|image|dog|cat/i.test(m))) return { msg: s === 413 ? 'That photo is too big. Try a smaller one.' : m, act: 'photo', photo: true };
    if (s >= 500 || err.kind === 'server' || /not configured/i.test(m)) return { msg: 'The roast machine is napping. Give it a minute and try again.', act: 'retry' };
    return { msg: m || 'The roast machine choked. Try again in a minute.', act: 'retry' };
  }

  /* ---------- photo: shrink on the phone before it goes anywhere ---------- */
  function shrinkPhoto(file) {
    return new Promise((resolve, reject) => {
      if (!/^image\//.test(file.type || 'image/')) { reject(new Error('That file is not a photo.')); return; }
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const w = img.naturalWidth, h = img.naturalHeight; const k = Math.min(1, 1024 / Math.max(w, h));
        const cv = document.createElement('canvas'); cv.width = Math.round(w * k); cv.height = Math.round(h * k);
        cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
        URL.revokeObjectURL(url); resolve(cv.toDataURL('image/jpeg', 0.82));
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read that photo. Try a JPG or PNG.')); };
      img.src = url;
    });
  }

  /* ---------- the flickable tag ---------- */
  function makeFlip(btn, onFace) {
    const inner = btn.querySelector('.flip__in');
    let ang = 0, drag = null, eatClick = false;
    const K = 0.55; // degrees per px of drag
    const paint = (a, ms) => { inner.style.transition = ms && !RM.matches ? `transform ${ms}ms cubic-bezier(.16,.84,.24,1)` : 'none'; inner.style.transform = `rotateY(${a}deg)`; };
    const face = () => ((Math.round(ang / 180) % 2 + 2) % 2 ? 'back' : 'front');
    const settle = (target, ms) => { ang = target; paint(ang, ms); onFace(face()); };
    btn.addEventListener('pointerdown', (e) => {
      if (e.button) return;
      drag = { x: e.clientX, y: e.clientY, a: ang, lx: e.clientX, lt: e.timeStamp, v: 0, axis: null, id: e.pointerId };
    });
    btn.addEventListener('pointermove', (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (!drag.axis && Math.abs(dx) + Math.abs(dy) > 8) {
        drag.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
        if (drag.axis === 'x') { try { btn.setPointerCapture(e.pointerId); } catch {} btn.classList.add('is-grab'); }
      }
      if (drag.axis !== 'x') return;
      const dt = Math.max(1, e.timeStamp - drag.lt);
      drag.v = 0.7 * ((e.clientX - drag.lx) / dt) + 0.3 * drag.v; drag.lx = e.clientX; drag.lt = e.timeStamp;
      if (!RM.matches) paint(drag.a + dx * K, 0);
    });
    const end = (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const d = drag; drag = null; btn.classList.remove('is-grab');
      if (d.axis !== 'x') return; // a tap (click handles it) or a vertical scroll
      eatClick = true; setTimeout(() => { eatClick = false; }, 0);
      const dx = e.clientX - d.x;
      if (RM.matches) { settle(d.a + (dx > 0 ? 180 : -180), 0); return; }
      const cur = d.a + dx * K;
      const projected = cur + d.v * K * 420; // a hard flick keeps spinning
      let target = Math.round(projected / 180) * 180;
      if (target === d.a && Math.abs(dx) > 40) target += dx > 0 ? 180 : -180;
      settle(target, Math.min(1700, Math.max(480, 380 + Math.abs(target - cur) * 1.1)));
    };
    btn.addEventListener('pointerup', end);
    btn.addEventListener('pointercancel', (e) => { if (drag && e.pointerId === drag.id) { const a = drag.a; drag = null; btn.classList.remove('is-grab'); settle(Math.round(a / 180) * 180, 300); } });
    btn.addEventListener('click', () => { if (eatClick) return; settle(ang + 180, 760); });
    return { reset() { settle(0, 0); }, nudge() { if (RM.matches) return; btn.classList.remove('flip--hint'); void btn.offsetWidth; btn.classList.add('flip--hint'); } };
  }

  /* ---------- share card (1080 x 1350, drawn on the phone) ---------- */
  const fontCache = new Map();
  async function fontFaceCSS(text) {
    // Only the glyphs on this tag, from Google Fonts, inlined so the SVG renders with the real face inside <img>.
    const chars = Array.from(new Set(text.toUpperCase() + text)).join('');
    if (fontCache.has(chars)) return fontCache.get(chars);
    const job = (async () => {
      const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 4000);
      try {
        const css = await (await fetch('https://fonts.googleapis.com/css2?family=Archivo+Black&text=' + encodeURIComponent(chars), { signal: ctl.signal })).text();
        const m = /url\((https:[^)]+)\)/.exec(css); if (!m) return '';
        const buf = await (await fetch(m[1], { signal: ctl.signal })).arrayBuffer();
        let bin = ''; const u = new Uint8Array(buf); for (let i = 0; i < u.length; i += 0x8000) bin += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
        return `@font-face{font-family:'Archivo Black';src:url(data:font/woff2;base64,${btoa(bin)}) format('woff2')}`;
      } catch { return ''; } finally { clearTimeout(t); }
    })();
    fontCache.set(chars, job);
    return job;
  }
  function loadImg(src) { return new Promise((res, rej) => { const i = new Image(); i.decoding = 'async'; i.onload = () => res(i); i.onerror = rej; i.src = src; }); }
  async function tagImage(o, px) {
    let svg = S.tagSVG(o);
    const css = await fontFaceCSS(o.lines.join(''));
    svg = svg.replace('<svg ', `<svg width="${px}" height="${Math.round(px * 0.75)}" `);
    if (css) svg = svg.replace('<defs>', `<defs><style>${css}</style>`);
    return loadImg('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg));
  }
  function wrap(ctx, text, maxW, maxLines) {
    const words = text.split(/\s+/); const lines = []; let cur = '';
    for (const w of words) { const t = cur ? cur + ' ' + w : w; if (ctx.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t; }
    if (cur) lines.push(cur);
    if (lines.length > maxLines) { lines.length = maxLines; lines[maxLines - 1] = lines[maxLines - 1].replace(/\s*\S*$/, '') + '…'; }
    return lines;
  }
  async function drawCard(st) {
    const W = 1080, H = 1350, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const x = cv.getContext('2d');
    if (document.fonts) await Promise.all(['400 120px Bungee', '400 34px Archivo', '500 28px "DM Mono"'].map((f) => document.fonts.load(f))).catch(() => {});
    const item = st.result.items[st.pick], pick = item.lines;
    const [tagImg, logo, pic] = await Promise.all([
      tagImage({ shape: st.result.shape, finish: st.finish, lines: pick, font: 'block' }, 1280),
      loadImg('/assets/logo/logo-final-horizontal-dark.svg?v=49').catch(() => null),
      !st.example && (st.result.portrait || st.photo) ? loadImg(st.result.portrait || st.photo).catch(() => null) : null,
    ]);
    // ground: the page void with the hero's magenta glow
    x.fillStyle = '#09010F'; x.fillRect(0, 0, W, H);
    let g = x.createRadialGradient(W * 0.5, 640, 40, W * 0.5, 640, 720); g.addColorStop(0, 'rgba(255,60,172,.30)'); g.addColorStop(1, 'rgba(255,60,172,0)');
    x.fillStyle = g; x.fillRect(0, 0, W, H);
    // the striped sunset (same stops and cuts as the hero)
    const cx = W / 2, cy = 660, R = 300;
    const sun = document.createElement('canvas'); sun.width = R * 2; sun.height = R * 2; const s = sun.getContext('2d');
    g = s.createLinearGradient(0, 0, 0, R * 2); g.addColorStop(0.08, '#FFD166'); g.addColorStop(0.42, '#FF8A6B'); g.addColorStop(0.78, '#FF3CAC');
    s.fillStyle = g; s.beginPath(); s.arc(R, R, R, 0, Math.PI * 2); s.fill();
    s.globalCompositeOperation = 'destination-out';
    [[0.52, 0.56], [0.63, 0.68], [0.74, 0.80], [0.85, 0.91]].forEach(([a, b]) => s.fillRect(0, a * R * 2, R * 2, (b - a) * R * 2));
    x.globalAlpha = 0.92; x.drawImage(sun, cx - R, cy - R - 40); x.globalAlpha = 1;
    // logo + headline
    if (logo) { const lh = 64, lw = lh * (logo.naturalWidth / logo.naturalHeight || 3.9); x.drawImage(logo, 72, 64, lw, lh); }
    if (st.result.adult) { // 18+ badge, top right: magenta outline pill
      x.font = '500 30px "DM Mono", monospace'; x.textBaseline = 'middle'; x.textAlign = 'center';
      x.lineWidth = 4; x.strokeStyle = '#FF3CAC'; x.beginPath(); x.roundRect ? x.roundRect(W - 72 - 112, 66, 112, 56, 28) : x.rect(W - 72 - 112, 66, 112, 56); x.stroke();
      x.fillStyle = '#FF3CAC'; x.fillText('18+', W - 72 - 56, 95);
    }
    x.textBaseline = 'alphabetic'; x.textAlign = 'left';
    x.font = '500 26px "DM Mono", monospace'; x.fillStyle = '#2AF5E4';
    x.fillText('THE ROAST OF', 72, 214);
    let fs = 136; const nm = st.result.name.toUpperCase();
    const fit = () => { x.font = `400 ${fs}px Bungee, Impact, sans-serif`; return x.measureText(nm).width <= W - 144; };
    while (!fit() && fs > 48) fs -= 4;
    x.fillStyle = '#FFFFFF'; x.fillText(nm, 72, 214 + fs + 4);
    // the quiz result pill: "94% MATCH" for a ranked saying, "WRITTEN FOR <NAME>" for a custom one
    const badge = item.kind === 'custom' ? `WRITTEN FOR ${nm}` : item.score != null ? `${item.score}% MATCH` : 'TOP MATCH';
    x.font = '500 30px "DM Mono", monospace';
    const bw = Math.min(W - 144 - 300, x.measureText(badge).width + 48), by = 214 + fs + 30;
    x.fillStyle = '#FF3CAC'; x.beginPath(); x.roundRect ? x.roundRect(72, by, bw, 56, 28) : x.rect(72, by, bw, 56); x.fill();
    x.fillStyle = '#09010F'; x.textBaseline = 'middle'; x.fillText(badge, 96, by + 29, bw - 48); x.textBaseline = 'alphabetic';
    // the dog (photo or portrait), round, ringed in magenta
    if (pic) {
      const pr = 120, px = W - 64 - pr, py = 520;
      x.save(); x.beginPath(); x.arc(px, py, pr, 0, Math.PI * 2); x.closePath(); x.clip();
      const k = Math.max((pr * 2) / pic.naturalWidth, (pr * 2) / pic.naturalHeight);
      x.drawImage(pic, px - (pic.naturalWidth * k) / 2, py - (pic.naturalHeight * k) / 2, pic.naturalWidth * k, pic.naturalHeight * k);
      x.restore(); x.lineWidth = 10; x.strokeStyle = '#FF3CAC'; x.beginPath(); x.arc(px, py, pr + 5, 0, Math.PI * 2); x.stroke();
    }
    // the tag, big, with a floor shadow
    const tw = 900, th = tw * 0.75, tx = (W - tw) / 2, ty = 470;
    x.save(); x.shadowColor = 'rgba(0,0,0,.7)'; x.shadowBlur = 50; x.shadowOffsetY = 30; x.drawImage(tagImg, tx, ty, tw, th); x.restore();
    // the verdict
    if (st.result.description) {
      x.font = '400 34px Archivo, system-ui, sans-serif'; x.fillStyle = '#CFC3DD'; x.textAlign = 'center';
      wrap(x, '“' + st.result.description + '”', W - 180, 3).forEach((l, i) => x.fillText(l, W / 2, 1158 + i * 46));
    }
    // sign-off
    x.fillStyle = 'rgba(255,244,250,.14)'; x.fillRect(72, 1278, W - 144, 1);
    x.textAlign = 'left'; x.font = '500 26px "DM Mono", monospace'; x.fillStyle = '#FFF4FA'; x.fillText('SALTYDOGTAGS.COM', 72, 1318);
    x.textAlign = 'right'; x.fillStyle = '#FF3CAC'; x.fillText('ROAST YOURS →', W - 72, 1318);
    return new Promise((res, rej) => cv.toBlob((b) => (b ? res(b) : rej(new Error('Could not draw the picture.'))), 'image/png'));
  }

  /* ---------- wire up ---------- */
  const form = $('#roastForm'), out = $('#roastOut'), nameIn = $('#roastName'), fileIn = $('#roastPhoto');
  const flipBtn = $('#roastFlip'), shareBtn = $('#roastShare'), buyBtn = $('#roastBuy'), status = $('#roastStatus');
  const st = { photo: null, result: null, pick: 0, finish: 'black', attempt: 0, card: null, busy: false, example: true };
  const quickBtn = $('#roastBuyQuick');
  const sentence = (t) => (/[.!?…]$/.test(t) ? t : t + '.'); // no "couch.." in the label
  const flip = makeFlip(flipBtn, (f) => {
    const l = st.result ? st.result.items[st.pick].lines.join(' ') : '';
    flipBtn.setAttribute('aria-label', f === 'front' ? `Tag front: ${sentence(l)} Press to flip.` : `Tag back: ${sentence(st.result ? st.result.name : '')} Press to flip.`);
  });
  const canShareFiles = (() => { try { return Boolean(navigator.canShare && navigator.canShare({ files: [new File([new Blob(['x'], { type: 'image/png' })], 'x.png', { type: 'image/png' })] })); } catch { return false; } })();
  shareBtn.querySelector('span').textContent = canShareFiles ? 'Send it to the group chat' : 'Save the picture';

  function renderTag() {
    const r = st.result, lines = r.items[st.pick].lines;
    st.finish = r.finish || 'black';
    $('.flip__face--front', flipBtn).innerHTML = S.tagSVG({ shape: r.shape, finish: st.finish, lines, font: 'block' });
    $('.flip__face--back', flipBtn).innerHTML = S.tagSVG({ shape: r.shape, finish: st.finish, lines: [r.name, 'Your number here'], font: 'block' });
    const price = S.money(S.price(r.shape, st.finish));
    buyBtn.querySelector('b').textContent = price;
    if (quickBtn) quickBtn.querySelector('b').textContent = price;
    // Data hooks on #roastShare (documented in index.html), kept current for anything that reads them.
    const d = shareBtn.dataset;
    d.name = r.name || ''; d.line1 = lines[0] || ''; d.line2 = lines[1] || ''; d.line3 = lines[2] || '';
    d.desc = r.description || ''; d.shape = r.shape || ''; d.finish = st.finish; d.example = st.example ? '1' : '0';
    if (st.example) delete out.dataset.shareReady; else out.dataset.shareReady = '1';
    st.card = null; st.cardBlob = null; // the share picture is stale; build it now so the tap can share inside the gesture
    if (!st.example) prepCard();
    mini.update();
  }
  function prepCard() {
    const job = drawCard(st); st.card = job;
    job.then((blob) => { if (st.card === job) st.cardBlob = blob; }, () => {});
    return job;
  }

  /* ---------- phones: a mini tag pinned to the bottom when the picked line changes and the big tag is off-screen ----------
     Chosen over scrolling the tag back into view: the picker stays under the thumb, nothing jumps, and the mini bar
     leaves as soon as the real tag is on screen again (or the results card is scrolled away). */
  const mini = (() => {
    const phone = matchMedia('(max-width: 900px)');
    let el = null, tagSeen = true, outSeen = false, wanted = false;
    const make = () => {
      el = document.createElement('div'); el.className = 'roast__mini'; el.hidden = true;
      el.innerHTML = '<button type="button" class="roast__mini-tag" aria-label="Show the full tag"></button><span class="roast__mini-t"></span><button type="button" class="roast__mini-buy">Engrave <b></b></button>';
      el.querySelector('.roast__mini-tag').addEventListener('click', () => { wanted = false; sync(); flipBtn.scrollIntoView({ behavior: RM.matches ? 'auto' : 'smooth', block: 'center' }); });
      el.querySelector('.roast__mini-buy').addEventListener('click', () => buyBtn.click());
      document.body.appendChild(el);
    };
    const sync = () => {
      if (!el) return;
      const show = wanted && phone.matches && !tagSeen && outSeen && !st.example && !st.busy;
      el.hidden = !show;
      if (show) { const bb = document.getElementById('buyBar'); el.style.bottom = bb && !bb.hidden && bb.offsetHeight ? bb.offsetHeight + 8 + 'px' : ''; }
    };
    if ('IntersectionObserver' in window) {
      new IntersectionObserver((es) => { tagSeen = es[0].isIntersecting; if (tagSeen) wanted = false; sync(); }, { threshold: 0.35 }).observe(flipBtn);
      new IntersectionObserver((es) => { outSeen = es[0].isIntersecting; sync(); }, { threshold: 0 }).observe(out);
    }
    return {
      picked() { if (!phone.matches || tagSeen) return; if (!el) make(); wanted = true; this.update(); },
      update() {
        if (!el || !st.result) return sync();
        const r = st.result, lines = r.items[st.pick].lines;
        el.querySelector('.roast__mini-tag').innerHTML = S.tagSVG({ shape: r.shape, finish: st.finish, lines, font: 'block' });
        el.querySelector('.roast__mini-t').textContent = lines.join(' ');
        el.querySelector('.roast__mini-buy b').textContent = S.money(S.price(r.shape, st.finish));
        sync();
      },
      hide() { wanted = false; sync(); },
    };
  })();

  /* ---------- feedback: "How'd we do?" + thumbs on custom lines -> POST /api/roast-feedback ---------- */
  const THANKS = { fire: 'Good. We\'ll do more of that.', meh: 'Fair. We\'ll try harder.', toofar: 'Noted. Whisky\'s lawyer has been informed.' };
  function sendFb(payload) {
    const r = st.result; if (!r || !r.rid) return Promise.resolve(null); // mock / pre-feedback responses: thanks only
    return fetch('/api/roast-feedback', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ rid: r.rid, ...payload }) })
      .then((x) => (x.ok ? x.json() : null)).catch(() => null);
  }
  const thumbsHTML = (n) => `<span class="fbv" data-ci="${n}"><button type="button" class="fbv__b" data-up="1" aria-label="Good line">👍</button><button type="button" class="fbv__b" data-up="0" aria-label="Bad line, write a new one">👎</button></span>`;
  // 👎 on a custom line: record the vote AND ask for a replacement in the same slot.
  async function rewriteLine(wrap) {
    const r = st.result, ci = +wrap.dataset.ci;
    const items = r.items.filter((x) => x.kind === 'custom'), item = items[ci];
    const i = r.items.indexOf(item), card = wrap.closest('.fbw'), b = card && card.querySelector('.opt b');
    if (!r.rid || !item || !card || st.rewriting) { wrap.innerHTML = '<span class="fbv__ty">Noted 👎</span>'; return; }
    st.rewriting = true; card.classList.add('is-rewriting'); card.setAttribute('aria-busy', 'true');
    wrap.innerHTML = '';
    const old = b.textContent; b.textContent = 'Writing a new one…';
    const d = await sendFb({ custom: { idx: ci, up: false, replace: true }, notes: r.notes || '' });
    st.rewriting = false; card.classList.remove('is-rewriting'); card.removeAttribute('aria-busy');
    if (st.result !== r) return; // a new roast replaced this one while we waited
    const nl = d && d.line ? [d.line.l1, d.line.l2, d.line.l3].filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim().slice(0, 24)) : [];
    if (!nl.length) {
      b.textContent = old;
      wrap.innerHTML = '<span class="fbv__ty" role="status">' + (d && d.reason === 'limit' ? 'Out of rewrites. Hit Roast again.' : 'Noted 👎') + '</span>';
      return;
    }
    item.lines = nl;
    b.textContent = nl.join(' ');
    wrap.outerHTML = thumbsHTML(ci); // the new line can be rated too
    card.classList.add('is-new'); setTimeout(() => card.classList.remove('is-new'), 1200);
    if (st.pick === i) { renderTag(); flip.reset(); }
    status.textContent = `New line: ${nl.join(' ')}`;
  }
  function renderFb(example) {
    let box = $('#roastFb');
    if (!box) { box = document.createElement('div'); box.id = 'roastFb'; box.className = 'roast__fb'; $('.roast__acts').before(box); }
    box.hidden = Boolean(example);
    box.innerHTML = `<span class="roast__fbq">How'd we do?</span><span class="roast__fbrow"><button type="button" class="pill" data-v="fire">🔥 Nailed it</button><button type="button" class="pill" data-v="meh">😐 Meh</button><button type="button" class="pill" data-v="toofar">🚫 Too far</button></span>`;
  }
  root.addEventListener('click', (e) => {
    const v = e.target.closest('#roastFb [data-v]');
    if (v) {
      const vote = v.dataset.v; sendFb({ vote });
      $('#roastFb').innerHTML = `<span class="roast__fbq" role="status">${esc(THANKS[vote].replace('Whisky', (st.result && st.result.name) || 'Whisky'))}</span>`;
      return;
    }
    const b = e.target.closest('.fbv__b');
    if (b) {
      e.preventDefault(); e.stopPropagation();
      const wrap = b.parentNode;
      if (b.dataset.up === '1') { sendFb({ custom: { idx: +wrap.dataset.ci, up: true } }); wrap.innerHTML = '<span class="fbv__ty">Noted 👍</span>'; }
      else rewriteLine(wrap);
    }
  });

  function render(example) {
    const r = st.result; st.example = Boolean(example);
    $('#roastKicker').textContent = example ? 'Example match' : 'Salty Dog match';
    $('#roastAdult').hidden = example || !r.adult;
    countUp(r, example);
    const pic = $('#roastPic'); const src = r.portrait || st.photo;
    pic.hidden = !src || example; if (src && !example) pic.src = src;
    $('#roastDesc').textContent = r.description ? '“' + r.description + '”' : '';
    const cIdx = r.items.filter((x) => x.kind === 'custom');
    const thumbs = (it) => { const n = cIdx.indexOf(it); return n < 0 || example ? '' : thumbsHTML(n); };
    const opt = (it, i) => `<div class="fbw${thumbs(it) ? ' fbw--t' : ''}">${thumbs(it)}<label class="opt"><input type="radio" name="roastPick" value="${i}"${i === st.pick ? ' checked' : ''}><span><b>${esc(it.lines.join(' '))}</b>` +
      (it.score != null ? `<i class="roast__pct">${it.score}%</i><i class="roast__bar" aria-hidden="true"><i style="width:${it.score}%"></i></i>` : '') + `</span></label></div>`;
    $('#roastPicks').innerHTML = r.items.map((it, i) => (it.kind === 'match' ? opt(it, i) : '')).join('');
    $('#roastCustom').innerHTML = r.items.map((it, i) => (it.kind === 'custom' ? opt(it, i) : '')).join('');
    renderFb(example);
    const hasCustom = r.items.some((it) => it.kind === 'custom');
    $('#roastDivider').hidden = !hasCustom; $('#roastCustom').hidden = !hasCustom;
    $('#roastDivider').textContent = `Written just for ${r.name}`;
    renderTag(); flip.reset();
    out.classList.toggle('is-example', Boolean(example));
    $('#roastAgain').textContent = example ? 'Now roast yours' : 'Roast again';
  }

  // "Meatball is a 94% match": the number counts up and the meter fills, once per result (instant for reduced motion).
  function countUp(r, instant) {
    const who = $('#roastWho'), meter = $('#roastMeter'), fill = meter.firstElementChild;
    cancelAnimationFrame(countUp._raf);
    meter.hidden = r.top == null;
    if (r.top == null) { who.textContent = matchLine(r); return; }
    meter.setAttribute('aria-label', `${r.top}% match`);
    if (instant || RM.matches) { who.textContent = matchLine(r); fill.style.transition = 'none'; fill.style.width = r.top + '%'; return; }
    fill.style.transition = 'none'; fill.style.width = '0%'; void fill.offsetWidth;
    fill.style.transition = ''; fill.style.width = r.top + '%';
    const t0 = performance.now(), dur = 1000;
    const step = (t) => {
      const k = Math.min(1, (t - t0) / dur), n = Math.round(r.top * (1 - Math.pow(1 - k, 3)));
      who.textContent = `${r.name} is ${aOrAn(n)} ${n}% match`;
      if (k < 1) countUp._raf = requestAnimationFrame(step);
    };
    countUp._raf = requestAnimationFrame(step);
  }

  fileIn.addEventListener('change', async () => {
    const f = fileIn.files && fileIn.files[0]; if (!f) return;
    const drop = $('.roast__drop');
    try {
      st.photo = await shrinkPhoto(f);
      $('#roastThumb').src = st.photo; drop.classList.add('has-photo');
      $('#roastDropT').textContent = 'Nice face. Tap to change.';
      drop.classList.remove('is-err'); clearErr();
    } catch (err) { st.photo = null; drop.classList.remove('has-photo'); fileIn.value = ''; showErr({ msg: err.message, act: 'photo', photo: true }); }
  });

  /* ---------- Salty 18+ pill: same age gate as the Salty sayings (app.js), same sdt-adult flag ---------- */
  const kidFlow = root.dataset.kid === '1'; // no kid flow exists today; if one is added it sets data-kid="1" on #roast
  const saltyIn = form.querySelector('input[name=roastVibe][value=salty]');
  if (saltyIn && kidFlow) { saltyIn.closest('.opt').hidden = true; saltyIn.disabled = true; }
  let lastVibe = (form.querySelector('input[name=roastVibe]:checked') || {}).value || 'couch';
  form.addEventListener('change', async (e) => {
    if (e.target.name !== 'roastVibe') return;
    if (e.target.value !== 'salty') { lastVibe = e.target.value; return; }
    let ok = false;
    try { ok = kidFlow ? false : await S.askAdult(); } catch { ok = false; }
    if (ok) { lastVibe = 'salty'; return; }
    const back = form.querySelector(`input[name=roastVibe][value="${lastVibe}"]`) || form.querySelector('input[name=roastVibe]');
    if (back) back.checked = true; // "No thanks" or Esc: back to the previous vibe
  });

  /* ---------- inline error card under the Roast button (stays until the next submit) ---------- */
  const goBtn = $('#roastGo');
  let errBox = null;
  function clearErr() { if (errBox) { errBox.hidden = true; errBox.innerHTML = ''; } $('.roast__drop').classList.remove('is-err'); }
  function showErr(c) {
    if (!errBox) { errBox = document.createElement('div'); errBox.className = 'roast__err'; errBox.id = 'roastErr'; errBox.setAttribute('role', 'alert'); goBtn.after(errBox); }
    const bl = $('.roast__fine a[href*="sayings"]'), browse = bl ? bl.getAttribute('href') : '/sayings/';
    const act = c.act === 'photo' ? '<button type="button" class="roast__err-btn" data-act="photo">Pick another photo</button>'
      : c.act === 'browse' ? `<a class="roast__err-btn" href="${esc(browse)}">Browse the sayings</a>`
      : c.act === 'retry' ? '<button type="button" class="roast__err-btn" data-act="retry">Try again</button>' : '';
    errBox.innerHTML = `<p>${esc(c.msg)}</p>${act}`;
    errBox.hidden = false;
    $('.roast__drop').classList.toggle('is-err', Boolean(c.photo));
    const rc = errBox.getBoundingClientRect();
    if (rc.top < 60 || rc.bottom > innerHeight) errBox.scrollIntoView({ behavior: RM.matches ? 'auto' : 'smooth', block: 'center' });
  }
  form.addEventListener('click', (e) => {
    const b = e.target.closest('.roast__err-btn[data-act]'); if (!b) return;
    if (b.dataset.act === 'photo') fileIn.click(); else run(st.attempt > 0);
  });

  /* ---------- loading state in the results area: Opus takes 20-40 s, so say so and show progress ---------- */
  let waitBox = null;
  const possessive = (n) => (/s$/i.test(n) ? n + "'" : n + "'s");
  function showWait(name) {
    if (!waitBox) {
      waitBox = document.createElement('div'); waitBox.className = 'roast__wait'; waitBox.setAttribute('aria-hidden', 'true');
      waitBox.innerHTML = '<p class="roast__kick">Roasting</p><p class="roast__wait-t"></p><p class="roast__wait-s"></p><div class="roast__wait-bar"><i></i></div>';
      out.prepend(waitBox);
    }
    $('.roast__wait-t', waitBox).textContent = `Writing ${possessive(name)} roast, usually 20-30 seconds`;
    out.classList.add('is-loading'); out.setAttribute('aria-busy', 'true'); // visible first, or the transition never runs
    const bar = $('.roast__wait-bar > i', waitBox);
    bar.style.transition = 'none'; bar.style.width = '2%'; void bar.offsetWidth;
    bar.style.transition = ''; bar.style.width = '94%'; // CSS eases this over ~30 s
  }
  function hideWait(done) {
    if (!waitBox) return;
    out.classList.remove('is-loading'); out.removeAttribute('aria-busy');
    if (done) $('.roast__wait-bar > i', waitBox).style.width = '100%';
  }
  const inView = (el, frac) => { const r = el.getBoundingClientRect(); return r.top < innerHeight * (frac || 0.75) && r.bottom > 60; };

  const LOADING = ['Counting wrinkles…', 'Asking the other seven bulldogs…', 'Sharpening the jokes…'];
  async function run(again) {
    if (st.busy) return;
    hideLimit();
    const name = (nameIn.value || '').trim().replace(/\s+/g, ' ').slice(0, 18);
    const field = nameIn.closest('.field');
    if (!name) { field.classList.add('is-err'); nameIn.focus(); return; }
    field.classList.remove('is-err');
    clearErr();
    let vibe = (form.querySelector('input[name=roastVibe]:checked') || {}).value || 'couch';
    // Belt and braces: salty never goes out without the gate flag (or in a kid flow).
    if (vibe === 'salty' && (kidFlow || !S.isAdult())) { vibe = 'couch'; const c = form.querySelector('input[name=roastVibe][value=couch]'); if (c) c.checked = true; lastVibe = 'couch'; }
    st.attempt = again ? st.attempt + 1 : 0;
    st.busy = true; form.classList.add('is-busy'); const go = goBtn; go.disabled = true; mini.hide();
    if (document.activeElement && document.activeElement.blur && form.contains(document.activeElement)) document.activeElement.blur(); // drop the keyboard
    const steps = [st.photo ? 'Sniffing the photo…' : `Sizing up ${name}…`].concat(LOADING);
    let k = 0; status.textContent = `Writing ${possessive(name)} roast. This usually takes 20 to 30 seconds.`; go.textContent = steps[0];
    const sub = () => waitBox && ($('.roast__wait-s', waitBox).textContent = steps[k]);
    showWait(name); sub();
    const tick = setInterval(() => { k = (k + 1) % steps.length; go.textContent = steps[k]; sub(); }, 2400);
    // Bring the loading card into view if it is below the fold (phones), then only follow up with the result
    // if the visitor has not scrolled on their own since.
    let userMoved = false;
    const moved = (e) => { if (e.type !== 'keydown' || /^(Arrow|Page|Home|End| )/.test(e.key)) userMoved = true; };
    const evs = ['wheel', 'touchmove', 'keydown'];
    setTimeout(() => evs.forEach((t) => addEventListener(t, moved, { passive: true })), 0);
    // (a beat later, so an instant failure like a 429 does not scroll the visitor away from its error card)
    const toWait = setTimeout(() => { if (!userMoved && !inView(out, 0.7)) out.scrollIntoView({ behavior: RM.matches ? 'auto' : 'smooth', block: 'start' }); }, 450);
    const ctl = new AbortController(); const tmo = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    try {
      const notes = String(($('#roastNotes') || {}).value || '').trim().slice(0, 300);
      const [d] = await Promise.all([askRoast(name, vibe, st.photo, st.attempt, notes, ctl.signal), new Promise((r) => setTimeout(r, RM.matches ? 0 : 900))]);
      st.result = normalize(d, name, vibe === 'salty'); st.pick = 0; st.result.notes = notes; st.rewriting = false;
      hideWait(true);
      render(false);
      status.textContent = `${matchLine(st.result)}. The top match is on the tag; runner-ups and custom lines are below.`;
      if (!userMoved) out.scrollIntoView({ behavior: RM.matches ? 'auto' : 'smooth', block: 'start' });
      setTimeout(() => flip.nudge(), RM.matches ? 0 : 700);
    } catch (err) {
      hideWait(false);
      status.textContent = '';
      showErr(err && err.kind ? errCopy(err) : { msg: (err && err.message) || 'The roast machine choked. Try again.', act: 'retry' });
    } finally {
      clearTimeout(tmo); clearTimeout(toWait); clearInterval(tick); evs.forEach((t) => removeEventListener(t, moved));
      st.busy = false; form.classList.remove('is-busy'); go.disabled = false; go.textContent = 'Roast my dog';
    }
  }
  form.addEventListener('submit', (e) => { e.preventDefault(); run(false); });
  nameIn.addEventListener('input', () => nameIn.closest('.field').classList.remove('is-err'));
  $('#roastAgain').addEventListener('click', () => { if (out.classList.contains('is-example')) { nameIn.focus(); return; } run(true); });
  $('#roastOut').addEventListener('change', (e) => { if (e.target.name !== 'roastPick') return; st.pick = +e.target.value; renderTag(); flip.reset(); mini.picked(); });
  const engrave = () => { const r = st.result; mini.hide(); S.loadRoast(r.items[st.pick].lines, r.shape, st.finish, r.name); };
  buyBtn.addEventListener('click', engrave);
  if (quickBtn) quickBtn.addEventListener('click', engrave);
  // Share = the same card prepCard() drew for this exact tag (shape, finish, all lines, the dog's photo).
  // iOS only allows navigator.share inside the tap, so when the picture is ready we call it with no await first.
  const shareText = (r) => `${r.name}: "${r.items[st.pick].lines.join(' ')}" ${matchLine(r)}. Roast yours: ${SITE}`;
  function deliver(blob, r) {
    const slug = r.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'dog';
    const file = new File([blob], `${slug}-roasted-salty-dog-tags.png`, { type: 'image/png' });
    if (canShareFiles) {
      return navigator.share({ files: [file], text: shareText(r) }).then(() => 'shared', (err) => {
        if (err && err.name === 'AbortError') return 'cancelled';
        if (err && err.name === 'NotAllowedError') return 'again'; // the tap expired while we waited
        return download(blob, file.name);
      });
    }
    return Promise.resolve(download(blob, file.name));
  }
  function download(blob, fname) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = fname;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    S.toast('Saved. Post it and tag @saltydogtagsco.');
    return 'downloaded';
  }
  shareBtn.addEventListener('click', async () => {
    const r = st.result; if (!r || st.example) return;
    if (st.cardBlob) { deliver(st.cardBlob, r).then((res) => { if (res === 'again') S.toast('Picture ready. Tap again to send it.'); }); return; }
    const span = shareBtn.querySelector('span'), label = span.textContent;
    span.textContent = 'Drawing the picture…'; shareBtn.disabled = true;
    let blob;
    try { blob = await (st.card || prepCard()); } catch { S.toast('Could not draw the picture. Try again.'); return; }
    finally { span.textContent = label; shareBtn.disabled = false; }
    if (st.result !== r) return;
    const res = await deliver(blob, r);
    if (res === 'again') S.toast('Picture ready. Tap again to send it.');
  });
  addEventListener('sdt:templates', () => { if (st.result) renderTag(); });

  // The example the section opens on: Whisky, so the flick works before anyone types a thing.
  st.result = normalize({
    description: VIBE_LINES.couch.split('{N}').join('Whisky'),
    matches: [[['Runs on', 'naps and spite.'], 94], [['Built like', 'a loaf.'], 81], [['Drool', 'happens.'], 77]].map(([l, score]) => ({ l1: l[0], l2: l[1], score })),
    custom: customFor('Whisky', 'couch'), shape: 'bone',
  }, 'Whisky');
  st.card = null;
  const first = () => { render(true); };
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { io.disconnect(); first(); } }, { rootMargin: '400px 0px' });
    io.observe(root);
  } else first();
})();
