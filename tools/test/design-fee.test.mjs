// node --test 'tools/test/*.test.mjs'
// "We design it" design fee (Nick, 2026-11-17): $2 per design on the mascot, synthwave and photo styles; Bold type and uploads are free.
// Art is made after payment (proof plus one round of changes), so an unpaid order costs nothing in image generation.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { price, checkoutLineItems, DESIGN_FEE_CENTS, DESIGN_FEE_STYLES, DESIGN_NOTE, designFeeUnits, ART_STYLES, MULTI_OFF } from '../../functions/api/_lib.js';
import { read } from '../lib/appdata.mjs';

const fc = (over = {}) => ({ shape: 'bone', size: 'medium', finish: 'fullcolor', qty: 1, art: 'design', style: 'mascot', front: ['A'], back: ['B'], ...over });

test('design fee: $2, on mascot, synthwave and photo only; Bold type and uploads are free; only on full color', () => {
  assert.equal(DESIGN_FEE_CENTS, 200);
  assert.deepEqual(DESIGN_FEE_STYLES, ['mascot', 'synthwave', 'photo']);
  for (const s of DESIGN_FEE_STYLES) assert.ok(ART_STYLES.includes(s), s);
  assert.ok(!DESIGN_FEE_STYLES.includes('bold'), 'Bold type is the free fallback');
  for (const style of DESIGN_FEE_STYLES) assert.equal(price([fc({ style })], [], 'ship').subtotal, 14 + 2, style);
  assert.equal(price([fc({ style: 'bold' })], [], 'ship').subtotal, 14);
  assert.equal(price([fc({ art: 'upload', style: undefined })], [], 'ship').subtotal, 14);
  assert.equal(designFeeUnits({ finish: 'black', art: 'design', style: 'mascot' }), 0, 'engraved tags never carry it');
});

test('design fee: once per design (copies share it), never discounted by the 3-tag deal', () => {
  const p = price([fc({ qty: 3 })], [], 'ship');
  assert.equal(p.subtotal, 3 * 14 + 2, 'three copies of one design pay one fee');
  assert.equal(p.discount, +(3 * 14 * MULTI_OFF).toFixed(2), 'the 15% is on the tag base only');
  const two = price([fc(), fc({ style: 'synthwave' })], [], 'ship');
  assert.equal(two.subtotal, 2 * 14 + 2 * 2, 'two designs, two fees');
});

test('design fee: its own Clover line at full price, with the after-payment proof note', () => {
  const order = { tags: [fc({ qty: 2 })], prints: [], ornaments: [], totals: { multi: false }, customer: { state: 'CA' } };
  const items = checkoutLineItems({}, order);
  const d = items.find((i) => i.name === 'Custom design');
  assert.ok(d); assert.equal(d.price, 200); assert.equal(d.unitQty, 1); assert.equal(d.note, DESIGN_NOTE);
  assert.match(DESIGN_NOTE, /after payment/); assert.match(DESIGN_NOTE, /One round of changes/);
  assert.equal(checkoutLineItems({}, { ...order, tags: [fc({ style: 'bold' })] }).find((i) => i.name === 'Custom design'), undefined);
});

test('design fee: app.js mirrors the server (price, styles) and the cart shows the line', () => {
  const app = read('site/app.js');
  assert.match(app, new RegExp(`designCents: ${DESIGN_FEE_CENTS}[,\\s}]`));
  assert.equal(/const DESIGN_FEE_STYLES = (\[[^\]]*\])/.exec(app)[1].replace(/'/g, '"'), JSON.stringify(DESIGN_FEE_STYLES).replace(/,/g, ', '));
  assert.match(app, /Custom design \(proof after payment, one round of changes\)/);
});

test('policies say how the design fee works, including the free Bold type fallback and no refund after the proof', () => {
  const pol = read('tools/content/policies.md');
  assert.match(pol, /\$2 design fee per design/); assert.match(pol, /after your invoice is paid/); assert.match(pol, /one round of changes/);
  assert.match(pol, /Bold type at no extra charge/); assert.match(pol, /isn't refunded once we've sent the proof/);
});
