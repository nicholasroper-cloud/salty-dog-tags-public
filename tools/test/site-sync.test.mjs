// node --test 'tools/test/*.test.mjs'
// Keeps the static home page, the builder tables in site/app.js and the server in functions/api/_lib.js from drifting apart.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { statSync } from 'node:fs';
import { appData, read, ROOT } from './_appdata.mjs';
import { SIZES, PREMIUM, ACTIVE_SHAPES, US_STATES, PICKUP_ENABLED, MAX_LINE } from '../../functions/api/_lib.js';

const d = appData();
const html = read('site/index.html');
const appSrc = read('site/app.js');
const jsonld = [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)].map((m) => JSON.parse(m[1]));
const nodes = jsonld.flatMap((j) => (j['@graph'] ? j['@graph'] : [j]));

test('saying count: JSON export, meta description and page copy all use the computed clean count', () => {
  const exp = JSON.parse(read('tools/out/sayings-count.json'));
  assert.equal(exp.clean, d.cleanCount);
  assert.equal(exp.total, d.SAYINGS.length);
  const desc = /<meta name="description" content="([^"]+)"/.exec(html)[1];
  assert.ok(desc.includes(`${d.cleanCount} sayings`), desc);
  assert.ok(desc.length <= 160, 'description too long: ' + desc.length);
  assert.match(html, new RegExp(`<span data-say-count>${d.cleanCount}</span>`));
  assert.ok(!/90\+|Ninety/.test(html));
});

test('every saying line fits the 24 character cap', () => {
  for (const [i, s] of d.SAYINGS.entries()) for (const l of s.l) assert.ok(l.length <= MAX_LINE, `saying ${i}: "${l}" is ${l.length}`);
});

test('home title: Salty Dog Tags suffix, 60 characters or fewer', () => {
  const title = /<title>(.*?)<\/title>/.exec(html)[1].replace(/&amp;/g, '&');
  assert.ok(title.endsWith('| Salty Dog Tags'), title);
  assert.ok(title.length <= 60, `${title.length}: ${title}`);
});

test('JSON-LD: one business node with a stable @id, no duplicate Organization, no invented ratings', () => {
  const biz = nodes.filter((n) => n['@id'] === 'https://saltydogtags.com/#business');
  assert.equal(biz.length, 1);
  assert.ok([].concat(biz[0]['@type']).includes('LocalBusiness'));
  assert.ok(biz[0].logo && biz[0].sameAs.length && biz[0].parentOrganization);
  assert.equal(nodes.filter((n) => [].concat(n['@type']).includes('Organization')).length, 0);
  const text = JSON.stringify(jsonld);
  assert.ok(!/aggregateRating|AggregateOffer|"review"/.test(text));
});

test('JSON-LD: one Product per visible shape x material tier, priced from the real pricing tables', () => {
  const products = nodes.filter((n) => n['@type'] === 'Product');
  assert.equal(products.length, d.products.length);
  for (const p of d.products) {
    const node = products.find((n) => n['@id'] === `https://saltydogtags.com/#tag-${p.shape}-${p.tier}`);
    assert.ok(node, `missing ${p.shape}-${p.tier}`);
    assert.equal(node.offers['@type'], 'Offer');
    assert.equal(node.offers.price, p.price.toFixed(2));
    assert.equal(node.offers.price, (SIZES[p.size] + (PREMIUM[p.finish] || 0)).toFixed(2), 'client tables and server _lib.js agree');
    assert.equal(node.offers.priceCurrency, 'USD');
    const ship = node.offers.shippingDetails;
    assert.equal(ship.length, 2);
    assert.deepEqual(ship.map((s) => s.shippingRate.value).sort(), [0, 4.5]);
    for (const s of ship) {
      assert.equal(s.shippingDestination.addressCountry, 'US');
      assert.deepEqual([s.deliveryTime.handlingTime.minValue, s.deliveryTime.handlingTime.maxValue], [1, 2]);
      assert.deepEqual([s.deliveryTime.transitTime.minValue, s.deliveryTime.transitTime.maxValue], [3, 5]);
    }
    assert.equal(node.offers.hasMerchantReturnPolicy.returnPolicyCategory, 'https://schema.org/MerchantReturnNotPermitted');
    assert.match(node.offers.hasMerchantReturnPolicy.description, /remake it free/);
  }
  assert.ok(!products.some((n) => d.HIDDEN_SHAPES.some((h) => n['@id'].includes('-' + h + '-'))), 'hidden shapes must not appear in schema');
});

