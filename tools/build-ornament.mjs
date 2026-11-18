#!/usr/bin/env node
/* Builds /ornament/ (the Holiday Pet Photo Ornament page) into site/ornament/index.html.
 * Prices, the ship-from city and the order cutoff are read from the constants at the top of site/app.js (PRICES.ornament,
 * SHIP_FROM, ORNAMENT_CUTOFF), so the page, the cart and the server (functions/api/_lib.js) cannot disagree:
 * tools/test/site-sync.test.mjs checks the server copy.
 * The interactive part (preview, upload, add to order) is site/ornament.js, which uses the shared cart in app.js.
 * Usage: node tools/build-ornament.mjs   (idempotent; run via `npm run build`)
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { appData, SITE, read } from './lib/appdata.mjs';
import { esc, headHtml, navHtml, footerHtml, page, jsonBreadcrumb, jsonFaq, crumbsHtml, ORIGIN } from './lib/shell.mjs';

const d = appData();
const src = read('site/app.js');
const grab = (re, what) => { const m = re.exec(src); if (!m) throw new Error('app.js constant not found: ' + what); return m[1]; };
const SHIP_FROM = grab(/const SHIP_FROM = '([^']+)'/, 'SHIP_FROM');
const CUTOFF = grab(/const ORNAMENT_CUTOFF = '([^']+)'/, 'ORNAMENT_CUTOFF');
const PAY_BY = grab(/const ORNAMENT_PAY_BY = '([^']+)'/, 'ORNAMENT_PAY_BY');
const SHIP_BY = grab(/const ORNAMENT_SHIP_BY = '([^']+)'/, 'ORNAMENT_SHIP_BY');
const AKHI_BY = grab(/const ORNAMENT_AKHI_BY = '([^']+)'/, 'ORNAMENT_AKHI_BY');
const USPS_DATE = grab(/const USPS_GROUND_DATE = '([^']+)'/, 'USPS_GROUND_DATE');
// Lady Jaye B4, verbatim (changing the dates in app.js changes both sentences).
const HERO_LINE = `Order by ${CUTOFF} and pay your invoice by ${PAY_BY} for Christmas in the lower 48.`;
const REVIEW_NOTE = "We check every upload by hand before you pay. If we can't print it, you pay nothing, or get a full refund.";
export const ENABLED = grab(/const ORNAMENT_ENABLED = (true|false)/, 'ORNAMENT_ENABLED') === 'true';
const RAISED_INCLUDED = grab(/const ORNAMENT_RAISED_INCLUDED = (true|false)/, 'ORNAMENT_RAISED_INCLUDED') === 'true';
const CENTS = d.PRICES.ornament;
const ACR = CENTS.acrylic / 100, STL = CENTS.stainless / 100, UPG = STL - ACR;
const SHIP = d.PRICES.ship, FREE = d.PRICES.freeOver;

const path = '/ornament/', url = ORIGIN + path;
const title = 'Holiday Pet Photo Ornament, Custom | Salty Dog Tags';
const description = `Custom pet photo ornament: full-color printed clear acrylic with raised name and year, $${ACR}, or engraved stainless bone, $${STL}. Ships USPS from ${SHIP_FROM}.`;

const FAQ = [
  { q: 'What is the difference between the two ornaments?', a: `The $${ACR} ornament is a 3 inch clear acrylic disc with your photo printed in full color and your dog's name and year raised on top. The $${STL} ornament is a polished stainless steel bone with the photo engraved by laser in grayscale, which is how a laser works on metal. Same photo either way: upload once, and you can upgrade to the stainless for +$${UPG}.` },
  { q: 'Is the photo really in color?', a: `On the acrylic ornament, yes. It is printed in full color with UV ink. On the stainless ornament it is engraved, so it is grayscale. We say so up front so nobody is surprised.` },
  { q: 'What kind of photo works best?', a: `A sharp, well lit, close photo with the face in the middle. We print at your photo's size, so a tiny or blurry one will look soft. We tell you before we print if a photo will not work.` },
  { q: 'Will it arrive before Christmas?', a: `Order by ${CUTOFF} and pay your invoice by ${PAY_BY}, and we ship by ${SHIP_BY}, ahead of USPS's ${USPS_DATE} Ground Advantage date for Christmas delivery in the lower 48. USPS sets delivery, so we can't promise a day. Alaska and Hawaii take 10+ days: order by ${AKHI_BY}. Put your deadline in the order notes.` },
  { q: 'Can I send my own artwork instead of a photo?', a: `On the acrylic ornament, yes: a PNG, JPG or SVG. You confirm you took the photo or made the art, or have permission to use it, with no logos, team names or characters you don't have rights to. Everything is covered in our <a href="/policies/#artwork">artwork terms</a>. ${REVIEW_NOTE} Or pick one of our house styles and we design it.` },
  { q: 'What if it comes out wrong?', a: `If we misprint or mis-engrave it, we remake it free. Custom items cannot be returned for a change of mind, because each one is made for you. Details are in the <a href="/policies/">shop policies</a>.` },
  { q: 'Is it safe for a dog to chew?', a: `No. It is a Christmas tree ornament, not a toy and not a collar tag. Hang it out of paw's reach.` },
];

export function renderOrnamentPage() {
const head = headHtml({
  title, description, path, ogSlug: 'home',
  jsonld: [
    // One Offer per tier, each on its own Product. No image, rating or review is claimed until real ones exist.
    ...[['acrylic', 'Holiday pet photo ornament, printed acrylic', 'Custom 3 inch clear acrylic ornament with your dog\'s photo printed in full color and the name and year raised.', ACR],
        ['stainless', 'Holiday pet photo ornament, engraved stainless bone', 'Custom polished stainless steel bone ornament with your dog\'s photo laser-engraved in grayscale, name and year on the back.', STL]].map(([k, name, desc, price]) => ({
      '@context': 'https://schema.org', '@type': 'Product', '@id': `${url}#${k}`, name, description: desc, brand: { '@type': 'Brand', name: 'Salty Dog Tags' }, sku: `SDT-ORN-${k.toUpperCase()}`,
      offers: { '@type': 'Offer', url: `${url}#make`, priceCurrency: 'USD', price: price.toFixed(2), availability: 'https://schema.org/InStock', itemCondition: 'https://schema.org/NewCondition', seller: { '@id': ORIGIN + '/#business' } },
    })),
    jsonFaq(url + '#faq', FAQ), jsonBreadcrumb([['Salty Dog Tags', '/'], ['Holiday ornament', path]]),
  ],
});

const CSS = `
.orn-hero__in{display:grid;gap:2rem;align-items:center}
.orn-hero__art{max-width:22rem;margin:0 auto;width:100%}
.orn-trust{list-style:none;padding:0;margin:1.2rem 0;display:grid;gap:.4rem;color:var(--mute);font-size:.95rem}
.orn-trust b{color:var(--foam)}
.orn-tiers{display:grid;gap:1.2rem}
.orn-tier{background:var(--s1);border:1px solid var(--line-2);border-radius:var(--r);padding:1.2rem;display:grid;gap:.8rem}
.orn-tier__art{max-width:15rem;margin:0 auto;width:100%;position:relative}
.orn-tier__art .flag{position:absolute;top:0;right:0;font-family:var(--mono);font-size:.62rem;letter-spacing:.14em;text-transform:uppercase;color:var(--dim)}
.orn-tier h3{margin:0;font-family:var(--display);font-weight:400;font-size:1.3rem}
.orn-tier__price{font-family:var(--display);font-size:2rem;color:var(--magenta);margin:0}
.orn-tier__price small{font-family:var(--mono);font-size:.7rem;letter-spacing:.1em;color:var(--mute);text-transform:uppercase}
.orn-tier ul{margin:0;padding-left:1.1rem;color:var(--mute);line-height:1.55}
.orn-make{display:grid;gap:1.6rem}
.orn-make__prev{display:grid;gap:.2rem;justify-items:center;align-content:start;position:sticky;top:var(--nav-h,60px);z-index:3;background:var(--void);padding:.4rem 0 .6rem;margin:0 calc(var(--edge) * -1);padding-left:var(--edge);padding-right:var(--edge)}
.orn-make__prev .two{display:grid;grid-template-columns:1fr 1fr;gap:.6rem;width:100%;max-width:15rem}
.orn-make__prev .one{width:100%;max-width:9rem}
.orn-make__prev .side{display:block;text-align:center;font-family:var(--mono);font-size:.62rem;letter-spacing:.14em;text-transform:uppercase;color:var(--dim)}
.orn-tierpick{display:grid;gap:.6rem}
.orn-tierpick .opt span{display:flex;flex-direction:column;gap:.15rem;align-items:flex-start;text-align:left}
.orn-price{font-family:var(--display);font-size:1.6rem;margin:.4rem 0}
.orn-price small{display:block;font-family:var(--mono);font-size:.68rem;letter-spacing:.08em;color:var(--mute);text-transform:uppercase}
.orn-msg{min-height:1.4em}
#ornForm .field,#ornForm input,#ornForm .grp{scroll-margin-top:15rem}
.orn-ship{max-width:42rem}
@media(min-width:820px){.orn-hero__in{grid-template-columns:1.1fr .9fr}.orn-tiers{grid-template-columns:1fr 1fr}.orn-make{grid-template-columns:1fr 1fr;align-items:start}.orn-make__prev{order:2;top:5rem;margin:0;padding:0;background:none}#ornForm .field,#ornForm input,#ornForm .grp{scroll-margin-top:6rem}.orn-make__prev .one{max-width:20rem}.orn-make__prev .two{max-width:26rem}}
`;

const tierCard = (k, h, price, bullets, note, extra = '') => `
      <article class="orn-tier" id="tier-${k}">
        <div class="orn-tier__art"><div id="tierArt-${k}" role="img" aria-label="${esc(h)} preview"></div><span class="flag">Preview</span></div>
        <h3>${esc(h)}</h3>
        <p class="orn-tier__price">$${price}${extra}</p>
        <ul>${bullets.map((b) => `<li>${b}</li>`).join('')}</ul>
        <p class="note">${note}</p>
      </article>`;

const body = `<a class="skip" href="#main">Skip to the page</a>

${navHtml([['/ornament/', 'Holiday ornament', true]], { cta: ['#make', 'Make one'] })}

<main id="main" tabindex="-1">
<style>${CSS}</style>
<section class="sec orn-hero">
  <div class="wrap orn-hero__in">
    <div class="orn-hero__copy">
      ${crumbsHtml([['Salty Dog Tags', '/'], ['Holiday ornament']])}
      <p class="eyebrow">Holiday drop</p>
      <h1>Holiday pet photo ornament.</h1>
      <p class="lead">Your dog on the tree. Printed in full color on clear acrylic with the name and year raised on top, or laser-engraved on a polished stainless bone. Upload one photo, pick a tier, done.</p>
      <ul class="orn-trust" aria-label="The basics">
        <li><b>$${ACR}</b> printed acrylic, full-color photo</li>
        <li><b>$${STL}</b> engraved stainless bone, <b>+$${UPG}</b> to upgrade from the same photo</li>
        <li>Ships USPS from <span data-ship-from>${esc(SHIP_FROM)}</span>. <span data-ornament-hero>${esc(HERO_LINE)}</span> $${SHIP.toFixed(2)} shipping, free over $${FREE}.</li>
      </ul>
      <a class="btn btn--coral" href="#make">Make an ornament</a>
    </div>
    <div class="orn-hero__art"><div id="ornHeroArt" role="img" aria-label="Preview of a printed acrylic ornament with a raised name and year"></div></div>
  </div>
</section>

<section class="sec sec--band" id="tiers" aria-labelledby="tiersH">
  <div class="wrap">
    <div class="sec__head sec__head--center"><p class="eyebrow">Two ways to make it</p><h2 id="tiersH">Printed or engraved.</h2></div>
    <div class="orn-tiers">${tierCard('acrylic', 'Printed clear acrylic', ACR, [
      '3 inch clear acrylic disc, with a ribbon hole',
      'Full-color photo printed in UV ink, with a white layer underneath so it pops on clear acrylic',
      'Your dog&rsquo;s name and the year <b>raised</b> on top of the print',
      'Or pick a house style, or upload your own artwork'], 'The photo is printed in full color on this one.')}${tierCard('stainless', 'Engraved stainless bone', STL, [
      'Polished stainless steel bone, with a ribbon hole',
      'Your photo laser-engraved in <b>grayscale</b> (a laser cannot print color on steel)',
      'Name and year engraved on the back',
      `The same photo as the acrylic: upgrade for +$${UPG}`], 'Engraved, so grayscale. It is the keepsake one.')}
    </div>
  </div>
</section>

<section class="sec" id="make" aria-labelledby="makeH">
  <div class="wrap">
    <div class="sec__head"><p class="eyebrow">Make yours</p><h2 id="makeH">Upload, name it, add it to the order.</h2><p class="lead">This adds the ornament to the same order as any tags. Nothing is charged until you check out.</p></div>
    <div class="orn-make">
      <div class="orn-make__prev" id="oPrev" aria-label="Preview"></div>
      <form id="ornForm" autocomplete="off" novalidate>
        <fieldset class="grp">
          <legend class="grp__h"><b>01</b> Pick the tier</legend>
          <div class="orn-tierpick" role="radiogroup" aria-label="Tier" id="oTier">
            <label class="opt"><input type="radio" name="tier" value="acrylic" checked><span><b>Printed clear acrylic &middot; $${ACR}</b><i class="dim">Full-color photo, raised name and year</i></span></label>
            <label class="opt"><input type="radio" name="tier" value="stainless"><span><b>Engraved stainless bone &middot; $${STL}</b><i class="dim">Grayscale engraving &middot; +$${UPG} from the acrylic</i></span></label>
          </div>
        </fieldset>
        <fieldset class="grp">
          <legend class="grp__h"><b>02</b> The art</legend>
          <div class="field" id="oArtField">
            <span class="lbl" id="oArtLbl">Where does the art come from?</span>
            <div class="opts" id="oArtMode" role="radiogroup" aria-labelledby="oArtLbl"></div>
            <div id="oDesign"><span class="lbl lbl--sub" id="oStyleLbl">House style</span><div class="opts opts--stack" id="oStyle" role="radiogroup" aria-labelledby="oStyleLbl"></div></div>
          </div>
          <div class="field" id="oUploadBox" hidden>
            <input type="file" id="oFile" class="photo-upload__input" accept="image/png,image/jpeg,image/svg+xml,.svg">
            <label for="oFile" class="photo-upload__btn"><img id="oThumb" class="photo-upload__thumb" alt="" hidden><span id="oFileTxt">Choose a photo</span></label>
            <p class="help" id="oHelp"></p>
            <p class="note" id="oStatus" aria-live="polite"></p>
            <label class="opt opt--check" id="oSafeRow" hidden><input type="checkbox" id="oSafe" checked><span><b>Show the print-safe area</b></span></label>
          </div>
          <div class="field" id="oAckField" hidden>
            <label class="opt opt--check"><input type="checkbox" id="oAck"><span id="oAckTxt"></span></label>
            <p class="help" data-review-note>${esc(REVIEW_NOTE)}</p>
          </div>
          <div class="field photo-toggle" id="oRaisedField" hidden>
            <label class="opt opt--check"><input type="checkbox" id="oRaised"><span><b>Raised name and year</b><i class="fin__up" id="oRaisedPrice"></i></span></label>
          </div>
        </fieldset>
        <fieldset class="grp">
          <legend class="grp__h"><b>03</b> Name and year</legend>
          <div class="row">
            <div class="field"><label for="oName">Dog&rsquo;s name <span class="cnt" id="oNameCnt">0/24</span></label><input type="text" id="oName" maxlength="24" placeholder="Whisky" autocomplete="off" required aria-required="true"><p class="err" id="oNameErr">Add the dog&rsquo;s name.</p></div>
            <div class="field"><label for="oYear">Year</label><input type="text" id="oYear" maxlength="4" value="2026" inputmode="numeric" autocomplete="off" required aria-required="true"><p class="err" id="oYearErr">Four digits, like 2026.</p></div>
          </div>
        </fieldset>
        <fieldset class="grp grp--last">
          <legend class="grp__h"><b>04</b> How many</legend>
          <div class="addrow">
            <div class="count"><button type="button" data-d="-1" aria-label="Fewer">&minus;</button><output id="oQty">1</output><button type="button" data-d="1" aria-label="More">+</button></div>
            <button class="btn btn--coral" type="submit" id="oAdd">Add to order</button>
          </div>
          <p class="orn-price" id="oPrice" aria-live="polite"></p>
          <p class="msg orn-msg" id="oMsg" role="status" aria-live="polite"></p>
        </fieldset>
      </form>
    </div>
  </div>
</section>

<section class="sec sec--rule" id="shipping" aria-labelledby="shipH">
  <div class="wrap orn-ship">
    <h2 id="shipH">Shipping</h2>
    <p>Ships USPS from <span data-ship-from>${esc(SHIP_FROM)}</span>, US addresses only. $${SHIP.toFixed(2)} shipping, free over $${FREE}. Utah sales tax is added for Utah addresses only.</p>
    <p><b data-ornament-hero>${esc(HERO_LINE)}</b> We make it and ship within 2 business days of payment, and USPS takes it from there. USPS sets delivery, so we cannot promise a day. Alaska and Hawaii take 10+ days: order by ${esc(AKHI_BY)}. Add your deadline to the order notes and we will tell you straight if it is too tight.</p>
    <p>Nothing is charged when you send the order. We email a secure Clover invoice, and the ornament is made when it is paid. ${REVIEW_NOTE}</p>
  </div>
</section>

<section class="sec sec--band faq" id="faq">
  <div class="wrap faq__in">
    <div class="sec__head"><p class="eyebrow">Questions humans ask</p><h2>Straight answers.</h2></div>
    <div class="faq__list">
${FAQ.map((f, i) => `    <details${i === 0 ? ' open' : ''}><summary>${esc(f.q)}</summary><p>${f.a}</p></details>`).join('\n')}
    </div>
  </div>
</section>
</main>

${footerHtml({ faqHref: '#faq' })}

<div class="toast" id="toast" role="status" aria-live="polite"></div>
<script src="/app.js?v=82"></script>
<script src="/ornament.js?v=2"></script>`;

return page({ head, body });
}

/* ---------- home page fragments ----------
   site/index.html is hand-written; the four ornament spots in it sit between <!--sdt:orn-NAME--> markers and are rewritten here
   from the master switch, so flipping ORNAMENT_ENABLED and running the build restores or removes them. */
