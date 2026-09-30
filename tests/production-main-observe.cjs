/* One low-rate observation after default promotion. No deployment, deletion, or node changes. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright');
const observation = require('./observation-state.cjs');
const root = path.resolve(__dirname, '..');
const origin = 'https://ipppping.hachimihaqile.top';
assert.equal(process.env.MAIN_OBSERVATION_PASS, '1', 'explicit production observation opt-in required');
const releaseRoot = process.env.TEST_RELEASE_ROOT || 'build/web-release-main-default';
assert.match(releaseRoot, /^build\/web-release(?:-[a-z0-9-]+)?$/);
const manifestBytes = fs.readFileSync(path.join(root, releaseRoot, 'manifest.json'));
const manifest = JSON.parse(manifestBytes);
const manifestHash = crypto.createHash('sha256').update(manifestBytes).digest('hex');
const start = Date.parse(process.env.OBSERVATION_STARTED_AT);
assert.ok(Number.isFinite(start) && start <= Date.now(), 'explicit actual default release timestamp required');
const reportPath = path.join(root, 'test-results/main-canvas-observation.json');
const report = fs.existsSync(reportPath) ? JSON.parse(fs.readFileSync(reportPath)) :
  { startedAt: new Date(start).toISOString(), manifestHash, samples: [] };
assert.equal(report.startedAt, new Date(start).toISOString(), 'never reuse another observation window');
assert.equal(report.manifestHash, manifestHash, 'never mix release fingerprints');
assert.ok(report.samples.length < 128, 'finite observation window; do not monitor indefinitely');
const row = { checkedAt: new Date().toISOString(), passed: false, hours: (Date.now() - start) / 3600000 };
(async () => {
  const host = execFileSync('ssh', ['-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-p', '13922',
    'root@84.54.3.65', 'systemctl show ipppping.service -p MainPID -p NRestarts -p ActiveState -p MemoryCurrent; systemctl is-active caddy; awk \'/^MemAvailable:|^SwapFree:|^SwapTotal:/{print}\' /proc/meminfo'],
    { encoding: 'utf8', timeout: 20000, windowsHide: true });
  row.host = Object.fromEntries(host.split(/\r?\n/).filter(line => line.includes('=')).map(line => line.split('=')));
  row.host.caddy = host.split(/\r?\n/).includes('active');
  const kib = field => Number(host.match(new RegExp('^' + field + ':\\s+(\\d+)', 'm'))?.[1]);
  row.host.availableBytes = kib('MemAvailable') * 1024;
  row.host.swapUsedBytes = (kib('SwapTotal') - kib('SwapFree')) * 1024;
  assert.equal(row.host.ActiveState, 'active'); assert.equal(row.host.caddy, true);
  const baseline = report.samples[0]?.host;
  if (baseline) {
    assert.equal(row.host.MainPID, baseline.MainPID, 'API process changed during observation; investigate before acceptance');
    assert.equal(row.host.NRestarts, baseline.NRestarts, 'API restart count changed during observation');
  }
  assert.ok(Number(row.host.MemoryCurrent) <= 128 * 1024 * 1024, 'API memory safety line');
  assert.ok(row.host.availableBytes >= 256 * 1024 * 1024, 'host available-memory safety line');
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [], requests = [], summaries = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { const url = new URL(request.url()); if (url.pathname.startsWith('/api/')) requests.push(url.pathname); });
    page.on('response', response => {
      if (new URL(response.url()).pathname === '/api/v2/summary-batch' && response.ok())
        summaries.push(response.json());
    });
    const home = await page.goto(origin + '/', { timeout: 60000 });
    assert.equal(home.status(), 200);
    await page.locator('#n_akari_jp').waitFor();
    assert.equal(await page.locator('body').getAttribute('data-chart-renderer'), 'canvas');
    assert.deepEqual(requests, ['/api/nodes'], 'no automatic query after default promotion');
    const appAsset = Object.keys(manifest.assets).find(name => name.startsWith('app.'));
    assert.equal(await page.locator('script[src*="/app."]').getAttribute('src'), '/static/assets/' + appAsset);
    for (const id of ['akari_jp', 'google_dns']) await page.locator('#n_' + id + ' .node-select').click();
    await page.locator('[data-mode="charts"]').click(); await page.locator('#goBtn').click();
    await page.waitForFunction(() => !MainCanvas.queryLoading && MainCanvas.instanceCount > 0);
    await page.waitForFunction(() => MainCanvas.pendingCount === 0);
    assert.equal(await page.locator('.card').count(), 2);
    assert.equal(await page.locator('.card .badge-ext').count(), 2);
    assert.ok(!requests.some(url => /stats|graph.png/.test(url)), 'no old API or PNG fan-out');
    const loaded = await Promise.all(summaries);
    const current = loaded.flatMap(data => data.items).find(item => item.protocol === 'v4');
    const measured = current?.current?.measurement_updated_at;
    assert.ok(Number.isFinite(measured) && Date.now() / 1000 - measured <= 300 && measured <= Date.now() / 1000 + 60,
      'known probe measurement must remain fresh; loss alone is not a release failure');
    row.measurementUpdatedAt = measured;
    row.instances = await page.evaluate(() => MainCanvas.instanceCount);
    row.requests = requests; row.errors = errors;
    assert.deepEqual(errors, []);
    assert.match(await page.locator('#canvasTrialLink').getAttribute('href'), /renderer=png/);
    row.passed = true;
  } finally { await browser.close(); }
})().catch(error => { row.error = error.message; process.exitCode = 1; })
  .finally(() => {
    report.samples.push(row);
    report.complete24h = observation.complete(report.samples, report.startedAt, 24);
    report.complete48h = observation.complete(report.samples, report.startedAt, 48);
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ ...row, complete24h: report.complete24h, complete48h: report.complete48h }, null, 2));
  });
