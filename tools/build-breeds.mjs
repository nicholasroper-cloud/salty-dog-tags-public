#!/usr/bin/env node
/* Builds site/<breed>-dog-tags/index.html (one per tools/breeds/<slug>.json) and site/dog-tags-by-breed/index.html.
 *
 * Source of truth: tools/breeds/*.json for the words, site/app.js for sayings, prices, finishes and shapes,
 * tools/data/shape-fits.json for the "Which shape fits your {breed}" block, tools/lib/shell.mjs for head/nav/footer.
 *
 * Saying cards. Every "Use this" link opens the builder with exactly that saying:
 *   - /#build?s=<index>&shape=&finish=   when the card text (lines joined by a space, case-insensitive) is a clean SAYINGS entry
 *   - /#build?t=line1|line2|...&shape=&finish=   otherwise (lines URL-encoded, 24 characters max each, 4 lines max)
 * shape= and finish= are the card's own, and the price printed on the card is priced from the same tables, so the price you
 * see is the price that loads. Cards in the JSON may set "shape" and "finish"; cards that do not get a deterministic pick
 * for the breed's size variant (see autoPick). The bulldog page has photographed cards ("file") and keeps its shapes.
 *
 * Product JSON-LD. One Offer: the first saying card on the page (its shape, finish and printed price), with that card as the
 * product image: the bulldog page uses its photograph, every other breed a render of the card (site/assets/feed/b-<slug>.jpg,
 * drawn by tools/render-feed-images.py from tools/out/breed-images.json, which this tool writes).
 *
 * Usage: node tools/build-breeds.mjs        (idempotent; run via `npm run build`)
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { appData, SITE, ROOT } from './lib/appdata.mjs';
import { money, cap, assertLines, buildUseUrl, autoPick } from './lib/cards.mjs';
import { esc, stripTags, headHtml, navHtml, footerHtml, page, jsonBreadcrumb, jsonFaq, jsonProduct, ldScript, crumbsHtml, ORIGIN } from './lib/shell.mjs';
import { breedSingles, THEMES, materialFor } from './lib/products.mjs';

const d = appData();
const BREEDS_DIR = join(ROOT, 'tools', 'breeds');
const FITS = JSON.parse(readFileSync(join(ROOT, 'tools', 'data', 'shape-fits.json'), 'utf8'));

const breeds = readdirSync(BREEDS_DIR).filter((f) => f.endsWith('.json') && !f.startsWith('_')).sort()
  .map((f) => JSON.parse(readFileSync(join(BREEDS_DIR, f), 'utf8')));
const bySlug = Object.fromEntries(breeds.map((b) => [b.slug, b]));

/* ---------- saying cards (shared helpers live in lib/cards.mjs) ---------- */
function resolveCards(b) {
  return b.sayings.cards.map((c, i) => {
    assertLines(`${b.slug} card ${i}`, c.lines);
    const pick = c.shape ? { shape: c.shape, finish: c.finish } : autoPick(b.fit.variant, c.lines, i);
    if (!d.visibleShapes.includes(pick.shape) || !d.finishOk(pick.finish, pick.shape)) throw new Error(`${b.slug}: card ${i} ${pick.shape}/${pick.finish} is not a real blank`);
    const price = d.priceFor(pick.shape, pick.finish);
    if (c.oldPrice && c.oldPrice !== money(price)) console.warn(`  note ${b.slug} card ${i}: old page said ${c.oldPrice}, tables say ${money(price)}`);
    return { ...c, ...pick, price, ...buildUseUrl(c.lines, pick.shape, pick.finish) };
  });
}

// alt.md: {color} {shape} {breed} dog tag engraved "{saying}"
const altFor = (b, c) => {
  const fin = d.finishName(c.finish); const color = fin[0].toUpperCase() + fin.slice(1).toLowerCase();
  return `${color} ${c.shape} ${b.altBreed || b.fit.name.toLowerCase()} dog tag engraved "${c.lines.join(' ')}"`;
};

