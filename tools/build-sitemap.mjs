#!/usr/bin/env node
/* Regenerates site/sitemap.xml by walking site/ for index.html files.
 * Left out: any page whose robots meta says noindex, plus /sayings/salty/, /wall/ and the non-index files (orders, thanks, 404).
 * lastmod is the date of the last git commit that touched the page; a page with uncommitted changes (or not yet in git) uses today.
 * The Markdown alternate link that build-agent-files.py adds later does not count as a change.
 * Each URL carries its share image (<image:image>) read from the page's og:image.
 * Usage: node tools/build-sitemap.mjs   (run last in `npm run build`)
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { SITE, ROOT } from './lib/appdata.mjs';

const ORIGIN = 'https://saltydogtags.com';
const EXCLUDE = new Set(['sayings/salty/', 'wall/', 'orders/', 'thanks/', '404/']);

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) { const p = join(dir, e); if (statSync(p).isDirectory()) walk(p, out); else if (e === 'index.html') out.push(p); }
  return out;
}
const git = (...args) => { try { return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return ''; } };
const today = new Date().toLocaleDateString('en-CA'); // local YYYY-MM-DD, the same calendar as git's %cs
// build-agent-files.py adds the Markdown <link rel="alternate"> after this runs, so a freshly generated page always differs from HEAD by
// that one line. Ignore it, or every generated page would get today's date on every build.
const strip = (s) => s.replace(/^<link rel="alternate" type="text\/markdown" href="[^"]*">\n/m, '').trim();
function lastmod(file) {
  const rel = relative(ROOT, file);
  if (git('status', '--porcelain', '--', rel)) { // modified or untracked
    const head = git('show', `HEAD:${rel}`);
    if (!head || strip(head) !== strip(readFileSync(file, 'utf8'))) return today;
  }
  return git('log', '-1', '--format=%cs', '--', rel) || today;
}

const urls = [];
for (const file of walk(SITE)) {
  const rel = relative(SITE, dirname(file)); // '' for the home page
  const path = rel ? rel + '/' : '';
  if (EXCLUDE.has(path)) continue;
  const html = readFileSync(file, 'utf8');
  const robots = /<meta name="robots" content="([^"]*)"/.exec(html);
  if (robots && /noindex/i.test(robots[1])) continue;
  const canonical = /<link rel="canonical" href="([^"]*)"/.exec(html);
  const loc = `${ORIGIN}/${path}`;
  if (canonical && canonical[1] !== loc) throw new Error(`${rel || '/'}: canonical ${canonical[1]} is not ${loc}`);
  const image = /<meta property="og:image" content="([^"]*)"/.exec(html);
  urls.push({ loc, path, lastmod: lastmod(file), image: image && image[1] });
}
// Home first, then the hubs, then everything else alphabetically.
const rank = (u) => (u.path === '' ? 0 : ['roast/', 'sayings/', 'dog-tags-by-breed/', 'guides/', 'utah-dog-tags/', 'st-george-dog-tags/', 'policies/', 'privacy/'].indexOf(u.path) + 1 || 99);
urls.sort((a, b) => rank(a) - rank(b) || a.path.localeCompare(b.path));

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
${urls.map((u) => `  <url>
    <loc>${u.loc}</loc>
    <lastmod>${u.lastmod}</lastmod>${u.image ? `
    <image:image><image:loc>${u.image}</image:loc></image:image>` : ''}
  </url>`).join('\n')}
</urlset>
`;
writeFileSync(join(SITE, 'sitemap.xml'), xml);
console.log(`build-sitemap: ${urls.length} URLs`);
