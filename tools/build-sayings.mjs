#!/usr/bin/env node
/* Builds every page under site/sayings/ from the single source of truth, the SAYINGS array in site/app.js:
 *   /sayings/                  the clean sayings only, grouped by category, with the six themes linked at the top
 *   /sayings/salty/            the 18+ sayings: noindex,follow, behind the same age gate as the home page (sdt-adult), not in the sitemap
 *   /sayings/<theme>/          six theme pages (tools/data/themes.json): intro, cards linking /#build?s=N, ItemList + BreadcrumbList, 3 related breeds
 *   /sayings/<slug>/           30 single-saying pages (tools/data/top-sayings.json): blurb, static tag preview, Product (one Offer at the
 *                              price on the page, shipping + returns) and BreadcrumbList, "Engrave it" CTA, links to the breeds it fits
 * Counts on every page come from tools/out/sayings-count.json (checked against app.js by lib/appdata.mjs). Prices come from the same
 * PRICES/FINISHES/SIZE_AVAIL tables the builder uses. This tool does not touch functions/ (functions/api/_sayings.js is hand maintained).
 *
 * Usage: node tools/build-sayings.mjs   (idempotent; run via `npm run build`)
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { appData, SITE, ROOT } from './lib/appdata.mjs';
import { money, sayingPick } from './lib/cards.mjs';
import { tagSvg } from './lib/tagsvg.mjs';
import { esc, headHtml, navHtml, footerHtml, page, jsonBreadcrumb, jsonProduct, crumbsHtml, ORIGIN } from './lib/shell.mjs';
import { SINGLES, THEMES, sayingProduct, singleBreeds } from './lib/products.mjs';

const d = appData();
const { SAYINGS, CATS } = d;
const N = d.count.clean; // the one number every page quotes
const BREED_LABEL = { aussie: 'Aussie', beagle: 'Beagle', bernese: 'Bernese', 'boston-terrier': 'Boston Terrier', boxer: 'Boxer', bulldog: 'Bulldog', cavalier: 'Cavalier', chihuahua: 'Chihuahua', corgi: 'Corgi', dachshund: 'Dachshund', doberman: 'Doberman', doodle: 'Doodle', frenchie: 'Frenchie', 'german-shepherd': 'German Shepherd', 'golden-retriever': 'Golden Retriever', 'great-dane': 'Great Dane', husky: 'Husky', lab: 'Lab', pomeranian: 'Pomeranian', poodle: 'Poodle', pug: 'Pug', rottweiler: 'Rottweiler', 'shih-tzu': 'Shih Tzu', yorkie: 'Yorkie' };

/* ---------- checks: refuse to publish anything inconsistent ---------- */
const slugs = new Set(['salty']);
for (const t of THEMES) { if (slugs.has(t.slug)) throw new Error('duplicate slug ' + t.slug); slugs.add(t.slug); if (t.indices.some((i) => SAYINGS[i].x)) throw new Error(t.slug + ' contains an 18+ saying'); }
for (const s of SINGLES) { if (slugs.has(s.slug)) throw new Error('duplicate slug ' + s.slug); slugs.add(s.slug); if (SAYINGS[s.index].x) throw new Error(s.slug + ' is an 18+ saying'); }
for (const p of [...THEMES.map((t) => t.title), ...SINGLES.map((s) => s.title)]) if (p.length > 60) throw new Error('title over 60: ' + p);
const singleByIndex = new Map(SINGLES.map((s) => [s.index, s]));

