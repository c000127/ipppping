'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { complete, REQUIRED_HOURS, SAMPLE_INTERVAL_MINUTES } = require('./observation-state.cjs');
const started = '2026-09-30T03:00:00.000Z';
const samples = quarters => Array.from({ length: quarters + 1 }, (_, quarter) =>
  ({ checkedAt: new Date(Date.parse(started) + quarter * 15 * 60000).toISOString(), passed: true }));
test('a full 1h observation requires baseline plus four quarter-hour samples', () => {
  assert.equal(REQUIRED_HOURS, 1);
  assert.equal(SAMPLE_INTERVAL_MINUTES, 15);
  assert.equal(complete(samples(4), started), true);
  assert.equal(complete(samples(3), started), false);
  assert.equal(complete(samples(4), started, 12), false);
  assert.equal(complete(samples(4), started, 48), false);
});
test('two passing endpoints and duplicate samples cannot impersonate coverage', () => {
  const rows = samples(4);
  assert.equal(complete([rows[0], rows.at(-1)], started), false);
  assert.equal(complete([...Array(4).fill(rows[0]), rows.at(-1)], started), false);
});
test('failure, invalid timestamp, late start and gaps remain incomplete', () => {
  const rows = samples(4); rows[3].passed = false;
  assert.equal(complete(rows, started), false);
  assert.equal(complete(samples(6).slice(2), started), false);
  const broken = samples(4); broken[3].checkedAt = 'invalid';
  assert.equal(complete(broken, started), false);
  const gaps = [...samples(1), ...samples(7).slice(4)];
  assert.equal(complete(gaps, started), false);
});

test('five samples just short of one actual hour cannot pass', () => {
  const rows = samples(4);
  rows.at(-1).checkedAt = new Date(Date.parse(rows.at(-1).checkedAt) - 1).toISOString();
  assert.equal(complete(rows, started), false);
});
