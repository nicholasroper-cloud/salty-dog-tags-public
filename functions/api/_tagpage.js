// The public finder page (/t/<id>). Server-rendered, no cookies, no analytics, no third-party anything. The CSP is default-src 'self'
// (so no inline script or style: the page's data rides in data- attributes read by /t.js, styled by /t.css).
// Never shown: owner surname, address, email, a home map, a reward amount, or the phone unless the owner turned "show my phone" on.
import { LIMITS, LOC_CONSENT_TEXT, LOC_CONSENT_VERSION } from './_tagsettings.js';

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const CSP = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'";
export const pageHeaders = (extra = {}) => ({
  'content-type': 'text/html; charset=utf-8',
  'content-security-policy': CSP,
  'x-robots-tag': 'noindex, nofollow',
  'referrer-policy': 'no-referrer',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'permissions-policy': 'geolocation=(self), camera=(), microphone=()',
  'x-sdt-finder': '1',            // the daily canary looks for this header to prove the /T/ rewrite still reaches this page
  ...extra
});

const shell = (title, body, attrs = '') => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow"><meta name="referrer" content="no-referrer">
<title>${esc(title)}</title><link rel="stylesheet" href="/t.css?v=1"></head>
<body><main class="f" ${attrs}>${body}<p class="f__brand">Salty Dog Tags</p></main><script src="/t.js?v=1" defer></script></body></html>`;

// Generic: unknown id, disabled tag, D1 down. Looks identical for all three.
export function genericPage() {
  return shell('Found a dog?', `<h1>Found a dog?</h1><p class="f__lead">Thank you for checking.</p><p class="f__big">Call the number on the back of this tag.</p><p class="f__fine">Any vet or shelter can check for a microchip.</p>`, 'data-state="generic"');
}

export function unclaimedPage({ id, nonce }) {
  return shell('Found a dog?', `<h1>Found a dog?</h1><p class="f__lead">Thank you for checking.</p>
<p class="f__big">This tag isn&rsquo;t set up yet. Call the number on the back.</p>
${messageForm('Send a message to the family')}<p class="f__fine">Any vet or shelter can check for a microchip.</p>`, `data-state="unclaimed" data-t="${esc(id)}" data-n="${esc(nonce)}"`);
}

function messageForm(label) {
  return `<button class="f__btn f__btn--solid" type="button" data-act="msg">${esc(label)}</button>
<form class="f__form" data-form="msg" hidden>
<label for="fmsg">Your message (${LIMITS.messageMax} characters)</label>
<textarea id="fmsg" name="message" maxlength="${LIMITS.messageMax}" rows="4" required placeholder="I found your dog near..."></textarea>
<label for="freply">How can they reach you? (optional)</label>
<input id="freply" name="reply" maxlength="${LIMITS.replyMax}" autocomplete="off" placeholder="A phone number or a first name">
<input class="f__hp" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">
<button class="f__btn f__btn--solid" type="submit">Send</button>
<p class="f__status" role="status" aria-live="polite"></p>
</form>`;
}

// profile: { id, dog, message, showPhone, phone }
export function claimedPage({ id, nonce, dog, message, phone, beacon = true }) {
  const name = String(dog || 'This dog').slice(0, 40);
  const call = phone
    ? `<a class="f__btn" href="tel:${esc(phone)}">Call</a> <a class="f__btn" href="sms:${esc(phone)}">Text</a>`
    : `<p class="f__big">Call the number on the back of this tag.</p>`;
  return shell(`${name} is not lost, just away from home`, `<h1>${esc(name)}</h1>
<p class="f__lead">If I&rsquo;m alone, I may be lost. Thank you for checking.</p>
${message ? `<blockquote class="f__note">${esc(message)}</blockquote>` : ''}
${call}
${messageForm('Message my family')}
<button class="f__btn" type="button" data-act="loc">Share my location</button>
<div class="f__sheet" data-sheet="loc" hidden role="dialog" aria-modal="true" aria-labelledby="locT">
<h2 id="locT">Share your location?</h2>
<p data-consent-ver="${esc(LOC_CONSENT_VERSION)}">${esc(LOC_CONSENT_TEXT)}</p>
<button class="f__btn f__btn--solid" type="button" data-act="loc-go">Share once</button>
<button class="f__btn" type="button" data-act="loc-cancel">Not now</button>
</div>
<form class="f__form" data-form="place" hidden>
<label for="fplace">Type where you are</label>
<input id="fplace" name="place" maxlength="${LIMITS.placeMax}" autocomplete="off" placeholder="Corner of Main St and 200 N">
<button class="f__btn f__btn--solid" type="submit">Send</button>
<p class="f__status" role="status" aria-live="polite"></p>
</form>
<p class="f__fine">Any vet or shelter can check for a microchip.</p>
<p class="f__fine">My family will never ask you for money or a code.</p>`, `data-state="claimed" data-t="${esc(id)}" data-n="${esc(nonce)}" data-beacon="${beacon ? 1 : 0}"`);
}

export const rateLimitedPage = () => shell('Please wait', '<h1>One moment</h1><p class="f__big">Too many tries from this network. Please wait a little and try again, or call the number on the back of the tag.</p>', 'data-state="limited"');
