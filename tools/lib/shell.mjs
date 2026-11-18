// Shared page shell for every generator and for tools/polish-pages.mjs: <head> pieces, fonts, share-image tags, nav and footer.
// Nothing here is page content. Change the shell once and every generated page picks it up on the next `npm run build`.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, SITE } from './appdata.mjs';

export const ORIGIN = 'https://saltydogtags.com';

// ORNAMENT_ENABLED in site/app.js is the master switch for the holiday ornament. false: no nav, menu or footer link anywhere.
// Tests call setOrnamentLinks(true) to render the enabled markup in-process.
export let ornamentLinks = /const ORNAMENT_ENABLED = (true|false)/.exec(readFileSync(join(SITE, 'app.js'), 'utf8'))[1] === 'true';
export const setOrnamentLinks = (on) => { ornamentLinks = Boolean(on); };
export const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
export const decode = (s) => String(s).replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&rarr;/g, '→').replace(/&ndash;/g, '–').replace(/&mdash;/g, '—').replace(/&ldquo;/g, '“').replace(/&rdquo;/g, '”').replace(/&middot;/g, '·').replace(/&amp;/g, '&');
export const stripTags = (s) => decode(String(s).replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
export const ldScript = (obj) => `<script type="application/ld+json">${JSON.stringify(obj)}</script>`;

// Cache-buster versions follow the home page, which is owned by the storefront work: whatever it ships, the rest of the site matches.
const home = readFileSync(join(SITE, 'index.html'), 'utf8');
export const STYLES_V = /\/styles\.css\?v=(\d+)/.exec(home)[1];
export const LOGO_V = /logo-final-icon\.svg\?v=(\d+)/.exec(home)[1];

/* ---------- fonts: the home page's non-blocking pattern (preload + print/onload swap + noscript) ----------
 * Every page except the home page needs only Bungee, Archivo, Archivo Black and DM Mono. The four builder-only faces
 * (Pacifico, Alfa Slab One, Permanent Marker, and the home-page tag fonts) load on the home page alone. */
export const FONT_CORE = 'https://fonts.googleapis.com/css2?family=Bungee&family=Archivo:wght@400;500;600;700&family=Archivo+Black&family=DM+Mono:wght@400;500&display=swap';
export const fontsHtml = (url = FONT_CORE) => [
  '<link rel="preconnect" href="https://fonts.googleapis.com">',
  '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>',
  `<link rel="preload" as="style" href="${url}">`,
  `<link rel="stylesheet" href="${url}" media="print" onload="this.media='all'">`,
  `<noscript><link rel="stylesheet" href="${url}"></noscript>`,
].join('\n');

/* ---------- share images ---------- */
// site/assets/og/README.md lists every generated 1200x630 JPEG with its headline, so alt text never drifts from the picture.
const ogReadme = readFileSync(join(SITE, 'assets/og/README.md'), 'utf8');
export const OG = {};
for (const m of ogReadme.matchAll(/^\| `([^`]+)\.jpg` \| [^|]*\| ([^|]*) \| ([^|]*) \|/gm)) OG[m[1]] = { headline: m[2].trim(), aside: m[3].trim().replace(/\s*\/\s*/g, ' ').replace(/;\s*.*$/, '') };
export function ogImage(slug) {
  const key = OG[slug] ? slug : 'home';
  if (!existsSync(join(SITE, 'assets/og', key + '.jpg'))) throw new Error('missing share image for ' + slug);
  const o = OG[key];
  const alt = o.aside && o.aside !== '' ? `${o.headline.replace(/\.$/, '')}. ${o.aside}` : o.headline;
  return { file: key, url: `${ORIGIN}/assets/og/${key}.jpg`, alt: `Salty Dog Tags share image: ${alt}` };
}

export function socialMeta({ url, title, description, ogSlug, type = 'website', twitterTitle, twitterDescription }) {
  const img = ogImage(ogSlug);
  return [
    '<meta property="og:site_name" content="Salty Dog Tags">',
    `<meta property="og:type" content="${type}">`,
    `<meta property="og:title" content="${esc(title)}">`,
    `<meta property="og:description" content="${esc(description)}">`,
    '<meta property="og:locale" content="en_US">',
    `<meta property="og:url" content="${url}">`,
    `<meta property="og:image" content="${img.url}">`,
    '<meta property="og:image:width" content="1200">',
    '<meta property="og:image:height" content="630">',
    `<meta property="og:image:alt" content="${esc(img.alt)}">`,
    '<meta name="twitter:card" content="summary_large_image">',
    `<meta name="twitter:title" content="${esc(twitterTitle || title)}">`,
    `<meta name="twitter:description" content="${esc(twitterDescription || description)}">`,
    `<meta name="twitter:image" content="${img.url}">`,
    `<meta name="twitter:image:alt" content="${esc(img.alt)}">`,
  ].join('\n');
}

export function headHtml({ title, description, path, robots = 'index,follow,max-image-preview:large', ogSlug, jsonld = [], preload = '', type = 'website' }) {
  const url = ORIGIN + path;
  return `<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta name="theme-color" content="#09010F">
<link rel="icon" href="/assets/logo/logo-final-icon.svg?v=${LOGO_V}" type="image/svg+xml">
<link rel="icon" href="/assets/logo/logo-final-icon-32.png?v=${LOGO_V}" type="image/png" sizes="32x32">
<link rel="apple-touch-icon" href="/assets/logo/logo-final-icon-180.png?v=${LOGO_V}">
<link rel="canonical" href="${url}">
<meta name="robots" content="${robots}">
${preload ? preload + '\n' : ''}${fontsHtml()}
<link rel="stylesheet" href="/styles.css?v=${STYLES_V}">
${socialMeta({ url, title, description, ogSlug, type })}
${jsonld.map(ldScript).join('\n')}`;
}

/* ---------- nav + footer ---------- */
// One header for every page (the home page ships the same markup): Roast, Sayings, Breeds, Guides, FAQ, then the primary
// button, plus a Menu for narrow screens. `links` only says which entry is the current page (aria-current); the entries
// themselves are fixed so the header never differs from page to page.
const NAV_SCRIPT = `<script>(function(){var d=document.querySelector('.nav__more');if(!d)return;document.addEventListener('click',function(e){if(d.open&&!d.contains(e.target))d.open=false;});document.addEventListener('keydown',function(e){if(e.key==='Escape'&&d.open){d.open=false;d.querySelector('summary').focus();}});d.querySelector('.nav__menu').addEventListener('click',function(e){if(e.target.closest('a'))d.open=false;});})();</script>`;
export const navHtml = (links = [], { cta = ['/#build', 'Build a tag'] } = {}) => {
  const cur = (href) => (links.some(([h, , c]) => c && h === href) ? ' aria-current="page"' : '');
  return `<nav class="nav" id="nav" aria-label="Main">
  <a class="nav__mark" href="/" aria-label="Salty Dog Tags home">
    <img src="/assets/logo/logo-nav.webp" srcset="/assets/logo/logo-nav.webp 2x, /assets/logo/logo-nav@3x.webp 3x" alt="Salty Dog Tags" width="172" height="44">
  </a>
  <div class="nav__links">
    <a class="nav__roast" href="/roast/"${cur('/roast/')}>Roast<span class="nav__long"> my dog</span></a>
    <a class="nav__say" href="/sayings/"${cur('/sayings/')}>Sayings</a>
    <a class="nav__in" href="/dog-tags-by-breed/"${cur('/dog-tags-by-breed/')}>Breeds</a>
    <a class="nav__in" href="/guides/"${cur('/guides/')}>Guides</a>
${ornamentLinks ? `    <a class="nav__in nav__orn" href="/ornament/"${cur('/ornament/')}>Holiday ornament</a>\n` : ''}    <a class="nav__in" href="/#faq">FAQ</a>
    <a class="cta" href="${cta[0]}">${cta[1]}</a>
    <details class="nav__more"><summary aria-label="More pages"><span class="nav__burger" aria-hidden="true"></span><span class="nav__menu-t">Menu</span></summary>
      <div class="nav__menu"><a href="/sayings/">Sayings</a><a href="/dog-tags-by-breed/">Breeds</a><a href="/guides/">Guides</a>${ornamentLinks ? '<a href="/ornament/">Holiday ornament</a>' : ''}<a href="/#photo-color">Photo &amp; color</a><a href="/#faq">FAQ</a></div>
    </details>
  </div>
</nav>
${NAV_SCRIPT}`;
};

const SOCIAL = `      <ul class="foot__social" aria-label="Follow Salty Dog Tags">
        <li><a href="https://www.instagram.com/saltydogtagsco" target="_blank" rel="noopener" aria-label="Instagram, @saltydogtagsco"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="17.3" cy="6.7" r="1.2" fill="currentColor"/></svg><span>@saltydogtagsco</span></a></li>
        <li><a href="https://www.tiktok.com/@saltydogtags" target="_blank" rel="noopener" aria-label="TikTok, @saltydogtags"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M16 2.5c.4 2.5 1.9 4.1 4.5 4.4v3.2c-1.6 0-3.1-.5-4.4-1.4v6.6a5.9 5.9 0 1 1-5.9-5.9c.3 0 .6 0 .9.1v3.3a2.7 2.7 0 1 0 1.8 2.5V2.5z"/></svg><span>@saltydogtags</span></a></li>
        <li><a href="https://www.facebook.com/saltydogtags" target="_blank" rel="noopener" aria-label="Facebook, /saltydogtags"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M13.6 21.5v-8.2h2.8l.4-3.3h-3.2V7.9c0-.9.3-1.6 1.6-1.6h1.7V3.4c-.3 0-1.3-.1-2.5-.1-2.5 0-4.2 1.5-4.2 4.3V10H7.4v3.3h2.8v8.2z"/></svg><span>/saltydogtags</span></a></li>
      </ul>`;

// faqHref: '#faq' on pages that have their own FAQ section, '/#faq' (the home page FAQ) everywhere else.
export const footerHtml = ({ faqHref = '/#faq' } = {}) => `<footer class="foot">
  <div class="foot__in">
    <p class="foot__sign" aria-hidden="true">Stay salty.</p>
    <div class="foot__brand">
      <img src="/assets/logo/logo-nav.webp" srcset="/assets/logo/logo-nav.webp 2x, /assets/logo/logo-nav@3x.webp 3x" alt="Salty Dog Tags" width="172" height="44" loading="lazy">
      <p>Laser-engraved dog tags. Engraved in Lehi, Utah, by a family with seven English bulldogs and one very busy laser.</p>
    </div>
    <div class="foot__col">
      <p class="foot__h">Talk to us</p>
      <a class="foot__mail" href="mailto:hello@saltydogtags.com">hello@saltydogtags.com</a>
${SOCIAL}
    </div>
    <div class="foot__col">
      <p class="foot__h">More</p>
      <a href="/dog-tags-by-breed/">Tags by breed</a>
      <a href="/guides/">Guides</a>
      <a href="/">All tags</a>
      <a href="/sayings/">Every saying</a>
      <a href="/#photo-color">Photo &amp; color tags</a>
${ornamentLinks ? `      <a href="/ornament/">Holiday ornament</a>\n` : ''}      <a href="${faqHref}">FAQ</a>
      <a href="/policies/">Shop policies</a>
      <a href="/privacy/">Privacy</a>
      <a href="https://thirstybeaches.com" target="_blank" rel="noopener">Thirsty Beaches</a>
      <a class="foot__play" href="/#play">Play Salty Maze</a>
    </div>
    <p class="foot__legal">&copy; 2026 Salty Dog Tags &middot; Lehi, Utah &middot; No bulldogs were rushed in the making of these tags.</p>
  </div>
</footer>`;

export const page = ({ head, body, bodyClass = '' }) => `<!DOCTYPE html>
<html lang="en">
<head>
${head}
</head>
<body${bodyClass ? ` class="${bodyClass}"` : ''}>
${body}
</body>
</html>
`;

export const jsonBreadcrumb = (crumbs) => ({ '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: crumbs.map(([name, path], i) => ({ '@type': 'ListItem', position: i + 1, name, item: ORIGIN + path })) });
export const jsonFaq = (id, items) => ({ '@context': 'https://schema.org', '@type': 'FAQPage', ...(id ? { '@id': id } : {}), mainEntity: items.map((x) => ({ '@type': 'Question', name: stripTags(x.q), acceptedAnswer: { '@type': 'Answer', text: stripTags(x.a) } })) });
export const crumbsHtml = (parts) => `<nav class="crumbs" aria-label="Breadcrumb">${parts.map(([text, href], i) => (href ? `<a href="${href}">${text}</a>` : `<span aria-current="page">${text}</span>`)).join('<span aria-hidden="true">/</span>')}</nav>`;

/* ---------- Product + Offer JSON-LD (breed pages and single-saying pages) ----------
 * One Offer per page: the price is the price printed on that page for the tag the Product describes, url is the page itself.
 * Shipping and returns say exactly what /policies/ says: USPS, US only (50 states + DC), $4.50 flat, free on orders of $35+
 * (schema.org has no per-offer free-shipping threshold Google reads, so it is stated in the description), engraved and shipped
 * in 1-2 business days, 3-5 days in transit; custom engraved tags are not returnable, a mis-engraved tag is remade free.
 * No AggregateRating and no Review: there are no real ratings to mark up. */
export const SHIPPING_DETAILS = {
  '@type': 'OfferShippingDetails',
  shippingRate: { '@type': 'MonetaryAmount', value: 4.5, currency: 'USD' },
  shippingDestination: { '@type': 'DefinedRegion', addressCountry: 'US' },
  deliveryTime: {
    '@type': 'ShippingDeliveryTime',
    handlingTime: { '@type': 'QuantitativeValue', minValue: 1, maxValue: 2, unitCode: 'DAY' },
    transitTime: { '@type': 'QuantitativeValue', minValue: 3, maxValue: 5, unitCode: 'DAY' },
  },
  description: 'USPS, US addresses only. $4.50 flat per order, free on orders of $35 or more after discounts. Engraved and shipped in 1 to 2 business days, then 3 to 5 days in transit.',
};
export const RETURN_POLICY = {
  '@type': 'MerchantReturnPolicy',
  applicableCountry: 'US',
  returnPolicyCategory: 'https://schema.org/MerchantReturnNotPermitted',
  merchantReturnLink: ORIGIN + '/policies/#returns',
  description: 'Every tag is custom engraved, so no returns. If the engraving does not match your order or the tag is defective, email a photo within 30 days of delivery for a free remake with free shipping.',
};
export function jsonProduct({ id, name, description, image, url, price, sku, material, color, category = 'Pet Supplies > Pet ID Tags' }) {
  if (!(price > 0)) throw new Error(`${url}: Product needs a real price`);
  return {
    '@context': 'https://schema.org', '@type': 'Product', '@id': id, name, description,
    image: [].concat(image), ...(sku ? { sku } : {}), brand: { '@type': 'Brand', name: 'Salty Dog Tags' }, category,
    ...(material ? { material } : {}), ...(color ? { color } : {}),
    offers: {
      '@type': 'Offer', url, priceCurrency: 'USD', price: price.toFixed(2), availability: 'https://schema.org/InStock',
      itemCondition: 'https://schema.org/NewCondition', seller: { '@id': ORIGIN + '/#business' },
      shippingDetails: SHIPPING_DETAILS, hasMerchantReturnPolicy: RETURN_POLICY,
    },
  };
}
