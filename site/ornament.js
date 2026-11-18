/* Salty Dog Tags: /ornament/ page logic. Runs on top of app.js (window.SDT): the preview renderers, the photo/art pipeline
   (processArt: 1.5 MB cap, resolution check), and the shared cart. Prices come from SDT.cfg.PRICES (mirrors functions/api/_lib.js);
   the server prices the order again and ignores anything the browser says about money. No dependencies. */
(function () {
  'use strict';
  const SDT = window.SDT;
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  if (!SDT || !SDT.cfg || !$('#ornForm')) return;
  const cfg = SDT.cfg;
  const money = (n) => '$' + (Math.round(n * 100) / 100).toFixed(2).replace(/\.00$/, '');
  const st = { tier: 'acrylic', art: 'design', style: 'photo', img: null, imgName: '', w: 0, h: 0, svg: false, ack: false, safe: true, raised: false, qty: 1 };
  const needsImage = () => st.tier === 'stainless' || st.art === 'upload' || Boolean((cfg.ART_STYLES[st.style] || {}).needsImage);
  const nameVal = () => $('#oName').value.replace(/\s+/g, ' ').trim();
  const yearVal = () => $('#oYear').value.trim();
  const unit = () => cfg.PRICES.ornament[st.tier] / 100 + (st.tier === 'acrylic' && !cfg.ORNAMENT_RAISED_INCLUDED && st.raised ? cfg.PRICES.raisedCents / 100 : 0);

  function setErr(id, msg) {
    const el = $('#' + id); if (!el) return;
    const field = el.closest('.field'); if (!field) return;
    let p = $('#' + id + 'Err') || field.querySelector('.err');
    if (!p) { p = document.createElement('p'); p.className = 'err'; p.id = id + 'Err'; field.appendChild(p); }
    if (msg) p.textContent = msg;
    field.classList.add('is-err'); el.setAttribute('aria-invalid', 'true');
  }
  function clearErr(id) { const el = $('#' + id); if (!el) return; const f = el.closest('.field'); if (f) f.classList.remove('is-err'); el.removeAttribute('aria-invalid'); }

  // Sample previews (tier cards, hero): synthetic, labelled "Preview" on the page.
  function renderSamples() {
    $('#ornHeroArt').innerHTML = SDT.tagSVGFullcolor({ shape: 'round', ornament: true, lines: ['Whisky', '2026'], font: 'bungee', art: 'design', style: 'synthwave', raised: true });
    $('#tierArt-acrylic').innerHTML = SDT.tagSVGFullcolor({ shape: 'round', ornament: true, lines: ['Whisky', '2026'], font: 'bungee', art: 'design', style: 'photo', raised: true });
    $('#tierArt-stainless').innerHTML = SDT.tagSVG({ shape: 'bone', finish: 'polished', photo: true, photoData: null, lines: [] });
  }

  function build() {
    $('#oArtMode').innerHTML = [['design', 'We design it'], ['upload', 'Upload your own']].map(([k, n]) => `<label class="opt"><input type="radio" name="oart" value="${k}"><span>${n}</span></label>`).join('');
    $('#oStyle').innerHTML = Object.entries(cfg.ART_STYLES).map(([k, s]) => `<label class="opt"><input type="radio" name="ostyle" value="${k}"><span>${esc(s.n)}<i class="dim">${esc(s.d)}</i></span></label>`).join('');
    $('#oAckTxt').innerHTML = SDT.ackHtml(cfg.ART_ACK_TEXT);
    $$('[data-review-note]').forEach((el) => { el.textContent = cfg.ART_REVIEW_NOTE; });
    if (!cfg.ORNAMENT_RAISED_INCLUDED) $('#oRaisedPrice').textContent = '+' + money(cfg.PRICES.raisedCents / 100);
  }

  function render() {
    const acrylic = st.tier === 'acrylic', needs = needsImage();
    $$('input[name=tier]').forEach((r) => { r.checked = r.value === st.tier; });
    $('#oArtField').hidden = !acrylic;
    $$('input[name=oart]').forEach((r) => { r.checked = r.value === st.art; });
    $$('input[name=ostyle]').forEach((r) => { r.checked = r.value === st.style; });
    $('#oDesign').hidden = !acrylic || st.art !== 'design';
    $('#oUploadBox').hidden = !needs;
    $('#oFileTxt').textContent = st.img ? 'Change image' : (acrylic && st.art === 'upload' ? 'Choose a photo or artwork' : 'Choose your dog photo');
    $('#oHelp').textContent = !acrylic ? 'One photo (JPG or PNG, at least 600 px on the short side). The laser engraves it in grayscale.'
      : st.art === 'upload' ? 'PNG, JPG or SVG, up to 1.5 MB. It fills the ornament: keep what matters inside the dashed line.' : 'This style uses your dog photo. JPG or PNG.';
    $('#oSafeRow').hidden = !(acrylic && st.art === 'upload');
    $('#oSafe').checked = st.safe;
    $('#oAckField').hidden = !needs;
    $('#oAck').checked = st.ack;
    $('#oRaisedField').hidden = !(acrylic && !cfg.ORNAMENT_RAISED_INCLUDED);
    $('#oRaised').checked = st.raised;
    const th = $('#oThumb'); if (st.img) { th.src = st.img; th.hidden = false; } else { th.removeAttribute('src'); th.hidden = true; }
    $('#oQty').textContent = st.qty;
    $('#oPrice').innerHTML = money(unit() * st.qty) + `<small>${st.qty} &times; ${money(unit())} &middot; ${acrylic ? 'printed acrylic' : 'engraved stainless'}${st.tier === 'stainless' ? ' &middot; +' + money((cfg.PRICES.ornament.stainless - cfg.PRICES.ornament.acrylic) / 100) + ' over the acrylic' : ''}</small>`;
    const lines = [nameVal() || 'Whisky', yearVal() || '2026'];
    if (acrylic) {
      $('#oPrev').innerHTML = `<div class="one">${SDT.tagSVGFullcolor({ shape: 'round', ornament: true, lines, font: 'bungee', art: st.art, style: st.style, imgData: st.img, raised: cfg.ORNAMENT_RAISED_INCLUDED || st.raised, showSafe: st.safe })}</div><span class="side">Preview: printed in full color, name and year raised</span>`;
    } else {
      const front = SDT.tagSVG({ shape: 'bone', finish: 'polished', photo: true, photoData: st.svg ? null : st.img, lines: [] });
      const back = SDT.tagSVG({ shape: 'bone', finish: 'polished', lines });
      $('#oPrev').innerHTML = `<div class="two"><div><div style="filter:grayscale(1)">${front}</div><span class="side">Front, engraved in grayscale</span></div><div>${back}<span class="side">Back</span></div></div>`;
    }
  }

  function init() {
    build(); renderSamples(); render();
    const form = $('#ornForm');
    form.addEventListener('change', (e) => {
      const t = e.target;
      if (t.name === 'tier') st.tier = t.value;
      else if (t.name === 'oart') st.art = t.value;
      else if (t.name === 'ostyle') st.style = t.value;
      else if (t.id === 'oSafe') st.safe = t.checked;
      else if (t.id === 'oAck') { st.ack = t.checked; clearErr('oAck'); }
      else if (t.id === 'oRaised') st.raised = t.checked;
      render();
    });
    form.addEventListener('input', (e) => {
      if (e.target.type !== 'text') return; // checkboxes and radios are handled on 'change' (render() would undo the click here)
      if (e.target.id === 'oName') { $('#oNameCnt').textContent = e.target.value.length + '/24'; clearErr('oName'); }
      if (e.target.id === 'oYear') clearErr('oYear');
      render();
    });
    $$('.count button', form).forEach((b) => b.addEventListener('click', () => { st.qty = Math.min(20, Math.max(1, st.qty + +b.dataset.d)); render(); }));
    $('#oFile').addEventListener('change', async (e) => {
      const file = e.target.files && e.target.files[0]; if (!file) return;
      const status = $('#oStatus'); status.className = 'note'; status.textContent = 'Reading image…';
      try {
        const r = await SDT.processArt(file);
        Object.assign(st, { img: r.dataUrl, imgName: file.name, w: r.w, h: r.h, svg: r.svg });
        clearErr('oFile');
        status.textContent = `Loaded ${file.name}.` + (r.warn ? ' ' + r.warn : '');
        if (r.warn) status.classList.add('note--warn');
      } catch (err) {
        Object.assign(st, { img: null, imgName: '', w: 0, h: 0, svg: false });
        status.className = 'note note--err'; status.textContent = err.message || 'Could not use that image.'; e.target.value = '';
      }
      render();
    });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      ['oName', 'oYear', 'oFile', 'oAck'].forEach(clearErr);
      const msg = $('#oMsg'); msg.className = 'msg orn-msg'; msg.textContent = '';
      const bad = [];
      if (!nameVal()) bad.push(['oName', 'Add the dog’s name.']);
      else if (nameVal().length > 24) bad.push(['oName', 'The name is 24 characters at most.']);
      if (!/^20\d\d$/.test(yearVal())) bad.push(['oYear', 'Four digits, like 2026.']);
      if (needsImage()) {
        if (!st.img) bad.push(['oFile', st.tier === 'stainless' || st.art !== 'upload' ? 'Upload your dog photo.' : 'Upload a photo or finished artwork.']);
        else if (st.tier === 'stainless' && st.svg) bad.push(['oFile', 'The engraved ornament needs a photo (JPG or PNG), not an SVG.']);
        else if (st.tier === 'stainless' && Math.min(st.w, st.h) < 600) bad.push(['oFile', 'That photo is too small to engrave well. Use one at least 600 px on the short side, or pick the printed acrylic.']);
        else if (!st.ack) bad.push(['oAck', 'Tick the box to confirm you own the image or have permission to use it.']);
      }
      if (bad.length) {
        bad.forEach(([id, m]) => setErr(id, m));
        msg.className = 'msg msg--bad is-on'; msg.textContent = bad[0][1];
        const first = $('#' + bad[0][0]); if (first) first.focus();
        return;
      }
      const res = SDT.addOrnament({ tier: st.tier, oname: nameVal(), year: yearVal(), qty: st.qty, art: st.tier === 'stainless' ? 'upload' : st.art, style: st.style, raised: st.raised, photoData: needsImage() ? st.img : null, photoName: st.imgName, ack: needsImage() ? st.ack : false });
      if (!res.ok) { msg.className = 'msg msg--bad is-on'; msg.textContent = res.error; return; }
      if (!res.saved) { msg.className = 'msg msg--bad is-on'; msg.textContent = 'That image is too big to carry to checkout. Try a smaller image.'; return; }
      msg.className = 'msg msg--ok is-on'; msg.textContent = 'Added. Taking you to your order…';
      location.href = '/#order';
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
