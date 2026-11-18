/* Finder page script (/t/<id>). Same-origin only, no third parties, no cookies set, no storage. CSP default-src 'self'.
 *  - the scan beacon: POST /api/tag/scan once, only when the page is visible and at least 1 second old (this is what counts a scan)
 *  - "Message my family", "Share my location" (consent sheet first, then the browser prompt, then a typed-place fallback) */
(function () {
  'use strict';
  var root = document.querySelector('main.f');
  if (!root) return;
  var t = root.getAttribute('data-t') || '', n = root.getAttribute('data-n') || '', state = root.getAttribute('data-state');
  function post(path, extra) {
    var body = { t: t, n: n }; for (var k in extra) body[k] = extra[k];
    return fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), credentials: 'same-origin' })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { return { ok: r.ok, status: r.status, d: d }; }); });
  }
  var $ = function (s) { return root.querySelector(s); };

  // ---- beacon ----
  if (t && n && (state === 'claimed' || state === 'unclaimed') && root.getAttribute('data-beacon') !== '0') {
    var fired = false;
    var fire = function () { if (fired || document.visibilityState !== 'visible') return; fired = true; post('/api/tag/scan', {}).catch(function () {}); };
    setTimeout(function () {
      if (document.visibilityState === 'visible') fire();
      else document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') setTimeout(fire, 1000); });
    }, 1100);
  }

  function status(form, text, bad) { var s = form.querySelector('.f__status'); if (s) { s.textContent = text; s.className = 'f__status' + (bad ? ' is-bad' : ' is-ok'); } }

  // ---- message ----
  var msgBtn = $('[data-act="msg"]'), msgForm = $('[data-form="msg"]');
  if (msgBtn && msgForm) {
    msgBtn.addEventListener('click', function () { msgForm.hidden = false; msgBtn.hidden = true; var ta = msgForm.querySelector('textarea'); if (ta) ta.focus(); });
    msgForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var btn = msgForm.querySelector('button[type=submit]'); btn.disabled = true;
      post('/api/tag/message', { message: msgForm.message.value, reply: msgForm.reply.value, website: msgForm.website.value })
        .then(function (r) {
          if (r.ok && r.d.sent) { status(msgForm, 'Sent. Thank you for helping.'); msgForm.message.value = ''; }
          else { status(msgForm, (r.d && r.d.error) || 'Could not send. Please call the number on the back of the tag.', true); btn.disabled = false; }
        }).catch(function () { status(msgForm, 'Could not send. Please call the number on the back of the tag.', true); btn.disabled = false; });
    });
  }

  // ---- location ----
  var locBtn = $('[data-act="loc"]'), sheet = $('[data-sheet="loc"]'), placeForm = $('[data-form="place"]');
  function showPlace() { if (sheet) sheet.hidden = true; if (placeForm) { placeForm.hidden = false; var i = placeForm.querySelector('input'); if (i) i.focus(); } }
  if (locBtn && sheet) {
    var ver = (sheet.querySelector('[data-consent-ver]') || {}).getAttribute ? sheet.querySelector('[data-consent-ver]').getAttribute('data-consent-ver') : '';
    locBtn.addEventListener('click', function () { sheet.hidden = false; });
    sheet.querySelector('[data-act="loc-cancel"]').addEventListener('click', function () { sheet.hidden = true; });
    sheet.querySelector('[data-act="loc-go"]').addEventListener('click', function () {
      var go = sheet.querySelector('[data-act="loc-go"]'); go.disabled = true;
      if (!navigator.geolocation) { showPlace(); return; }
      navigator.geolocation.getCurrentPosition(function (p) {
        post('/api/tag/location', { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy, consent: ver }).then(function (r) {
          sheet.hidden = true; locBtn.textContent = r.ok ? 'Location sent. Thank you.' : 'Could not send location'; locBtn.disabled = r.ok;
          if (!r.ok) showPlace();
        }).catch(showPlace);
      }, function () { showPlace(); }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 });
    });
  }
  if (placeForm) placeForm.addEventListener('submit', function (e) {
    e.preventDefault();
    post('/api/tag/location', { place: placeForm.place.value }).then(function (r) {
      status(placeForm, r.ok ? 'Sent. Thank you.' : ((r.d && r.d.error) || 'Could not send.'), !r.ok);
    }).catch(function () { status(placeForm, 'Could not send.', true); });
  });
})();