function cardHtml(b, c) {
  const text = c.lines.map(esc).join('<br>');
  if (c.file) {
    return `      <li><a class="say say--link" href="${c.href}">
        <span class="say__photo say__photo--img"><img src="/assets/bulldog/${c.file}" width="640" height="480" alt="${esc(altFor(b, c))}" loading="lazy" decoding="async"></span>
        <span class="say__name">${text}</span>
        <span class="say__t"><span>${money(c.price)}</span><b>Use this &rarr;</b></span>
      </a></li>`;
  }
  return `      <a class="saycard" href="${c.href}"><p class="saycard__text">${text}</p><span class="saycard__row"><span class="saycard__price">${cap(c.shape)} &middot; ${money(c.price)}</span><span class="saycard__cta">Use this &rarr;</span></span></a>`;
}

/* ---------- shape-fits block ---------- */
const article = (name) => (/^[AEIOU]/i.test(name) ? 'an' : 'a');
function fill(tpl, name) {
  const a = article(name);
  return tpl.replace(/\{A\}/g, cap(a)).replace(/\{a\}/g, a).replace(/\{breed\}/g, name);
}
const fitFor = (b) => FITS.variants[b.fit.variant];

/* ---------- the tag the Product describes: the page's first saying card ---------- */
const THEME_NAME = { 'lost-and-found': 'Lost and found', attitude: 'Attitude', family: 'Family', beach: 'Beach', 'bulldog-life': 'Bulldog life', 'certified-cute': 'Certified cute' };
const breedImages = [];
function productImage(b, c) {
  if (c.file) return `${ORIGIN}/assets/bulldog/${c.file}`;
  breedImages.push({ file: `b-${b.slug}.jpg`, slug: b.slug, lines: c.lines, shape: c.shape, finish: c.finish, ink: d.FINISHES[c.finish]?.ink || 'dark' });
  return `${ORIGIN}/assets/feed/b-${b.slug}.jpg`;
}

