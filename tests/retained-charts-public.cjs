/* Explicitly opted-in, three-node read-only Chrome check; never a full matrix. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { chromium } = require('playwright');
assert.equal(process.env.CHART_RETENTION_PUBLIC_PASS, '1', 'public check requires explicit opt-in');
const origin = process.env.IPPPPING_SITE;
assert.ok(origin && new URL(origin).protocol === 'https:');
const nodes = (process.env.CHART_RETENTION_NODES || '').split(',');
assert.equal(new Set(nodes).size, 3);
assert.ok(nodes.every(id => /^[a-z0-9_]+$/.test(id)));
const root = path.resolve(__dirname, '..');
const release = process.env.TEST_RELEASE_ROOT;
assert.match(release || '', /^build\/web-release-[a-z0-9-]+$/);
const manifest = JSON.parse(fs.readFileSync(path.join(root, release, 'manifest.json')));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const errors = [], series = [], summaries = [], assets = [], checks = [], legacy = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1800, height: 1100 } });
    const nearReady = () => page.waitForFunction(() => {
      const bounds = document.getElementById('mainArea').getBoundingClientRect();
      return MainCanvas.pendingCount === 0 && [...document.querySelectorAll('.card')].every(card => {
        const r = card.getBoundingClientRect();
        if (r.bottom < bounds.top - 300 || r.top > bounds.bottom + 300) return true;
        const img = card.querySelector('.trial-preview');
        return card.querySelector('canvas') || img?.complete && img.naturalWidth > 300 &&
          getComputedStyle(img).opacity === '1' && getComputedStyle(img).visibility === 'visible';
      });
    }, null, { timeout: 30000 });
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => {
      const url = new URL(request.url());
      if (url.pathname === '/api/v2/series') series.push(url.href);
      if (url.pathname === '/api/v2/summary-batch') summaries.push(url.href);
      if (/\/api\/(graph\.png|stats)/.test(url.pathname)) legacy.push(url.href);
    });
    page.on('response', response => {
      const url = new URL(response.url());
      if (!url.pathname.startsWith('/static/assets/')) return;
      const name = path.posix.basename(url.pathname);
      checks.push(response.body().then(bytes => {
        assert.equal(hash(bytes), manifest.assets[name], 'loaded asset fingerprint: ' + name);
        assets.push(name);
      }));
    });
    const query = new URLSearchParams({ nodes: nodes.join(','), mode: 'charts', dur: '10800', filter: 'all', unified: '0' });
    const response = await page.goto(origin + '/?' + query);
    assert.equal(response.status(), 200);
    const expectedHTML = fs.readFileSync(path.join(root, release, 'index.html'), 'utf8');
    assert.equal(hash(Buffer.from(expectedHTML)), manifest.pages['index.html']);
    const publicHTML = await response.text(), close = expectedHTML.lastIndexOf('</body>');
    assert.ok(close > 0 && publicHTML.startsWith(expectedHTML.slice(0, close)) &&
      publicHTML.endsWith(expectedHTML.slice(close)), 'all application HTML must match the release');
    // The edge appends its beacon/challenge scripts before </body>. Origin HTML
    // is byte-verified by the installer; do not mistake edge instrumentation
    // for an app release mismatch or skip actual loaded asset verification.
    const extra = publicHTML.slice(close, publicHTML.length - (expectedHTML.length - close));
    if (extra) {
      const tags = await page.evaluate(text => {
        const doc = new DOMParser().parseFromString(text, 'text/html');
        return [...doc.head.children, ...doc.body.children]
          .map(el => ({ tag: el.tagName, src: el.getAttribute('src'), text: el.textContent }));
      }, extra);
      assert.ok(tags.length > 0 && tags.length <= 2 && tags.every(tag => tag.tag === 'SCRIPT' &&
        (tag.src?.startsWith('https://static.cloudflareinsights.com/beacon.min.js/') ||
         !tag.src && tag.text.includes('__CF$cv$params') && tag.text.includes('/cdn-cgi/challenge-platform/'))),
      'only recognized Cloudflare suffix instrumentation is permitted');
    }
    assert.equal(await page.locator('body').getAttribute('data-chart-renderer'), 'canvas');
    await page.locator('#n_' + nodes[0]).waitFor();
    assert.equal(series.length, 0, 'navigation must not submit');
    await page.locator('#goBtn').click();
    await page.waitForFunction(() => MainCanvas.instanceCount > 0 && MainCanvas.pendingCount === 0);
    assert.ok(await page.locator('.card').count() <= 12);
    assert.equal(await page.locator('#graphGrid').evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length), 2);
    await page.waitForFunction(() => {
      const bounds = document.getElementById('mainArea').getBoundingClientRect();
      const plots = [...document.querySelectorAll('.trial-plot')].filter(plot => {
        const rect = plot.getBoundingClientRect(); return rect.bottom > bounds.top && rect.top < bounds.bottom;
      });
      return plots.length > 4 && plots.every(plot => plot.querySelector('canvas') ||
        plot.querySelector('img')?.complete && plot.querySelector('img').naturalWidth > 300);
    }, null, { timeout: 30000 });
    await nearReady();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const first = await page.locator('.card canvas').first().evaluate(canvas => ({
      index: canvas.closest('.card').dataset.index, png: canvas.toDataURL('image/png')
    }));
    await page.locator('#mainArea').evaluate(main => { main.scrollTop = main.scrollHeight; });
    const preview = page.locator(`.card[data-index="${first.index}"] .trial-preview`);
    await preview.waitFor({ state: 'attached' });
    assert.equal(await preview.getAttribute('src') === first.png, true, 'offscreen chart retains identical pixels');
    await nearReady();
    const retained = await page.evaluate(() => ({ count: MainCanvas.previewCount, bytes: MainCanvas.previewBytes }));
    const requestsBeforeReturn = series.length;
    await page.locator('#mainArea').evaluate(main => { main.scrollTop = 0; });
    await page.locator(`.card[data-index="${first.index}"] canvas`).waitFor();
    await nearReady();
    assert.equal(series.length, requestsBeforeReturn, 'returning to cached charts adds no series request');
    assert.ok(await page.evaluate(() => MainCanvas.instanceCount + MainCanvas.pooledCount <= 4));
    assert.ok(summaries.length <= 3 && series.length <= 12);
    assert.equal(legacy.length, 0);
    assert.deepEqual(errors, []);
    await Promise.all(checks);
    assert.ok(assets.some(name => name.startsWith('matrix-renderer.')));
    const report = { passed: true, twoColumnsMoreThanFourVisible: true, checkedAt: new Date().toISOString(), routes: await page.locator('.card').count(),
      seriesRequests: series.length, summaryRequests: summaries.length, loadedAssets: assets,
      exactPreviewPixels: true, noReturnRefetch: true, retained, errors };
    report.previewComputedVisibility = await page.locator('.trial-preview').evaluateAll(images =>
      images.every(img => getComputedStyle(img).opacity === '1' && getComputedStyle(img).visibility === 'visible'));
    assert.equal(report.previewComputedVisibility, true);
    fs.mkdirSync(path.join(root, 'test-results'), { recursive: true });
    await page.screenshot({ path: path.join(root, 'test-results/chart-recovery-public.png') });
    fs.writeFileSync(path.join(root, 'test-results/chart-recovery-public.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
