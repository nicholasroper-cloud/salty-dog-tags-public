// saltydogtags.com admin API client. The Bearer key lives only in this closure: it is never put in a URL,
// an error message, or a log line (R6).
export class ApiError extends Error {
  constructor(code, message, status) { super(message); this.code = code; this.status = status; }
}

const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

export function createApi({ apiBase, key, fetchImpl = fetch }) {
  const base = apiBase.replace(/\/+$/, '');
  const auth = { Authorization: `Bearer ${key}` };

  async function call(pathAndQuery, init, timeoutMs) {
    let res;
    try {
      res = await fetchImpl(base + pathAndQuery, { ...init, headers: { ...auth, ...(init && init.headers) }, signal: AbortSignal.timeout(timeoutMs), redirect: 'error' });
    } catch (e) {
      if (e && (e.name === 'TimeoutError' || e.name === 'AbortError')) throw new ApiError('TIMEOUT', `request timed out after ${timeoutMs} ms`);
      throw new ApiError('NETWORK', `network error: ${e && e.cause && e.cause.code ? e.cause.code : (e && e.message) || 'unknown'}`);
    }
    if (res.status === 401) throw new ApiError('AUTH', 'admin key rejected (401)', 401);
    if (!res.ok) throw new ApiError(`HTTP_${res.status}`, `HTTP ${res.status}`, res.status);
    return res;
  }

  return {
    async listOrders() {
      const res = await call('/api/orders', { method: 'GET' }, 15000);
      let body;
      try { body = await res.json(); } catch { throw new ApiError('BAD_BODY', 'orders response was not JSON'); }
      if (!body || !Array.isArray(body.orders)) throw new ApiError('BAD_BODY', 'orders response has no orders array');
      return body.orders;
    },

    async setStatus(id, status) {
      const res = await call('/api/orders', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id, status }) }, 15000);
      try { return await res.json(); } catch { return { ok: true }; }
    },

    // Streams the body and aborts above 10 MB.
    async getPhoto(id, index) {
      const res = await call(`/api/photo?id=${encodeURIComponent(id)}&t=${encodeURIComponent(String(index))}`, { method: 'GET' }, 30000);
      const declared = Number(res.headers.get('content-length'));
      if (declared > MAX_PHOTO_BYTES) throw new ApiError('TOO_BIG', 'photo exceeds 10 MB');
      const chunks = [];
      let total = 0;
      for await (const chunk of res.body) {
        total += chunk.length;
        if (total > MAX_PHOTO_BYTES) throw new ApiError('TOO_BIG', 'photo exceeds 10 MB');
        chunks.push(chunk);
      }
      return { bytes: Buffer.concat(chunks), contentType: res.headers.get('content-type') || '' };
    }
  };
}
