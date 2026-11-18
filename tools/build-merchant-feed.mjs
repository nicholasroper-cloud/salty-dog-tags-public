#!/usr/bin/env node
/* Google Merchant Center product feed: one product per clean saying (18+ vault excluded).
 * Every item is lib/products.mjs sayingProduct(): the shape, finish and price the /sayings/ card, the "Engrave it" button and the
 * single-saying page's Product JSON-LD all use, so the feed price, the page price and the schema price are one number.
 * g:link is the saying's own page (/sayings/<slug>/) when it has one, otherwise its card on /sayings/ (id="s-N").
 * g:id matches the page schema's sku (sdt-s<N>).
 *
 * Writes:  site/feeds/google-products.xml   (RSS 2.0 + g: namespace; submit this URL in Merchant Center)
 *          tools/out/feed-items.json         (input for tools/render-feed-images.py, which draws each
 *                                             saying onto its tag blank -> site/assets/feed/s<N>.jpg)
 * Usage:   node tools/build-merchant-feed.mjs && python3 tools/render-feed-images.py
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { appData, ROOT } from './lib/appdata.mjs';
import { sayingProduct } from './lib/products.mjs';

const d = appData();
const BASE = 'https://saltydogtags.com';
const xml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
const catName = (c) => (d.CATS[c] && (d.CATS[c].n || d.CATS[c])) || c;

const items = d.SAYINGS.map((s, i) => ({ s, i })).filter(({ s }) => !s.x && s.c !== 'adult').map(({ i }) => {
  const p = sayingProduct(i);
  return {
    ...p, single: p.single ? p.single.slug : null, file: `s${i}.jpg`, catName: catName(p.cat),
    description: `Funny personalized dog ID tag, laser engraved with "${p.text}" on the front and your dog's name and your phone number on the back. ` +
      `${p.sizeLabel} ${p.shape} tag in ${p.color.toLowerCase()} (${p.material.toLowerCase()}). ` +
      `Engraving is cut into the metal, not printed, so it won't wear off. Engraved to order in Lehi, Utah by a family with seven English bulldogs; engraved and shipped in 1-2 business days, then USPS 3-5 days in transit, US only. ` +
      `Change the wording, shape or finish before you order. Free remake if we engrave it wrong.`,
  };
});

const now = new Date().toUTCString();
const out = [`<?xml version="1.0" encoding="UTF-8"?>`,
  `<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">`, `<channel>`,
  `<title>Salty Dog Tags</title>`, `<link>${BASE}/</link>`,
  `<description>Funny laser-engraved dog ID tags, engraved in Lehi, Utah.</description>`, `<lastBuildDate>${now}</lastBuildDate>`];
for (const it of items) {
  out.push(`<item>`,
    `<g:id>${it.sku}</g:id>`,
    `<g:title>${xml(it.title)}</g:title>`,
    `<g:description>${xml(it.description)}</g:description>`,
    `<g:link>${xml(it.link)}</g:link>`,
    `<g:image_link>${xml(it.image)}</g:image_link>`,
    `<g:availability>in_stock</g:availability>`,
    `<g:price>${it.price.toFixed(2)} USD</g:price>`,
    `<g:brand>Salty Dog Tags</g:brand>`,
    `<g:condition>new</g:condition>`,
    `<g:identifier_exists>no</g:identifier_exists>`,
    `<g:product_type>Pet ID Tags &gt; Dog Tags &gt; ${xml(it.catName)}</g:product_type>`,
    `<g:material>${xml(it.material)}</g:material>`,
    `<g:color>${xml(it.color)}</g:color>`,
    `<g:size>${xml(it.sizeLabel)}</g:size>`,
    `<g:is_bundle>no</g:is_bundle>`,
    `<g:shipping><g:country>US</g:country><g:service>USPS</g:service><g:price>4.50 USD</g:price><g:min_handling_time>1</g:min_handling_time><g:max_handling_time>2</g:max_handling_time><g:min_transit_time>3</g:min_transit_time><g:max_transit_time>5</g:max_transit_time></g:shipping>`,
    `<g:custom_label_0>${xml(it.cat)}</g:custom_label_0>`,
    `</item>`);
}
out.push(`</channel>`, `</rss>`, ``);
mkdirSync(join(ROOT, 'site', 'feeds'), { recursive: true });
mkdirSync(join(ROOT, 'tools', 'out'), { recursive: true });
writeFileSync(join(ROOT, 'site', 'feeds', 'google-products.xml'), out.join('\n'));
writeFileSync(join(ROOT, 'tools', 'out', 'feed-items.json'), JSON.stringify(items.map(({ i, lines, text, cat, shape, finish, size, price, ink, title, link, image, material, color, file }) => ({ i, lines, text, cat, shape, finish, size, price, ink, title, link, image, material, color, file })), null, 1));
console.log(`feed: ${items.length} products -> site/feeds/google-products.xml (${items.filter((x) => x.single).length} link to their own page)`);
