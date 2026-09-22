const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Pool, delay, retryDelay, dataStatus } = require('../web/request-state.js');

test('mixed work shares four slots and drains after failures', async () => {
  const pool = new Pool(4);
  let running = 0, peak = 0;
  const settled = await Promise.allSettled(Array.from({ length: 80 }, (_, i) => pool.run(async () => {
    peak = Math.max(peak, ++running);
    await delay(1);
    running--;
    if (i % 7 === 0) throw new Error('failure');
    return i;
  })));
  assert.equal(peak, 4);
  assert.equal(settled.length, 80);
  await delay(0);
  assert.equal(pool.active, 0);
  assert.equal(pool.queue.length, 0);
});
test('queued cancellation never starts obsolete work', async () => {
  const pool = new Pool(1), controller = new AbortController();
  const first = pool.run(() => delay(20));
  let started = false;
  const cancelled = pool.run(() => { started = true; }, controller.signal);
  controller.abort();
  await assert.rejects(cancelled, { name: 'AbortError' });
  await first;
  assert.equal(started, false);
});
test('Retry-After seconds/date are lower bounds, not capped early', () => {
  assert.ok(retryDelay('120', 0) >= 120000);
  assert.ok(retryDelay('Tue, 22 Sep 2026 00:02:00 GMT', 0, Date.parse('2026-09-22T00:00:00Z')) >= 120000);
  assert.ok(retryDelay('invalid', 1) >= 1000);
});
test('missing, stale, expired, failed, full loss and clock skew differ', () => {
  const now = 1700001000000;
  const good = { measurement_updated_at: now / 1000 - 30, current_loss_pct: 0 };
  assert.equal(dataStatus(good, now, now).state, 'measured');
  assert.equal(dataStatus({}, now, now).state, 'unknown');
  assert.equal(dataStatus({ measurement_state: 'missing' }, now, now).state, 'missing');
  assert.equal(dataStatus({ ...good, measurement_updated_at: now / 1000 - 601 }, now, now).state, 'stale');
  assert.equal(dataStatus(good, now - 61000, now).state, 'stale');
  assert.equal(dataStatus(good, now, now, 'refresh_failed').state, 'error');
  assert.match(dataStatus({ ...good, current_loss_pct: 100 }, now, now).label, /100% loss/);
  assert.equal(dataStatus({ ...good, measurement_updated_at: now / 1000 + 61 }, now, now).state, 'unknown');
});