export const homeFragments = () => ({
  'orn-nav': '<a class="nav__in nav__orn" href="/ornament/">Holiday ornament</a>',
  'orn-menu': '<a href="/ornament/">Holiday ornament</a>',
  'orn-foot': '<a href="/ornament/">Holiday ornament</a>',
  'orn-promo': `<section class="sec pc orn-promo" id="ornament-promo" aria-labelledby="opH">
  <div class="wrap">
    <article class="pc__card orn-promo__card">
      <figure class="pc__shot orn-promo__shot"><div id="ornPromoArt" role="img" aria-label="Preview of a printed acrylic ornament with a raised name and year"></div><figcaption class="pc__flag">Preview</figcaption></figure>
      <div class="pc__body">
        <p class="eyebrow">New &middot; holiday</p>
        <div class="pc__top"><h2 id="opH">Holiday pet photo ornament</h2></div>
        <ul class="pc__spec">
          <li><b>$${ACR}</b> printed clear acrylic, full-color photo with raised name and year</li>
          <li><b>$${STL}</b> engraved stainless bone, same photo, grayscale</li>
        </ul>
        <a class="btn btn--coral" href="/ornament/">Make an ornament</a>
        <p class="pc__fine">Ships USPS from <span data-ship-from>${esc(SHIP_FROM)}</span>. <span data-ornament-hero>${esc(HERO_LINE)}</span></p>
      </div>
    </article>
  </div>
</section>`,
});
export function applyHomeMarkers(html, enabled) {
  const frag = homeFragments();
  let out = html;
  for (const [name, markup] of Object.entries(frag)) {
    const re = new RegExp(`(<!--sdt:${name}-->)[\\s\\S]*?(<!--/sdt:${name}-->)`);
    if (!re.test(out)) throw new Error('index.html is missing the marker pair for ' + name);
    out = out.replace(re, (_m, a, b) => a + (enabled ? markup : '') + b);
  }
  return out;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const homePath = join(SITE, 'index.html');
  writeFileSync(homePath, applyHomeMarkers(readFileSync(homePath, 'utf8'), ENABLED));
  if (ENABLED) {
    mkdirSync(join(SITE, 'ornament'), { recursive: true });
    writeFileSync(join(SITE, 'ornament', 'index.html'), renderOrnamentPage());
    console.log('ornament: wrote site/ornament/index.html');
  } else {
    // Switched off: no page (a request gets the site 404), so the sitemap, llms files and the markdown map lose it on their own.
    rmSync(join(SITE, 'ornament'), { recursive: true, force: true });
    console.log('ornament: ORNAMENT_ENABLED is false, no /ornament/ page, home links removed');
  }
}
