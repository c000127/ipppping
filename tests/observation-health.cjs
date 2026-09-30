'use strict';
const assert = require('node:assert/strict');

// Window-local current is not a live health witness. Never backfill its nulls.
function check(summary, live, now) {
  assert.ok(Number.isFinite(now), 'finite observation clock');
  assert.equal(summary?.schema, 'ipppping.series.v2');
  assert.equal(summary.source, 'akari_jp');
  assert.equal(summary.target, 'google_dns');
  assert.equal(summary.protocol, 'v4');
  assert.ok(!summary.error, 'known summary must be available');
  const fresh = (stamp, maxAge, label) => assert.ok(Number.isFinite(stamp) &&
    stamp > 0 && now - stamp <= maxAge && stamp <= now + 60, label);
  const { start, end } = summary.window || {};
  assert.ok(Number.isFinite(start) && Number.isFinite(end) && start < end && end % 60 === 0,
    'valid frozen minute-aligned window');
  fresh(end, 120, 'summary window must remain recent');
  fresh(summary.generated_at, 120, 'summary generation must remain recent');
  assert.ok(summary.generated_at >= end, 'generation cannot precede window');

  assert.equal(live?.stats_semantics, 'p1-raw-current');
  assert.equal(live.freshness_source, 'rrd_lastupdate');
  assert.equal(live.measurement_state, 'measured', 'raw data must contain a measurement, not just an RRD write');
  fresh(live.measurement_updated_at, 300, 'known live measurement must remain fresh');
  fresh(live.observed_at, 300, 'live witness must remain recent');
  assert.equal(live.measurement_updated_at, live.rrd_updated_at);
  const measured = value => Number.isFinite(value.current_ms) && value.current_ms >= 0 ||
    Number.isFinite(value.current_loss_pct) && value.current_loss_pct >= 0 && value.current_loss_pct <= 100;
  assert.ok(measured(live), 'a measured RTT or loss is required; full loss is still a measurement');

  const current = summary.current || {};
  fresh(current.rrd_updated_at, 300, 'snapshot raw input must remain fresh');
  assert.ok(live.measurement_updated_at >= current.rrd_updated_at,
    'later independent witness cannot be older than snapshot input');
  if (current.state === 'outside_window') {
    assert.ok(current.rrd_updated_at > end, 'only a newer raw input explains this recent outside_window');
    for (const key of ['measurement_updated_at', 'current_ms', 'current_loss_pct'])
      assert.equal(current[key], null, 'outside_window values must stay null');
  } else {
    assert.equal(current.state, 'measured', 'missing/unknown current is not healthy');
    assert.ok(start < current.rrd_updated_at && current.rrd_updated_at <= end, 'current must belong to window');
    assert.equal(current.measurement_updated_at, current.rrd_updated_at);
    assert.ok(measured(current), 'measured snapshot must contain RTT or loss');
    fresh(current.measurement_updated_at, 300, 'window-local measurement must remain fresh');
  }
  return { measurementUpdatedAt: live.measurement_updated_at,
    snapshotState: current.state, witness: 'separate-p1-raw-current-read' };
}
module.exports = { check };