const sayText = (i) => SAYINGS[i].l.join(' ');
// withId: the /sayings/ index gives every card id="s-N", the landing anchor the Merchant Center feed uses for sayings without their own page.
function sayCard(i, withId = false) {
  const { shape, finish } = sayingPick(i, SAYINGS[i].l);
  return `<a class="saycard"${withId ? ` id="s-${i}"` : ''} href="/#build?s=${i}&amp;shape=${shape}&amp;finish=${finish}"><p class="saycard__text">${esc(sayText(i))}</p><span class="saycard__row"><span class="saycard__price">${money(d.priceFor(shape, finish))}</span><span class="saycard__cta">Use this &rarr;</span></span></a>`;
}
const NAV = (cur) => navHtml([['/sayings/', 'Sayings', cur]]);
const CSS = '<link rel="stylesheet" href="/sayings.css?v=1">';
const themeNav = (cur) => `<ul class="sayhub" aria-label="Sayings by theme">${THEMES.map((t) => `<li><a href="/sayings/${t.slug}/"${t.slug === cur ? ' aria-current="page"' : ''}>${esc(themeName(t))}</a></li>`).join('')}</ul>`;
const themeName = (t) => ({ 'lost-and-found': 'Lost and found', attitude: 'Attitude', family: 'Family', beach: 'Beach', 'bulldog-life': 'Bulldog life', 'certified-cute': 'Certified cute' }[t.slug] || t.slug);
function write(path, html) { const dir = join(SITE, path); mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, 'index.html'), html); }
const withCss = (head) => head.replace(/(<link rel="stylesheet" href="\/styles\.css\?v=\d+">)/, `$1\n${CSS}`);
const ldItemList = (name, idxs) => ({ '@context': 'https://schema.org', '@type': 'ItemList', name, numberOfItems: idxs.length, itemListElement: idxs.map((i, n) => ({ '@type': 'ListItem', position: n + 1, name: sayText(i), url: `${ORIGIN}/#build?s=${i}` })) });

/* ---------- /sayings/ ---------- */
const order = Object.keys(CATS).filter((k) => k !== 'all' && k !== 'adult');
const withIdx = SAYINGS.map((s, i) => ({ ...s, i }));
const cleanByCat = Object.fromEntries(order.map((k) => [k, withIdx.filter((s) => s.c === k && !s.x)]));
const cleanTotal = order.reduce((n, k) => n + cleanByCat[k].length, 0);
if (cleanTotal !== N) throw new Error(`categories hold ${cleanTotal} clean sayings but sayings-count.json says ${N}; a clean saying is in a category /sayings/ does not list`);
const allCleanIdx = withIdx.filter((s) => !s.x).map((s) => s.i);

function indexPage() {
  const title = `Funny Dog Tag Sayings: ${N} One-Liners | Salty Dog Tags`;
  const description = `Browse ${N} funny dog tag sayings by bulldog life, lost and found, attitude, family and beach. Tap one to load it in the builder. Laser engraved from $12.`;
  const sections = order.map((key, i) => `<section class="sec${i % 2 ? ' sec--band' : ''}" id="say-${key}">
  <div class="wrap">
    <h2>${esc(CATS[key])}</h2>
    <div class="grid saycards">${cleanByCat[key].map((s) => sayCard(s.i, true)).join('')}</div>
  </div>
</section>`).join('\n');
  const head = withCss(headHtml({ title, description, path: '/sayings/', ogSlug: 'sayings', jsonld: [ldItemList('Funny dog tag sayings', [...allCleanIdx]), jsonBreadcrumb([['Home', '/'], ['Sayings', '/sayings/']])] }));
  const body = `<a class="skip" href="#main">Skip to the sayings</a>

${NAV(true)}

<main id="main" tabindex="-1">
<section class="sec" id="intro">
  <div class="wrap wrap--narrow">
    <p class="eyebrow">The full list</p>
    <h1>Funny dog tag sayings.</h1>
    <p class="lead">${N} lines, field-tested on seven bulldogs, sorted by personality. Tap any saying to load it straight into the tag builder. The name and phone number go on the back, and you can still rewrite anything before you order. Want lines for one breed? Try <a href="/dog-tags-by-breed/">tags by breed</a>.</p>
    <p class="eyebrow" style="margin-top:2rem">Or start with a theme</p>
    ${themeNav('')}
  </div>
</section>

${sections}

<section class="sec" id="salty-18">
  <div class="wrap wrap--narrow">
    <h2>${esc(CATS.adult)}</h2>
    <p class="note saygate-note">Real swear words, real dog tags, for adults. They live on their own page, behind an 18+ check.</p>
    <div class="actions"><a class="btn btn--ghost" href="/sayings/salty/">I'm 18+. Take me to the salty page.</a></div>
  </div>
</section>

<section class="sec sec--band" id="back-to-build">
  <div class="wrap wrap--narrow" style="text-align:center">
    <p class="lead">Found one you like? <a href="/#build">Open the builder</a> and make it yours.</p>
  </div>
</section>
</main>

${footerHtml()}`;
  write('sayings', page({ head, body }));
}

