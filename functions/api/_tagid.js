// Smart QR tag ids, claim codes, tokens. Pure functions over Web Crypto (Workers and Node 20+ both have it).
// ADR 2026-11-16 section 1. The id alphabet and URL shape are a permanent contract: never change them.
import { safeEqual } from './_security.js';
import SDTQR from '../../site/tag-qr.js';

// Crockford base32: 0-9 A-Z minus I L O U. 32 symbols, so `byte & 31` picks a character with NO modulo bias
// (orderId() in _lib.js uses `%` on a 31 letter alphabet, which is biased: do not copy it).
export const ID_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const ID_LEN = 10;
export const ID_RE = /^[0-9A-HJKMNP-TV-Z]{10}$/;

export function newTagId() {
  const b = new Uint8Array(ID_LEN);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => ID_ALPHABET[x & 31]).join('');
}

// Lookups ignore case and the usual misreads: O -> 0, I and L -> 1. Spaces and hyphens are dropped. Returns the canonical id or null.
export function normalizeTagId(input) {
  const s = String(input == null ? '' : input).toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  return ID_RE.test(s) ? s : null;
}

// Display and payload forms. People see saltydogtags.com/t/<id>; the QR encodes the upper case base (see site/tag-qr.js).
export const tagPayload = (id, env) => SDTQR.payloadFor(id, { base: env && typeof env.TAG_BASE_URL === 'string' && env.TAG_BASE_URL.trim() ? env.TAG_BASE_URL.trim().toUpperCase() : undefined });
export const tagDisplayUrl = (id, env) => `${String((env && env.SITE_URL) || 'https://saltydogtags.com').replace(/^https?:\/\//, '').replace(/\/+$/, '')}/t/${String(id).toLowerCase()}`;

export function b32(bytes) {
  let bits = 0, acc = 0, out = '';
  for (const byte of bytes) {
    acc = (acc << 8) | byte; bits += 8;
    while (bits >= 5) { out += ID_ALPHABET[(acc >>> (bits - 5)) & 31]; bits -= 5; }
    acc &= (1 << bits) - 1;
  }
  if (bits) out += ID_ALPHABET[(acc << (5 - bits)) & 31];
  return out;
}

async function hmacBytes(secret, msg) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg)));
}

// Claim code: first 12 chars (60 bits) of base32(HMAC-SHA256(TAG_CLAIM_KEY, `${id}:${claim_ver}`)), shown XXXX-XXXX-XXXX.
// Never stored: it can be reprinted any time, and bumping claim_ver retires the old one. Returns '' when the key is missing
// (fail closed: no key, no codes, nobody can claim).
export async function claimCode(key, id, ver = 1) {
  if (typeof key !== 'string' || key.length < 16) return '';
  const raw = b32(await hmacBytes(key, `${id}:${ver}`)).slice(0, 12);
  return raw.replace(/(.{4})(?=.)/g, '$1-');
}
export const normalizeClaimCode = (input) => {
  const s = String(input == null ? '' : input).toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  return /^[0-9A-HJKMNP-TV-Z]{12}$/.test(s) ? s : null;
};
export async function claimCodeOk(key, id, ver, input) {
  const given = normalizeClaimCode(input);
  const want = await claimCode(key, id, ver);
  if (!given || !want) return false;
  return safeEqual(given, want.replace(/-/g, ''));
}

// Beacon nonce: the finder page issues it, the scan beacon must return it. HMAC of the id and the issue time under a key derived
// from TAG_CLAIM_KEY (never the raw key), so a script that never loaded the page cannot fake a scan.
export async function scanNonce(key, id, at = Date.now()) {
  if (typeof key !== 'string' || key.length < 16) return '';
  const mac = b32(await hmacBytes(key, `nonce:${id}:${at}`)).slice(0, 16);
  return `${at.toString(36)}.${mac}`;
}
export async function scanNonceOk(key, id, nonce, now = Date.now(), { minAgeMs = 1000, maxAgeMs = 6 * 3600 * 1000 } = {}) {
  const m = /^([0-9a-z]{6,12})\.([0-9A-Z]{16})$/.exec(String(nonce || ''));
  if (!m) return false;
  const at = parseInt(m[1], 36);
  if (!Number.isFinite(at) || now - at < minAgeMs || now - at > maxAgeMs) return false;
  const want = await scanNonce(key, id, at);
  return Boolean(want) && safeEqual(want, nonce);
}

// Random secrets and row ids.
export const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export function randomToken(bytes = 32) { const b = new Uint8Array(bytes); crypto.getRandomValues(b); return b64url(b); }
export function rowId() { const b = new Uint8Array(12); crypto.getRandomValues(b); return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join(''); }
export async function sha256Hex(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(s)));
  return Array.from(new Uint8Array(buf), (x) => x.toString(16).padStart(2, '0')).join('');
}