const lis = (arr) => arr.join('');
function renderBreed(b) {
  const cards = resolveCards(b);
  const n = cards.length;
  if (!new RegExp(`^${n} `).test(b.sayings.h2)) throw new Error(`${b.slug}: sayings h2 should start with the card count (${n}): ${b.sayings.h2}`);
  const fit = fitFor(b); const name = b.fit.name;
  const path = `/${b.slug}-dog-tags/`; const url = ORIGIN + path;
  const faqItems = b.faq.items.map((x) => (x.shapeFit ? { q: fill(fit.faqQ, name), a: fill(fit.faqA, name) } : x));
  const hasPhotos = cards.some((c) => c.file);
  const relBreeds = b.related.breeds.map((s) => { if (!bySlug[s]) throw new Error(`${b.slug}: related breed ${s} has no page`); return `<a class="lp-go" href="/${s}-dog-tags/">${esc(bySlug[s].crumb)}</a>`; });
  const relGuides = b.related.guides.map((g) => `<a class="lp-go" href="${g.href}">${esc(g.text)}</a>`);
  // single-saying pages that fit this breed, and the saying themes that list it (internal links both ways)
  const relSays = [...breedSingles(b.slug).slice(0, 8).map((x) => `<a class="lp-go" href="/sayings/${x.slug}/">${esc(d.SAYINGS[x.index].l.join(' '))}</a>`),
    ...THEMES.filter((t) => t.breeds.includes(b.slug)).map((t) => `<a class="lp-go" href="/sayings/${t.slug}/">${esc(THEME_NAME[t.slug] || t.slug)} sayings &rarr;</a>`)];
  const secs = [];
  const sec = (id, inner, extra = '') => secs.push({ id, inner, extra });
  sec('tough', `  <div class="wrap lp-split">
    <h2>${esc(b.sections.tough.h2)}</h2>
    <div class="lp-prose">
${b.sections.tough.html.split('\n').map((l) => '      ' + l).join('\n')}
    </div>
  </div>`);
  if (b.sections.pack) sec('pack', `  <div class="wrap lp-split">
    <h2>${esc(b.sections.pack.h2)}</h2>
    <div class="lp-prose">
${b.sections.pack.html.split('\n').map((l) => '      ' + l).join('\n')}
    </div>
  </div>`);
  sec('shapes', `  <div class="wrap lp-split">
    <h2>${esc(fill(FITS.heading, name))}</h2>
    <div class="lp-prose">
      <p>${esc(fill(fit.body, name))}</p>
      <p>Stainless and brass add $4, polished adds $6. The preview in the builder is exactly what we engrave.</p>
      <p><a class="lp-go" href="/#build">Pick a shape in the builder &rarr;</a></p>
    </div>
  </div>`);
  sec('sayings', `  <div class="wrap">
    <div class="sec__head sec__head--split">
      <h2>${esc(b.sayings.h2)}</h2>
      <p class="lead">${b.sayings.lead}</p>
    </div>
    ${hasPhotos ? '<ol class="grid grid--tags lp-says">' : '<div class="grid saycards">'}
${cards.map((c) => cardHtml(b, c)).join('\n')}
    ${hasPhotos ? '</ol>' : '</div>'}
    <div class="lp-says__foot">
      <p class="note">${b.sayings.note}</p>
      <p class="lp-links"><a class="lp-go" href="/#build">Open the builder &rarr;</a><a class="lp-go" href="/sayings/">Browse every saying &rarr;</a></p>
    </div>
  </div>`);
  const m = b.sections.more;
  sec('more', `  <div class="wrap lp-close">
    <h2>${esc(m.h2)}</h2>
    <p class="lead">${m.lead}</p>
    <div class="actions">
      <a class="btn btn--coral" href="/#build">Start from scratch in the builder &rarr;</a>${m.alt ? `
      <a class="actions__alt" href="${m.alt.href}">${m.alt.text}</a>` : ''}
    </div>
  </div>`);
  const body = secs.map((s, i) => `<section class="sec${i % 2 ? ' sec--band' : ''}" id="${s.id}">\n${s.inner}\n</section>`).join('\n\n');
  const lead = cards[0];
  const productLd = jsonProduct({ id: `${url}#tag`, name: b.product.name, description: b.product.description.replace(/\bmade in\b/gi, 'engraved in'),
    image: productImage(b, lead), url, price: lead.price, sku: `sdt-breed-${b.slug}`, material: materialFor(lead.finish), color: d.finishName(lead.finish) });
  const head = headHtml({
    title: b.title, description: b.description, path, ogSlug: b.slug,
    preload: b.slug === 'bulldog' ? '<link rel="preload" as="image" href="/assets/whisky-tag-real.jpg?v=55">' : '',
    jsonld: [jsonFaq(`${url}#faq`, faqItems), productLd, jsonBreadcrumb([['Salty Dog Tags', '/'], ['Dog Tags by Breed', '/dog-tags-by-breed/'], [b.breadcrumbName, path]])],
  });
  const html = `<a class="skip" href="#sayings">Skip to the sayings</a>

${navHtml([['/', 'All tags'], ['#sayings', 'Sayings'], ['#shapes', 'Shapes'], ['#faq', 'FAQ']])}

<main id="main" tabindex="-1">
<header class="hero lp-hero">
  <div class="hero__in">
    <div class="hero__head">
      ${crumbsHtml([['Salty Dog Tags', '/'], ['By breed', '/dog-tags-by-breed/'], [esc(b.crumb)]])}
      <h1>${esc(b.h1)}</h1>
      <p class="hero__blurb">${b.blurb}</p>
    </div>
    <figure class="hero__art lp-photo">
      <img src="/assets/whisky-tag-real.jpg?v=55" width="635" height="384" alt="${esc(b.hero.alt)}" fetchpriority="high">
      <figcaption>${b.hero.figcaption}</figcaption>
    </figure>
    <div class="hero__cta">
      <div class="actions">
        <a class="btn btn--coral" href="/#build">${esc(b.cta)}</a>
        <a class="actions__alt" href="#sayings">or read all ${n} ${esc(b.sayName)} sayings</a>
      </div>
      <ul class="trust" aria-label="What you get">
        <li><b>From $12 a tag</b> both sides engraved</li>
        <li><b>Shipped in 1&ndash;2 business days</b> USPS 3&ndash;5 days, US only</li>
        <li><b>Free remake</b> if we mis-engrave</li>
      </ul>
    </div>
  </div>
</header>

${body}

<!--related-->
<section class="sec related" id="related">
  <div class="wrap">
    <h2>More breeds</h2>
    <p class="lp-links">${lis(relBreeds)}<a class="lp-go" href="/dog-tags-by-breed/">All breeds &rarr;</a></p>${relSays.length ? `
    <h2>Sayings that fit ${esc(fill('{a} {breed}', name))}</h2>
    <p class="lp-links">${lis(relSays)}</p>` : ''}
    <h2>Related guides</h2>
    <p class="lp-links">${lis(relGuides)}<a class="lp-go" href="/guides/">All guides &rarr;</a></p>
  </div>
</section>
<!--/related-->

<section class="sec sec--band faq" id="faq">
  <div class="wrap faq__in">
    <div class="sec__head">
      <p class="eyebrow">Questions humans ask</p>
      <h2>${esc(b.faq.h2)}</h2>
      <p class="lead">Still stuck? <a href="mailto:hello@saltydogtags.com">hello@saltydogtags.com</a>. A human answers. The dogs supervise.</p>
    </div>
    <div class="faq__list">
${faqItems.map((x, i) => `      <details${i === 0 ? ' open' : ''}><summary>${esc(x.q)}</summary><p>${x.shapeFit ? esc(x.a) : x.a}</p></details>`).join('\n')}
    </div>
  </div>
</section>
</main>

${footerHtml({ faqHref: '#faq' })}`;
  return { html: page({ head, body: html, bodyClass: 'lp' }), cards, faqItems };
}

