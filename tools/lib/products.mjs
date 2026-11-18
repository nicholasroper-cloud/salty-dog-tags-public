// One definition of "the product" a saying is sold as, shared by build-sayings.mjs (single-saying pages and their Product JSON-LD),
// build-merchant-feed.mjs (the Merchant Center feed) and build-breeds.mjs (links between breed pages and single-saying pages).
// The shape and finish are sayingPick(): the same pick the /sayings/ cards and the "Engrave it" button use, so the page,
// its schema and the feed always quote one price.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { appData, ROOT } from './appdata.mjs';
import { sayingPick, norm } from './cards.mjs';
import { ORIGIN } from './shell.mjs';

const d = appData();
export const SINGLES = JSON.parse(readFileSync(join(ROOT, 'tools/data/top-sayings.json'), 'utf8')).singles;
export const THEMES = JSON.parse(readFileSync(join(ROOT, 'tools/data/themes.json'), 'utf8')).themes;
const BREEDS_DIR = join(ROOT, 'tools', 'breeds');
export const BREEDS = readdirSync(BREEDS_DIR).filter((f) => f.endsWith('.json') && !f.startsWith('_')).sort()
  .map((f) => JSON.parse(readFileSync(join(BREEDS_DIR, f), 'utf8')));

// Tag sizes as the site's own copy states them (tools/data/shape-fits.json): one size per shape, polished bone is 48 mm.
const SHAPE_SIZE = { round: '1.2"', bone: '1.5"', heart: '1.5"', paw: '1.5"', military: '2"' };
export const sizeLabel = (shape, finish) => (shape === 'bone' && finish === 'polished' ? '48 mm' : SHAPE_SIZE[shape] || '1.5"');
export const materialFor = (finish) => ({ anodized: 'Anodized aluminum', stainless: 'Stainless steel', brass: 'Brass' }[d.FINISHES[finish]?.kind] || 'Aluminum');
const SHAPE_NAME = { bone: 'Bone', heart: 'Heart', round: 'Round', military: 'Military', paw: 'Paw' };

export const singleByIndex = new Map(SINGLES.map((s) => [s.index, s]));
export const singleUrl = (s) => `${ORIGIN}/sayings/${s.slug}/`;

export function sayingProduct(i) {
  const s = d.SAYINGS[i]; if (!s || s.x) throw new Error('not a clean saying: ' + i);
  const { shape, finish } = sayingPick(i, s.l);
  const text = s.l.join(' ');
  const color = d.finishName(finish);
  const single = singleByIndex.get(i);
  return {
    i, lines: s.l, text, cat: s.c, shape, finish, size: d.sizesFor(shape, finish)[0], price: d.priceFor(shape, finish),
    ink: d.FINISHES[finish]?.ink || 'dark', color, material: materialFor(finish), sizeLabel: sizeLabel(shape, finish),
    sku: `sdt-s${i}`,
    title: `Funny Dog Tag "${text}" Engraved ${color} ${SHAPE_NAME[shape] || shape} Pet ID Tag ${sizeLabel(shape, finish)}`.replace(/\s+/g, ' ').trim(),
    image: `${ORIGIN}/assets/feed/s${i}.jpg`,
    // landing page: the single-saying page when there is one, otherwise the saying's own card on /sayings/ (id="s-N")
    link: single ? singleUrl(single) : `${ORIGIN}/sayings/#s-${i}`,
    single,
  };
}

/* ---------- which breed a saying fits, and which sayings a breed page should point at ----------
 * Order of evidence: a hand pick in top-sayings.json ("breeds"), the saying is printed on that breed's page, the single's own blurb names the breed, the saying's themes list it. */
const BREED_NAMES = { aussie: /\baussie|australian shepherd/, beagle: /\bbeagle/, bernese: /\bbernese/, 'boston-terrier': /\bboston/, boxer: /\bboxer/, bulldog: /(?<!french )\bbulldog/, cavalier: /\bcavalier/, chihuahua: /\bchihuahua/, corgi: /\bcorgi/, dachshund: /\bdachshund|\bdoxie/, doberman: /\bdoberman/, doodle: /doodle/, frenchie: /\bfrenchie|french bulldog/, 'german-shepherd': /german shepherd/, 'golden-retriever': /\bgolden/, 'great-dane': /great dane/, husky: /\bhusk/, lab: /\blab\b|labrador/, pomeranian: /\bpomeranian/, poodle: /\bpoodle/, pug: /\bpugs?\b/, rottweiler: /\brottweiler|\brottie/, 'shih-tzu': /shih tzu/, yorkie: /\byorkie|yorkshire/ };
const onBreedPage = new Map(); // saying index -> breed slugs whose page prints it
for (const b of BREEDS) for (const c of b.sayings.cards) {
  const k = norm(c.lines.join(' '));
  d.SAYINGS.forEach((s, i) => { if (!s.x && norm(s.l.join(' ')) === k) onBreedPage.set(i, [...(onBreedPage.get(i) || []), b.slug]); });
}
export function singleBreeds(s, n = 3) {
  const blurb = s.blurb.toLowerCase();
  const named = Object.keys(BREED_NAMES).filter((slug) => BREED_NAMES[slug].test(blurb));
  const themed = THEMES.filter((t) => t.indices.includes(s.index)).flatMap((t) => t.breeds);
  for (const b of s.breeds || []) if (!BREED_NAMES[b]) throw new Error(`${s.slug}: unknown breed ${b}`);
  return [...new Set([...(s.breeds || []), ...(onBreedPage.get(s.index) || []), ...named, ...themed])].slice(0, n);
}
export const breedSingles = (slug) => SINGLES.filter((s) => singleBreeds(s).includes(slug));
