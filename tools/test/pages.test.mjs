// node --test 'tools/test/*.test.mjs'
// Guards the generated pages: deep links, prices, wording, schema, fonts, sitemap, robots, headers, feeds.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { appData, read, ROOT } from '../lib/appdata.mjs';
import { roomy } from '../lib/cards.mjs';

const d = appData();
const SITE = join(ROOT, 'site');
const walk = (dir, out = []) => { for (const e of readdirSync(dir)) { const p = join(dir, e); if (statSync(p).isDirectory()) { if (e !== 'assets') walk(p, out); } else if (e.endsWith('.html')) out.push(p); } return out; };
const pages = walk(SITE).map((f) => ({ rel: relative(SITE, f), html: readFileSync(f, 'utf8') }));
const page = (rel) => pages.find((p) => p.rel === rel).html;
const unescapeAttr = (s) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#x27;/g, "'");
const jsonld = (html) => [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)].map((m) => JSON.parse(m[1]));
const CITY_PAGES = ['utah-dog-tags/index.html', 'st-george-dog-tags/index.html']; // same folder pattern, not breeds
const breedPages = pages.filter((p) => /^[a-z-]+-dog-tags\/index\.html$/.test(p.rel) && !CITY_PAGES.includes(p.rel));
const clean = d.SAYINGS.map((s, i) => ({ ...s, i })).filter((s) => !s.x);
const joined = (s) => s.l.join(' ').toLowerCase();
const COUNT = JSON.parse(read('tools/out/sayings-count.json')).clean;

test('breed pages: 24 of them, plus the hub', () => { assert.equal(breedPages.length, 24); assert.ok(page('dog-tags-by-breed/index.html')); });

