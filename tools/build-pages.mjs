#!/usr/bin/env node
/* Builds the long-form standalone pages from tools/content/*.md and tools/data/*.json:
 *   /utah-dog-tags/   tools/content/utah-intro.md + utah-outro.md around eight Utah saying cards (tools/data/utah.json)
 *   /privacy/         tools/content/privacy.md
 *   /policies/        tools/content/policies.md   (anchors #terms #shipping #returns #cancellations #content #contest #law)
 * Same shell as the guides pages. The Utah page points at the home page's #business node by @id instead of redeclaring it.
 * Usage: node tools/build-pages.mjs   (idempotent; run via `npm run build`)
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { appData, SITE, ROOT } from './lib/appdata.mjs';
import { money, cap, assertLines, buildUseUrl, autoPick } from './lib/cards.mjs';
import { renderMd } from './lib/md.mjs';
import { esc, headHtml, navHtml, footerHtml, page, jsonBreadcrumb, jsonFaq, crumbsHtml, ogImage, ORIGIN } from './lib/shell.mjs';
import { SG, moveVars, fill } from './lib/local.mjs';

const d = appData();
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const write = (path, html) => { mkdirSync(join(SITE, path), { recursive: true }); writeFileSync(join(SITE, path, 'index.html'), html); };
const NAV = navHtml([['/', 'All tags'], ['/sayings/', 'Sayings'], ['/guides/', 'Guides']]);

/* ---------- city pages: /utah-dog-tags/ and /st-george-dog-tags/ ----------
 * Same layout for both: a narrow article (intro), a full-width band of local saying cards (t= builder links), the outro,
 * an "Around here" link row and the FAQ. Both point at the home page's #business node by @id instead of redeclaring it. */
function cityPage({ dir, data, intro, outro, sayId, crumb, ogSlug, related, faqH2 }) {
  const path = `/${dir}/`; const url = ORIGIN + path;
  // Local lines never match a SAYINGS entry exactly, and the brief wants t= links here, so force t=.
  const cards = data.sayings.map((c, i) => {
    assertLines(`${dir} card ${i}`, c.lines);
    const pick = autoPick('B', c.lines, i);
    return `      <a class="saycard" href="${buildUseUrl(c.lines, pick.shape, pick.finish, { forceT: true }).href}"><p class="saycard__text">${c.lines.map(esc).join('<br>')}</p><p class="note">${esc(c.note)}</p><span class="saycard__row"><span class="saycard__price">${cap(pick.shape)} &middot; ${money(d.priceFor(pick.shape, pick.finish))}</span><span class="saycard__cta">Use this &rarr;</span></span></a>`;
  }).join('\n');
  // Split the sayings heading + lead out of the narrow article so the cards get the full grid width.
  const at = intro.indexOf(`<h2 id="${sayId}">`);
  if (at < 0) throw new Error(`${dir}: intro has no <h2 id="${sayId}">`);
  const article1 = intro.slice(0, at); const sayHead = intro.slice(at);
  const sayH2 = /<h2[^>]*>(.*?)<\/h2>/.exec(sayHead)[1]; const sayLead = sayHead.replace(/<h2[^>]*>.*?<\/h2>\s*/, '');
  const faq = data.faq;
  const head = headHtml({
    title: data.title, description: data.description, path, ogSlug,
    jsonld: [
      { '@context': 'https://schema.org', '@type': 'WebPage', '@id': url, url, name: data.title, description: data.description, about: { '@id': ORIGIN + '/#business' }, isPartOf: { '@id': ORIGIN + '/#website' }, inLanguage: 'en-US' },
      jsonFaq(url + '#faq', faq), jsonBreadcrumb([['Salty Dog Tags', '/'], [crumb, path]]),
    ],
  });
  const body = `<a class="skip" href="#main">Skip to the page</a>

${navHtml([['/', 'All tags'], ['/sayings/', 'Sayings'], ['/guides/', 'Guides'], ['#faq', 'FAQ']])}

<main id="main" tabindex="-1">
<section class="sec art">
  <div class="wrap wrap--narrow">
    ${crumbsHtml([['Salty Dog Tags', '/'], [crumb]])}
    <h1>${esc(data.h1)}</h1>
${article1}
  </div>
</section>

<section class="sec sec--band" id="${sayId}-grid">
  <div class="wrap">
    <div class="sec__head sec__head--split">
      <h2>${sayH2}</h2>
      <div class="lead">${sayLead}</div>
    </div>
    <div class="grid saycards">
${cards}
    </div>
  </div>
</section>

<section class="sec art">
  <div class="wrap wrap--narrow">
${outro}
    <div class="actions">
      <a class="btn btn--coral" href="/#build">Build a tag &rarr;</a>
      <a class="actions__alt" href="/sayings/">Browse every saying &rarr;</a>
    </div>
  </div>
</section>
</main>

<!--related-->
<section class="sec related" id="related">
  <div class="wrap">
    <h2>Around here</h2>
    <p class="lp-links">${related.map(([href, text]) => `<a class="lp-go" href="${href}">${text}</a>`).join('')}</p>
  </div>
</section>
<!--/related-->

<section class="sec sec--band faq" id="faq">
  <div class="wrap faq__in">
    <div class="sec__head">
      <p class="eyebrow">Questions humans ask</p>
      <h2>${esc(faqH2)}</h2>
      <p class="lead">Still stuck? <a href="mailto:hello@saltydogtags.com">hello@saltydogtags.com</a>. A human answers. The dogs supervise.</p>
    </div>
    <div class="faq__list">
${faq.map((x, i) => `      <details${i === 0 ? ' open' : ''}><summary>${esc(x.q)}</summary><p>${esc(x.a)}</p></details>`).join('\n')}
    </div>
  </div>
</section>

${footerHtml({ faqHref: '#faq' })}`;
  write(dir, page({ head, body, bodyClass: 'lp' }));
}

