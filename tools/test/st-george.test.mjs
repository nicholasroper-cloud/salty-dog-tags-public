// node --test 'tools/test/*.test.mjs'
// Guards the St. George / Washington County set: /st-george-dog-tags/ and the three guides written by tools/build-pages.mjs
// from tools/data/st-george.json + tools/content/{st-george-*,guide-*}.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { read, ROOT } from '../lib/appdata.mjs';
import { SG, shipFrom, moved, moveVars, fill } from '../lib/local.mjs';

const SITE = join(ROOT, 'site');
const sg = SG();
const html = (rel) => readFileSync(join(SITE, rel), 'utf8');
const jsonld = (h) => [...h.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)].map((m) => JSON.parse(m[1]));
const attr = (s) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#x27;/g, "'");
const visible = (h) => h.replace(/<script.*?<\/script>/gs, '').replace(/<!--.*?-->/gs, '').replace(/<[^>]+>/g, ' ');
const CITY = 'st-george-dog-tags/index.html';
const GUIDES = sg.guides.map((g) => ({ ...g, rel: `guides/${g.slug}/index.html` }));
const ALL = [CITY, ...GUIDES.map((g) => g.rel)];

test('St. George set: one city page and three guides exist, each in the sitemap with its own share image', () => {
  const sm = read('site/sitemap.xml');
  for (const rel of ALL) {
    assert.ok(existsSync(join(SITE, rel)), rel);
    assert.match(sm, new RegExp(`<loc>https://saltydogtags\\.com/${rel.replace('index.html', '').replace(/\./g, '\\.')}</loc>`), rel + ' in sitemap');
    const img = /<meta property="og:image" content="https:\/\/saltydogtags\.com\/assets\/og\/([a-z0-9-]+)\.jpg">/.exec(html(rel))[1];
    assert.notEqual(img, 'home', `${rel}: has its own share image`);
  }
  assert.equal(GUIDES.length, 3);
});

test('St. George set: titles 60 or less, descriptions 140-155, one H1, no unfilled placeholders', () => {
  for (const rel of ALL) {
    const h = html(rel);
    const title = attr(/<title>(.*?)<\/title>/.exec(h)[1]); const desc = attr(/<meta name="description" content="([^"]*)"/.exec(h)[1]);
    assert.ok(title.length <= 60, `${rel}: title ${title.length}`);
    assert.ok(desc.length >= 140 && desc.length <= 155, `${rel}: description ${desc.length}`);
    assert.match(title, /St\. George/, `${rel}: title names the city`);
    assert.equal((h.match(/<h1[ >]/g) || []).length, 1, rel);
    assert.ok(!/\{\{[A-Z_]+\}\}/.test(h), `${rel}: placeholder left`);
  }
});

