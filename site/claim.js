/* /claim: prefill from ?t= and ?c= (the claim QR on the packing slip), then POST /api/tag/claim. */
(function () {
  'use strict';
  var q = new URLSearchParams(location.search);
  var f = document.getElementById('claimForm'), msg = document.getElementById('claimMsg');
  if (!f) return;
  if (q.get('t')) f.t.value = q.get('t');
  if (q.get('c')) f.c.value = q.get('c');
  f.addEventListener('submit', function (e) {
    e.preventDefault();
    msg.className = 'm__msg'; msg.textContent = 'Sending...';
    var btn = f.querySelector('button'); btn.disabled = true;
    fetch('/api/tag/claim', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ t: f.t.value, c: f.c.value, email: f.email.value }) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (r) {
        msg.className = 'm__msg ' + (r.ok ? 'm__ok' : 'm__bad');
        msg.textContent = r.ok ? r.d.message : (r.d.error || 'Something went wrong. Try again.');
        btn.disabled = r.ok;
      }).catch(function () { msg.className = 'm__msg m__bad'; msg.textContent = 'Could not reach the server. Try again.'; btn.disabled = false; });
  });
})();
