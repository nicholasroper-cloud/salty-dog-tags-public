// Shared harness for the smart tag server tests: env with D1, KV, keys; a recording fetch stub; a claimed tag factory.
import { makeD1 } from './_d1.mjs';
import { newTagId, rowId, scanNonce } from '../../functions/api/_tagid.js';
import { createSession } from '../../functions/api/_session.js';

export const KEY = 'claim-key-0123456789abcdef-test';
export const SITE = 'https://saltydogtags.com';
export function kv() {
  const m = new Map();
  return { get: async (k) => m.get(k) ?? null, delete: async (k) => { m.delete(k); }, put: async (k, v) => { m.set(k, v); }, getWithMetadata: async (k) => ({ value: m.get(k) ?? null, metadata: null }), list: async () => ({ keys: [], list_complete: true }), _m: m };
}
export const mkEnv = (over = {}) => ({ ORDERS: kv(), TAGDB: makeD1(), ADMIN_KEY: 'adminkey-0123456789abcdef', TAG_CLAIM_KEY: KEY, IP_SALT: 'salt-0123456789abcdef-xyz', SITE_URL: SITE,
  RESEND_API_KEY: 're_test', TWILIO_SID: 'ACtest', TWILIO_TOKEN: 'twtoken', TAG_TWILIO_MSID: 'MGtest', TWILIO_FROM: '+15550000000', ...over });

// Records every outbound call and answers by rule. rules: [(url, init) => Response | undefined]
export function stubFetch(rules = []) {
  const calls = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url); const body = init.body instanceof URLSearchParams ? Object.fromEntries(init.body) : (typeof init.body === 'string' && init.body.startsWith('{') ? JSON.parse(init.body) : init.body);
    calls.push({ url: u, init, body, headers: init.headers || {} });
    for (const r of rules) { const res = r(u, init, body); if (res) return res; }
    if (u.includes('api.resend.com')) return new Response(JSON.stringify({ id: 're_' + calls.length }), { status: 200 });
    if (u.includes('api.twilio.com')) return new Response(JSON.stringify({ sid: 'SM' + calls.length }), { status: 201 });
    if (u.includes('pushover')) return new Response('{"status":1}', { status: 200 });
    return new Response('not stubbed', { status: 500 });
  };
  return { calls, restore: () => { globalThis.fetch = real; }, emails: () => calls.filter((c) => c.url.includes('resend')), sms: () => calls.filter((c) => c.url.includes('twilio')) };
}

let ipN = 1;
export const ip = () => '198.51.100.' + (++ipN % 250);
export const req = (method, path, { body, headers = {}, ipaddr, ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) AppleWebKit/605.1.15 Version/17.0 Mobile Safari/604.1', origin = SITE } = {}) =>
  new Request(SITE + path, { method, headers: { 'cf-connecting-ip': ipaddr || ip(), 'user-agent': ua, ...(origin && method !== 'GET' ? { origin } : {}), ...(body && typeof body === 'object' ? { 'content-type': 'application/json' } : {}), ...headers }, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) });

// Inserts a tag directly. opts: { status, dog, owner:{email,tz}, contacts:[{slot,email,phone,sms,verified,stopped}], show_phone, buyer_email, message }
export async function makeTag(env, opts = {}) {
  const id = opts.id || newTagId(), now = Date.now();
  let ownerId = null;
  if (opts.owner !== null && (opts.status === 'claimed' || opts.owner)) {
    const email = (opts.owner && opts.owner.email) || `owner-${id}@example.com`;
    const have = await env.TAGDB.prepare('SELECT id FROM owners WHERE email = ?1').bind(email).first();
    ownerId = have ? have.id : rowId();
    if (!have) await env.TAGDB.prepare('INSERT INTO owners(id, email, tz, created_at) VALUES(?1,?2,?3,?4)').bind(ownerId, email, (opts.owner && opts.owner.tz) || 'America/Denver', now).run();
  }
  const status = opts.status || 'shipped';
  await env.TAGDB.prepare(`INSERT INTO tags(id, order_id, tag_index, shape, finish, status, owner_id, dog_name, message, show_phone, buyer_email, claim_ver, payload, created_at, alerts_paused_until)
    VALUES(?1,?2,0,'military','stainless',?3,?4,?5,?6,?7,?8,1,?9,?10,?11)`).bind(id, opts.order || 'SDT-' + id.slice(0, 4), status, ownerId, opts.dog === undefined ? 'Whisky' : opts.dog, opts.message || null, opts.show_phone ? 1 : 0, opts.buyer_email || null, 'HTTPS://SALTYDOGTAGS.COM/T/' + id, now, opts.paused || null).run();
  const cids = [];
  for (const c of opts.contacts || []) {
    const cid = rowId(); cids.push(cid);
    await env.TAGDB.prepare('INSERT INTO contacts(id, owner_id, tag_id, slot, label, phone_e164, email, sms_on, email_on, sms_verified_at, sms_stopped_at, sms_consent_ver) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)')
      .bind(cid, ownerId, id, c.slot || 1, c.label || 'Me', c.phone || null, c.email || null, c.sms ? 1 : 0, c.email_on === false ? 0 : (c.email ? 1 : 0), c.verified ? now : null, c.stopped ? now : null, c.sms ? 'sdt-sms-v1-2026-11-16' : null).run();
  }
  return { id, ownerId, cids };
}
export const getRow = (env, sql, ...a) => env.TAGDB.prepare(sql).bind(...a).first();
export const allRows = async (env, sql, ...a) => (await env.TAGDB.prepare(sql).bind(...a).all()).results;
export async function nonceFor(id, at = Date.now() - 5000) { return scanNonce(KEY, id, at); }
export async function sessionCookieFor(env, ownerId) { const s = await createSession(env, ownerId); return `sdt_s=${s.token}`; }
