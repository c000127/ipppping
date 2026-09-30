/* Explicit, guarded frontend-only default -> PNG -> default rehearsal.
 * Never restarts the API, edits runtime/RRD, or removes immutable assets. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const origin = 'https://ipppping.hachimihaqile.top';
assert.equal(process.env.MAIN_DEFAULT_ROLLOUT, '1', 'explicit production rollout required');
const stages = { png: process.env.PNG_STAGE, canvas: process.env.CANVAS_STAGE };
for (const [mode, stage] of Object.entries(stages))
  assert.match(stage || '', new RegExp('^/root/ipppping-stage-main-cleanup-' +
    (mode === 'png' ? 'png' : 'default') + '-[A-Za-z0-9]{8}$'));
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const releases = Object.fromEntries(['png', 'canvas'].map(mode => {
  const dir = path.join(root, 'build/web-release-main-' + (mode === 'png' ? 'promotable' : 'default'));
  const bytes = fs.readFileSync(path.join(dir, 'manifest.json'));
  return [mode, { manifest: JSON.parse(bytes), hash: hash(bytes) }];
}));
const gatePath = path.join(root, 'test-results/p4-matrix-cdp-soak-3600s-off-main-default-busy-cleanup.json');
const gate = JSON.parse(fs.readFileSync(gatePath));
assert.equal(gate.host, 'main-default');
assert.equal(gate.releaseManifestSha256, releases.canvas.hash);
// The unchanged analyzer also rejects partial duration, diagnostic controls and resource growth.
const gateResult = JSON.parse(execFileSync(process.execPath,
  ['tests/analyze-p4-soak.cjs', gatePath], { cwd: root, encoding: 'utf8', windowsHide: true }));
assert.equal(gateResult.passed, true);
const ssh = command => execFileSync('ssh', ['-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes',
  '-p', '13922', 'root@84.54.3.65', command], { encoding: 'utf8', timeout: 60000, windowsHide: true }).trim();
const service = () => ssh('systemctl show ipppping.service -p MainPID -p NRestarts -p ActiveEnterTimestamp');
const before = service(), report = { startedAt: new Date().toISOString(), gate: gateResult, before, steps: [], errors: [] };
async function verifyPublic(mode) {
  const expected = releases[mode].manifest;
  for (const [name, checksum] of Object.entries(expected.pages)) {
    const url = name === 'index.html' ? '/' : '/' + name.replace(/\.html$/, '');
    const response = await fetch(origin + url, { cache: 'no-store', signal: AbortSignal.timeout(20000) });
    assert.equal(response.status, 200);
    const publicHtml = await response.text();
    // Known CDN injection only; unknown changes still fail the origin hash.
    const originHtml = publicHtml
      .replace(/<script>\(function\(\)\{function c\(\).*?<\/script>/s, '')
      .replace(/<script type="module" src="https:\/\/static\.cloudflareinsights\.com\/beacon\.min\.js\/[^>]*><\/script>\r?\n?/s, '');
    assert.equal(hash(Buffer.from(originHtml)), checksum);
  }
  for (const [name, checksum] of Object.entries(expected.assets)) {
    const response = await fetch(origin + '/static/assets/' + name, { signal: AbortSignal.timeout(20000) });
    assert.equal(response.status, 200); assert.equal(hash(Buffer.from(await response.arrayBuffer())), checksum);
  }
  assert.equal(service(), before, 'frontend rehearsal must not restart API');
}
async function activate(mode) {
  const stage = stages[mode];
  const remoteHash = ssh('sha256sum ' + stage + '/build/web-release/manifest.json').split(/\s+/)[0];
  assert.equal(remoteHash, releases[mode].hash);
  const output = ssh('python3 ' + stage + '/deploy/install-api.py ' + stage + ' --frontend-only');
  const finishedAt = new Date().toISOString();
  assert.match(output, /^Frontend installed without API restart\. Backup: \/root\/ipppping-backup-/);
  await verifyPublic(mode);
  report.steps.push({ mode, manifestHash: releases[mode].hash, finishedAt, output });
}
async function query(page, canvas) {
  const paths = [], read = request => {
    const pathname = new URL(request.url()).pathname;
    if (pathname.startsWith('/api/')) paths.push(pathname);
  };
  page.on('request', read);
  try {
    await page.locator('#goBtn').click();
    if (canvas) {
      await page.waitForFunction(() => !MainCanvas.queryLoading && MainCanvas.instanceCount > 0);
      await page.waitForFunction(() => MainCanvas.pendingCount === 0);
      assert.ok(!paths.some(url => /stats|graph.png/.test(url)));
      assert.equal(await page.locator('.card .badge-ext').count(), 2);
      assert.equal(await page.locator('.card .badge-v4').count(), 1);
      assert.equal(await page.locator('.card .badge-v6').count(), 1);
    } else {
      await page.waitForFunction(() => [...document.querySelectorAll('.card-img img')].some(img => img.complete && img.naturalWidth > 0));
      assert.ok(paths.includes('/api/stats-batch.json'));
      assert.ok(paths.includes('/api/graph.png'));
      assert.ok(!paths.some(url => url.startsWith('/api/v2/')));
    }
    assert.equal(await page.locator('.card').count(), 2);
  } finally { page.off('request', read); }
}
async function openSelected(browser, renderer) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', error => report.errors.push(error.message));
  const suffix = renderer ? '?renderer=' + renderer : '';
  await page.goto(origin + '/' + suffix);
  await page.locator('#n_akari_jp').waitFor();
  for (const id of ['akari_jp', 'google_dns']) await page.locator('#n_' + id + ' .node-select').click();
  await page.locator('[data-mode="charts"]').click();
  return page;
}
(async () => {
  await verifyPublic('png');
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  let changed = false;
  try {
    const oldPng = await openSelected(browser, 'png'), oldCanvas = await openSelected(browser, 'canvas');
    await query(oldPng, false); await query(oldCanvas, true);
    changed = true; await activate('canvas');
    const defaults = await openSelected(browser);
    assert.equal(await defaults.locator('body').getAttribute('data-chart-renderer'), 'canvas');
    assert.equal(await defaults.locator('.card').count(), 0, 'default navigation must not submit');
    await query(defaults, true);
    await query(oldPng, false); await query(oldCanvas, true);
    await activate('png');
    const rolled = await openSelected(browser);
    assert.equal(await rolled.locator('body').getAttribute('data-chart-renderer'), 'png');
    await query(rolled, false); await query(defaults, true);
    await activate('canvas');
    const restored = await openSelected(browser);
    assert.equal(await restored.locator('body').getAttribute('data-chart-renderer'), 'canvas');
    await query(restored, true); await query(rolled, false);
    assert.deepEqual(report.errors, []);
    report.observationStartedAt = report.steps.at(-1).finishedAt;
    report.oldTabsPassed = true; report.passed = true;
  } catch (error) {
    report.error = error.message;
    if (changed) {
      try { await activate('png'); report.recoveredToPng = true; }
      catch (recoveryError) { report.recoveryError = recoveryError.message; }
    }
    throw error;
  } finally {
    await browser.close();
    report.after = service(); report.finishedAt = new Date().toISOString();
    const output = path.join(root, 'test-results/main-default-rollout.json');
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
