// Shared guard for the finder beacon routes: /api/tag/scan, /location, /message.
import { json } from './_lib.js';
import { readObject } from './_security.js';
import { normalizeTagId, scanNonceOk } from './_tagid.js';
import { getTag } from './_tagdb.js';
import { hasDb } from './_tagsettings.js';
import { originOk } from './_session.js';
import { speedBump } from './_ratelimit.js';

// Known crawlers and link previewers. A real person's browser is not on this list, and a preview fetcher usually does not run the
// page's JavaScript anyway (the beacon is the real gate); this is the second line.
export const BOT_RE = /bot\b|crawl|spider|slurp|preview|facebookexternalhit|facebot|whatsapp|telegram|discord|slack|twitterbot|linkedin|skypeuripreview|embedly|quora|pinterest|headless|lighthouse|pagespeed|gtmetrix|inspectiontool|bingpreview|yahoo|curl\/|wget|python-requests|python-urllib|go-http-client|okhttp|java\/|libwww|httpclient|node-fetch|axios|postman|monitor|uptime|pingdom|linkpresentation|mail\.ru|yandex|baidu|duckduck|semrush|ahrefs|mj12|dotbot|petalbot|bytespider|gptbot|claudebot|ccbot|perplexity|applebot/i;
export const isBot = (ua) => !ua || BOT_RE.test(String(ua));

// Returns { tag, body } or { res } (a Response to return). `needNonce` false only for tests.
export async function guard(request, env, { maxBody = 4000 } = {}) {
  if (request.method !== 'POST') return { res: json({ ok: false, error: 'method' }, 405, { allow: 'POST' }) };
  if (!hasDb(env)) return { res: json({ ok: false, error: 'unavailable' }, 503) };
  if (!originOk(request, env)) return { res: json({ ok: false, error: 'origin' }, 403) };
  if ((request.headers.get('content-type') || '').indexOf('application/json') < 0) return { res: json({ ok: false, error: 'json only' }, 415) };
  if (!speedBump('tagapi:' + (request.headers.get('cf-connecting-ip') || '-'), 120, 60_000)) return { res: json({ ok: false, error: 'slow down' }, 429) };
  const parsed = await readObject(request, maxBody);
  if (parsed.error) return { res: json({ ok: false, error: parsed.error }, parsed.status) };
  const body = parsed.body;
  const id = normalizeTagId(body.t);
  if (!id) return { res: json({ ok: true, counted: false }) };            // same answer as an unknown id
  if (!(await scanNonceOk(env.TAG_CLAIM_KEY, id, body.n))) return { res: json({ ok: true, counted: false }) };   // never loaded the page, or too fresh, or stale
  let tag = null;
  try { tag = await getTag(env, id); } catch { return { res: json({ ok: false, error: 'unavailable' }, 503) }; }
  if (!tag || tag.status === 'disabled') return { res: json({ ok: true, counted: false }) };
  return { tag, body, id };
}
