'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { check } = require('./observation-health.cjs');
const now = 1800000030, end = 1800000000;
function fixture(outside = false) {
  const stamp = outside ? end + 10 : end - 10;
  return { summary: { schema: 'ipppping.series.v2', source: 'akari_jp', target: 'google_dns',
    protocol: 'v4', generated_at: now - 1, window: { start: end - 10800, end },
    current: { state: outside ? 'outside_window' : 'measured', rrd_updated_at: stamp,
      measurement_updated_at: outside ? null : stamp, current_ms: outside ? null : 1,
      current_loss_pct: outside ? null : 0 } },
  live: { stats_semantics: 'p1-raw-current', freshness_source: 'rrd_lastupdate',
    measurement_state: 'measured', measurement_updated_at: stamp, rrd_updated_at: stamp,
    observed_at: now, current_ms: 1, current_loss_pct: 0 } };
}
const run = f => check(f.summary, f.live, now);
test('measured current and separate live evidence pass without mutation', () => {
  const f = fixture(), before = JSON.stringify(f);
  assert.equal(run(f).measurementUpdatedAt, end - 10);
  assert.equal(JSON.stringify(f), before);
});
test('newer raw input outside frozen window stays null, with independent measured proof', () => {
  const f = fixture(true), before = JSON.stringify(f);
  assert.equal(run(f).snapshotState, 'outside_window');
  assert.equal(JSON.stringify(f), before);
});
test('outside_window is not enough without a real measured witness', () => {
  for (const state of ['missing', 'unknown']) {
    const f = fixture(true); f.live.measurement_state = state;
    f.live.measurement_updated_at = null; f.live.current_ms = null; f.live.current_loss_pct = null;
    assert.throws(() => run(f));
  }
});
test('a fresh RRD write or RTT average never replaces a missing measurement', () => {
  const f = fixture(); f.live.measurement_updated_at = null; f.live.avg_ms = 1;
  assert.throws(() => run(f));
});
test('full loss is measured even when RTT is null', () => {
  const f = fixture(); f.live.current_ms = null; f.live.current_loss_pct = 100;
  f.summary.current.current_ms = null; f.summary.current.current_loss_pct = 100;
  assert.equal(run(f).measurementUpdatedAt, end - 10);
});
test('missing raw values cannot pass a falsely measured state', () => {
  const f = fixture(); f.live.current_ms = null; f.live.current_loss_pct = null;
  assert.throws(() => run(f));
});
test('original five-minute age and sixty-second future limits are unchanged', () => {
  const f = fixture(true); f.live.measurement_updated_at = f.live.rrd_updated_at = now + 60;
  assert.doesNotThrow(() => run(f));
  f.live.measurement_updated_at = f.live.rrd_updated_at = now + 61;
  assert.throws(() => run(f));
  const old = fixture(); old.live.measurement_updated_at = old.live.rrd_updated_at = now - 301;
  assert.throws(() => run(old));
  const boundary = fixture();
  boundary.summary.current.rrd_updated_at = boundary.summary.current.measurement_updated_at = now - 300;
  boundary.live.measurement_updated_at = boundary.live.rrd_updated_at = now - 300;
  assert.doesNotThrow(() => run(boundary));
});
test('cached or historical summary cannot pass on fresh live data alone', () => {
  const f = fixture(); f.summary.window.end -= 180; assert.throws(() => run(f));
  const generated = fixture(); generated.summary.generated_at = now - 121;
  assert.throws(() => run(generated));
});
test('outside_window cannot conceal an older, in-window or fabricated current', () => {
  const f = fixture(true); f.summary.current.rrd_updated_at = end - 1;
  assert.throws(() => run(f));
  const invented = fixture(true); invented.summary.current.measurement_updated_at = end + 10;
  assert.throws(() => run(invented));
});
test('route mismatch and wrong semantics are rejected', () => {
  for (const field of ['source', 'target', 'protocol', 'schema']) {
    const f = fixture(); f.summary[field] = 'wrong'; assert.throws(() => run(f));
  }
  const f = fixture(); f.live.stats_semantics = 'legacy'; assert.throws(() => run(f));
});
test('stale raw input, stale witness and missing summary are rejected', () => {
  const f = fixture(true); f.summary.current.rrd_updated_at = now - 301; assert.throws(() => run(f));
  const witness = fixture(); witness.live.observed_at = now - 301; assert.throws(() => run(witness));
  const missing = fixture(); missing.summary.current.state = 'missing'; assert.throws(() => run(missing));
  const malformed = fixture(); malformed.summary.current.current_ms = malformed.summary.current.current_loss_pct = null;
  assert.throws(() => run(malformed));
});
test('a witness older than snapshot input is not accepted', () => {
  const f = fixture(true); f.live.measurement_updated_at = f.live.rrd_updated_at = end;
  assert.throws(() => run(f));
});
