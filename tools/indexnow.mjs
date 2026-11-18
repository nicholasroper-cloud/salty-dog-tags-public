#!/usr/bin/env node
/* Tells IndexNow (Bing, Yandex and partners) about every URL in site/sitemap.xml.
 * Run it by hand AFTER a deploy, never from `npm run build`:
 *   node tools/indexnow.mjs            POST the sitemap URLs
 *   node tools/indexnow.mjs --dry-run  print the payload and stop
 * The key file is site/340e80e49fce4613a1997e1801402e13.txt (its content is the key); it must be live at keyLocation before you run this.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SITE } from './lib/appdata.mjs';

const HOST = 'saltydogtags.com';
const KEY = '340e80e49fce4613a1997e1801402e13';
const KEY_LOCATION = `https://${HOST}/${KEY}.txt`;
const ENDPOINT = 'https://api.indexnow.org/indexnow';

const sitemap = readFileSync(join(SITE, 'sitemap.xml'), 'utf8');
const urlList = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]).filter((u) => new URL(u).host === HOST);
if (!urlList.length) throw new Error('no URLs found in site/sitemap.xml');
if (urlList.length > 10000) throw new Error('IndexNow takes at most 10,000 URLs per request');
const payload = { host: HOST, key: KEY, keyLocation: KEY_LOCATION, urlList };

if (process.argv.includes('--dry-run')) {
  console.log(JSON.stringify(payload, null, 2));
  console.log(`\n${urlList.length} URLs (dry run, nothing sent)`);
} else {
  const res = await fetch(ENDPOINT, { method: 'POST', headers: { 'content-type': 'application/json; charset=utf-8' }, body: JSON.stringify(payload) });
  // 200 OK and 202 Accepted are both success; 422 means the key file is not reachable or a URL is off-host.
  console.log(`IndexNow ${res.status} ${res.statusText} for ${urlList.length} URLs`);
  if (!res.ok && res.status !== 202) { console.error(await res.text()); process.exit(1); }
}
