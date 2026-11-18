/* /my: the owner dashboard. Everything a finder typed (messages, places) is written with textContent only, never innerHTML.
 * Talks to /api/my/<action> (functions/api/my/[action].js) and /api/auth/start. No third-party scripts. */
(function () {
  'use strict';
  var app = document.getElementById('app');
  var state = null;

  function el(tag, attrs, kids) {
    var e = document.createElement(tag);
    for (var k in (attrs || {})) {
      if (k === 'class') e.className = attrs[k]; else if (k === 'text') e.textContent = attrs[k];
      else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] === true) e.setAttribute(k, ''); else if (attrs[k] !== false && attrs[k] != null) e.setAttribute(k, attrs[k]);
    }
    (kids || []).forEach(function (c) { if (c != null) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return e;
  }
  function api(action, body) {
    var init = body === undefined ? { method: 'GET' } : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
    return fetch('/api/my/' + action, init).then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { return { ok: r.ok, status: r.status, d: d }; }); });
  }
  function say(node, text, bad) { node.textContent = text; node.className = 'm__msg ' + (bad ? 'm__bad' : 'm__ok'); }
  function field(label, input, id) { input.id = id; return el('div', {}, [el('label', { for: id, text: label }), input]); }
  var when = function (t, tz) { try { return new Intl.DateTimeFormat('en-US', { timeZone: tz, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(t)); } catch (e) { return new Date(t).toLocaleString(); } };

  /* ---- signed out ---- */
  function signIn() {
    app.textContent = '';
    var msg = el('p', { class: 'm__msg', role: 'status', 'aria-live': 'polite' });
    var email = el('input', { type: 'email', autocomplete: 'email', placeholder: 'you@example.com' });
    var form = el('form', { class: 'm__card', onsubmit: function (e) {
      e.preventDefault();
      fetch('/api/auth/start', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: email.value }) })
        .then(function (r) { return r.json().then(function (d) { say(msg, d.message || d.error || 'Done.', !r.ok); }); })
        .catch(function () { say(msg, 'Could not reach the server.', true); });
    } }, [field('Your email', email, 'siEmail'), el('button', { class: 'm__btn m__btn--solid', type: 'submit', text: 'Send my sign-in link' }), msg,
      el('p', { class: 'm__fine', text: 'We email a one-time link, no password. Your tag not activated yet? Go to /claim with the code from the packing slip.' })]);
    app.appendChild(el('h1', { text: 'My tags' })); app.appendChild(form);
    app.appendChild(el('p', { class: 'm__fine' }, [el('a', { href: '/claim', text: 'Activate a new tag' })]));
  }

  /* ---- one contact ---- */
  function contactForm(tag, slot, c) {
    c = c || {};
    var msg = el('p', { class: 'm__msg', role: 'status', 'aria-live': 'polite' });
    var id = 'c' + tag.id + slot;
    var label = el('input', { type: 'text', maxlength: 30, value: c.label || (slot === 1 ? 'Me' : 'Family member') });
    var phone = el('input', { type: 'tel', autocomplete: 'tel', inputmode: 'tel', value: c.phone_e164 || '', placeholder: '435-555-0123' });
    var email = el('input', { type: 'email', autocomplete: 'email', value: c.email || '' });
    var emailOn = el('input', { type: 'checkbox' }); emailOn.checked = c.id ? Boolean(c.email_on) : true;
    var smsOn = el('input', { type: 'checkbox' }); smsOn.checked = Boolean(c.sms_on);
    var consent = el('input', { type: 'checkbox' }); consent.checked = Boolean(c.sms_on);   // a saved opt-in stays ticked; the server stores the versioned text and hash at the first tick
    var consentBox = el('label', { class: 'm__chk' }, [consent, el('span', { text: state.sms.text })]);
    var verifyBox = el('div');
    function refreshVerify() {
      verifyBox.textContent = '';
      if (!c.id || !c.sms_on || !c.phone_e164) return;
      if (c.sms_stopped_at) { verifyBox.appendChild(el('p', { class: 'm__fine m__bad', text: 'This number replied STOP. Reply START from that phone to turn texts back on. Email alerts still work.' })); return; }
      if (c.sms_verified_at) { verifyBox.appendChild(el('p', { class: 'm__fine m__ok', text: 'Text alerts are on for this number.' })); return; }
      var out = el('p', { class: 'm__msg', role: 'status' });
      var code = el('input', { type: 'text', inputmode: 'numeric', maxlength: 6, placeholder: '6 digit code', autocomplete: 'one-time-code' });
      verifyBox.appendChild(el('p', { class: 'm__fine', text: slot === 2 ? 'This person must reply YES to the text we send before they get alerts.' : 'We text a 6 digit code to confirm the number is yours.' }));
      verifyBox.appendChild(el('button', { class: 'm__btn', type: 'button', text: slot === 2 ? 'Send the YES text' : 'Text me a code', onclick: function () {
        api('sms-send', { contact_id: c.id }).then(function (r) { say(out, r.ok ? (slot === 2 ? 'Sent. Ask them to reply YES.' : 'Sent. Type the code below.') : (r.d.error || 'Could not send.'), !r.ok); });
      } }));
      if (slot === 1) {
        verifyBox.appendChild(code);
        verifyBox.appendChild(el('button', { class: 'm__btn m__btn--solid', type: 'button', text: 'Confirm code', onclick: function () {
          api('sms-verify', { contact_id: c.id, code: code.value }).then(function (r) { if (r.ok) load(); else say(out, r.d.error || 'Not right.', true); });
        } }));
      }
      verifyBox.appendChild(out);
    }
    refreshVerify();
    function sync() { consentBox.style.display = smsOn.checked ? '' : 'none'; }
    smsOn.addEventListener('change', sync); sync();
    return el('form', { class: 'm__card', onsubmit: function (e) {
      e.preventDefault();
      api('contact', { tag_id: tag.id, slot: slot, label: label.value, phone: phone.value, email: email.value, email_on: emailOn.checked, sms_on: smsOn.checked,
        consent: { checked: consent.checked, ver: state.sms.version } }).then(function (r) { if (r.ok) load(); else say(msg, r.d.error || 'Could not save.', true); });
    } }, [
      el('h2', { text: slot === 1 ? 'Contact 1' : 'Contact 2' }),
      field('Name', label, id + 'l'),
      el('div', { class: 'row' }, [field('Phone (for texts)', phone, id + 'p'), field('Email', email, id + 'e')]),
      el('label', { class: 'm__chk' }, [emailOn, el('span', { text: 'Send email alerts' })]),
      state.sms.enabled ? el('label', { class: 'm__chk' }, [smsOn, el('span', { text: 'Send text alerts to this phone' })]) : el('p', { class: 'm__fine', text: 'Text alerts are switched off right now. Email alerts still work.' }),
      state.sms.enabled ? consentBox : null,
      el('button', { class: 'm__btn m__btn--solid', type: 'submit', text: 'Save contact' }), msg, verifyBox
    ]);
  }

  /* ---- one tag ---- */
  function tagCard(t) {
    var tz = state.owner.tz;
    var msg = el('p', { class: 'm__msg', role: 'status', 'aria-live': 'polite' });
    var dog = el('input', { type: 'text', maxlength: 40, value: t.dog_name || '' });
    var note = el('textarea', { maxlength: 200, rows: 3, placeholder: 'e.g. Whisky is friendly but shy. He needs his medicine at 6.' }); note.value = t.message || '';
    var show = el('input', { type: 'checkbox' }); show.checked = Boolean(t.show_phone);
    var pause = el('select', {}, [['none', 'Alerts on'], ['1h', 'Pause for 1 hour'], ['24h', 'Pause for 24 hours'], ['off', 'Turn alerts off']].map(function (o) { return el('option', { value: o[0], text: o[1] }); }));
    if (t.paused) pause.value = t.paused > Date.now() + 365 * 86400e3 ? 'off' : '24h';
    var c1 = (t.contacts || []).filter(function (c) { return c.slot === 1; })[0], c2 = (t.contacts || []).filter(function (c) { return c.slot === 2; })[0];
    var act = el('div', {}, (t.activity || []).length ? t.activity.map(function (s) {
      var line = when(s.at, tz) + ' · ' + (s.kind === 'scan' ? 'scanned' : s.kind === 'location' ? 'location shared' : 'message');
      var parts = [el('strong', { text: line })];
      if (s.kind === 'location' && s.lat != null) parts.push(el('div', {}, [el('a', { href: 'https://maps.apple.com/?ll=' + s.lat.toFixed(5) + ',' + s.lng.toFixed(5), rel: 'noopener noreferrer', text: 'Apple Maps' }), ' · ', el('a', { href: 'https://www.google.com/maps/search/?api=1&query=' + s.lat.toFixed(5) + ',' + s.lng.toFixed(5), rel: 'noopener noreferrer', text: 'Google Maps' }), s.accuracy_m ? ' · within ' + Math.round(s.accuracy_m) + ' m' : '']));
      if (s.place_text) parts.push(el('div', { text: 'Typed: ' + s.place_text }));
      if (s.message) parts.push(el('div', { text: s.message }));
      if (s.finder_reply) parts.push(el('div', { text: 'How to reach them: ' + s.finder_reply }));
      var keep = el('button', { class: 'm__btn', type: 'button', text: s.keep ? 'Kept (tap to release)' : 'Keep', onclick: function () { api('pin', { scan_id: s.id, keep: !s.keep }).then(function (r) { if (r.ok) load(); else say(msg, r.d.error || 'Could not.', true); }); } });
      parts.push(keep);
      return el('div', { class: 'm__act' }, parts);
    }) : [el('p', { class: 'm__fine', text: 'Nothing yet. Scans, locations and messages show up here for 30 days unless you keep them.' })]);
    return el('section', {}, [
      el('div', { class: 'm__card' }, [
        el('h2', {}, [(t.dog_name || 'Your tag'), el('span', { class: 'm__badge', text: t.scanCount + ' scans' })]),
        el('form', { onsubmit: function (e) {
          e.preventDefault();
          api('tag', { id: t.id, dog_name: dog.value, message: note.value, show_phone: show.checked, pause: pause.value }).then(function (r) { if (r.ok) { say(msg, 'Saved.'); load(); } else say(msg, r.d.error || 'Could not save.', true); });
        } }, [
          field('Dog name', dog, 'dn' + t.id),
          field('Note for a finder (200 characters, no links)', note, 'nt' + t.id),
          el('p', { class: 'm__fine', text: 'Do not put your address here.' }),
          el('label', { class: 'm__chk' }, [show, el('span', { text: 'Show a Call and Text button for my phone on the finder page (off by default: the number is already engraved on the tag)' })]),
          field('Alerts', pause, 'pz' + t.id),
          el('button', { class: 'm__btn m__btn--solid', type: 'submit', text: 'Save' }),
          el('button', { class: 'm__btn', type: 'button', text: 'Send a test alert', onclick: function () { api('test', { tag_id: t.id }).then(function (r) { say(msg, r.ok ? 'Test sent: ' + (r.d.sent.email + r.d.sent.sms) + ' delivered' + ((r.d.failed.email + r.d.failed.sms) ? ', ' + (r.d.failed.email + r.d.failed.sms) + ' failed' : '') + '.' : (r.d.error || 'Could not send.'), !r.ok); }); } }),
          msg, el('p', { class: 'm__fine' }, ['Your tag page: ', el('a', { href: '/t/' + t.id.toLowerCase(), text: 'saltydogtags.com/t/' + t.id.toLowerCase() })])
        ])
      ]),
      contactForm(t, 1, c1), contactForm(t, 2, c2),
      el('div', { class: 'm__card' }, [el('h2', { text: 'Recent activity' }), act]),
      el('p', { class: 'm__fine' }, [el('button', { class: 'm__btn m__btn--danger', type: 'button', text: 'Release this tag', onclick: function () { if (confirm('Give this tag back? It goes back to "not set up", its contacts and activity are deleted, and the old code stops working.')) api('release', { tag_id: t.id }).then(load); } })])
    ]);
  }

  function render() {
    app.textContent = '';
    var q = new URLSearchParams(location.search);
    app.appendChild(el('h1', { text: 'My tags' }));
    if (q.get('claimed')) app.appendChild(el('p', { class: 'm__msg m__ok', text: 'Your tag is activated. Add who should get alerts, then scan the tag once and send a test alert.' }));
    app.appendChild(el('p', { class: 'f__lead', text: 'Signed in as ' + state.owner.email }));
    if (!state.tags.length) app.appendChild(el('p', { text: 'No tags yet. ' }, [el('a', { href: '/claim', text: 'Activate one' })]));
    state.tags.forEach(function (t) { app.appendChild(tagCard(t)); });
    var m = el('p', { class: 'm__msg', role: 'status' });
    var tzIn = el('input', { type: 'text', value: state.owner.tz });
    var mk = el('input', { type: 'checkbox' }); mk.checked = Boolean(state.owner.marketing_optin);
    app.appendChild(el('form', { class: 'm__card', onsubmit: function (e) {
      e.preventDefault();
      api('settings', { tz: tzIn.value, marketing_optin: mk.checked }).then(function (r) { say(m, r.ok ? 'Saved.' : (r.d.error || 'Could not save.'), !r.ok); });
    } }, [el('h2', { text: 'Account' }), field('Time zone (for alert times)', tzIn, 'tz'),
      el('label', { class: 'm__chk' }, [mk, el('span', { text: state.owner.marketing_text })]),
      el('button', { class: 'm__btn m__btn--solid', type: 'submit', text: 'Save' }), m]));
    app.appendChild(el('p', {}, [
      el('button', { class: 'm__btn', type: 'button', text: 'Sign out', onclick: function () { api('signout', {}).then(function () { location.href = '/my'; }); } }),
      el('button', { class: 'm__btn m__btn--danger', type: 'button', text: 'Delete my account', onclick: function () {
        var v = prompt('This deletes your account, contacts and activity now, and your tags go back to "not set up". Type DELETE to confirm.');
        if (v === 'DELETE') api('delete-account', { confirm: 'DELETE' }).then(function () { location.href = '/my'; });
      } })]));
  }

  function load() {
    api('me').then(function (r) {
      if (r.status === 401) return signIn();
      if (!r.ok) { app.textContent = ''; app.appendChild(el('p', { text: 'Could not load your tags. Try again in a moment.' })); return; }
      state = r.d; render();
    }).catch(function () { app.textContent = 'Could not reach the server.'; });
  }
  load();
})();
