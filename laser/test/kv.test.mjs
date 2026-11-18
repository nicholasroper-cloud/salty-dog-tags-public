import { test } from 'node:test';
import assert from 'node:assert/strict';
import { effectiveInterval, kvBudgetLine } from '../lib/queue.mjs';

const iv = (o) => effectiveInterval(o).intervalS;

test('free/unknown: floor of 180 s even when 60 is configured', () => {
  for (const kvPlan of ['free', 'unknown']) {
    assert.equal(iv({ pollSeconds: 60, kvPlan, orderCount: 10 }), 180);
    assert.equal(iv({ pollSeconds: 60, kvPlan, orderCount: 100 }), 180);
  }
});

test('the owner default of 300 s is kept on free/unknown', () => {
  assert.equal(iv({ pollSeconds: 300, kvPlan: 'free', orderCount: 10 }), 300);
  assert.equal(iv({ pollSeconds: 300, kvPlan: 'unknown', orderCount: 100 }), 300);
});

test('paid removes the floor and the read cap', () => {
  assert.equal(iv({ pollSeconds: 60, kvPlan: 'paid', orderCount: 10 }), 60);
  assert.equal(iv({ pollSeconds: 60, kvPlan: 'paid', orderCount: 500 }), 60);
});

test('read budget: interval stretches so reads/day stay <= 50,000 on free', () => {
  const k = effectiveInterval({ pollSeconds: 180, kvPlan: 'free', orderCount: 500 });
  assert.equal(k.intervalS, Math.ceil((500 * 86400) / 50000));
  assert.ok(k.readsPerDay <= 50000 + 500);   // rounding of lists/day
  const small = effectiveInterval({ pollSeconds: 180, kvPlan: 'free', orderCount: 100 });
  assert.equal(small.intervalS, 180);        // 100*480 = 48,000 <= 50,000
  assert.equal(small.listsPerDay, 480);
  assert.equal(small.readsPerDay, 48000);
});

test('backoff doubles per failure and caps at 900 s', () => {
  assert.equal(iv({ pollSeconds: 300, kvPlan: 'free', orderCount: 10, failures: 1 }), 600);
  assert.equal(iv({ pollSeconds: 300, kvPlan: 'free', orderCount: 10, failures: 2 }), 900);
  assert.equal(iv({ pollSeconds: 300, kvPlan: 'free', orderCount: 10, failures: 6 }), 900);
  assert.equal(iv({ pollSeconds: 60, kvPlan: 'paid', orderCount: 10, failures: 3 }), 480);
  assert.equal(iv({ pollSeconds: 60, kvPlan: 'paid', orderCount: 10, failures: 9 }), 900);
});

test('the 900 s cap never undercuts the read budget for very large order lists', () => {
  const k = effectiveInterval({ pollSeconds: 300, kvPlan: 'free', orderCount: 2000, failures: 3 });
  assert.equal(k.intervalS, Math.ceil((2000 * 86400) / 50000));
});

test('budget log line format', () => {
  const k = effectiveInterval({ pollSeconds: 300, kvPlan: 'unknown', orderCount: 41 });
  assert.equal(kvBudgetLine('unknown', k), `KV budget: plan=unknown, interval=300s, ~288/day lists, ~${288 * 41}/day reads (free limits 1,000 lists / 100,000 reads per account)`);
});