function utahPage() {
  const U = JSON.parse(read('tools/data/utah.json'));
  cityPage({
    dir: 'utah-dog-tags', data: U, sayId: 'utah-sayings', crumb: 'Utah dog tags', ogSlug: 'utah', faqH2: 'Utah questions',
    intro: renderMd(read('tools/content/utah-intro.md').replace('{{COUNT}}', String(d.count.clean))).replace('<!--utah-sayings-->', ''),
    outro: renderMd(read('tools/content/utah-outro.md')),
    related: [['/guides/what-to-put-on-a-dog-tag/', 'What to put on a dog tag'], ['/dog-tags-by-breed/', 'Tags by breed'], ['/sayings/', 'Every saying'], ['/guides/dog-parks-utah-county/', 'Utah County dog parks'], ['/guides/utah-dog-license-and-tag-rules/', 'Utah dog license rules'], ['/st-george-dog-tags/', 'St. George dog tags'], ['/guides/', 'All guides &rarr;']],
  });
}

/* ---------- St. George / Washington County: /st-george-dog-tags/ + three guides ----------
 * Words: tools/content/st-george-*.md and guide-*.md. Facts, FAQs, titles, the license table and the move switch: tools/data/st-george.json.
 * {{PLACEHOLDERS}} come from move.before or move.after (lib/local.mjs: SHIP_FROM in site/app.js decides). */
const SGD = SG();
const MV = { ...moveVars(SGD), COUNT: String(d.count.clean) };
const SG_GUIDES = SGD.guides.map((g) => [`/guides/${g.slug}/`, esc(g.crumb)]);

function stGeorgePage() {
  cityPage({
    dir: 'st-george-dog-tags', sayId: 'st-george-sayings', crumb: 'St. George dog tags', ogSlug: 'st-george', faqH2: 'St. George questions',
    data: { title: MV.TITLE, description: MV.DESCRIPTION, h1: MV.H1, sayings: SGD.sayings, faq: SGD.faq.map((x) => ({ q: x.q, a: fill(x.a, MV) })) },
    intro: renderMd(fill(read('tools/content/st-george-intro.md'), MV)).replace('<!--st-george-sayings-->', ''),
    outro: renderMd(fill(read('tools/content/st-george-outro.md'), MV)),
    related: [...SG_GUIDES, ['/guides/what-to-put-on-a-dog-tag/', 'What to put on a dog tag'], ['/utah-dog-tags/', 'Utah dog tags'], ['/sayings/', 'Every saying'], ['/guides/', 'All guides &rarr;']],
  });
}

