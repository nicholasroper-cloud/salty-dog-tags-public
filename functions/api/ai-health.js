// GET /api/ai-health — dry run (no image) status for the models /api/roast and /api/portrait depend on.
// The text model gets a real, trivial prompt (cheap to run and the only honest way to know it answers).
// The vision and image models require an actual photo to say anything meaningful, so per spec this is a
// no-image dry run: we report them "configured" without spending an AI call on a fake image.
// Claude (the primary provider for /api/roast when ANTHROPIC_API_KEY is set) is NEVER called here: health
// only reports whether the key is present, so polling this endpoint cannot spend Anthropic tokens.
import { json, corsHeaders, handlePreflight, withTimeout, hasClaude, callClaude } from './_lib.js';
import { safeEqual } from './_security.js';

export const onRequestOptions = ({ request, env }) => handlePreflight(request, env);

const TEXT_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const VISION_MODEL = '@cf/llava-hf/llava-1.5-7b-hf';
const PORTRAIT_MODEL = '@cf/stabilityai/stable-diffusion-xl-base-1.0';
const CLAUDE_MODEL = 'claude-haiku-5-5'; // health probe only; cheapest model (Nick 2026-11-16: cut spend)
const AI_TIMEOUT_MS = 5000;

export async function onRequestGet({ request, env }) {
  const extra = corsHeaders(request, env);
  const claudeKey = hasClaude(env);
  // `provider` is what /api/roast will try first; Workers AI remains the fallback either way.
  const claude = { configured: claudeKey, model: CLAUDE_MODEL, note: claudeKey ? 'key set; not called (health never spends Claude tokens)' : 'ANTHROPIC_API_KEY not set' };
  const provider = claudeKey ? 'claude' : 'workers-ai';
  // Owner-only live probe: GET /api/ai-health?probe=1 with Bearer ADMIN_KEY makes ONE tiny Claude call (~5 tokens)
  // and reports success or the short error code, so a broken model id or key shows up without a full roast.
  const url = new URL(request.url);
  if (url.searchParams.get('probe') === '1') {
    const auth = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
    if (!env.ADMIN_KEY || !safeEqual(auth, env.ADMIN_KEY)) return json({ error: 'not found' }, 404, extra);
    // Rate-limit diagnostics for the owner: which key this request would use and what KV holds for it.
    let rl = null;
    try {
      const ip = request.headers.get('cf-connecting-ip') || '';
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ip));
      const h = Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('').slice(0, 24);
      rl = { key: 'ai:ip:' + h, value: await env.ORDERS.get('ai:ip:' + h) };
    } catch (e) { rl = { error: String((e && e.message) || e).slice(0, 80) }; }
    if (url.searchParams.get('rl') === '1') return json({ rl }, 200, extra);
    const t0 = Date.now();
    try {
      const text = await callClaude(env, { model: CLAUDE_MODEL, system: 'Reply with the single word OK.', messages: [{ role: 'user', content: 'OK?' }], maxTokens: 5, timeoutMs: 20000 });
      return json({ probe: 'ok', model: CLAUDE_MODEL, ms: Date.now() - t0, text: String(text).slice(0, 20) }, 200, extra);
    } catch (e) {
      return json({ probe: 'fail', model: CLAUDE_MODEL, ms: Date.now() - t0, code: String((e && e.message) || e).slice(0, 60) }, 200, extra);
    }
  }
  if (!env.AI) return json({ ai: false, models: {}, provider, claude }, 200, extra);

  const models = {};
  try {
    const out = await withTimeout(
      env.AI.run(TEXT_MODEL, { messages: [{ role: 'user', content: 'Reply with the single word: OK' }], max_tokens: 5 }),
      AI_TIMEOUT_MS
    );
    models[TEXT_MODEL] = { ok: Boolean(out && typeof out.response === 'string' && out.response.length), note: 'live dry run' };
  } catch (e) {
    models[TEXT_MODEL] = { ok: false, note: String((e && e.message) || e).slice(0, 120) };
  }

  // No image is sent for these two (per spec); we can only confirm the binding has them configured,
  // not that a real inference call succeeds. /api/roast and /api/portrait report real failures live.
  models[VISION_MODEL] = { ok: null, note: 'not called — requires an image; see POST /api/roast' };
  models[PORTRAIT_MODEL] = { ok: null, note: 'not called — requires an image; see POST /api/portrait' };

  return json({ ai: true, models, provider, claude }, 200, extra);
}
