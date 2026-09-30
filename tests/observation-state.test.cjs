'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { complete } = require('./observation-state.cjs');
const started = '2026-09-30T03:00:00.000Z';
const samples = hours => Array.from({ length: hours + 1 }, (_, hour) =>
  ({ checkedAt: new Date(Date.parse(started) + hour * 3600000).toISOString(), passed: true }));
test('a full hourly observation can pass 24h and then 48h separately', () => {
  assert.equal(complete(samples(24), started, 24), true);
  assert.equal(complete(samples(24), started, 48), false);
  assert.equal(complete(samples(48), started, 48), true);
});
test('two passing endpoints and duplicate samples cannot impersonate coverage', () => {
  const rows = samples(24);
  assert.equal(complete([rows[0], rows.at(-1)], started, 24), false);
  assert.equal(complete([...Array(24).fill(rows[0]), rows.at(-1)], started, 24), false);
});
test('failure, invalid timestamp, late start and gaps remain incomplete', () => {
  const rows = samples(24); rows[3].passed = false;
  assert.equal(complete(rows, started, 24), false);
  assert.equal(complete(samples(25).slice(1), started, 24), false);
  const broken = samples(24); broken[3].checkedAt = 'invalid';
  assert.equal(complete(broken, started, 24), false);
  const gaps = [...samples(5), ...samples(29).slice(10)];
  assert.equal(complete(gaps, started, 24), false);
});

