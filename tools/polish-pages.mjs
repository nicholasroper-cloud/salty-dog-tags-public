#!/usr/bin/env node
/* Idempotent head/footer normalizer for the pages that are hand-written rather than generated:
 *   site/guides/**, site/roast/, site/wall/, site/404.html, site/thanks.html, site/orders.html
 * (the generated pages get the same shell from tools/lib/shell.mjs, and site/index.html is owned by the storefront work.)
 * It only touches shared furniture, never article copy:
 *   - logo and styles.css cache-buster versions follow the home page
 *   - Google Fonts: the home page's non-blocking pattern (preload + media="print" onload swap + noscript), core four families
 *   - og:image / twitter:image -> /assets/og/<slug>.jpg (1200x630, summary_large_image) with alt text from site/assets/og/README.md
 *   - "| Salty Dog Tags" title suffix when the title stays at 60 characters or fewer; per-page title/description overrides below
 *   - the footer (policies + privacy links, "Engraved in Lehi", /#faq on pages without their own FAQ)
 *   - wording: "Made in Lehi" -> "Engraved in Lehi"
 * Running it twice changes nothing.
 * Usage: node tools/polish-pages.mjs
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { SITE } from './lib/appdata.mjs';
import { readFileSync as readHome } from 'node:fs';
import { FONT_CORE, fontsHtml, footerHtml, ogImage, LOGO_V, STYLES_V, esc, decode } from './lib/shell.mjs';

const GENERATED = [/^[a-z-]+-dog-tags\//, /^dog-tags-by-breed\//, /^sayings\//, /^privacy\//, /^policies\//, /^index\.html$/];
// The St. George guides are written by build-pages.mjs (tools/data/st-george.json lists them), so the furniture pass leaves them alone.
const SG_GUIDE_RE = new RegExp(`^guides/(${JSON.parse(readHome(join(SITE, '..', 'tools/data/st-george.json'), 'utf8')).guides.map((g) => g.slug).join('|')})/`);
GENERATED.push(SG_GUIDE_RE);
const OWN_FONTS = new Set(['orders.html']); // admin page keeps whatever families it already loads
const NO_SOCIAL = new Set(['404.html', 'thanks.html', 'orders.html']); // no og block today and none wanted
const NO_SUFFIX = new Set(['404.html', 'thanks.html', 'orders.html']);
// Hand-tuned copy that has to differ from what is on the page today.
const OVERRIDES = {
  'roast/index.html': { description: 'Roast my dog, free: upload one photo and a name and our AI writes a roast in seconds. Like it? We laser-engrave the best line on a tag from $12.' },
  'guides/index.html': { title: 'Dog Tag Guides: Sizes, Metals, Engraving | Salty Dog Tags' },
};

// Exact-string content fixes for the hand-written guides, applied after the furniture pass. Each runs once (the "from" string is gone afterwards).
const PATCHES = {
  // size guide: every breed with a page is linked from the list it belongs in, plus the four newest breeds in the closing links
  'guides/dog-tag-size-guide-by-breed/index.html': [
    ['<li><a href="/beagle-dog-tags/">Beagle</a></li><li>Cocker Spaniel</li>', '<li><a href="/beagle-dog-tags/">Beagle</a></li><li><a href="/cavalier-dog-tags/">Cavalier King Charles Spaniel</a></li><li>Cocker Spaniel</li>'],
    ['<li><a href="/great-dane-dog-tags/">Great Dane</a></li><li>Mastiff</li>', '<li><a href="/great-dane-dog-tags/">Great Dane</a></li><li><a href="/doodle-dog-tags/">Goldendoodle and Labradoodle</a></li><li>Mastiff</li>'],
    ['especially on fluffy breeds like Bernese and Huskies.', 'especially on fluffy breeds like <a href="/bernese-dog-tags/">Bernese</a> and <a href="/husky-dog-tags/">Huskies</a>.'],
    ['<a class="lp-go" href="/bulldog-dog-tags/">English Bulldog tags</a><a class="lp-go" href="/dog-tags-by-breed/">', '<a class="lp-go" href="/bulldog-dog-tags/">English Bulldog tags</a><a class="lp-go" href="/aussie-dog-tags/">Aussie tags</a><a class="lp-go" href="/bernese-dog-tags/">Bernese tags</a><a class="lp-go" href="/boston-terrier-dog-tags/">Boston Terrier tags</a><a class="lp-go" href="/cavalier-dog-tags/">Cavalier tags</a><a class="lp-go" href="/dog-tags-by-breed/">'],
  ],
  'guides/cat-tags-vs-dog-tags/index.html': [[
    'Small dogs get small tags (a <a href="/chihuahua-dog-tags/">chihuahua</a> wears our 1-inch Small). Big dogs can carry bigger ones (a <a href="/great-dane-dog-tags/">Great Dane</a> wears the 2-inch Large). Our <a href="/guides/dog-tag-size-guide-by-breed/">size guide by breed</a> covers the rest.',
    'Small dogs get the smaller shapes (a <a href="/chihuahua-dog-tags/">chihuahua</a> starts with our round or heart). Big dogs can carry bigger ones (a <a href="/great-dane-dog-tags/">Great Dane</a> wears the military or the polished stainless bone). Our <a href="/guides/dog-tag-size-guide-by-breed/">size guide by breed</a> covers the rest.',
  ]],
};
// St. George links into the hand-written pages. Each insert is guarded by a marker so a second run changes nothing.
const SG_DATA = JSON.parse(readHome(join(SITE, '..', 'tools/data/st-george.json'), 'utf8'));
const SG_INSERTS = {
  // guides hub: the three St. George guides go right after the Utah County dog parks entry, and the closing row links the city page
  'guides/index.html': [
    ['data-sg-guides', (h) => h.replace(/(<h2><a href="\/guides\/dog-parks-utah-county\/">[\s\S]*?<\/p>\n)/, (m) => m + SG_DATA.guides.map((g, i) => `    <h2${i === 0 ? ' data-sg-guides' : ''}><a href="/guides/${g.slug}/">${esc(g.h1)}</a></h2>\n    <p>${esc(g.hubBlurb)}</p>\n`).join(''))],
    ['href="/st-george-dog-tags/"', (h) => h.replace('<a class="lp-go" href="/utah-dog-tags/">Engraved in Lehi, Utah &rarr;</a></p>', '<a class="lp-go" href="/utah-dog-tags/">Engraved in Lehi, Utah &rarr;</a><a class="lp-go" href="/st-george-dog-tags/">Dog tags for St. George &rarr;</a></p>')],
  ],
  // Utah license guide: a short St. George section before "What goes on the collar", plus the related row
  'guides/utah-dog-license-and-tag-rules/index.html': [
    ['id="st-george-and-washington-county"', (h) => h.replace('<h2 id="what-goes-on-the-collar">', '<h2 id="st-george-and-washington-county">St. George and Washington County</h2>\n<p>Southern Utah cities set their own rules, and they differ from each other: St. George renews every year, Washington City every two years, Ivins until the rabies certificate runs out. We wrote them up from the city pages in <a href="/guides/st-george-dog-license-rules/">St. George dog license rules (plus Washington City, Hurricane and Ivins)</a>.</p>\n<h2 id="what-goes-on-the-collar">')],
    ['related-sg', (h) => h.replace('<a class="lp-go" href="/guides/">All guides &rarr;</a></p>\n  </div>\n</section>\n<!--/related-->', '<a class="lp-go related-sg" href="/guides/st-george-dog-license-rules/">St. George license rules</a><a class="lp-go" href="/guides/">All guides &rarr;</a></p>\n  </div>\n</section>\n<!--/related-->')],
  ],
  // Utah County dog parks guide: point south before "Before you go", plus the related row
  'guides/dog-parks-utah-county/index.html': [
    ['id="st-george"', (h) => h.replace('<h2 id="before-you-go">', '<h2 id="st-george">St. George and Washington County</h2>\n<p>Heading south? We checked the fenced dog parks in St. George, Washington City and Hurricane, plus the leash rules for Snow Canyon, Red Cliffs and Zion, in <a href="/guides/st-george-dog-parks-and-trails/">St. George dog parks and dog-friendly trails</a>.</p>\n<h2 id="before-you-go">')],
    ['related-sg', (h) => h.replace('<a class="lp-go" href="/guides/">All guides &rarr;</a></p>\n  </div>\n</section>\n<!--/related-->', '<a class="lp-go related-sg" href="/guides/st-george-dog-parks-and-trails/">St. George dog parks</a><a class="lp-go" href="/guides/">All guides &rarr;</a></p>\n  </div>\n</section>\n<!--/related-->')],
  ],
};
// Inserted once, right after the <h1>, so the three-size tables below it read correctly now that every shape comes in one size.
const SIZE_GUIDE_NOTE = '<p class="note" data-shape-note>Update: each shape now comes in one size, so you pick the shape and the size comes with it. Read the sizes below as a guide to the shape: small is the round (about 1.2 inches), medium is the bone, heart or paw (about 1.5 inches), large is the military (about 2 inches), and the polished stainless bone is the biggest at 48 mm. Prices are on each shape in the <a href="/#build">builder</a>.</p>';

const HOME_JS = Object.fromEntries(['app', 'roast', 'share'].map((n) => [n, new RegExp(`/${n}\\.js\\?v=(\\d+)`).exec(readHome(join(SITE, 'index.html'), 'utf8'))?.[1]]));

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) { const p = join(dir, e); if (statSync(p).isDirectory()) walk(p, out); else if (e.endsWith('.html')) out.push(p); }
  return out;
}
const slugFor = (rel) => {
  if (rel === 'wall/index.html') return 'wall';
  if (rel === 'guides/index.html') return 'guides';
  const m = /^guides\/([^/]+)\/index\.html$/.exec(rel); if (m) return m[1];
  return 'home'; // /roast/ has no image of its own yet
};

function polish(rel, src) {
  let h = src;
  const ov = OVERRIDES[rel] || {};
  // logo + stylesheet versions
  h = h.replace(/(\/assets\/logo\/[\w.-]+\?v=)\d+/g, `$1${LOGO_V}`).replace(/(\/styles\.css\?v=)\d+/g, `$1${STYLES_V}`);
  // fonts: drop every existing font link (preconnects, preload, stylesheet, noscript) and put the pattern where the first one was
  const fontRe = /^[ \t]*(?:<link rel="preconnect" href="https:\/\/fonts\.(?:googleapis|gstatic)\.com"(?: crossorigin)?>|<link rel="preload" as="style" href="https:\/\/fonts\.googleapis\.com[^"]*">|<link rel="stylesheet" href="https:\/\/fonts\.googleapis\.com[^"]*"(?: media="print" onload="this\.media='all'")?>|<noscript><link rel="stylesheet" href="https:\/\/fonts\.googleapis\.com[^"]*"><\/noscript>)[ \t]*\n/gm;
  const existing = /href="(https:\/\/fonts\.googleapis\.com\/css2[^"]*)"/.exec(h);
  if (existing) {
    const url = OWN_FONTS.has(rel) ? existing[1] : FONT_CORE;
    let placed = false;
    h = h.replace(fontRe, () => { if (placed) return ''; placed = true; return fontsHtml(url) + '\n'; });
  }
  if (!NO_SUFFIX.has(rel) || ov.title) {
    // title: optional override, then the brand suffix when it fits in 60. og:title / twitter:title follow only when they were
    // a copy of the old <title> (a page with a deliberately different share title keeps it).
    const oldTitle = decode(/<title>(.*?)<\/title>/s.exec(h)[1]);
    let title = ov.title || oldTitle;
    if (!NO_SUFFIX.has(rel) && !title.endsWith('| Salty Dog Tags') && title.length + 16 <= 60) title += ' | Salty Dog Tags';
    h = h.replace(/<title>.*?<\/title>/s, () => `<title>${esc(title)}</title>`);
    for (const re of [/(<meta property="og:title" content=")([^"]*)(")/, /(<meta name="twitter:title" content=")([^"]*)(")/]) {
      h = h.replace(re, (m, a, cur, b) => (decode(cur) === oldTitle || decode(cur) === title ? a + esc(title) + b : m));
    }
  }
  if (ov.description) h = h.replace(/(<meta name="description" content=")[^"]*(")/, (_, a, b) => a + esc(ov.description) + b);
  // share image
  if (!NO_SOCIAL.has(rel) && /<meta property="og:image"/.test(h)) {
    const img = ogImage(slugFor(rel));
    h = h.replace(/<meta property="og:image" content="[^"]*">/, () => `<meta property="og:image" content="${img.url}">`)
      .replace(/<meta property="og:image:width" content="[^"]*">/, '<meta property="og:image:width" content="1200">')
      .replace(/<meta property="og:image:height" content="[^"]*">/, '<meta property="og:image:height" content="630">')
      .replace(/<meta property="og:image:alt" content="[^"]*">/, () => `<meta property="og:image:alt" content="${esc(img.alt)}">`)
      .replace(/<meta name="twitter:image" content="[^"]*">/, () => `<meta name="twitter:image" content="${img.url}">`)
      .replace(/<meta name="twitter:image:alt" content="[^"]*">/, () => `<meta name="twitter:image:alt" content="${esc(img.alt)}">`)
      .replace(/<meta name="twitter:card" content="[^"]*">/, '<meta name="twitter:card" content="summary_large_image">');
  }
  // footer
  if (/<footer class="foot">/.test(h)) {
    const faqHref = /id="faq"/.test(h) ? '#faq' : '/#faq';
    h = h.replace(/<footer class="foot">[\s\S]*?<\/footer>/, (f) => {
      if (f.includes('foot__brand')) return footerHtml({ faqHref }); // full footer: use the shared one
      return /\/policies\//.test(f) ? f : f.replace(/(<a href="\/#faq">FAQ<\/a>)/, '$1 &middot; <a href="/policies/">Policies</a> &middot; <a href="/privacy/">Privacy</a>'); // compact footer (/roast/): add the two links
    });
  }
  // content patches
  for (const [from, to] of PATCHES[rel] || []) h = h.split(from).join(to);
  for (const [marker, apply] of SG_INSERTS[rel] || []) if (!h.includes(marker)) { const out = apply(h); if (out === h) throw new Error(`${rel}: St. George insert for ${marker} found no anchor`); h = out; }
  if (rel === 'guides/dog-tag-size-guide-by-breed/index.html' && !h.includes('data-shape-note')) h = h.replace(/(<h1>.*?<\/h1>\n)/s, (m) => m + SIZE_GUIDE_NOTE + '\n');
  // breed names in the size-guide lists link to their breed page (the four newest breed pages had a single inbound link)
  if (rel === 'guides/dog-tag-size-guide-by-breed/index.html') {
    const BREED_LINK = { 'Rottweiler': 'rottweiler', 'Bernese Mountain Dog': 'bernese', 'Great Dane': 'great-dane', 'Australian Shepherd': 'aussie', 'Boston Terrier': 'boston-terrier', 'Pug': 'pug', 'Shih Tzu': 'shih-tzu', 'Chihuahua': 'chihuahua', 'Pomeranian': 'pomeranian', 'Cavalier King Charles Spaniel': 'cavalier', 'Yorkshire Terrier': 'yorkie', 'Toy Poodle': 'poodle' };
    for (const [name, slug] of Object.entries(BREED_LINK)) h = h.split(`<li>${name}</li>`).join(`<li><a href="/${slug}-dog-tags/">${name}</a></li>`);
  }
  // script cache busters follow the home page (app.js, roast.js, share.js)
  for (const name of ['app', 'roast', 'share']) { const v = HOME_JS[name]; if (v) h = h.replace(new RegExp(`(/${name}\\.js\\?v=)\\d+`, 'g'), (_, a) => a + v); }
  // <main> landmark on pages that have none (the compact /roast/ layout): wrap everything between the nav and the footer
  if (!/<main[ >]/.test(h) && /<footer class="foot">/.test(h) && /<\/nav>/.test(h)) {
    h = h.replace(/<\/nav>\n/, (m) => m + '\n<main id="main">\n').replace(/<footer class="foot">/, '</main>\n\n<footer class="foot">');
  }
  // wording
  h = h.replace(/Made in Lehi/g, 'Engraved in Lehi').replace(/made in Lehi/g, 'engraved in Lehi');
  return h;
}

let changed = 0, seen = 0;
for (const file of walk(SITE).sort()) {
  const rel = relative(SITE, file);
  if (GENERATED.some((re) => re.test(rel))) continue;
  seen++;
  const src = readFileSync(file, 'utf8'); const out = polish(rel, src);
  if (out !== src) { writeFileSync(file, out); changed++; }
}
console.log(`polish-pages: ${seen} hand-written pages checked, ${changed} updated`);
