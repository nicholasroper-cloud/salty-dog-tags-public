// GET /api/notify-test  (Authorization: Bearer ADMIN_KEY) — fires a sample order ping so the owner can check the phone.
import { json, isAdmin } from './_lib.js';
import { notifyOrder } from './_notify.js';
export async function onRequestGet({ request, env }) {
  if (!isAdmin(request, env)) return json({ error: 'nope' }, 401);
  const sample = { id: 'TEST-0000', totals: { total: 12 }, customer: { name: 'Test Human', delivery: 'ship' },
    tags: [{ shape: 'bone', finish: 'black', size: 'medium', qty: 1, front: ['Built like', 'a loaf.'], back: [] }] };
  const errors = await notifyOrder(null, env, sample, 'new');
  return json({ ok: true, errors, channels: { ntfy: Boolean(env.NTFY_TOPIC), pushover: Boolean(env.PUSHOVER_TOKEN && env.PUSHOVER_USER), twilio: Boolean(env.TWILIO_SID && env.TWILIO_FROM && env.NOTIFY_TO) } });
}
