'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, after } = require('node:test');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ipppping-soak-gate-'));
let sequence = 0;
after(() => fs.rmSync(dir, { recursive: true, force: true }));
const fixture = () => ({ driver: 'direct-cdp', networkInspector: 'off', complete: true,
  soakSeconds: 3600, soakPattern: 'scroll', soakView: 'charts',
  soakRender: 'normal', soakMotion: 'normal', errors: [],
  cycles: 1700, submits: 56, summaryRequests: 855, seriesRequests: 2500,
  samples: Array.from({ length: 61 }, (_, i) => ({ elapsed: i * 60000,
    privateByType: { renderer: 200 * 1048576 }, heap: 2 * 1048576,
    nodes: 30000, jsEventListeners: 34, instances: 4, pooled: 0, allocations: 4,
    cache: 16, cacheBytes: 25000, pending: 0, canvases: 4,
    pixels: 640000, backingPixels: 640000 })) });
const run = report => {
  const name = path.join(dir, 'report-' + sequence++ + '.json');
  fs.writeFileSync(name, JSON.stringify(report));
  return spawnSync(process.execPath, [path.join(__dirname, 'analyze-p4-soak.cjs'), name], { encoding: 'utf8' });
};
test('a full stable visible-rendering report passes the original numerical gate', () => {
  const result = run(fixture()); assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).passed, true);
});
test('an incomplete or actually shorter run cannot pass by claiming 3600 seconds', () => {
  const incomplete = fixture(); incomplete.complete = false; assert.notEqual(run(incomplete).status, 0);
  const short = fixture(); short.samples.forEach(row => { row.elapsed *= .9; });
  assert.notEqual(run(short).status, 0);
});
test('Network recording and non-production isolation controls are not release gates', () => {
  for (const [field, value] of [['networkInspector', 'default'], ['soakPattern', 'static'],
    ['soakView', 'results'], ['soakRender', 'no-paint'], ['soakRender', 'hidden-canvas'],
    ['soakMotion', 'reduce'], ['axisFormat', 'shared']]) {
    const report = fixture(); report[field] = value;
    assert.notEqual(run(report).status, 0, field + '=' + value);
  }
});
test('renderer growth fails both declared windows despite stable JS heap', () => {
  const report = fixture(); report.samples.forEach((row, i) => { row.privateByType.renderer += i * 1048576; });
  const result = run(report); assert.equal(result.status, 1);
  const data = JSON.parse(result.stdout);
  assert.equal(data.checks.rendererSlope, false); assert.equal(data.checks.rendererMedianDrift, false);
});
test('bounded visible charts cannot hide an accumulating pool or backing stores', () => {
  for (const field of ['pooled', 'allocations', 'backingPixels']) {
    const report = fixture(); report.samples.at(-1)[field] = field === 'backingPixels' ? 5000000 : 9;
    const result = run(report); assert.equal(result.status, 1);
    assert.equal(JSON.parse(result.stdout).passed, false);
  }
});
test('cache, DOM, listener and heap growth remain hard failures', () => {
  for (const [field, value] of [['cache', 17], ['cacheBytes', 2 * 1048576 + 1],
    ['nodes', 30009], ['jsEventListeners', 59], ['heap', 4 * 1048576 + 1]]) {
    const report = fixture(); report.samples.at(-1)[field] = value;
    assert.equal(run(report).status, 1, field);
  }
});