/* ---------- /dog-tags-by-breed/ hub ---------- */
const HUB = JSON.parse(readFileSync(join(BREEDS_DIR, '_hub.json'), 'utf8'));
function renderHub() {
  const path = '/dog-tags-by-breed/';
  const cardsHtml = HUB.breeds.map((h) => {
    if (!bySlug[h.slug]) throw new Error('hub: unknown breed ' + h.slug);
    return `      <a class="saycard hubcard" href="/${h.slug}-dog-tags/"><p class="hubcard__name">${esc(h.name)}</p><p class="saycard__text">${h.samples.map((s) => `&ldquo;${esc(s)}&rdquo;`).join('<br>')}</p><span class="saycard__row"><span class="saycard__price">from $12</span><span class="saycard__cta">${esc(h.link)} &rarr;</span></span></a>`;
  }).join('\n');
  const itemList = { '@context': 'https://schema.org', '@type': 'CollectionPage', '@id': ORIGIN + path, name: 'Dog Tags by Breed', description: HUB.description,
    mainEntity: { '@type': 'ItemList', itemListElement: HUB.breeds.map((h, i) => ({ '@type': 'ListItem', position: i + 1, name: `${h.name} Dog Tags`, url: `${ORIGIN}/${h.slug}-dog-tags/` })) } };
  const head = headHtml({ title: HUB.title, description: HUB.description, path, ogSlug: 'dog-tags-by-breed', jsonld: [itemList, jsonBreadcrumb([['Salty Dog Tags', '/'], ['Dog Tags by Breed', path]])] });
  const body = `<a class="skip" href="#breeds">Skip to the breeds</a>

${navHtml([['/', 'All tags'], ['/sayings/', 'Sayings'], ['/guides/', 'Guides']])}

<main id="main" tabindex="-1">
<section class="sec" id="breeds">
  <div class="wrap">
    ${crumbsHtml([['Salty Dog Tags', '/'], ['By breed']])}
    <div class="sec__head sec__head--split">
      <h1>Dog Tags by Breed</h1>
      <p class="lead">${HUB.lead}</p>
    </div>
    <div class="grid saycards hubcards">
${cardsHtml}
    </div>
    <div class="lp-says__foot">
      <p class="note">${HUB.note}</p>
      <p class="lp-links"><a class="lp-go" href="/#build">Build a tag &rarr;</a><a class="lp-go" href="/guides/">Read the guides &rarr;</a><a class="lp-go" href="/utah-dog-tags/">Engraved in Lehi, Utah &rarr;</a></p>
    </div>
  </div>
</section>
</main>

${footerHtml({ faqHref: '/#faq' })}`;
  return page({ head, body, bodyClass: 'lp' });
}

/* ---------- write ---------- */
let wrote = 0;
for (const b of breeds) {
  const { html } = renderBreed(b);
  writeFileSync(join(SITE, `${b.slug}-dog-tags`, 'index.html'), html);
  wrote++;
}
writeFileSync(join(SITE, 'dog-tags-by-breed', 'index.html'), renderHub());
writeFileSync(join(ROOT, 'tools', 'out', 'breed-images.json'), JSON.stringify(breedImages, null, 1) + '\n');
console.log(`build-breeds: ${wrote} breed pages + the by-breed hub`);
