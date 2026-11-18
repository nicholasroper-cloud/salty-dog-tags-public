/*
  SDTShare: self-contained share-card maker for Salty Dog Tags. No dependencies, no external images.

  API
    SDTShare.card({name, line1, line2, desc, adult}) -> Promise<Blob>
      Renders a 1080x1350 PNG (portrait, Instagram/Messages). name = dog's name, line1/line2 = engraved tag
      text, desc = the saying/roast shown under the tag, adult = true adds an "18+" badge.
      Uses Bungee / Archivo / DM Mono if the page loaded them (waits briefly via document.fonts), else system fonts.
    SDTShare.share(blob, text) -> Promise<'shared'|'downloaded'|'cancelled'>
      navigator.share with the PNG file when supported (canShare files); otherwise downloads
      saltydogtags-roast.png and copies `text` to the clipboard (best effort).
*/
(function () {
  var W = 1080, H = 1350;
  var DISPLAY = '"Bungee","Archivo Black",Impact,sans-serif', BODY = '"Archivo",system-ui,-apple-system,"Segoe UI",sans-serif', MONO = '"DM Mono",ui-monospace,Menlo,monospace';

  function loadFonts() {
    if (!document.fonts || !document.fonts.load) return Promise.resolve();
    var p = Promise.all(['40px Bungee', '700 30px Archivo', '30px "DM Mono"'].map(function (f) { return document.fonts.load(f).catch(function () {}); }));
    return Promise.race([p, new Promise(function (r) { setTimeout(r, 1500); })]);
  }
  function rr(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }
  function fit(c, text, font, maxW, start, min) { var s = start; do { c.font = font.replace('{s}', s); s -= 2; } while (c.measureText(text).width > maxW && s > min); return s + 2; }
  function wrap(c, text, maxW) {
    var words = String(text || '').split(/\s+/), lines = [], cur = '';
    words.forEach(function (w) { var t = cur ? cur + ' ' + w : w; if (c.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t; });
    if (cur) lines.push(cur); return lines;
  }

  function card(o) {
    o = o || {};
    return loadFonts().then(function () {
      var cv = document.createElement('canvas'); cv.width = W; cv.height = H; var c = cv.getContext('2d');
      // background
      var g = c.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#09010F'); g.addColorStop(.55, '#1A0B33'); g.addColorStop(1, '#2A0F4A');
      c.fillStyle = g; c.fillRect(0, 0, W, H);
      var sun = c.createRadialGradient(W / 2, 760, 20, W / 2, 760, 560); sun.addColorStop(0, 'rgba(255,60,172,.35)'); sun.addColorStop(1, 'rgba(255,60,172,0)');
      c.fillStyle = sun; c.fillRect(0, 0, W, H);
      // perspective grid
      c.strokeStyle = 'rgba(42,245,228,.35)'; c.lineWidth = 2; var hy = 1010;
      for (var i = -12; i <= 12; i++) { c.beginPath(); c.moveTo(W / 2 + i * 30, hy); c.lineTo(W / 2 + i * 150, H); c.stroke(); }
      for (var j = 0; j < 8; j++) { var y = hy + Math.pow(j / 8, 2) * (H - hy); c.beginPath(); c.moveTo(0, y); c.lineTo(W, y); c.stroke(); }
      c.textAlign = 'center'; c.textBaseline = 'alphabetic';
      // heading
      c.fillStyle = '#2AF5E4'; c.font = '500 30px ' + MONO; c.fillText('SALTY DOG TAGS', W / 2, 96);
      var name = String(o.name || 'Your dog').toUpperCase().slice(0, 24);
      c.shadowColor = '#FF3CAC'; c.shadowBlur = 28; c.fillStyle = '#FFF4FA';
      var ns = fit(c, name, '{s}px ' + DISPLAY, 900, 110, 48); c.font = ns + 'px ' + DISPLAY; c.fillText(name, W / 2, 230); c.shadowBlur = 0;
      // tag (bone shape)
      var tx = 120, ty = 330, tw = 840, th = 400, cy = ty + th / 2;
      c.save(); c.shadowColor = 'rgba(0,0,0,.6)'; c.shadowBlur = 40; c.shadowOffsetY = 20;
      var tg = c.createLinearGradient(0, ty, 0, ty + th); tg.addColorStop(0, '#EDF0F4'); tg.addColorStop(.5, '#B9C0C9'); tg.addColorStop(1, '#DDE1E6');
      c.fillStyle = tg; rr(c, tx + 60, ty + 40, tw - 120, th - 80, 40); c.fill();
      [[tx + 60, ty + 40], [tx + 60, ty + th - 40], [tx + tw - 60, ty + 40], [tx + tw - 60, ty + th - 40]].forEach(function (p) { c.beginPath(); c.arc(p[0] + (p[0] < W / 2 ? -10 : 10), p[1], 60, 0, 7); c.fill(); });
      c.restore();
      c.strokeStyle = 'rgba(255,255,255,.7)'; c.lineWidth = 3; rr(c, tx + 60, ty + 40, tw - 120, th - 80, 40); c.stroke();
      c.fillStyle = '#09010F'; c.beginPath(); c.arc(tx + 150, cy, 16, 0, 7); c.fill();
      // engraved text: highlight below, dark above
      var lines = [String(o.line1 || '').toUpperCase(), String(o.line2 || '').toUpperCase()].filter(Boolean); if (!lines.length) lines = [name];
      var ls = 999; lines.forEach(function (t) { ls = Math.min(ls, fit(c, t, '{s}px ' + DISPLAY, 560, 90, 30)); });
      var gap = ls * 1.15, y0 = cy - (lines.length - 1) * gap / 2 + ls * .35;
      lines.forEach(function (t, k) {
        c.font = ls + 'px ' + DISPLAY; var y = y0 + k * gap;
        c.fillStyle = 'rgba(255,255,255,.9)'; c.fillText(t, W / 2 + 60 + 2, y + 3);
        c.fillStyle = '#2B2F36'; c.fillText(t, W / 2 + 60, y);
      });
      // saying
      c.fillStyle = '#FFF4FA'; var fs = 44; c.font = '700 ' + fs + 'px ' + BODY;
      var dl = wrap(c, o.desc ? '"' + o.desc + '"' : '', 860); while (dl.length > 4 && fs > 28) { fs -= 2; c.font = '700 ' + fs + 'px ' + BODY; dl = wrap(c, '"' + o.desc + '"', 860); }
      dl.slice(0, 4).forEach(function (t, k) { c.fillText(t, W / 2, 830 + k * (fs * 1.3)); });
      if (o.adult) { c.fillStyle = '#FFD166'; c.font = '500 28px ' + MONO; c.fillText('18+ SALTY', W / 2, 800); }
      // CTA + footer
      c.fillStyle = '#FF3CAC'; rr(c, 300, 1110, 480, 90, 45); c.fill();
      c.fillStyle = '#09010F'; c.font = '30px ' + DISPLAY; c.fillText('ROAST YOUR DOG', W / 2, 1168);
      c.fillStyle = '#FFF4FA'; c.font = '500 30px ' + MONO; c.fillText('saltydogtags.com', W / 2, 1290);
      return new Promise(function (res, rej) { cv.toBlob(function (b) { b ? res(b) : rej(new Error('Could not render card')); }, 'image/png'); });
    });
  }

  function share(blob, text) {
    var file; try { file = new File([blob], 'saltydogtags-roast.png', { type: 'image/png' }); } catch (e) { file = null; }
    if (file && navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
      return navigator.share({ files: [file], text: text || '', title: 'Salty Dog Tags' }).then(function () { return 'shared'; }, function (e) { if (e && e.name === 'AbortError') return 'cancelled'; throw e; });
    }
    var a = document.createElement('a'), u = URL.createObjectURL(blob); a.href = u; a.download = 'saltydogtags-roast.png';
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(u); }, 4000);
    var cp = (text && navigator.clipboard && navigator.clipboard.writeText) ? navigator.clipboard.writeText(text).catch(function () {}) : Promise.resolve();
    return cp.then(function () { return 'downloaded'; });
  }

  window.SDTShare = { card: card, share: share };
})();