/* ---------- /sayings/salty/ ---------- */
function saltyPage() {
  const adult = withIdx.filter((s) => s.x);
  const title = 'Salty 18+ Dog Tag Sayings | Salty Dog Tags';
  const description = 'Adults only: the salty dog tag sayings, with real swear words, laser engraved on real dog tags. You confirm you are 18 or older before the list opens.';
  const head = withCss(headHtml({ title, description, path: '/sayings/salty/', robots: 'noindex,follow', ogSlug: 'sayings', jsonld: [] }));
  const body = `<a class="skip" href="#main">Skip to the salty sayings</a>

${NAV(true)}

<main id="main" tabindex="-1">
<section class="sec" id="intro">
  <div class="wrap wrap--narrow">
    ${crumbsHtml([['Home', '/'], ['Sayings', '/sayings/'], ['Salty 18+']])}
    <p class="eyebrow">Adults only</p>
    <h1>Salty 18+ dog tag sayings.</h1>
    <p class="lead">Real swear words. Real dog tags. ${adult.length} lines for owners who are 18 or older and fine with that. Tap one to load it into the builder.</p>
    <noscript><p class="note">This page needs JavaScript to confirm you are 18 or older. The clean list is at <a href="/sayings/">/sayings/</a>.</p></noscript>
  </div>
</section>

<section class="sec sec--band saygate" id="salty-list" hidden>
  <div class="wrap">
    <div class="grid saycards">${adult.map((s) => sayCard(s.i)).join('')}</div>
  </div>
</section>
</main>

${footerHtml()}

<dialog class="adult-gate" id="adultGate" aria-labelledby="adultGateT">
  <p class="adult-gate__t" id="adultGateT">Real swear words. Real dog tags.</p>
  <p class="adult-gate__p">The Salty section has grown-up language. You're 18 or older and fine with that?</p>
  <div class="adult-gate__acts">
    <button type="button" class="btn btn--coral" id="adultYes">Yes, I'm 18+</button>
    <button type="button" class="btn btn--ghost" id="adultNo">No thanks</button>
  </div>
</dialog>

<script>
  // Same gate and the same localStorage key (sdt-adult) as the home page. The list stays hidden until the visitor confirms,
  // and anything that goes wrong (no JS, blocked storage, Esc, "No thanks") leaves it hidden.
  (function () {
    var list = document.getElementById('salty-list'), gate = document.getElementById('adultGate');
    function show() { list.hidden = false; }
    function leave() { location.replace('/sayings/'); }
    try { if (localStorage.getItem('sdt-adult') === '1') { show(); return; } } catch (e) {}
    var yes = false;
    document.getElementById('adultYes').addEventListener('click', function () { yes = true; try { localStorage.setItem('sdt-adult', '1'); } catch (e) {} gate.close(); show(); });
    document.getElementById('adultNo').addEventListener('click', function () { gate.close(); });
    gate.addEventListener('close', function () { if (!yes) leave(); });
    if (gate.showModal) gate.showModal();
    else if (window.confirm("Real swear words. You're 18 or older and fine with that?")) { try { localStorage.setItem('sdt-adult', '1'); } catch (e) {} show(); } else leave();
  })();
</script>`;
  write('sayings/salty', page({ head, body }));
}

