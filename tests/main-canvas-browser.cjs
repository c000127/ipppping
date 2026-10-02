/* Main-page Canvas candidate. Owned local transport, installed Chrome; never production load. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { fork } = require('node:child_process');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const fixture = fork(path.join(__dirname, 'chart-matrix-browser.cjs'), [], {
  cwd: root, env: { ...process.env, MATRIX_FIXTURE_ONLY: '1' },
  stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true
});
const message = type => new Promise((resolve, reject) => {
  const timeout = setTimeout(() => { fixture.off('message', receive); reject(new Error('fixture timeout: ' + type)); }, 15000);
  const receive = value => { if (value.type === type) { clearTimeout(timeout); fixture.off('message', receive); resolve(value); } };
  fixture.on('message', receive);
});
const configure = async settings => { const ready = message('configured'); fixture.send({ type: 'configure', settings }); await ready; };
(async () => {
  const { origin } = await message('ready');
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const errors = [], transport = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1800, height: 900 } });
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => transport.push(new URL(request.url()).pathname));
    if (process.env.RUN_AXE) await page.addInitScript({ path: path.join(root, 'build/qa-deps/package/axe.min.js') });
    await page.goto(origin + '/?renderer=png');
    await page.locator('.node').first().waitFor();
    await page.waitForTimeout(100);
    assert.ok(!transport.some(url => /uplot|matrix-renderer|matrix-data|chart-matrix-trial/.test(url)), 'PNG must not load Canvas dependencies');
    assert.equal(await page.evaluate(() => typeof MatrixRenderer), 'undefined');
    const defaults = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const defaultRequests = [];
    defaults.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/')) defaultRequests.push(new URL(request.url()).pathname); });
    defaults.on('pageerror', error => errors.push(error.message));
    await defaults.goto(origin + '/');
    await defaults.locator('#n_v0').waitFor();
    assert.deepEqual(defaultRequests, ['/api/nodes'], 'default promotion does not auto-submit');
    const isCanvasDefault = await defaults.evaluate(() => document.body.dataset.chartRenderer === 'canvas');
    assert.equal(await defaults.evaluate(() => canvasOptIn), isCanvasDefault);
    if (isCanvasDefault) {
      for (const id of ['v0', 'ext']) await defaults.locator('#n_' + id + ' .node-select').click();
      await defaults.locator('[data-mode="charts"]').click();
      await defaults.locator('#goBtn').click();
      await defaults.waitForFunction(() => MainCanvas.instanceCount > 0);
      assert.ok(!defaultRequests.some(url => /stats|graph.png/.test(url)));
      assert.match(await defaults.locator('#canvasTrialLink').getAttribute('href'), /renderer=png/);
    }
    await defaults.close();
    transport.length = 0;
    await page.goto(origin + '/?renderer=canvas');
    await page.locator('.node').first().waitFor();
    assert.ok(!transport.some(url => url.startsWith('/api/') && url !== '/api/nodes'), 'candidate navigation is draft-only');
    for (const id of ['v0', 'v1', 'ext']) await page.locator('#n_' + id + ' .node-select').click();
    await page.locator('[data-pair-mode="fixed"]').click();
    for (const id of ['v0', 'v1']) await page.locator('[data-anchor-node="' + id + '"]').click();
    await page.locator('[data-mode="charts"]').click();
    transport.length = 0;
    await page.locator('#goBtn').click();
    await page.waitForFunction(() => MainCanvas.instanceCount > 0);
    await page.waitForFunction(() => MainCanvas.pendingCount === 0 && !document.querySelector('.trial-reveal'));
    assert.equal(await page.locator('.card').count(), 4);
    assert.equal(await page.locator('.card .badge-ext').count(), 4);
    assert.equal(await page.locator('.card .badge-v4').count(), 2);
    assert.equal(await page.locator('.card .badge-v6').count(), 2);
    assert.ok(!transport.some(url => /graph.png|\/api\/stats/.test(url)), 'Canvas never doubles legacy stats/images');
    assert.match(await page.locator('#selFreshness').textContent(), /^Updated \d\d:\d\d$/);
    await page.locator('#unifiedAxisToggle').check();
    const snapshot = await page.evaluate(() => MainCanvas.matrix.unifiedMax);
    await page.locator('[data-filter="v4"]').click();
    await page.waitForFunction(() => MainCanvas.instanceCount > 0);
    assert.equal(await page.evaluate(() => MainCanvas.matrix.unifiedMax), snapshot);
    await page.locator('[data-filter="all"]').click();
    await page.waitForFunction(() => MainCanvas.pendingCount === 0 && MainCanvas.instanceCount > 0);
    const seriesBefore = transport.filter(url => url === '/api/v2/series').length;
    const plot = page.locator('.trial-plot').first();
    await plot.focus(); await page.keyboard.press('Enter');
    await page.locator('#intervalTable tbody tr').first().waitFor();
    assert.ok(await page.locator('#intervalTable tbody tr').count() <= 120);
    assert.equal(transport.filter(url => url === '/api/v2/series').length, seriesBefore);
    await page.keyboard.press('Escape');
    await page.locator('#intervalDialog').waitFor({ state: 'hidden' });
    assert.equal(await page.locator('#intervalTable tr').count(), 0);
    assert.equal(await plot.evaluate(element => element === document.activeElement), true);
    await page.evaluate(() => { window.__mainOriginalCard = document.querySelector('.card'); });
    await configure({ v2Epoch: 1 });
    await page.locator('#goBtn').click();
    await page.waitForFunction(() => document.querySelector('.card [data-metric="0"] .stat-value').getAnimations().length > 0);
    const motions = await page.evaluate(() => ({
      same: window.__mainOriginalCard === document.querySelector('.card'),
      cards: [...document.querySelectorAll('.card')].filter(card => card.getAnimations().length).length,
      loss: document.querySelector('.card [data-metric="4"] .stat-value').getAnimations().length
    }));
    assert.equal(motions.same, true); assert.ok(motions.cards <= 6 && motions.loss > 0);
    await page.waitForTimeout(350);
    assert.equal(await page.evaluate(() => document.querySelector('.card [data-metric="0"] .stat-value').getAnimations().length), 0);
    await configure({ v2Epoch: 0 });

    // A busy series replaced by an unavailable summary must not leave a stale
    // accessibility loading flag on a retained card.
    await configure({ seriesDelayMs: 800 });
    await page.locator('#goBtn').click();
    await page.waitForFunction(() => [...document.querySelectorAll('.card')].some(card =>
      card.querySelector('.route-source')?.textContent === 'VPS 1' &&
      card.querySelector('.badge-v6') && card.querySelector('[aria-busy="true"]')));
    await configure({ partialMissing: true, seriesDelayMs: 0 });
    await page.locator('#goBtn').click();
    await page.waitForFunction(() => !MainCanvas.queryLoading && MainCanvas.pendingCount === 0);
    assert.equal(await page.locator('.trial-plot[aria-disabled="true"][aria-busy="true"]').count(), 0,
      'unavailable retained plots cannot remain busy after cancellation');
    await configure({ partialMissing: false });
    await page.locator('#goBtn').click();
    await page.waitForFunction(() => !MainCanvas.queryLoading && MainCanvas.pendingCount === 0);

    const frozenBeforeFailure = await page.evaluate(() => MainCanvas.matrix.end);
    await configure({ failNextSummary: true, summaryDelayMs: 300 });
    await page.locator('#durSelect').selectOption('21600');
    await page.locator('#goBtn').click();
    assert.equal(await page.locator('.card').count(), 4);
    await page.waitForFunction(() => document.getElementById('canvasStatus').textContent.startsWith('Query failed:'));
    assert.equal(await page.evaluate(() => MainCanvas.matrix.end), frozenBeforeFailure);
    assert.equal(await page.evaluate(() => MainCanvas.matrix.dur), 10800);
    assert.equal(await page.locator('#goBtn').getAttribute('data-pending'), 'true');
    await configure({ summaryBusyCount: 3, summaryDelayMs: 0 });
    transport.length = 0;
    await page.locator('#goBtn').click();
    await page.waitForFunction(() => document.getElementById('canvasStatus').textContent.startsWith('Query failed:'));
    assert.equal(transport.filter(url => url === '/api/v2/summary-batch').length, 3, 'two retries only');
    assert.ok(!transport.some(url => /graph.png|\/api\/stats/.test(url)), 'busy never fans out to PNG or old stats');
    assert.equal(await page.evaluate(() => MainCanvas.matrix.dur), 10800);

    // Replace a slow query; only the newest duration may commit.
    await configure({ summaryDelayMs: 150 });
    await page.locator('#goBtn').click();
    await page.locator('#durSelect').selectOption('3600');
    await page.locator('#goBtn').click();
    await page.waitForFunction(() => !MainCanvas.queryLoading && MainCanvas.matrix.dur === 3600);
    await configure({ summaryDelayMs: 0 });
    await configure({ summaryDelayMs: 300 });
    await page.locator('#durSelect').selectOption('21600');
    await page.locator('#goBtn').click();
    assert.equal(await page.evaluate(() => MainCanvas.queryLoading), true);
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, value: true });
      document.dispatchEvent(new Event('visibilitychange'));
      delete document.hidden; document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.waitForTimeout(350);
    assert.equal(await page.evaluate(() => MainCanvas.queryLoading), false);
    assert.equal(await page.evaluate(() => MainCanvas.matrix.dur), 3600, 'hidden query cannot overwrite committed state');
    await configure({ summaryDelayMs: 0 });
    await page.locator('[data-mode="stats"]').click(); transport.length = 0;
    await page.locator('#goBtn').click();
    await page.waitForFunction(() => MainCanvas.mode === 'stats');
    await page.waitForTimeout(200);
    assert.equal(await page.locator('canvas').count(), 0);
    assert.equal(await page.evaluate(() => MainCanvas.pooledCount), 0);
    assert.ok(transport.includes('/api/stats-batch.json'));
    assert.ok(!transport.includes('/api/v2/series'));

    // Near-cap selection with partial errors remains bounded and correctly labelled.
    await page.evaluate(() => { draftSelection = []; draftAnchors.clear(); draftPairMode = 'all'; renderSidebar(); updSel(); });
    for (let i = 0; i < 16; i++) await page.locator('#n_v' + i + ' .node-select').click();
    await configure({ partialMissing: true });
    await page.locator('[data-mode="charts"]').click(); transport.length = 0;
    await page.locator('#goBtn').click();
    await page.waitForFunction(() => !MainCanvas.queryLoading && MainCanvas.pairs.length === 480);
    await page.waitForFunction(() => MainCanvas.instanceCount > 0);
    await page.waitForFunction(() => document.querySelectorAll('.card').length === 480);
    assert.equal(await page.locator('.card').count(), 480);
    assert.equal(transport.filter(url => url === '/api/v2/summary-batch').length, 15);
    assert.ok(!transport.some(url => /graph.png|\/api\/stats/.test(url)));
    await page.locator('#mainArea').evaluate(main => { main.scrollTop = 0; });
    await page.waitForFunction(() => document.querySelector('.card canvas') && MainCanvas.pendingCount === 0);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const originalPlot = await page.locator('.card canvas').first().evaluate(canvas => ({
      index: canvas.closest('.card').dataset.index, png: canvas.toDataURL('image/png')
    }));
    await page.locator('#mainArea').evaluate(main => { main.scrollTop = main.scrollHeight; });
    const kept = page.locator(`.card[data-index="${originalPlot.index}"] .trial-preview`);
    await kept.waitFor({ state: 'attached' });
    assert.equal((await kept.getAttribute('src')) === originalPlot.png, true, 'main Charts retains exact offscreen pixels');
    assert.ok(await page.evaluate(() => MainCanvas.previewCount > 0 && MainCanvas.previewBytes > 0));
    for (const fraction of [1, .5, 0, 1, 0]) {
      await page.evaluate(f => { const main = document.getElementById('mainArea'); main.scrollTop = (main.scrollHeight - main.clientHeight) * f; }, fraction);
      await page.waitForTimeout(200);
    }
    assert.ok(await page.evaluate(() => MainCanvas.instanceCount + MainCanvas.pooledCount <= 4 &&
      MainCanvas.cacheCount <= 16 && MainCanvas.cacheBytes <= 2 * 1024 * 1024));
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, value: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    assert.equal(await page.locator('canvas').count(), 0);
    assert.equal(await page.evaluate(() => MainCanvas.pooledCount), 0);
    assert.equal(await page.evaluate(() => MainCanvas.previewCount), 0);
    assert.equal(await page.locator('.trial-preview').count(), 0, 'hidden page releases its previews');
    await page.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); });
    await page.waitForFunction(() => MainCanvas.instanceCount > 0);
    if (process.env.RUN_AXE) {
      const audit = await page.evaluate(() => axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] } }));
      assert.deepEqual(audit.violations.map(item => item.id), []);
    }
    const out = path.join(root, 'test-results'); fs.mkdirSync(out, { recursive: true });
    await page.screenshot({ path: path.join(out, 'main-canvas-desktop.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(250);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: path.join(out, 'main-canvas-mobile.png') });
    const link = await page.locator('#canvasTrialLink').getAttribute('href');
    assert.ok(!link.includes('renderer=canvas') && link.includes('nodes='), 'manual PNG return preserves draft');
    const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3.5, hasTouch: true });
    mobile.on('pageerror', error => errors.push(error.message));
    await mobile.goto(origin + '/?renderer=canvas&nodes=v0%2Cext&dur=10800&mode=charts&filter=all&unified=0');
    await mobile.locator('#n_v0').waitFor({ state: 'attached' });
    await mobile.locator('#toggleSidebar').click();
    await mobile.locator('#goBtn').click();
    await mobile.waitForFunction(() => MainCanvas.instanceCount > 0);
    assert.ok(await mobile.evaluate(() => MainCanvas.backingPixels <= (MainCanvas.instanceCount + MainCanvas.pooledCount) * 1280 * 220 * 4 &&
      document.documentElement.scrollWidth <= innerWidth));
    await mobile.close();
    await page.evaluate(() => {
      nodes.push({ id: 'v6only', label: 'V6 only', group: 'vps', v4: false, v6: true });
      window.__v6OnlyPairs = makePairs(['v0', 'v6only']);
    });
    assert.equal(await page.evaluate(() => window.__v6OnlyPairs.length), 2);
    assert.equal(await page.evaluate(() => window.__v6OnlyPairs.every(pair => pair.type === 'v6')), true);
    await page.locator('#toggleSidebar').click();
    await page.locator('[data-mode="stats"]').click();
    assert.match(await page.locator('#canvasTrialLink').getAttribute('href'), /mode=stats/, 'PNG return preserves the actual draft view');
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ mainCanvas: 'passed', routes: 480, summaryPages: 15, partialErrors: true,
      noDoubleFetch: true, lazyDependencies: true, intervalReuse: true, race: true, hiddenCleanup: true, errors }, null, 2));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; })
  .finally(() => { if (fixture.exitCode === null) fixture.kill(); });