// Same furniture as the hand-written guides (art-date, art-cta, cta-pair, related row, FAQ, the not-legal-advice line).
const ART_CTA = '<div class="art-cta"><a class="art-cta__go" href="/#build">Make one in 2 minutes &rarr;</a><span class="art-cta__or">or <a href="/roast/">let us roast your dog</a> for the line.</span></div>';
const fmtDate = (iso) => new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
function licenseTable(t) {
  const [, ...cols] = t.head;
  return `<div class="art-table" tabindex="0" role="region" aria-label="Dog license rules by city"><table><thead><tr>${t.head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${t.rows.map(([city, anchor, ...cells]) => `<tr><td><b><a href="#${anchor}">${esc(city)}</a></b></td>${cells.map((c, i) => `<td data-label="${esc(cols[i])}">${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}
function stGeorgeGuide(g) {
  const path = `/guides/${g.slug}/`; const url = ORIGIN + path;
  const title = g.title.length + 16 <= 60 ? `${g.title} | Salty Dog Tags` : g.title;
  let html = renderMd(fill(read(g.md), MV));
  if (html.includes('<!--table:license-->')) html = html.replace('<!--table:license-->', licenseTable(SGD.licenseTable));
  html = html.split('<!--cta-->').join(ART_CTA);
  if (/<!--[a-z:-]+-->/.test(html)) throw new Error(`${path}: unknown marker ${/<!--[a-z:-]+-->/.exec(html)[0]}`);
  const img = ogImage(g.slug);
  const head = headHtml({
    title, description: g.description, path, ogSlug: g.slug, type: 'article',
    jsonld: [
      { '@context': 'https://schema.org', '@type': 'Article', '@id': url + '#article', headline: g.h1, description: g.description, image: [img.url], datePublished: g.datePublished, dateModified: SGD.checked, author: { '@type': 'Organization', name: 'Salty Dog Tags', url: ORIGIN + '/' }, publisher: { '@id': ORIGIN + '/#business' }, mainEntityOfPage: url },
      jsonFaq(url + '#faq', g.faq), jsonBreadcrumb([['Salty Dog Tags', '/'], ['Guides', '/guides/'], [g.crumb, path]]),
    ],
  });
  const related = [...SG_GUIDES.filter(([h]) => h !== path), ['/st-george-dog-tags/', 'Dog tags for St. George'], ['/guides/what-to-put-on-a-dog-tag/', 'What to put on a dog tag'], ['/sayings/', 'Every saying'], ['/guides/', 'All guides &rarr;']];
  const body = `<a class="skip" href="#main">Skip to content</a>

${NAV}

<main id="main" tabindex="-1">
<article class="sec art">
  <div class="wrap wrap--narrow">
    ${crumbsHtml([['Salty Dog Tags', '/'], ['Guides', '/guides/'], [esc(g.crumb)]])}
    <h1>${esc(g.h1)}</h1>
<p class="art-date">Salty Dog Tags &middot; Updated <time datetime="${SGD.checked}">${fmtDate(SGD.checked)}</time></p>
${html}
    <div class="cta-pair">
      <a class="cta-card cta-card--roast" href="/roast/"><span class="cta-card__k">Free</span><b class="cta-card__t">Roast my dog &rarr;</b><span class="cta-card__d">One photo and a name. We write the jokes, you pick one for the tag.</span></a>
      <a class="cta-card" href="/#build"><span class="cta-card__k">From $12</span><b class="cta-card__t">Build a tag &rarr;</b><span class="cta-card__d">Pick a line or write your own. Name and number go on the back.</span></a>
    </div>
    <p class="lp-links cta-pair__alt"><a class="lp-go" href="/st-george-dog-tags/">Dog tags for St. George &rarr;</a></p>
<p class="dim"><i>This article is general information, not legal or veterinary advice. Rules are set city by city and by each park, and they change. Check the linked page or call the office before you rely on anything here. Last checked ${SGD.checked}.</i></p>
  </div>
</article>

<!--related-->
<section class="sec related" id="related">
  <div class="wrap">
    <h2>Around here</h2>
    <p class="lp-links">${related.map(([href, text]) => `<a class="lp-go" href="${href}">${text}</a>`).join('')}</p>
  </div>
</section>
<!--/related-->

<section class="sec sec--band faq" id="faq">
  <div class="wrap faq__in">
    <div class="sec__head">
      <p class="eyebrow">Questions humans ask</p>
      <h2>FAQ</h2>
      <p class="lead">Still stuck? <a href="mailto:hello@saltydogtags.com">hello@saltydogtags.com</a>. A human answers. The dogs supervise.</p>
    </div>
    <div class="faq__list">
${g.faq.map((x, i) => `      <details${i === 0 ? ' open' : ''}><summary>${esc(x.q)}</summary><p>${esc(x.a)}</p></details>`).join('\n')}
    </div>
  </div>
</section>

</main>

${footerHtml({ faqHref: '#faq' })}`;
  write(`guides/${g.slug}`, page({ head, body, bodyClass: 'lp' }));
}

/* ---------- /privacy/ and /policies/ ---------- */
// The table of contents goes after the first paragraph (the one-line intro).
function withToc(html, toc) {
  if (!toc) return html;
  const nav = `<p class="lp-links" aria-label="On this page" style="margin:0 0 1rem">${toc.map(([id, text]) => `<a class="lp-go" href="#${id}">${esc(text)}</a>`).join('')}</p>`;
  const i = html.indexOf('</p>') + 4;
  return html.slice(0, i) + '\n' + nav + html.slice(i);
}
function docPage({ slug, title, description, crumb, h1, toc }) {
  const path = `/${slug}/`;
  const md = read(`tools/content/${slug}.md`);
  const lines = md.split('\n'); const dateLine = lines.find((l) => l.startsWith('**')); // "**Last updated: ...**"
  const rest = md.replace(dateLine, '');
  const html = renderMd(rest);
  const head = headHtml({ title, description, path, ogSlug: 'home', jsonld: [jsonBreadcrumb([['Salty Dog Tags', '/'], [crumb, path]])] });
  const body = `<a class="skip" href="#main">Skip to the page</a>

${NAV}

<main id="main" tabindex="-1">
<article class="sec art">
  <div class="wrap wrap--narrow">
    ${crumbsHtml([['Salty Dog Tags', '/'], [crumb]])}
    <h1>${esc(h1)}</h1>
    <p class="note">${esc(dateLine.replace(/\*\*/g, ''))}</p>
${withToc(html, toc)}
  </div>
</article>
</main>

${footerHtml({ faqHref: '/#faq' })}`;
  write(slug, page({ head, body, bodyClass: 'lp' }));
}

utahPage();
stGeorgePage();
for (const g of SGD.guides) stGeorgeGuide(g);
docPage({ slug: 'policies', title: 'Shop Policies: Shipping, Returns, Contest | Salty Dog Tags', description: 'Salty Dog Tags shop policies in plain English: terms of sale, shipping, returns and remakes, cancellations, user content, the photo contest and governing law.', crumb: 'Shop policies', h1: 'Shop Policies',
  toc: [['terms', 'Terms of sale'], ['shipping', 'Shipping'], ['returns', 'Returns & remakes'], ['cancellations', 'Cancellations'], ['content', 'User content & 18+'], ['contest', 'Monthly photo contest'], ['law', 'Governing law']] });
docPage({ slug: 'privacy', title: 'Privacy Policy | Salty Dog Tags', description: 'What Salty Dog Tags collects to make and ship your tag, who we share it with, how long we keep it, and your choices. We do not sell it and run no ad trackers.', crumb: 'Privacy', h1: 'Privacy Policy' });
console.log(`build-pages: /utah-dog-tags/, /st-george-dog-tags/, ${SGD.guides.length} St. George guides, /policies/, /privacy/`);
