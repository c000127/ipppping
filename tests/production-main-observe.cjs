/* One low-rate observation after default promotion. No deployment, deletion, or node changes. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright');
const observation = require('./observation-state.cjs');
const health = require('./observation-health.cjs');
const root = path.resolve(__dirname, '..');
const origin = 'https://ipppping.hachimihaqile.top';
assert.equal(process.env.MAIN_OBSERVATION_PASS, '1', 'explicit production observation opt-in required');
const releaseRoot = process.env.TEST_RELEASE_ROOT || 'build/web-release-main-default';
assert.match(releaseRoot, /^build\/web-release(?:-[a-z0-9-]+)?$/);
const manifestBytes = fs.readFileSync(path.join(root, releaseRoot, 'manifest.json'));
const manifest = JSON.parse(manifestBytes);
const manifestHash = crypto.createHash('sha256').update(manifestBytes).digest('hex');
const rollout = JSON.parse(fs.readFileSync(path.join(root, 'test-results/main-default-rollout.json')));
assert.equal(rollout.passed, true); assert.equal(rollout.oldTabsPassed, true);
assert.equal(rollout.steps.at(-1).manifestHash, manifestHash);
const releasedAt = rollout.observationStartedAt;
const start = Date.parse(process.env.OBSERVATION_STARTED_AT);
assert.ok(Number.isFinite(start) && start <= Date.now() && start >= Date.parse(releasedAt),
  'explicit authorized new observation start; original release time remains unchanged');
const reportRelative = process.env.OBSERVATION_REPORT;
assert.equal(reportRelative, 'test-results/main-canvas-observation-health-v2.json',
  'explicit new report required; never overwrite the failed observation');
const previousBytes = fs.readFileSync(path.join(root, 'test-results/main-canvas-observation.json'));
const previous = JSON.parse(previousBytes);
assert.equal(previous.startedAt, releasedAt); assert.equal(previous.manifestHash, manifestHash);
assert.ok(previous.samples.some(sample => !sample.passed), 'retain the original failure');
const previousReportSha256 = crypto.createHash('sha256').update(previousBytes).digest('hex');
const reportPath = path.join(root, reportRelative);
const report = fs.existsSync(reportPath) ? JSON.parse(fs.readFileSync(reportPath)) :
  { schema: 'ipppping.production-observation.health-v2', startedAt: new Date(start).toISOString(),
    releasedAt, manifestHash, previousReportSha256, samples: [] };
assert.equal(report.schema, 'ipppping.production-observation.health-v2');
assert.equal(report.releasedAt, releasedAt, 'never rewrite the original release time');
assert.equal(report.previousReportSha256, previousReportSha256, 'original failed evidence must remain byte-identical');
assert.equal(report.startedAt, new Date(start).toISOString(), 'never reuse another observation window');
assert.equal(report.manifestHash, manifestHash, 'never mix release fingerprints');
assert.ok(!report.samples.some(sample => !sample.passed),
  'failed observation is terminal; retain evidence and obtain direction before a new window');
assert.notEqual(report.complete1h, true, 'completed observation must not keep monitoring');
assert.ok(report.samples.length < 8 && Date.now() - start <= 2 * 3600000,
  'finite observation window; do not monitor indefinitely or reuse expired coverage');
const row = { checkedAt: new Date().toISOString(), passed: false, hours: (Date.now() - start) / 3600000 };
(async () => {
  const host = execFileSync('ssh', ['-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-p', '13922',
    'root@84.54.3.65', 'systemctl show ipppping.service -p MainPID -p NRestarts -p ActiveEnterTimestamp -p ActiveState -p MemoryCurrent; systemctl is-active caddy; awk \'/^MemAvailable:|^SwapFree:|^SwapTotal:/{print}\' /proc/meminfo'],
    { encoding: 'utf8', timeout: 20000, windowsHide: true });
  row.host = Object.fromEntries(host.split(/\r?\n/).filter(line => line.includes('=')).map(line => line.split('=')));
  row.host.caddy = host.split(/\r?\n/).includes('active');
  const kib = field => Number(host.match(new RegExp('^' + field + ':\\s+(\\d+)', 'm'))?.[1]);
  row.host.availableBytes = kib('MemAvailable') * 1024;
  row.host.swapUsedBytes = (kib('SwapTotal') - kib('SwapFree')) * 1024;
  assert.equal(row.host.ActiveState, 'active'); assert.equal(row.host.caddy, true);
  const releasedHost = Object.fromEntries(rollout.after.split(/\r?\n/).map(line => line.split('=')));
  for (const key of ['MainPID', 'NRestarts', 'ActiveEnterTimestamp'])
    assert.equal(row.host[key], releasedHost[key], 'API identity must match the actual release');
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
    const errors = [], requests = [], summaries = [], assetChecks = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { const url = new URL(request.url()); if (url.pathname.startsWith('/api/')) requests.push(url.pathname); });
    page.on('response', response => {
      if (new URL(response.url()).pathname === '/api/v2/summary-batch' && response.ok())
        summaries.push(response.json());
      const pathname = new URL(response.url()).pathname;
      const name = pathname.startsWith('/static/assets/') ? pathname.slice('/static/assets/'.length) : '';
      if (Object.hasOwn(manifest.assets, name)) assetChecks.push(response.body().then(bytes =>
        ({ name, status: response.status(), sha256: crypto.createHash('sha256').update(bytes).digest('hex') }),
      error => ({ name, error: error.message })));
    });
    const home = await page.goto(origin + '/', { timeout: 60000 });
    assert.equal(home.status(), 200);
    const originHtml = (await home.text())
      .replace(/<script>\(function\(\)\{function c\(\).*?<\/script>/s, '')
      .replace(/<script type="module" src="https:\/\/static\.cloudflareinsights\.com\/beacon\.min\.js\/[^>]*><\/script>\r?\n?/s, '');
    row.mainHtmlSha256 = crypto.createHash('sha256').update(originHtml).digest('hex');
    assert.equal(row.mainHtmlSha256, manifest.pages['index.html'], 'deployed main page fingerprint');
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
    assert.equal(await page.locator('.card .badge-v4').count(), 1);
    assert.equal(await page.locator('.card .badge-v6').count(), 1);
    assert.ok(!requests.some(url => /stats|graph.png/.test(url)), 'no old API or PNG fan-out');
    const loaded = await Promise.all(summaries);
    const current = loaded.flatMap(data => data.items).find(item => item.protocol === 'v4');
    // Retain diagnostic evidence before asserting; null may mean outside_window,
    // but it must not be silently replaced with a fabricated passing timestamp.
    row.probe = { source: current?.source, target: current?.target,
      protocol: current?.protocol, current: current?.current, window: current?.window,
      generatedAt: current?.generated_at, error: current?.error };
    row.requests = requests; row.errors = errors;
    // One independent diagnostic read, not a browser request or a PNG fallback.
    const liveUrl = origin + '/api/stats?' + new URLSearchParams({ source: 'akari_jp',
      target: 'google_dns', type: 'v4', dur: '10800', state: 'p1' });
    row.healthRequest = { path: '/api/stats', count: 1, browserInitiated: false };
    const liveResponse = await fetch(liveUrl, { cache: 'no-store', signal: AbortSignal.timeout(15000) });
    assert.equal(liveResponse.status, 200);
    row.liveProbe = await liveResponse.json();
    Object.assign(row, health.check(current, row.liveProbe, Date.now() / 1000));
    row.instances = await page.evaluate(() => MainCanvas.instanceCount);
    assert.ok(row.instances <= 4);
    assert.ok(requests.filter(url => url === '/api/v2/summary-batch').length <= 3,
      'one summary page and at most two busy retries');
    assert.ok(requests.filter(url => url === '/api/v2/series').length <= 2,
      'known two-route sample must not amplify series requests');
    row.requests = requests; row.errors = errors;
    row.assets = await Promise.all(assetChecks);
    for (const asset of row.assets) {
      assert.ok(!asset.error, 'asset response must be readable');
      assert.equal(asset.status, 200);
      assert.equal(asset.sha256, manifest.assets[asset.name], 'loaded asset fingerprint');
    }
    for (const prefix of ['app.', 'matrix-renderer.'])
      assert.ok(row.assets.some(asset => asset.name.startsWith(prefix)), 'main and renderer assets must be verified');
    assert.deepEqual(errors, []);
    assert.match(await page.locator('#canvasTrialLink').getAttribute('href'), /renderer=png/);
    row.passed = true;
  } finally { await browser.close(); }
})().catch(error => { row.error = error.message; process.exitCode = 1; })
  .finally(() => {
    report.samples.push(row);
    report.requiredHours = observation.REQUIRED_HOURS;
    report.sampleIntervalMinutes = observation.SAMPLE_INTERVAL_MINUTES;
    report.complete1h = observation.complete(report.samples, report.startedAt);
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ ...row, requiredHours: report.requiredHours,
      sampleIntervalMinutes: report.sampleIntervalMinutes, complete1h: report.complete1h }, null, 2));
  });
