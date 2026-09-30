'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { complete, REQUIRED_HOURS } = require('./observation-state.cjs');
const started = '2026-09-30T03:00:00.000Z';
const samples = hours => Array.from({ length: hours + 1 }, (_, hour) =>
  ({ checkedAt: new Date(Date.parse(started) + hour * 3600000).toISOString(), passed: true }));
test('a full 12h observation requires baseline plus twelve hourly samples', () => {
  assert.equal(REQUIRED_HOURS, 12);
  assert.equal(complete(samples(12), started), true);
  assert.equal(complete(samples(11), started), false);
  assert.equal(complete(samples(12), started, 24), false);
  assert.equal(complete(samples(12), started, 48), false);
});
test('two passing endpoints and duplicate samples cannot impersonate coverage', () => {
  const rows = samples(12);
  assert.equal(complete([rows[0], rows.at(-1)], started), false);
  assert.equal(complete([...Array(12).fill(rows[0]), rows.at(-1)], started), false);
});
test('failure, invalid timestamp, late start and gaps remain incomplete', () => {
  const rows = samples(12); rows[3].passed = false;
  assert.equal(complete(rows, started), false);
  assert.equal(complete(samples(13).slice(1), started), false);
  const broken = samples(12); broken[3].checkedAt = 'invalid';
  assert.equal(complete(broken, started), false);
  const gaps = [...samples(5), ...samples(17).slice(10)];
  assert.equal(complete(gaps, started), false);
});

test('thirteen samples just short of twelve actual hours cannot pass', () => {
  const rows = samples(12);
  rows.at(-1).checkedAt = new Date(Date.parse(rows.at(-1).checkedAt) - 1).toISOString();
  assert.equal(complete(rows, started), false);
});