/* ---------- theme pages ---------- */
function themePage(t) {
  const path = `/sayings/${t.slug}/`;
  const featured = t.indices.filter((i) => singleByIndex.has(i)).map((i) => singleByIndex.get(i));
  const relBreeds = t.breeds.map((b) => { if (!BREED_LABEL[b]) throw new Error('unknown breed ' + b); return `<a class="lp-go" href="/${b}-dog-tags/">${esc(BREED_LABEL[b])} tags</a>`; });
  const others = THEMES.filter((o) => o.slug !== t.slug).map((o) => `<a class="lp-go" href="/sayings/${o.slug}/">${esc(themeName(o))}</a>`);
  const head = withCss(headHtml({ title: t.title, description: t.meta, path, ogSlug: 'sayings',
    jsonld: [ldItemList(t.h1.replace(/\.$/, ''), t.indices), jsonBreadcrumb([['Home', '/'], ['Sayings', '/sayings/'], [t.h1.replace(/\.$/, ''), path]])] }));
  const [first, ...rest] = t.intro;
  const body = `<a class="skip" href="#main">Skip to the sayings</a>

${NAV(true)}

<main id="main" tabindex="-1">
<section class="sec" id="intro">
  <div class="wrap wrap--narrow">
    ${crumbsHtml([['Home', '/'], ['Sayings', '/sayings/'], [esc(themeName(t))]])}
    <p class="eyebrow">${t.indices.length} sayings</p>
    <h1>${esc(t.h1)}</h1>
    <p class="lead">${esc(first)}</p>
${rest.map((p) => `    <p>${esc(p)}</p>`).join('\n')}
  </div>
</section>
${featured.length ? `
<section class="sec" id="top-lines">
  <div class="wrap">
    <h2>Top lines on this page</h2>
    <p class="note" style="margin-bottom:1rem">A closer look at the favorites.</p>
    <p class="lp-links">${featured.map((s) => `<a class="lp-go" href="/sayings/${s.slug}/">${esc(sayText(s.index))}</a>`).join('')}</p>
  </div>
</section>
` : ''}
<section class="sec sec--band" id="sayings">
  <div class="wrap">
    <div class="grid saycards">${t.indices.map(sayCard).join('')}</div>
  </div>
</section>

<section class="sec saymore" id="more">
  <div class="wrap">
    <h2>Tags for the breed</h2>
    <p class="lp-links">${relBreeds.join('')}<a class="lp-go" href="/dog-tags-by-breed/">All breeds &rarr;</a></p>
    <h2>More sayings</h2>
    <p class="lp-links">${others.join('')}<a class="lp-go" href="/sayings/">All ${N} sayings &rarr;</a></p>
  </div>
</section>
</main>

${footerHtml()}`;
  write(`sayings/${t.slug}`, page({ head, body }));
}