test('breed cards: every Use this link opens the builder with that exact saying, shape and finish, and the printed price is the price that loads', () => {
  let cards = 0;
  for (const p of breedPages) {
    // text cards and bulldog photo cards
    for (const m of p.html.matchAll(/<a class="(?:saycard|say say--link)" href="([^"]+)">(.*?)<\/a>/gs)) {
      const href = unescapeAttr(m[1]); const body = m[2]; cards++;
      const u = /^\/#build\?(s=(\d+)|t=([^&]+))&shape=([a-z]+)&finish=([a-z]+)$/.exec(href);
      assert.ok(u, `${p.rel}: bad card link ${href}`);
      const [, , idx, t, shape, finish] = u;
      assert.ok(d.visibleShapes.includes(shape) && d.finishOk(finish, shape), `${p.rel}: ${shape}/${finish} is not a real blank`);
      const text = [...body.matchAll(/<(?:p class="saycard__text"|span class="say__name")>(.*?)<\/(?:p|span)>/gs)][0][1].replace(/<br>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&');
      if (idx != null) {
        assert.ok(!d.SAYINGS[+idx].x, `${p.rel}: s=${idx} is 18+`);
        assert.equal(joined(d.SAYINGS[+idx]), text.toLowerCase().replace(/\s+/g, ' '), `${p.rel}: s=${idx} is not the card text`);
      } else {
        const lines = decodeURIComponent(t).split('|');
        assert.equal(lines.join(' '), text, `${p.rel}: t= does not match the card`);
        assert.ok(lines.length <= 3 && lines.every((l) => l.length > 0 && l.length <= 24), `${p.rel}: t= lines out of range`);
        assert.ok(!clean.some((s) => joined(s) === text.toLowerCase()), `${p.rel}: "${text}" exists verbatim in SAYINGS, so it should use s=`);
      }
      const price = /(?:saycard__price">[^<]*?|<span>)\$(\d+)/.exec(body);
      assert.equal(+price[1], d.priceFor(shape, finish), `${p.rel}: card price vs tables for ${shape}/${finish}`);
    }
  }
  assert.ok(cards >= 24 * 8, 'cards found: ' + cards);
});

test('bulldog page: alt text follows the pattern and the Snake Eyes card loads what it shows', () => {
  const h = page('bulldog-dog-tags/index.html');
  assert.match(h, /alt="Black bone bulldog dog tag engraved &quot;I snore\. It&#x27;s a lifestyle\.&quot;"/);
  assert.match(h, /alt="Red round bulldog dog tag engraved &quot;Drool happens\.&quot;"/);
  assert.match(h, /href="\/#build\?s=1&amp;shape=round&amp;finish=red"/);
  assert.ok(!/alt="[A-Za-z ]+ tag"/.test(h), 'old "Black bone tag" alt text is gone');
  assert.equal([...h.matchAll(/<img src="\/assets\/bulldog\//g)].length, 12);
});

test('breed pages: no size recommendations left, the shape-fits block is in, FAQ and JSON-LD agree', () => {
  for (const p of breedPages) {
    const text = p.html.replace(/<script type="application\/ld\+json">.*?<\/script>/gs, (s) => s); // keep JSON-LD in scope on purpose
    assert.ok(!/go Large|go Medium|Short answer|lp-sizes|2-inch Large|\(1\.5 inch\)|\(2 inch\)|Small \(1 inch/.test(text), `${p.rel}: old size advice remains`);
    assert.match(p.html, /<h2>Which shape fits your [^<]+<\/h2>/);
    assert.match(p.html, /id="shapes"/);
    const faq = jsonld(p.html).find((j) => j['@type'] === 'FAQPage');
    const items = [...p.html.matchAll(/<details[^>]*><summary>(.*?)<\/summary><p>(.*?)<\/p><\/details>/gs)];
    assert.equal(faq.mainEntity.length, items.length, `${p.rel}: FAQ html vs JSON-LD count`);
    assert.match(faq.mainEntity[0].name, /^Which tag shape fits an? /);
  }
});

test('breed pages: variant pairing (tiny, medium, large) picks the right shape-fits text', () => {
  const has = (slug, re) => assert.match(page(`${slug}-dog-tags/index.html`), re, slug);
  for (const s of ['chihuahua', 'pomeranian', 'yorkie', 'shih-tzu', 'poodle']) has(s, /Skip the military/);
  for (const s of ['beagle', 'corgi', 'boxer', 'aussie', 'dachshund', 'frenchie', 'pug']) has(s, /the sweet spot is the bone, heart or paw/);
  for (const s of ['bulldog', 'lab', 'golden-retriever', 'german-shepherd', 'great-dane', 'bernese', 'rottweiler', 'doberman', 'husky', 'doodle']) has(s, /Leave the round for the lapdogs/);
  has('aussie', /For an Aussie/);
});

test('breed pages: related-breed and guide links asked for', () => {
  const linksTo = (page_, slug) => assert.match(page(`${page_}-dog-tags/index.html`), new RegExp(`<section class="sec related" id="related">[\\s\\S]*href="/${slug}-dog-tags/"`), `${page_} -> ${slug}`);
  for (const p of ['corgi', 'german-shepherd', 'husky']) linksTo(p, 'aussie');
  for (const p of ['great-dane', 'golden-retriever', 'doodle']) linksTo(p, 'bernese');
  for (const p of ['frenchie', 'pug', 'bulldog']) linksTo(p, 'boston-terrier');
  for (const p of ['poodle', 'shih-tzu', 'yorkie']) linksTo(p, 'cavalier');
  for (const p of ['bulldog', 'frenchie']) for (const g of ['dog-birthday-ideas', 'gifts-for-bulldog-owners']) assert.match(page(`${p}-dog-tags/index.html`), new RegExp(`href="/guides/${g}/"`), `${p} -> ${g}`);
});

test('every page: logo v=50 everywhere, no dead #faq footer link, no "Made in Lehi", no pickup, policies + privacy in the footer', () => {
  const homeV = /logo-final-icon\.svg\?v=(\d+)/.exec(read('site/index.html'))[1];
  for (const p of pages.filter((x) => x.rel !== 'index.html')) {
    for (const m of p.html.matchAll(/\/assets\/logo\/[\w.-]+\?v=(\d+)/g)) assert.equal(m[1], homeV, `${p.rel}: logo cache buster`);
    if (p.rel === 'orders.html') continue; // owner admin page: legacy pickup orders still display
    assert.ok(!/Made in Lehi|made in Lehi/.test(p.html), `${p.rel}: made in`);
    assert.ok(!/pick ?up at the|trailer pickup|free pickup|Pickup at/i.test(p.html.replace(/<script.*?<\/script>/gs, '')), `${p.rel}: pickup`);
    if (/<footer class="foot">/.test(p.html)) {
      assert.match(p.html, /href="\/policies\/"/, `${p.rel}: footer policies link`);
      if (!/id="faq"/.test(p.html)) assert.ok(!/<a href="#faq">/.test(p.html), `${p.rel}: dead #faq link`);
    }
  }
  for (const rel of ['guides/index.html', 'dog-tags-by-breed/index.html']) assert.match(page(rel), /<a href="\/#faq">FAQ<\/a>/);
});

test('fonts: non-blocking pattern on every page; /sayings/ and /roast/ load only the four core families', () => {
  for (const p of pages.filter((x) => x.rel !== 'index.html')) {
    if (!/fonts\.googleapis\.com\/css2/.test(p.html)) continue;
    assert.match(p.html, /<link rel="preload" as="style" href="https:\/\/fonts\.googleapis\.com/, p.rel);
    assert.match(p.html, /media="print" onload="this\.media='all'"/, p.rel);
    assert.match(p.html, /<noscript><link rel="stylesheet" href="https:\/\/fonts\.googleapis\.com/, p.rel);
    assert.equal([...p.html.replace(/<noscript>.*?<\/noscript>/gs, '').matchAll(/<link rel="stylesheet" href="https:\/\/fonts\.googleapis\.com[^>]*>/g)].filter((m) => !/media="print"/.test(m[0])).length, 0, `${p.rel}: blocking font stylesheet`);
  }
  for (const rel of ['sayings/index.html', 'roast/index.html']) {
    const fams = [...new Set([...page(rel).matchAll(/family=([^&:"]+)/g)].map((m) => m[1]))].sort();
    assert.deepEqual(fams, ['Archivo', 'Archivo+Black', 'Bungee', 'DM+Mono'], rel);
  }
});

test('metas: brand suffix, title and description lengths, one title per page, share images', () => {
  const seen = new Map();
  for (const p of pages) {
    if (['404.html', 'thanks.html', 'orders.html', 'claim.html', 'my.html', 'index.html'].includes(p.rel)) continue; // home is owned by the storefront work
    const title = unescapeAttr(/<title>(.*?)<\/title>/s.exec(p.html)[1]);
    const desc = unescapeAttr(/<meta name="description" content="([^"]*)"/.exec(p.html)[1]);
    if (p.rel !== 'index.html') assert.ok(title.length <= 60, `${p.rel}: title ${title.length}: ${title}`);
    if (title.length + 16 <= 60) assert.ok(title.endsWith('| Salty Dog Tags'), `${p.rel}: could carry the brand suffix: ${title}`);
    assert.ok(desc.length >= 100 && desc.length <= 160, `${p.rel}: description ${desc.length}`);
    assert.ok(!seen.has(title), `${p.rel}: duplicate title with ${seen.get(title)}`); seen.set(title, p.rel);
    assert.match(p.html, /<meta property="og:image" content="https:\/\/saltydogtags\.com\/assets\/og\/[a-z0-9-]+\.jpg">/, p.rel);
    assert.match(p.html, /og:image:width" content="1200"/); assert.match(p.html, /og:image:height" content="630"/);
    assert.match(p.html, /twitter:card" content="summary_large_image"/);
    assert.match(p.html, /twitter:image" content="https:\/\/saltydogtags\.com\/assets\/og\/[a-z0-9-]+\.jpg"/);
    const img = /og:image" content="https:\/\/saltydogtags\.com\/assets\/og\/([a-z0-9-]+\.jpg)"/.exec(p.html)[1];
    assert.ok(existsSync(join(SITE, 'assets/og', img)), `${p.rel}: ${img} does not exist`);
  }
  for (const rel of ['cavalier-dog-tags', 'dachshund-dog-tags', 'utah-dog-tags']) { const n = unescapeAttr(/<meta name="description" content="([^"]*)"/.exec(page(rel + '/index.html'))[1]).length; assert.ok(n >= 135 && n <= 155, `${rel}: ${n}`); }
  assert.ok(unescapeAttr(/<meta name="description" content="([^"]*)"/.exec(page('roast/index.html'))[1]).length <= 155);
  const wallN = unescapeAttr(/<meta name="description" content="([^"]*)"/.exec(page('wall/index.html'))[1]).length; assert.ok(wallN >= 135 && wallN <= 155, 'wall ' + wallN);
});

test('/sayings/: only the clean sayings, counts from sayings-count.json, themes linked at the top', () => {
  const h = page('sayings/index.html');
  assert.equal([...h.matchAll(/<a class="saycard"(?: id="s-\d+")? href="\/#build\?s=(\d+)[&"]/g)].length, COUNT);
  for (const m of h.matchAll(/<a class="saycard"(?: id="s-\d+")? href="\/#build\?s=(\d+)[&"]/g)) assert.ok(!d.SAYINGS[+m[1]].x);
  assert.match(/<title>(.*?)<\/title>/.exec(h)[1], new RegExp(`${COUNT} One-Liners`));
  assert.match(h, new RegExp(`content="Browse ${COUNT} funny`));
  assert.match(h, new RegExp(`<p class="lead">${COUNT} lines`));
  assert.ok(!/180\+|\b9\d\+/.test(h));
  const itemList = jsonld(h).find((j) => j['@type'] === 'ItemList'); assert.equal(itemList.numberOfItems, COUNT); assert.equal(itemList.itemListElement.length, COUNT);
  const hubAt = h.indexOf('aria-label="Sayings by theme"'); const firstSection = h.indexOf('id="say-');
  assert.ok(hubAt > 0 && hubAt < firstSection);
  for (const t of ['lost-and-found', 'attitude', 'family', 'beach', 'bulldog-life', 'certified-cute']) assert.match(h, new RegExp(`href="/sayings/${t}/"`));
  const adultText = d.SAYINGS.filter((s) => s.x).map((s) => s.l.join(' '));
  for (const t of adultText.slice(0, 20)) assert.ok(!h.includes(t.replace(/'/g, '&#x27;')), `18+ saying leaked into /sayings/: ${t}`);
});

test('/sayings/salty/: noindex,follow, age gate on sdt-adult, fail-closed, not in the sitemap or robots-allowed', () => {
  const h = page('sayings/salty/index.html');
  assert.match(h, /<meta name="robots" content="noindex,follow">/);
  assert.match(h, /sdt-adult/); assert.match(h, /<dialog class="adult-gate" id="adultGate"/);
  assert.match(h, /<section[^>]*id="salty-list" hidden>/);
  assert.equal([...h.matchAll(/<a class="saycard"/g)].length, d.adultCount);
  assert.ok(!read('site/sitemap.xml').includes('/sayings/salty/'));
  // robots must NOT block it: a blocked URL can still be listed; the noindex tag only works if Google can fetch the page
  assert.ok(!/sayings\/salty/.test(read('site/robots.txt')));
});

test('theme pages: six, indices rendered, schema, three related breeds, cross-links to single pages', () => {
  const themes = JSON.parse(read('tools/data/themes.json')).themes; const singles = JSON.parse(read('tools/data/top-sayings.json')).singles;
  assert.equal(themes.length, 6);
  for (const t of themes) {
    const h = page(`sayings/${t.slug}/index.html`);
    assert.equal([...h.matchAll(/<a class="saycard"(?: id="s-\d+")? href="\/#build\?s=(\d+)[&"]/g)].map((m) => +m[1]).join(), t.indices.join(), t.slug);
    assert.ok(t.indices.every((i) => !d.SAYINGS[i].x));
    const ld = jsonld(h); assert.ok(ld.find((j) => j['@type'] === 'BreadcrumbList')); assert.equal(ld.find((j) => j['@type'] === 'ItemList').itemListElement.length, t.indices.length);
    assert.equal(t.breeds.length, 3); for (const b of t.breeds) assert.match(h, new RegExp(`href="/${b}-dog-tags/"`));
    for (const s of singles.filter((x) => t.indices.includes(x.index))) assert.match(h, new RegExp(`href="/sayings/${s.slug}/"`), `${t.slug} -> ${s.slug}`);
    assert.match(h, new RegExp(`<h1>${t.h1.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}</h1>`));
  }
});

// The Offer every Product on a breed or single-saying page carries: one price, the page's own URL, the shop's real shipping and returns.
function assertOffer(where, node, url, price) {
  const o = node.offers;
  assert.equal(o['@type'], 'Offer', where); assert.equal(o.url, url, where); assert.equal(o.price, price.toFixed(2), where);
  assert.equal(o.priceCurrency, 'USD'); assert.equal(o.availability, 'https://schema.org/InStock');
  const sh = o.shippingDetails; assert.equal(sh['@type'], 'OfferShippingDetails'); assert.equal(sh.shippingRate.value, 4.5); assert.equal(sh.shippingDestination.addressCountry, 'US');
  assert.deepEqual([sh.deliveryTime.handlingTime.minValue, sh.deliveryTime.handlingTime.maxValue, sh.deliveryTime.transitTime.minValue, sh.deliveryTime.transitTime.maxValue], [1, 2, 3, 5]);
  assert.match(sh.description, /free on orders of \$35/);
  assert.equal(o.hasMerchantReturnPolicy.returnPolicyCategory, 'https://schema.org/MerchantReturnNotPermitted'); assert.match(o.hasMerchantReturnPolicy.description, /free remake/);
  assert.ok(!/aggregateRating|"review"|AggregateOffer/i.test(JSON.stringify(node)), where + ': no ratings, no AggregateOffer');
  for (const img of node.image) assert.ok(existsSync(join(SITE, new URL(img).pathname)), `${where}: image ${img} missing`);
}

test('single-saying pages: 30, tag preview, Product with one Offer at the printed price, own image, Engrave it CTA, title saying-first', () => {
  const singles = JSON.parse(read('tools/data/top-sayings.json')).singles;
  assert.equal(singles.length, 30);
  const images = new Set();
  for (const s of singles) {
    const h = page(`sayings/${s.slug}/index.html`); const url = `https://saltydogtags.com/sayings/${s.slug}/`;
    assert.match(h, /<figure class="saytag">\s*<svg/);
    const cta = new RegExp(`<a class="btn btn--coral" href="/#build\\?s=${s.index}&amp;shape=([a-z]+)&amp;finish=([a-z]+)">Engrave it`).exec(h); assert.ok(cta, s.slug);
    const ld = jsonld(h); assert.deepEqual(ld.map((j) => j['@type']), ['Product', 'BreadcrumbList']);
    const prod = ld[0]; const printed = +/<figcaption>.*? &middot; \$(\d+)<\/figcaption>/.exec(h)[1];
    assert.equal(printed, d.priceFor(cta[1], cta[2]), s.slug);
    assertOffer(s.slug, prod, url, printed);
    assert.equal(prod.sku, `sdt-s${s.index}`); assert.equal(prod.image[0], `https://saltydogtags.com/assets/feed/s${s.index}.jpg`); images.add(prod.image[0]);
    assert.ok(s.title.length <= 60);
    const text = d.SAYINGS[s.index].l.join(' ').toLowerCase().replace(/[.,!?:]+$/, '');
    assert.ok(s.title.toLowerCase().startsWith(text.replace(/[.,!?:]+$/, '')), `${s.slug}: title should start with the saying: ${s.title}`);
    assert.match(h, /href="\/[a-z-]+-dog-tags\/">/, `${s.slug}: links back to a breed`);
  }
  assert.equal(images.size, 30, 'every single-saying page has its own product image');
});

test('breed pages: Product with one Offer = the first saying card (its printed price and its picture), breed-first varied titles', () => {
  const images = new Set(); const firstClauses = new Set();
  for (const p of breedPages) {
    const slug = p.rel.split('-dog-tags/')[0]; const url = `https://saltydogtags.com/${slug}-dog-tags/`;
    const prod = jsonld(p.html).find((j) => j['@type'] === 'Product'); assert.ok(prod, p.rel);
    const first = /<a class="(?:saycard|say say--link)" href="[^"]+">.*?(?:saycard__price">[A-Za-z]+ &middot; |<span class="say__t"><span>)\$(\d+)/s.exec(p.html);
    assertOffer(p.rel, prod, url, +first[1]);
    assert.equal(prod.image.length, 1); images.add(prod.image[0]);
    const title = unescapeAttr(/<title>(.*?)<\/title>/.exec(p.html)[1]);
    assert.ok(title.length <= 60 && title.endsWith(' | Salty Dog Tags'), title);
    assert.ok(!/ — Funny Engraved/.test(title), `${p.rel}: template title ${title}`);
    firstClauses.add(title.replace(/^.*? Dog Tags/, ''));
  }
  assert.equal(images.size, 24, 'every breed page has its own product image');
  assert.ok(firstClauses.size >= 20, 'breed titles should not share one pattern');
});

test('merchant feed: 181 items, each lands on a page that shows the same price; single-saying items land on their own page', () => {
  const xml = read('site/feeds/google-products.xml');
  const items = [...xml.matchAll(/<item>(.*?)<\/item>/gs)].map((m) => Object.fromEntries([...m[1].replace(/<g:shipping>.*?<\/g:shipping>/s, '').matchAll(/<g:([a-z_]+)>([^<]*)<\/g:\1>/g)].map((x) => [x[1], x[2]])));
  assert.equal(items.length, COUNT);
  const singles = new Map(JSON.parse(read('tools/data/top-sayings.json')).singles.map((s) => [s.index, s]));
  const idx = page('sayings/index.html');
  let own = 0;
  for (const it of items) {
    const i = +/^sdt-s(\d+)$/.exec(it.id)[1]; const price = +it.price.replace(' USD', '');
    assert.ok(existsSync(join(SITE, new URL(it.image_link).pathname)), it.id + ' image');
    if (singles.has(i)) {
      own++; const s = singles.get(i);
      assert.equal(it.link, `https://saltydogtags.com/sayings/${s.slug}/`);
      const prod = jsonld(page(`sayings/${s.slug}/index.html`)).find((j) => j['@type'] === 'Product');
      assert.equal(prod.offers.price, price.toFixed(2), it.id); assert.equal(prod.sku, it.id); assert.equal(prod.image[0], it.image_link);
    } else {
      assert.equal(it.link, `https://saltydogtags.com/sayings/#s-${i}`);
      const card = new RegExp(`<a class="saycard" id="s-${i}" href="[^"]+">.*?saycard__price">\\$(\\d+)<`, 's').exec(idx); assert.ok(card, it.id + ' anchor');
      assert.equal(+card[1], price, it.id + ' card price');
    }
    assert.equal(it.availability, 'in_stock');
  }
  assert.equal(own, 30);
});

test('/utah-dog-tags/: no pickup, @id reference to #business (no second business node), five-question FAQ, eight t= cards, about 900 words', () => {
  const h = page('utah-dog-tags/index.html'); const ld = jsonld(h);
  assert.ok(!/pickup|pick up/i.test(h));
  assert.ok(!ld.some((j) => [].concat(j['@type']).some((t) => ['LocalBusiness', 'Store', 'Organization'].includes(t))));
  assert.deepEqual(ld.find((j) => j['@type'] === 'WebPage').about, { '@id': 'https://saltydogtags.com/#business' });
  assert.equal(ld.find((j) => j['@type'] === 'FAQPage').mainEntity.length, 5);
  assert.equal([...h.matchAll(/<a class="saycard" href="\/#build\?t=/g)].length, 8);
  const words = h.slice(h.indexOf('<main'), h.indexOf('</main>')).replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length + 120;
  assert.ok(words > 800 && words < 1100, 'words ' + words);
  assert.match(h, /dog-parks-utah-county\/#lehi/);
});

test('/policies/ and /privacy/: anchors, no confirm markers, no pickup, the contest says what it must', () => {
  const pol = page('policies/index.html'), priv = page('privacy/index.html');
  for (const id of ['terms', 'shipping', 'returns', 'cancellations', 'contest', 'content', 'law']) assert.match(pol, new RegExp(`<h2 id="${id}">`), id);
  for (const h of [pol, priv]) {
    assert.ok(!/NICK TO CONFIRM|\[NICK/.test(h)); assert.ok(!/trailer|pickup|pick up/i.test(h.replace(/<script.*?<\/script>/gs, '')));
    assert.ok(!/noindex/.test(h));
  }
  const contest = pol.slice(pol.indexOf('id="contest"'), pol.indexOf('id="law"')).replace(/<[^>]+>/g, ' ');
  for (const re of [/No purchase necessary/i, /judged/i, /#SaltyDogTags/, /hello@saltydogtags\.com/, /United States/, /18 or older/, /parent or guardian/, /one winner each month/i, /owners of Salty Dog Tags/i, /best face/i, /one free tag/i, /shape of our choice/i, /Void where prohibited/i]) assert.match(contest, re);
  assert.ok(!/odds/i.test(contest), 'a judged pick has no odds statement');
  assert.match(pol, /Bulldog Promise/);
  const sm = read('site/sitemap.xml'); assert.match(sm, /\/policies\//); assert.match(sm, /\/privacy\//);
  assert.match(priv, /hashed\) version of your IP/); assert.ok(!/browser type, saved/.test(priv));
});

test('sitemap: every URL is a real indexable page, canonical matches, excluded pages stay out', () => {
  const sm = read('site/sitemap.xml'); const locs = [...sm.matchAll(/<loc>https:\/\/saltydogtags\.com([^<]*)<\/loc>/g)].map((m) => m[1]);
  assert.equal(new Set(locs).size, locs.length);
  for (const l of locs) {
    const f = join(SITE, l, 'index.html'); assert.ok(existsSync(f), l);
    const h = readFileSync(f, 'utf8');
    assert.ok(!/noindex/i.test(/<meta name="robots" content="([^"]*)"/.exec(h)?.[1] || ''), `${l} is noindex`);
    assert.match(h, new RegExp(`<link rel="canonical" href="https://saltydogtags\\.com${l}">`));
  }
  for (const bad of ['/wall/', '/sayings/salty/', '/orders', '/thanks', '/404']) assert.ok(!locs.some((l) => l.startsWith(bad)), bad);
  const indexable = pages.filter((p) => p.rel.endsWith('index.html') && !/noindex/.test(p.html)).length; assert.equal(locs.length, indexable);
  assert.match(sm, /<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/);
});

test('_headers, robots.txt, IndexNow key and merchant feed', () => {
  const hd = read('site/_headers');
  for (const p of ['/thanks', '/thanks.html', '/orders', '/orders.html']) assert.match(hd, new RegExp(`^${p.replace('.', '\\.')}\\n  X-Robots-Tag: noindex$`, 'm'), p);
  assert.match(hd, /^\/assets\/\*\n  Cache-Control: public, max-age=\d+$/m); // covers /assets/og/*
  assert.ok(!/\/assets\/og/.test(hd.replace(/^#.*$/gm, '')), 'no overlapping second cache rule');
  const robots = read('site/robots.txt');
  assert.match(robots, /^Sitemap: https:\/\/saltydogtags\.com\/sitemap\.xml$/m);
  assert.equal(readFileSync(join(SITE, '340e80e49fce4613a1997e1801402e13.txt'), 'utf8'), '340e80e49fce4613a1997e1801402e13');
  const src = read('tools/indexnow.mjs');
  assert.match(src, /api\.indexnow\.org\/indexnow/); assert.match(src, /HOST = 'saltydogtags\.com'/); assert.match(src, /340e80e49fce4613a1997e1801402e13/);
  // The live Merchant Center feed is site/feeds/google-products.xml (tools/build-merchant-feed.mjs, one item per clean saying).
  const feed = read('site/feeds/google-products.xml');
  assert.match(feed, /<rss version="2\.0" xmlns:g="http:\/\/base\.google\.com\/ns\/1\.0">/);
  const items = feed.split('<item>').slice(1);
  assert.ok(items.length >= 150, 'feed has one item per clean saying');
  for (const it of items.slice(0, 20)) { assert.match(it, /<g:availability>in_stock<\/g:availability>/); assert.match(it, /<g:price>[\d.]+ USD<\/g:price>/); }
});

test('internal links: every href on every page resolves to a file (and every #anchor on the same page exists)', () => {
  const missing = [];
  for (const p of pages) {
    const ids = new Set([...p.html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
    for (const m of p.html.matchAll(/<a [^>]*href="([^"]+)"/g)) {
      const href = unescapeAttr(m[1]);
      if (/^(https?:|mailto:|tel:|javascript:)/.test(href)) continue;
      if (href.startsWith('#')) { if (href.length > 1 && !href.startsWith('#build?') && href !== '#play' && !ids.has(href.slice(1))) missing.push(`${p.rel}: ${href}`); continue; }
      const [pathPart, hash] = href.split('#'); const path = pathPart.split('?')[0];
      if (!path.startsWith('/')) continue;
      const cands = [join(SITE, path), join(SITE, path, 'index.html'), join(SITE, path + '.html')];
      const hit = cands.find((c) => existsSync(c) && statSync(c).isFile());
      if (!hit) { missing.push(`${p.rel}: ${href}`); continue; }
      if (hash && !hash.startsWith('build') && hash !== 'play' /* opened by the home page script */ && hit.endsWith('.html') && !new RegExp(`\\sid="${hash}"`).test(readFileSync(hit, 'utf8'))) missing.push(`${p.rel}: ${href} (no #${hash})`);
    }
  }
  assert.deepEqual(missing, []);
});

test('customer-facing wording: no trailer, pickup, made-in or short ship-time claims on any public page', () => {
  const hits = [];
  for (const p of pages) {
    if (p.rel === 'orders.html') continue; // owner-only admin page (noindex): it still reads old pickup orders
    const text = p.html.replace(/<!--.*?-->/gs, ''); // dev comments are not shown to anyone
    for (const [name, re] of [['trailer', /trailer/i], ['pickup', /pick-?up/i], ['made in', /made in (lehi|utah|the usa)/i], ['ships in 3', /ships? in 3|ship it in 3/i], ['90+', /90\+|ninety\+/i], ['unresolved marker', /\[NICK TO CONFIRM/i]]) {
      if (re.test(text)) hits.push(`${p.rel}: ${name}`);
    }
  }
  assert.deepEqual(hits, []);
});

test('ship time is stated the same way everywhere it appears: 1 to 2 business days, then USPS 3 to 5 days', () => {
  const bad = [];
  for (const p of pages) {
    if (p.rel === 'orders.html') continue;
    for (const m of p.html.matchAll(/[^.<>]{0,60}\b3(?: to |&ndash;|-)5 days[^.<>]{0,40}/g)) {
      if (!/USPS|transit|after that|in transit/i.test(m[0] + p.html.slice(m.index + m[0].length, m.index + m[0].length + 40)) && !/1(?: to |&ndash;)2 business days/.test(p.html.slice(Math.max(0, m.index - 160), m.index + m[0].length + 40))) bad.push(`${p.rel}: ${m[0].trim()}`);
    }
  }
  assert.deepEqual(bad, []);
});

test('sayings, theme and single-page cards: the printed price is the price for the link\'s shape and finish, and that shape fits the saying', () => {
  const themes = JSON.parse(read('tools/data/themes.json')).themes; const singles = JSON.parse(read('tools/data/top-sayings.json')).singles;
  const rels = ['sayings/index.html', 'sayings/salty/index.html', ...themes.map((t) => `sayings/${t.slug}/index.html`)];
  let n = 0;
  for (const rel of rels) for (const m of page(rel).matchAll(/<a class="saycard"(?: id="s-\d+")? href="([^"]+)">.*?saycard__price">\$(\d+)</gs)) {
    const u = /^\/#build\?s=(\d+)&amp;shape=([a-z]+)&amp;finish=([a-z]+)$/.exec(m[1]); assert.ok(u, `${rel}: ${m[1]}`);
    const [, i, shape, finish] = u; n++;
    assert.ok(d.finishOk(finish, shape), `${rel}: s=${i} ${shape}/${finish}`);
    assert.equal(+m[2], d.priceFor(shape, finish), `${rel}: s=${i} price vs ${shape}/${finish}`);
    assert.ok(roomy(shape, d.SAYINGS[+i].l, finish) || !['bone', 'military', 'heart', 'round', 'paw'].some((s) => roomy(s, d.SAYINGS[+i].l, finish)), `${rel}: s=${i} does not fit ${shape}`);
  }
  assert.ok(n > COUNT);
  for (const s of singles) {
    const h = page(`sayings/${s.slug}/index.html`);
    const cta = /href="\/#build\?s=\d+&amp;shape=([a-z]+)&amp;finish=([a-z]+)">Engrave it/.exec(h); const cap = /<figcaption>.*? &middot; \$(\d+)<\/figcaption>/.exec(h);
    assert.equal(+cap[1], d.priceFor(cta[1], cta[2]), s.slug);
  }
  // every clean card loads on a shape where the real builder says the text fits (so it never moves the saying and changes the price);
  // includes s=35, 200, 299, 266, 338 and 288, the long sayings that used to be priced at the gallery shape
  const fx = JSON.parse(read('tools/test/fixtures/builder-fit.json')).overflows; const idx = page('sayings/index.html');
  for (const m of [...idx.matchAll(/href="\/#build\?s=(\d+)&amp;shape=([a-z]+)&amp;finish=([a-z]+)"/g), ...breedPages.flatMap((p) => [...p.html.matchAll(/href="\/#build\?s=(\d+)&amp;shape=([a-z]+)&amp;finish=([a-z]+)"/g)])]) {
    const t = fx[m[1]]; const over = m[2] === 'bone' && m[3] === 'polished' ? t.polished : t[m[2]];
    assert.equal(over, false, `s=${m[1]} links ${m[2]}/${m[3]} but the builder says it overflows`);
  }
});

test('text-fit heuristic never says a saying fits a shape where the real builder says it is too long', () => {
  const fx = JSON.parse(read('tools/test/fixtures/builder-fit.json')).overflows;
  let checked = 0;
  for (const [i, t] of Object.entries(fx)) {
    for (const shape of ['bone', 'heart', 'round', 'military', 'paw']) { checked++; if (roomy(shape, d.SAYINGS[+i].l, 'black')) assert.equal(t[shape], false, `s=${i} ${shape}: heuristic says fits, builder says overflow`); }
    if (roomy('bone', d.SAYINGS[+i].l, 'polished')) assert.equal(t.polished, false, `s=${i} polished bone`);
  }
  assert.equal(Object.keys(fx).length, COUNT); assert.equal(checked, COUNT * 5);
});

test('every page except the home page has exactly one <main> landmark', () => {
  for (const p of pages.filter((x) => x.rel !== 'index.html')) { if (['404.html', 'thanks.html', 'orders.html'].includes(p.rel)) continue; assert.equal([...p.html.matchAll(/<main[ >]/g)].length, 1, p.rel); assert.equal([...p.html.matchAll(/<\/main>/g)].length, 1, p.rel); }
});

test('script cache busters on every page match the home page', () => {
  const home = page('index.html');
  for (const n of ['app', 'roast', 'share']) {
    const v = new RegExp(`/${n}\\.js\\?v=(\\d+)`).exec(home)?.[1]; if (!v) continue;
    for (const p of pages) for (const m of p.html.matchAll(new RegExp(`/${n}\\.js\\?v=(\\d+)`, 'g'))) assert.equal(m[1], v, `${p.rel}: ${n}.js`);
  }
});

test('privacy page lists only the alert channels the code uses', () => {
  const notify = read('functions/api/_notify.js'); const used = notify.slice(notify.indexOf('export function notifyOrder'));
  assert.ok(!/ntfy/i.test(used)); assert.ok(!/ntfy/i.test(page('privacy/index.html')));
  assert.match(page('privacy/index.html'), /Pushover and\/or Twilio/);
});
