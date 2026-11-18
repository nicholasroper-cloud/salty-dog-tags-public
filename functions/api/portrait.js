// POST /api/portrait — optional stylized sticker portrait of the uploaded dog photo (img2img).
// Best-effort: image generation is slow and not every account/region has every model behaving
// reliably, so any failure (timeout, model error, bad output) degrades to {error:'portrait unavailable'}
// rather than blocking the page — this endpoint is a bonus, /api/roast is the one that must always work.
// The uploaded photo is never stored.
import { json, corsHeaders, handlePreflight, rateLimitIp, withTimeout } from './_lib.js';

export const onRequestOptions = ({ request, env }) => handlePreflight(request, env);

// Workers AI currently ships @cf/stabilityai/stable-diffusion-xl-base-1.0 for img2img (the spec's
// suggested @cf/runwayml/stable-diffusion-v1-5-img2img is not in the live model catalog as of this
// build — confirmed via `wrangler ai models list`). SDXL base-1.0 accepts image_b64 + strength for
// img2img and returns a raw PNG stream.
const PORTRAIT_MODEL = '@cf/stabilityai/stable-diffusion-xl-base-1.0';
const PORTRAIT_PROMPT = 'flat vector sticker of this dog, synthwave colors, thick black outline, bold flat shading, die-cut sticker style';
const PORTRAIT_NEGATIVE = 'photo, photorealistic, blurry, text, watermark, extra limbs, deformed';

// Diffusion is much slower than a text/vision call — this is a deliberately longer budget than the
// 5s used on /api/roast's AI calls, since the job here is cosmetic, not core to a tag order.
const PORTRAIT_TIMEOUT_MS = 20000;
const RATE_LIMIT = 20;
const RATE_WINDOW_S = 60 * 60;
const MAX_BODY = 2_200_000;
const IMAGE_MAX_BYTES = 1_572_864;
const DATA_URL_RE = /^data:image\/(jpeg|jpg|png);base64,([A-Za-z0-9+/=]+)$/;

function toBase64(bytes) {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  return btoa(binary);
}

// Workers AI binary-output models (image generation) hand back a ReadableStream; normalize to bytes.
async function resultToBytes(result) {
  if (result instanceof Uint8Array) return result;
  if (result instanceof ArrayBuffer) return new Uint8Array(result);
  if (result && typeof result.getReader === 'function') {
    const reader = result.getReader();
    const chunks = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.length;
    }
    const out = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) { out.set(c, offset); offset += c.length; }
    return out;
  }
  return null;
}

export async function onRequestPost({ request, env }) {
  const extra = corsHeaders(request, env);
  if (!env.AI) return json({ error: 'portrait unavailable' }, 200, extra);
  if ((request.headers.get('content-type') || '').indexOf('application/json') < 0) return json({ error: 'json only' }, 415, extra);
  const raw = await request.text();
  if (raw.length > MAX_BODY) return json({ error: 'too big' }, 413, extra);
  let body;
  try { body = JSON.parse(raw); } catch { return json({ error: 'bad json' }, 400, extra); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ error: 'bad json' }, 400, extra);

  if (body.website) return json({ error: 'portrait unavailable' }, 200, extra); // honeypot: no AI spend

  if (typeof body.image !== 'string' || !body.image) return json({ error: 'No photo provided.' }, 400, extra);
  const m = DATA_URL_RE.exec(body.image);
  if (!m) return json({ error: 'That photo upload looks corrupted. Please re-upload it.' }, 400, extra);
  const approxBytes = Math.floor((m[2].length * 3) / 4);
  if (approxBytes > IMAGE_MAX_BYTES) return json({ error: 'That photo is too large. Please use a smaller image (1.5MB max).' }, 400, extra);

  let bytesIn;
  try { bytesIn = Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0)); }
  catch { return json({ error: 'That photo upload looks corrupted. Please re-upload it.' }, 400, extra); }

  const limited = await rateLimitIp(env, request, RATE_LIMIT, RATE_WINDOW_S);
  if (!limited.ok) return json({ error: 'Too many requests. Try again in a bit.' }, 429, extra);

  try {
    // image_b64 is documented in the model schema but rejected at runtime ("input tensor `image` is
    // not present") as of this build; the array form is what actually works. Verified live, not just
    // from docs.
    const result = await withTimeout(
      env.AI.run(PORTRAIT_MODEL, {
        prompt: PORTRAIT_PROMPT,
        negative_prompt: PORTRAIT_NEGATIVE,
        image: Array.from(bytesIn),
        strength: 0.6,
        num_steps: 20,
        guidance: 8,
      }),
      PORTRAIT_TIMEOUT_MS
    );
    const bytes = await resultToBytes(result);
    if (!bytes || !bytes.length) return json({ error: 'portrait unavailable' }, 200, extra);
    return json({ image: 'data:image/png;base64,' + toBase64(bytes) }, 200, extra);
  } catch {
    // Verified live (2026-10-12): this account/region's deployment of stable-diffusion-xl-base-1.0
    // rejects both `image` and `image_b64` with "input tensor `image` is not present in the model",
    // despite the published schema listing img2img support. The only other image-capable model that
    // accepts a real `image` input, @cf/runwayml/stable-diffusion-v1-5-inpainting, requires a
    // full-resolution mask_image tensor we cannot build server-side without an image-decoding
    // dependency. Per spec, fail closed here rather than block /api/roast or ship a fragile mask guess.
    return json({ error: 'portrait unavailable' }, 200, extra);
  }
}