test('/st-george-dog-tags/: WebPage about #business (no second business node), FAQ, eight t= cards, links to every guide and to Thirsty Beaches', () => {
  const h = html(CITY); const ld = jsonld(h);
  assert.ok(!ld.some((j) => [].concat(j['@type']).some((t) => ['LocalBusiness', 'Store', 'Organization'].includes(t))), 'no business node');
  assert.deepEqual(ld.find((j) => j['@type'] === 'WebPage').about, { '@id': 'https://saltydogtags.com/#business' });
  assert.equal(ld.find((j) => j['@type'] === 'FAQPage').mainEntity.length, sg.faq.length);
  assert.equal([...h.matchAll(/<a class="saycard" href="\/#build\?t=/g)].length, 8);
  for (const g of GUIDES) assert.match(h, new RegExp(`href="/guides/${g.slug}/`), g.slug);
  assert.match(h, /href="https:\/\/thirstybeaches\.com"/);
  assert.ok(!/aggregateRating|"review"/i.test(JSON.stringify(ld)));
});

test('St. George guides: Article + FAQPage + BreadcrumbList, dated the check day, every guide links its official sources', () => {
  const official = /href="https:\/\/(?:www\.)?(?:sgcityutah\.gov|washingtonutah\.gov|cityofhurricane\.com|www\.cityofhurricane\.com|ivinsutah\.gov|stateparks\.utah\.gov|redcliffsdesertreserve\.com|www\.redcliffsdesertreserve\.com|nps\.gov|home\.nps\.gov|weather\.gov)\//g;
  for (const g of GUIDES) {
    const h = html(g.rel); const ld = jsonld(h);
    const art = ld.find((j) => j['@type'] === 'Article');
    assert.equal(art.dateModified, sg.checked, g.slug); assert.equal(art.mainEntityOfPage, `https://saltydogtags.com/guides/${g.slug}/`);
    assert.equal(ld.find((j) => j['@type'] === 'FAQPage').mainEntity.length, g.faq.length, g.slug);
    assert.deepEqual(ld.find((j) => j['@type'] === 'BreadcrumbList').itemListElement.map((x) => x.name), ['Salty Dog Tags', 'Guides', g.crumb]);
    assert.ok([...h.matchAll(official)].length >= 4, `${g.slug}: official source links`);
    assert.match(h, new RegExp(`Last checked ${sg.checked}`), g.slug);
  }
});

test('license guide: the comparison table rows match the city sections (fees and anchors)', () => {
  const h = html('guides/st-george-dog-license-rules/index.html');
  for (const [city, anchor, , , fees] of sg.licenseTable.rows) {
    assert.match(h, new RegExp(`<h2 id="${anchor}">`), `${city}: section`);
    for (const fee of fees.match(/\$\d+/g)) assert.ok(visible(h.split(`<h2 id="${anchor}">`)[1]).includes(fee), `${city}: ${fee} appears in its section`);
  }
});

test('move switch: SHIP_FROM decides; before the move nothing claims St. George as the base, after the move the copy says so', () => {
  assert.equal(shipFrom(), /export const SHIP_FROM = '([^']+)'/.exec(read('functions/api/_lib.js'))[1], 'app.js and _lib.js agree');
  assert.equal(moved('Lehi, UT'), false); assert.equal(moved('St. George, UT'), true);
  const before = moveVars(sg, false); const after = moveVars(sg, true);
  assert.deepEqual(Object.keys(before).sort(), Object.keys(after).sort(), 'both states fill the same placeholders');
  assert.match(after.BASE_LINE, /in St\. George/); assert.match(before.ORIGIN, /Lehi/);
  assert.throws(() => fill('{{NOPE}}', before), /no value/);
  for (const v of [...Object.values(before), ...Object.values(after)]) assert.ok(!/pick-?up|made in|forever|\btext alert|trailer/i.test(v), v);
  if (!moved()) {
    for (const rel of ALL) {
      const t = visible(html(rel));
      assert.ok(!/engraved (?:here )?in St\.? George|made in St\.? George|St\.? George[- ]based|based in St\.? George|local pick-?up|pick ?up/i.test(t), `${rel}: claims a St. George base before the move`);
    }
    assert.match(visible(html(CITY)), /moving to St\. George/);
  }
});

test('smart QR wording on the St. George set: $5, finder page, email alerts; never texts, never "forever"', () => {
  for (const rel of ALL) {
    const t = visible(html(rel));
    assert.ok(!/forever|text alert|get a text|texts? you|\bSMS\b/i.test(t), rel);
    if (/scan-to-find QR/.test(t)) assert.match(t, /\$5[^.]{0,20}scan-to-find QR[\s\S]{0,160}finder page[\s\S]{0,120}email alert/, rel);
  }
});

test('links in: home, Utah page, Utah license guide, Utah County parks guide and the guides hub point at the St. George set', () => {
  assert.match(html('index.html'), /href="\/st-george-dog-tags\/"/);
  assert.match(html('utah-dog-tags/index.html'), /href="\/st-george-dog-tags\/"/);
  assert.match(html('guides/utah-dog-license-and-tag-rules/index.html'), /href="\/guides\/st-george-dog-license-rules\/"/);
  assert.match(html('guides/dog-parks-utah-county/index.html'), /href="\/guides\/st-george-dog-parks-and-trails\/"/);
  const hub = html('guides/index.html');
  for (const g of GUIDES) assert.equal((hub.match(new RegExp(`<h2[^>]*><a href="/guides/${g.slug}/">`, 'g')) || []).length, 1, `hub lists ${g.slug} once`);
  for (const g of GUIDES) assert.ok(read('site/llms-full.txt').includes(`/guides/${g.slug}/`), `llms-full has ${g.slug}`);
});

test('no doorway pages: the set is one city page plus three topic guides, never a page per town', () => {
  const towns = ['washington', 'santa-clara', 'ivins', 'hurricane'];
  for (const t of towns) for (const pat of [`${t}-dog-tags`, `${t}-utah-dog-tags`, `guides/${t}-dog-license`]) assert.ok(!existsSync(join(SITE, pat)), pat);
});
