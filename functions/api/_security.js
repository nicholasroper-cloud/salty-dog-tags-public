// Small security helpers shared by the Pages Functions.

// Constant-time string compare. The loop always runs over the longer input and folds the length difference
// into the result, so timing depends on neither where the strings differ nor which one is shorter.
export function safeEqual(a, b) {
  a = String(a == null ? '' : a); b = String(b == null ? '' : b);
  const n = Math.max(a.length, b.length);
  let r = a.length ^ b.length;
  for (let i = 0; i < n; i++) r |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return r === 0;
}

// Parses a JSON request body and only returns plain objects. `null`, arrays, numbers and strings all become
// `null` so callers can answer 400 instead of throwing on `body.field` and returning a 500.
export async function readObject(request, maxBytes = 20000) {
  let raw;
  try { raw = await request.text(); } catch { return { error: 'bad body', status: 400 }; }
  if (raw.length > maxBytes) return { error: 'too big', status: 413 };
  let v;
  try { v = JSON.parse(raw); } catch { return { error: 'bad json', status: 400 }; }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return { error: 'bad json', status: 400 };
  return { body: v, raw };
}

export async function hmacHex(secret, msg) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, '0')).join('');
}

// IP hash for rate-limit and privacy counters. IP_SALT is REQUIRED: without it the hash is reversible over the
// IPv4 space, so callers get null and must fail closed (or skip storing it) rather than fall back to a public salt.
export async function saltedIpHash(env, request) {
  const salt = typeof env.IP_SALT === 'string' ? env.IP_SALT.trim() : '';
  if (salt.length < 16) return null;
  const ip = request.headers.get('cf-connecting-ip') || '';
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(salt + ':' + ip));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('').slice(0, 24);
}
