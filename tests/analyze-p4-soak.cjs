/* Evaluate the predeclared local P4 60-minute Chrome memory gate. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');

const reportPath = process.argv[2];
if (!reportPath) throw new Error('usage: node tests/analyze-p4-soak.cjs REPORT.json');
const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
assert.notEqual(report.complete, false, 'the soak report is still in progress');
assert.ok(report.driver !== 'direct-cdp' || report.networkInspector === 'off',
  'direct CDP Network buffering is a diagnostic control, not the application memory gate');
assert.ok(report.soakSeconds >= 3600 && Array.isArray(report.samples) && report.samples.length >= 50,
  'a full 60-minute report with minute samples is required');
assert.ok((!report.soakPattern || report.soakPattern === 'scroll') &&
  (!report.soakView || report.soakView === 'charts'),
  'the G4 gate requires scrolling Charts, not an isolation control');
assert.ok(!report.soakRender || report.soakRender === 'normal',
  'the G4 gate requires actual visible Canvas rendering');
assert.ok(!report.soakMotion || report.soakMotion === 'normal',
  'the full G4 gate requires normal production motion');
const rows = [...report.samples].sort((a, b) => a.elapsed - b.elapsed);
const end = rows.at(-1).elapsed;
assert.ok(Number.isFinite(end) && end >= 3600000,
  'the observed sampling duration must cover at least 60 minutes');
const tail30 = rows.filter(row => row.elapsed >= end - 30 * 60000);
const first15 = tail30.filter(row => row.elapsed < end - 15 * 60000);
const last15 = tail30.filter(row => row.elapsed >= end - 15 * 60000);
const warm = rows.find(row => row.elapsed >= 10 * 60000);
assert.ok(warm && first15.length >= 10 && last15.length >= 10 &&
  rows.every(row => Number.isFinite(row.privateByType?.renderer)),
  'missing process-type or comparison-window samples');
const median = values => {
  const sorted = [...values].sort((a, b) => a - b);
  return (sorted[(sorted.length - 1) >> 1] + sorted[sorted.length >> 1]) / 2;
};
const mib = bytes => bytes / 1048576;
const slope = values => {
  const x = values.map(row => row.elapsed / 60000);
  const y = values.map(row => mib(row.privateByType.renderer));
  const meanX = x.reduce((sum, value) => sum + value, 0) / x.length;
  const meanY = y.reduce((sum, value) => sum + value, 0) / y.length;
  return x.reduce((sum, value, index) => sum + (value - meanX) * (y[index] - meanY), 0) /
    x.reduce((sum, value) => sum + (value - meanX) ** 2, 0);
};
const lastMedian = median(last15.map(row => mib(row.privateByType.renderer)));
const priorMedian = median(first15.map(row => mib(row.privateByType.renderer)));
const upper = key => Math.max(...rows.map(row => row[key]));
const range = key => [Math.min(...rows.map(row => row[key])), upper(key)];
const hasPoolSamples = rows.every(row => Number.isInteger(row.pooled) &&
  Number.isInteger(row.allocations));
const allocationRange = hasPoolSamples ? range('allocations') : null;
const checks = {
  rendererSlope: slope(tail30) <= 0.2,
  rendererMedianDrift: lastMedian - priorMedian <= 8,
  heap: rows.at(-1).heap <= warm.heap + 2 * 1048576,
  dom: range('nodes')[1] - range('nodes')[0] <= 8,
  listeners: range('jsEventListeners')[1] - range('jsEventListeners')[0] <= 24,
  instances: rows.every(row => row.instances + (row.pooled || 0) <= 4),
  ...(hasPoolSamples ? {
    poolAllocations: allocationRange[1] - allocationRange[0] <= 4,
    poolPixels: rows.every(row => Number.isFinite(row.backingPixels) &&
      row.backingPixels <= 4 * 1280 * 220 * 4)
  } : {}),
  cache: upper('cache') <= 16 && upper('cacheBytes') <= 2 * 1048576,
  pending: upper('pending') <= 4,
  canvases: upper('canvases') <= 4 && upper('pixels') <= 4 * 1280 * 220 * 4,
  errors: report.errors.length === 0
};
const result = { report: reportPath, minutes: +(end / 60000).toFixed(1),
  driver: report.driver || 'playwright', networkInspector: report.networkInspector || 'framework-managed',
  scrollPath: report.scrollPath || 'three-positions', seriesPoints: report.seriesPoints || null,
  visitedRoutes: report.visitedRoutes || null, viewport: report.viewport || null,
  releaseManifestSha256: report.releaseManifestSha256 || null, chartAsset: report.chartAsset || null,
  cycles: report.cycles, submits: report.submits,
  summaryRequests: report.summaryRequests, seriesRequests: report.seriesRequests,
  rendererSlopeMiBPerMin: +slope(tail30).toFixed(3),
  rendererMedianDriftMiB: +(lastMedian - priorMedian).toFixed(2),
  rendererPriorMedianMiB: +priorMedian.toFixed(2), rendererLastMedianMiB: +lastMedian.toFixed(2),
  heapWarmMiB: +mib(warm.heap).toFixed(2), heapEndMiB: +mib(rows.at(-1).heap).toFixed(2),
  domRange: range('nodes'), listenerRange: range('jsEventListeners'),
  maxInstances: upper('instances'), maxPooled: hasPoolSamples ? upper('pooled') : null,
  allocationRange, maxCache: upper('cache'),
  maxCacheBytes: upper('cacheBytes'), maxCanvases: upper('canvases'),
  maxPixels: upper('pixels'), maxBackingPixels: hasPoolSamples ? upper('backingPixels') : null, checks };
result.passed = Object.values(checks).every(Boolean);
console.log(JSON.stringify(result, null, 2));
if (!result.passed) process.exitCode = 1;