test('prices: client PRICES and server tables match', () => {
  assert.deepEqual(d.PRICES.size, SIZES);
  for (const [k, v] of Object.entries(PREMIUM)) assert.equal(d.PRICES.premium[k], v, k);
});

test('shapes: hidden set, server ACTIVE_SHAPES and visible shapes agree; sizes come from the real blanks', () => {
  assert.deepEqual([...d.HIDDEN_SHAPES].sort(), ['cat', 'fish', 'house', 'hydrant', 'star']);
  assert.deepEqual(d.visibleShapes.sort(), [...ACTIVE_SHAPES].sort());
  assert.ok(d.GALLERY_SHAPE.every((s) => d.visibleShapes.includes(s)), 'gallery only uses visible shapes');
  const shapes = JSON.parse(read('site/assets/shapes/shapes.json')).shapes;
  for (const [k, v] of Object.entries(shapes)) assert.deepEqual(d.BLANK_MM[k], v.blank_mm, `BLANK_MM.${k} must mirror shapes.json`);
});

test('pickup is off on both sides and the static HTML does not offer it', () => {
  assert.equal(PICKUP_ENABLED, false);
  assert.match(appSrc, /const PICKUP_ENABLED = false;/);
  assert.ok(!/name="delivery" value="pickup"/.test(html));
  assert.ok(!/trailer pickup|pick it up/i.test(html.replace(/<!--.*?-->/gs, '')));
});

test('checkout form: structured address, 50 states + DC, matches the server list', () => {
  for (const id of ['street', 'addr2', 'city', 'state', 'zip']) assert.match(html, new RegExp(`id="${id}"`));
  assert.match(html, /autocomplete="shipping address-line1"/); assert.match(html, /autocomplete="shipping postal-code"/);
  const clientStates = /const US_STATES = (\[[^\]]+\])/.exec(appSrc)[1];
  assert.deepEqual(JSON.parse(clientStates.replace(/'/g, '"')), US_STATES);
  assert.ok(!/<textarea id="address"/.test(html));
});

test('builder: back lines start empty (placeholders only)', () => {
  assert.match(appSrc, /back: \['', '', ''\]/);
  assert.match(html, /id="b1"[^>]*placeholder="Whisky"/);
  assert.match(html, /id="b2"[^>]*placeholder="435-555-0123"/);
  assert.ok(!/id="b[12]"[^>]*value=/.test(html));
});

test('ship-time wording is consistent and the made-in claim is "engraved in"', () => {
  const body = html.replace(/<script.*?<\/script>/gs, '');
  assert.ok(!/3 to 5 days of payment|Ships in 3/.test(body));
  assert.match(body, /1.{1,7}2 business days/);
  assert.ok(!/Made in Lehi/i.test(html));
  assert.match(body, /Engraved in Lehi, Utah/);
});

test('18+ gate: WHISKY and Konami go through askAdult, and loadSaying gates adult sayings', () => {
  assert.match(appSrc, /if \(s\.x && !adultOn\)/);
  assert.match(appSrc, /Konami[\s\S]{0,40}askAdult|askAdult\(\)\.then\(\(ok\) => \{ if \(!ok\) return; renderFilters\('adult'\)/);
});

test('contest copy: no purchase necessary, rules link', () => {
  assert.match(html, /No purchase necessary/);
  assert.match(html, /<a href="\/policies#contest">Full rules<\/a>/);
});

test('wall page: noindex,follow and no claim of existing customer dogs', () => {
  const wall = read('site/wall/index.html');
  assert.match(wall, /<meta name="robots" content="noindex,follow">/);
  const desc = /<meta name="description" content="([^"]+)"/.exec(wall)[1];
  assert.match(desc, /will go|will be/); assert.ok(!/\breal dogs\b/i.test(desc));
});

test('nav logo SVG is under 20 KB', () => {
  assert.ok(statSync(`${ROOT}/site/assets/logo/logo-final-horizontal-dark.svg`).size < 20000);
});

test('cache busters are bumped on the home page', () => {
  assert.match(html, /\/styles\.css\?v=(6[7-9]|[7-9]\d)/);
  assert.match(html, /\/app\.js\?v=(7[7-9]|[89]\d)/);
  assert.match(html, /\/roast\.js\?v=([8-9]|\d{2})/);
});
