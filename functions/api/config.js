// GET /api/config — tells the page whether card checkout is switched on (so copy and buttons match), and whether the
// smart QR tag add-on is offered (with the finish gates and payload base the builder needs to decide eligibility).
import { json, payEnabled, SMART_PRICE, SMART_LINE } from './_lib.js';
import { smartEnabled, qrConfig } from './_tagsettings.js';
import FINISH_FLAGS from '../../site/tag-qr-finishes.json' with { type: 'json' };

export const onRequestGet = ({ env }) => {
  const on = smartEnabled(env);
  const smart = on ? { price: SMART_PRICE, line: SMART_LINE, finishes: FINISH_FLAGS.finishes, base: qrConfig(env).baseUrl() } : null;
  return json({ pay: payEnabled(env), ...(smart ? { smart } : {}) }, 200, { 'cache-control': 'public, max-age=60' });
};
