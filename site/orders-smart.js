/* Salty Dog Tags: smart QR tag tools for the owner's orders page (site/orders.html).
 *  - tag badge and status column (Tollbooth task 8), "Mint QR id" button
 *  - QR layer for the LightBurn SVG export: qrOpts(tag) gives SDTLayout.svg() the QR group and the text fit (task 8)
 *  - packing slip print view with the claim QR and the claim code (task 8)
 *  - scan check: camera decode in the page, BarcodeDetector first, jsQR otherwise, then POST /api/tags/qc (task 10)
 * Classic script. orders.html calls SDTSmart.init() once with its helpers. Needs SDTQR (tag-qr.js) and SDTLayout.
 * The admin key never leaves the Authorization header; nothing here puts it in a URL. */
(function () {
  'use strict';
  let C = null;                       // context from orders.html: { key(), orders(), toast, esc, rerender, load }
  const statuses = {};                // tag id -> row from /api/tags/status
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const hdr = () => ({ authorization: 'Bearer ' + C.key(), 'content-type': 'application/json' });

  async function jfetch(url, init) {
    const r = await fetch(url, { ...init, headers: { ...hdr(), ...(init && init.headers) } });
    let d = {}; try { d = await r.json(); } catch { /* not json */ }
    if (r.status === 401) throw new Error('Wrong key.');
    if (!r.ok) { const e = new Error(d.error || ('Failed (' + r.status + ')')); e.data = d; e.status = r.status; throw e; }
    return d;
  }

  /* ---------- status column ---------- */
  const smartOf = (o) => (o.tags || []).map((t, i) => ({ t, i })).filter((x) => x.t && x.t.smart);
  async function refresh() {
    const ids = C.orders().filter((o) => smartOf(o).length).map((o) => o.id).slice(0, 60);
    if (!ids.length) return;
    try {
      const d = await jfetch('/api/tags/status?orders=' + encodeURIComponent(ids.join(',')));
      for (const k of Object.keys(statuses)) delete statuses[k];
      Object.assign(statuses, d.tags || {});
    } catch (e) { statuses.__error = e.message; }
    C.rerender();
  }
  const STATUS_LABEL = { issued: 'id issued', engraved: 'engraved, scan check due', qc_pass: 'QC passed', qc_fail: 'QC FAILED', shipped: 'shipped', claimed: 'claimed', disabled: 'disabled' };
  function badge(o, i, t) {
    if (!t.smart) return '';
    const id = t.smart.id, row = id ? statuses[id] : null;
    if (!id) return `<br><span class="meta"><span class="mach mach--qr">QR</span><b class="warnflag">no QR id yet</b> (D1 was unreachable at order time)</span>`;
    const st = row ? row.status : null;
    const tail = row ? [row.qc_decode_at ? 'camera OK' : 'camera not checked', row.native_scan_seen_at ? 'phone scan seen' : 'phone scan not seen', row.scans ? row.scans + ' scan' + (row.scans > 1 ? 's' : '') : ''].filter(Boolean).join(' · ') : (statuses.__error ? esc(statuses.__error) : 'status loading');
    return `<br><span class="meta"><span class="mach mach--qr">QR ${esc(id.slice(0, 4))}&hellip;</span><b class="${st === 'qc_fail' ? 'warnflag' : ''}">${esc(STATUS_LABEL[st] || st || '?')}</b> &middot; ${tail}${row && row.qc_fail_note ? ' &middot; ' + esc(row.qc_fail_note) : ''}</span>`;
  }
  function actions(o) {
    const sm = smartOf(o);
    if (!sm.length || o.status === 'cancelled') return '';
    const out = [];
    for (const { t, i } of sm) {
      if (!t.smart.id) out.push(`<button class="btn btn--solid" data-smart="mint">Mint QR id · tag ${i + 1}</button>`);
      else out.push(`<button class="btn btn--ghost" data-smart="qc" data-i="${i}">Scan check · tag ${i + 1}</button>`);
    }
    if (sm.some((x) => x.t.smart.id)) out.push(`<button class="btn btn--ghost" data-smart="slip">Print slip${sm.length > 1 ? 's' : ''}</button>`);
    return out.join('');
  }

  /* ---------- export: the QR for SDTLayout.svg ---------- */
  // Returns the opts.qr object for the back side of a smart tag, or null for a normal tag. Throws when the tag has no id.
  function qrOpts(t) {
    if (!t || !t.smart) return null;
    if (!t.smart.id) throw new Error('This tag has no QR id yet. Tap "Mint QR id" first.');
    const sm = t.smart, base = typeof sm.url === 'string' && sm.url.length > 10 ? sm.url.slice(0, sm.url.length - 10) : undefined;
    const p = SDTQR.planTag({ shape: t.shape, finish: t.finish, font: t.font, back: t.back }, { id: sm.id, base, fixed: { ecl: sm.ecl, mm: sm.mm, q: sm.q, x: sm.x, y: sm.y } });
    if (!p.ok) throw new Error('The stored QR placement does not fit this tag any more. Lay it out by hand.');
    if (!SDTQR.verify(p.plan, sm.id, { base }).ok) throw new Error('The QR would run too close to the edge or the hole. Lay it out by hand.');
    if (sm.url && sm.url !== p.plan.payload) throw new Error('The stored QR payload does not match its id. Do not engrave.');
    return SDTQR.layoutOpts(p.plan, sm.id, { base });
  }

  /* ---------- packing slip ---------- */
  function qrSvg(text) {
    const e = SDTQR.encode(text, 'M'), n = e.size, q = 4, S = n + 2 * q;
    const d = SDTQR.runs(e.modules, 1, 0).map((r) => `M${r.x + q} ${r.y + q}h${r.w}v${r.h}h${-r.w}z`).join('');
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${S} ${S}" role="img" aria-label="Claim QR code"><rect width="${S}" height="${S}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
  }
  function slipHtml(data) {
    const pages = data.slips.map((s) => `<section class="slip">
  <h1>${esc(s.dog || 'Your dog')}&rsquo;s tag</h1>
  <p class="sub">Order ${esc(data.orderId)}${s.qty > 1 ? ' &middot; ' + s.qty + ' tags share this one page' : ''}. Your tag has a scan-to-find QR on the back. Turn it on in 3 steps.</p>
  <div class="slip__grid">
    <div class="slip__qr">${qrSvg(s.claimUrl)}</div>
    <div>
      <div>Your activation code</div>
      <div class="slip__code">${esc(s.code)}</div>
      <div class="slip__url">${esc(s.url)}</div>
    </div>
  </div>
  <ol>
    <li><b>Scan the square above</b> with your phone camera (or go to <b>saltydogtags.com/claim</b> and type the code).</li>
    <li><b>Enter your email.</b> We send a sign-in link, no password. Add the people who should get an email when someone scans the tag.</li>
    <li><b>Scan the tag itself</b> once and tap &ldquo;Send a test alert&rdquo; to see how it works.</li>
  </ol>
  <p class="fine">The phone number is engraved on the tag too, because a QR needs signal. Keep this page; it has your code. We will never ask you for money or a code by text or call. Questions: hello@saltydogtags.com</p>
</section>`).join('');
    return `<!doctype html><meta charset="utf-8"><title>${esc(data.orderId)} packing slips</title><link rel="stylesheet" href="${location.origin}/slip.css"><div class="noprint">Print at <b>100%</b>, one page per tag. ${data.slips.length} slip${data.slips.length === 1 ? '' : 's'} for ${esc(data.orderId)}.</div>${pages}`;
  }
  async function openSlip(o) {
    const w = window.open('', '_blank');           // Safari only allows this inside the click, so open first and fill after the fetch
    if (!w) { C.toast('Allow pop-ups to open the slip.'); return; }
    try {
      const d = await jfetch('/api/tags/slip?order=' + encodeURIComponent(o.id));
      if (!d.slips.length) { w.close(); C.toast('No smart tags to print on that order.'); return; }
      w.document.write(slipHtml(d)); w.document.close();
    } catch (e) { w.close(); C.toast('Slip failed: ' + e.message); }
  }

  /* ---------- scan check (task 10) ---------- */
  let jsqrPromise = null;
  function loadJsQR() {
    if (typeof window.jsQR === 'function') return Promise.resolve(window.jsQR);
    return (jsqrPromise ||= new Promise((res, rej) => { const s = document.createElement('script'); s.src = '/vendor/jsqr.js'; s.onload = () => res(window.jsQR); s.onerror = () => rej(new Error('Could not load the QR reader.')); document.head.appendChild(s); }));
  }
  let detector = null;
  // Decodes one frame. source: canvas or video or ImageBitmap for BarcodeDetector; ImageData for the jsQR path.
  async function decode(canvas) {
    if (typeof window.BarcodeDetector === 'function') {
      try {
        detector ||= new window.BarcodeDetector({ formats: ['qr_code'] });
        const r = await detector.detect(canvas);
        if (r && r[0] && r[0].rawValue) return { text: r[0].rawValue, via: 'BarcodeDetector' };
      } catch { /* fall through to jsQR */ }
    }
    const jsQR = await loadJsQR();
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const r = jsQR(img.data, img.width, img.height, { inversionAttempts: 'attemptBoth' });
    return r ? { text: r.data, via: 'jsQR' } : null;
  }
  // The comparison the ship gate rests on: the decoded text must equal the tag's payload EXACTLY (the server repeats it).
  const matches = (decoded, payload) => typeof decoded === 'string' && decoded === payload;

  let dlg = null, stream = null, raf = 0, active = null;
  function stopCamera() { cancelAnimationFrame(raf); raf = 0; if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; } }
  function ensureDialog() {
    if (dlg) return dlg;
    dlg = document.createElement('dialog');
    dlg.id = 'qcDlg';
    dlg.style.cssText = 'max-width:34rem;width:calc(100% - 1.5rem);border:1.5px solid var(--line-2,#444);border-radius:16px;background:var(--paper,#1b1530);color:var(--text,#fff);padding:1rem 1.1rem';
    dlg.innerHTML = `<h3 style="margin:0 0 .4rem">Scan check</h3>
      <p class="meta" id="qcWho" style="margin:0 0 .6rem"></p>
      <video id="qcVideo" playsinline muted style="width:100%;max-height:44vh;background:#000;border-radius:12px;display:none"></video>
      <canvas id="qcCanvas" hidden></canvas>
      <ol class="meta" style="margin:.6rem 0;padding-left:1.1rem;line-height:1.7">
        <li>Camera decode: <b id="qcDec">waiting</b></li>
        <li>Phone camera: scan the tag with the iPhone camera and open the link once. <b id="qcNat">waiting</b></li>
      </ol>
      <p class="ship__err" id="qcErr" role="alert" style="min-height:1.2em"></p>
      <div class="acts" style="margin:0">
        <button class="btn btn--solid" id="qcStart" type="button">Start camera</button>
        <label class="btn btn--ghost ship__file" style="min-height:40px">Check a photo<input id="qcFile" type="file" accept="image/*" capture="environment"></label>
        <button class="btn btn--ghost" id="qcFail" type="button">Mark QC failed</button>
        <button class="btn btn--ghost" id="qcClose" type="button">Close</button>
      </div>`;
    document.body.appendChild(dlg);
    dlg.addEventListener('close', () => { stopCamera(); active = null; });
    dlg.querySelector('#qcClose').addEventListener('click', () => dlg.close());
    dlg.querySelector('#qcStart').addEventListener('click', startCamera);
    dlg.querySelector('#qcFile').addEventListener('change', (e) => { const f = e.target.files && e.target.files[0]; if (f) checkFile(f); e.target.value = ''; });
    dlg.querySelector('#qcFail').addEventListener('click', markFail);
    return dlg;
  }
  const say = (id, text, cls) => { const el = dlg.querySelector(id); el.textContent = text; el.style.color = cls === 'ok' ? 'var(--lime,#9f9)' : cls === 'bad' ? 'var(--magenta-2,#f69)' : ''; };
  async function submit(text) {
    if (!active) return false;
    if (!matches(text, active.payload)) { say('#qcDec', 'MISMATCH', 'bad'); dlg.querySelector('#qcErr').textContent = `Scanned "${text}" but this tag should say "${active.payload}".`; return false; }
    dlg.querySelector('#qcErr').textContent = '';
    try {
      const r = await jfetch('/api/tags/qc', { method: 'POST', body: JSON.stringify({ id: active.id, decodedText: text }) });
      say('#qcDec', 'matches the payload', 'ok');
      say('#qcNat', r.nativeScan ? 'seen' : 'waiting', r.nativeScan ? 'ok' : '');
      if (r.status === 'qc_pass') say('#qcNat', 'seen. QC PASSED', 'ok');
      pollNative();
      refresh();
      return true;
    } catch (e) { dlg.querySelector('#qcErr').textContent = e.message; return false; }
  }
  let pollT = 0;
  function pollNative() {
    clearTimeout(pollT);
    if (!active || !dlg.open) return;
    pollT = setTimeout(async () => {
      try {
        const d = await jfetch('/api/tags/status?orders=' + encodeURIComponent(active.orderId));
        const row = (d.tags || {})[active.id];
        if (row) { Object.assign(statuses, d.tags); if (row.native_scan_seen_at) { say('#qcNat', row.status === 'qc_pass' ? 'seen. QC PASSED' : 'seen', 'ok'); C.rerender(); return; } }
      } catch { /* keep trying */ }
      pollNative();
    }, 3000);
  }
  async function startCamera() {
    const v = dlg.querySelector('#qcVideo'), cv = dlg.querySelector('#qcCanvas');
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 } }, audio: false });
    } catch (e) { dlg.querySelector('#qcErr').textContent = 'Camera not available (' + (e && e.name) + '). Use "Check a photo" instead.'; return; }
    v.srcObject = stream; v.style.display = 'block'; await v.play().catch(() => {});
    let busy = false;
    const tick = async () => {
      raf = requestAnimationFrame(() => { setTimeout(tick, 150); });   // about 6 fps is plenty
      if (busy || !v.videoWidth) return;
      busy = true;
      try {
        cv.width = v.videoWidth; cv.height = v.videoHeight;
        cv.getContext('2d', { willReadFrequently: true }).drawImage(v, 0, 0);
        const r = await decode(cv);
        if (r && (await submit(r.text))) { stopCamera(); v.style.display = 'none'; }
      } catch { /* next frame */ } finally { busy = false; }
    };
    tick();
  }
  async function checkFile(file) {
    const cv = dlg.querySelector('#qcCanvas');
    try {
      const bmp = await createImageBitmap(file);
      const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
      cv.width = Math.round(bmp.width * scale); cv.height = Math.round(bmp.height * scale);
      cv.getContext('2d', { willReadFrequently: true }).drawImage(bmp, 0, 0, cv.width, cv.height);
      const r = await decode(cv);
      if (!r) { dlg.querySelector('#qcErr').textContent = 'No QR found in that photo. Get closer, or hold it flatter.'; say('#qcDec', 'not read', 'bad'); return; }
      await submit(r.text);
    } catch (e) { dlg.querySelector('#qcErr').textContent = 'Could not read that photo: ' + e.message; }
  }
  async function markFail() {
    if (!active) return;
    const note = prompt('What was wrong? (soft edges, did not scan, wrong place...)', '');
    if (note === null) return;
    try { await jfetch('/api/tags/qc', { method: 'POST', body: JSON.stringify({ id: active.id, fail: true, note }) }); say('#qcDec', 'FAILED', 'bad'); C.toast('QC failed. Re-engrave the same id on a new blank and destroy the bad one.'); refresh(); }
    catch (e) { dlg.querySelector('#qcErr').textContent = e.message; }
  }
  function openQc(o, i) {
    const t = o.tags[i]; if (!t || !t.smart || !t.smart.id) return;
    ensureDialog();
    active = { id: t.smart.id, orderId: o.id, payload: t.smart.url };
    dlg.querySelector('#qcWho').innerHTML = `${esc(o.id)} &middot; tag ${i + 1} &middot; <b>${esc(t.smart.id)}</b><br>Expected: <code>${esc(t.smart.url)}</code>`;
    say('#qcDec', 'waiting'); say('#qcNat', 'waiting'); dlg.querySelector('#qcErr').textContent = '';
    const row = statuses[t.smart.id];
    if (row && row.qc_decode_at) say('#qcDec', 'matches the payload', 'ok');
    if (row && row.native_scan_seen_at) say('#qcNat', 'seen', 'ok');
    dlg.querySelector('#qcVideo').style.display = 'none';
    dlg.showModal(); pollNative();
  }

  /* ---------- button dispatch ---------- */
  async function handle(btn, o) {
    const what = btn.dataset.smart;
    if (what === 'slip') return openSlip(o);
    if (what === 'qc') return openQc(o, +btn.dataset.i);
    if (what === 'mint') {
      btn.disabled = true;
      try { const d = await jfetch('/api/tags/mint', { method: 'POST', body: JSON.stringify({ orderId: o.id }) }); Object.assign(o, d.order); C.toast('QR id minted.'); }
      catch (e) { C.toast('Mint failed: ' + e.message); }
      btn.disabled = false; C.rerender(); refresh();
    }
  }
  // Ship / status changes the server refuses with blockers (409): ask, and retry with the override. Returns true when handled.
  function askOverride(err) {
    const b = err && err.data && err.data.blockers;
    if (!b || !b.length) return false;
    return confirm('Smart tags are not QC passed:\n\n- ' + b.join('\n- ') + '\n\nShip anyway? (The override is recorded on the order.)');
  }

  window.SDTSmart = { init(ctx) { C = ctx; }, refresh, badge, actions, qrOpts, handle, askOverride, decode, matches, qrSvg, slipHtml, statuses, _jfetch: jfetch };
})();