/* ---------- single-saying pages ---------- */
function singlePage(s) {
  const path = `/sayings/${s.slug}/`;
  const i = s.index; const lines = SAYINGS[i].l; const text = sayText(i);
  const p = sayingProduct(i); const { shape, finish, price } = p;
  const themes = THEMES.filter((t) => t.indices.includes(i));
  // "More like this": other single pages in the same themes first, then the same /sayings/ category, six at most
  const sameCat = SINGLES.filter((x) => x.index !== i && SAYINGS[x.index].c === SAYINGS[i].c).map((x) => x.index);
  // start the list just after this saying (wrapping round) so every single page gets links, not only the first six in a theme
  const pos = SINGLES.findIndex((x) => x.index === i);
  const rot = (arr) => [...arr].sort((a, b) => ((SINGLES.findIndex((x) => x.index === a) - pos + SINGLES.length) % SINGLES.length) - ((SINGLES.findIndex((x) => x.index === b) - pos + SINGLES.length) % SINGLES.length));
  const sameTheme = [...new Set([...rot(themes.flatMap((t) => t.indices.filter((x) => x !== i && singleByIndex.has(x)))), ...rot(sameCat)])].slice(0, 6).map((x) => singleByIndex.get(x));
  const breeds = singleBreeds(s);
  if (!breeds.length) throw new Error(`${s.slug}: no breed to link back to; add "breeds" in top-sayings.json`);
  const cap1 = d.finishName(finish);
  const svg = tagSvg({ shape, finish, lines, id: 't', label: `${cap1} ${shape} dog tag engraved "${text}"` });
  const product = jsonProduct({ id: `${ORIGIN}${path}#tag`, name: p.title, description: s.meta, image: p.image, url: ORIGIN + path, price, sku: p.sku, material: p.material, color: p.color });
  const head = withCss(headHtml({ title: s.title, description: s.meta, path, ogSlug: 'sayings', jsonld: [product, jsonBreadcrumb([['Home', '/'], ['Sayings', '/sayings/'], [text, path]])] }));
  const body = `<a class="skip" href="#main">Skip to the saying</a>

${NAV(true)}

<main id="main" tabindex="-1">
<article class="sec art saypage">
  <div class="wrap wrap--narrow">
    ${crumbsHtml([['Home', '/'], ['Sayings', '/sayings/'], ...(themes[0] ? [[esc(themeName(themes[0])), `/sayings/${themes[0].slug}/`]] : []), [esc(text)]])}
    <p class="eyebrow">Dog tag saying</p>
    <h1>${esc(text)}</h1>
    <figure class="saytag">
      ${svg}
      <figcaption>${esc(cap1)} ${esc(shape)} &middot; ${money(price)}</figcaption>
    </figure>
    <p class="saypage__blurb">${esc(s.blurb)}</p>
    <p class="saypage__cta">${esc(s.cta)}</p>
    <div class="actions">
      <a class="btn btn--coral" href="/#build?s=${i}&amp;shape=${shape}&amp;finish=${finish}">Engrave it &rarr;</a>
      <a class="actions__alt" href="/sayings/">Browse all ${N} sayings</a>
    </div>
  </div>
</article>

<section class="sec sec--band saymore" id="more">
  <div class="wrap">
${sameTheme.length || themes.length ? `    <h2>More like this</h2>
    <p class="lp-links">${sameTheme.map((x) => `<a class="lp-go" href="/sayings/${x.slug}/">${esc(sayText(x.index))}</a>`).join('')}${themes.map((t) => `<a class="lp-go" href="/sayings/${t.slug}/">All ${esc(themeName(t).toLowerCase())} sayings &rarr;</a>`).join('')}</p>
` : ''}    <h2>Dog tags by breed</h2>
    <p class="lp-links">${breeds.map((b) => `<a class="lp-go" href="/${b}-dog-tags/">${esc(BREED_LABEL[b])} tags</a>`).join('')}<a class="lp-go" href="/dog-tags-by-breed/">All breeds &rarr;</a><a class="lp-go" href="/guides/what-to-put-on-a-dog-tag/">What to put on a dog tag</a></p>
  </div>
</section>
</main>

${footerHtml()}`;
  write(`sayings/${s.slug}`, page({ head, body }));
}

/* ---------- write, and clear out generated folders that no longer exist ---------- */
const keep = new Set([...slugs]);
for (const entry of readdirSync(join(SITE, 'sayings'), { withFileTypes: true })) {
  if (entry.isDirectory() && !keep.has(entry.name)) { rmSync(join(SITE, 'sayings', entry.name), { recursive: true }); console.log('removed stale site/sayings/' + entry.name); }
}
indexPage(); saltyPage(); THEMES.forEach(themePage); SINGLES.forEach(singlePage);
console.log(`build-sayings: /sayings/ (${N} clean), /sayings/salty/ (${d.adultCount} 18+), ${THEMES.length} themes, ${SINGLES.length} single-saying pages`);
