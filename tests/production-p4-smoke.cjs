/* Low-rate read-only opt-in P4 smoke. Run only after an authorized deployment. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const origin = process.env.IPPPPING_SITE || 'https://ipppping.hachimihaqile.top';
const release = JSON.parse(fs.readFileSync(path.join(__dirname, '../build/web-release/manifest.json'), 'utf8'));
const expectedAppAsset = '/static/assets/' + Object.keys(release.assets).find(name => name.startsWith('app.'));
const expectedStylesAsset = '/static/assets/' + Object.keys(release.assets).find(name => name.startsWith('styles.'));
const expectedHandoffAsset = '/static/assets/' + Object.keys(release.assets).find(name => name.startsWith('query-handoff.'));
(async () => {
  const nodesResponse = await fetch(origin + '/api/nodes', { cache: 'no-store' });
  assert.equal(nodesResponse.status, 200);
  const nodes = await nodesResponse.json();
  assert.ok(['akari_jp', 'legendsg', 'google_dns'].every(id => nodes.some(node => node.id === id)));
  const query = new URLSearchParams({ nodes: 'akari_jp,google_dns', dur: '10800', limit: '32' });
  const response = await fetch(origin + '/api/v2/summary-batch?' + query,
    { headers: { 'Accept-Encoding': 'gzip' }, cache: 'no-store' });
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.schema, 'ipppping.summary-batch.v2');
  assert.equal(data.total, 2);
  assert.equal(data.end % 60, 0);
  assert.deepEqual(data.items.map(item => item.protocol), ['v4', 'v6']);
  assert.ok(!data.items[0].error, 'known G3 v4 route should be available');
  const series = await fetch(origin + '/api/v2/series?' + new URLSearchParams({
    source: 'akari_jp', target: 'google_dns', type: 'v4', dur: '10800',
    end: String(data.end), points: '120', encoding: 'columns'
  }), { cache: 'no-store' });
  assert.equal(series.status, 200);
  const full = await series.json();
  assert.equal(full.summary.max_median_ms, data.items[0].summary.max_median_ms);
  const main = await fetch(origin + '/', { cache: 'no-store' });
  assert.equal(main.status, 200);
  const mainHtml = await main.text();
  assert.ok(mainHtml.includes(expectedAppAsset));
  assert.ok(mainHtml.includes(expectedStylesAsset));
  assert.ok(mainHtml.includes(expectedHandoffAsset));
  assert.ok(!mainHtml.includes('/static/assets/chart-matrix-trial.'));
  const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : {}) });
  try {
    const home = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const handoffRequests = [];
    home.on('request', request => {
      if (request.url().includes('/api/') && !request.url().includes('/api/nodes'))
        handoffRequests.push(new URL(request.url()).pathname);
    });
    await home.goto(origin + '/');
    await home.locator('#n_akari_jp').waitFor();
    for (const id of ['akari_jp', 'google_dns'])
      await home.locator(`#n_${id} .node-label`).click();
    assert.match(await home.locator('#canvasTrialLink').getAttribute('href'), /^\/chart-matrix-trial\?nodes=/);
    await home.locator('#canvasTrialLink').click();
    await home.locator('.node[data-node-id="akari_jp"]').waitFor();
    assert.match(await home.locator('#trialStatus').textContent(), /^Selection restored;/);
    assert.equal(await home.locator('.node-cb:checked').count(), 2);
    assert.equal(await home.locator('#goBtn').textContent(), 'Show Charts');
    await home.locator('#filterPills [data-filter="v6"]').click();
    await home.locator('#unifiedAxisToggle').check();
    await home.locator('#pngBackLink').click();
    await home.locator('#n_akari_jp').waitFor();
    assert.equal(await home.locator('.node-cb:checked').count(), 2);
    assert.equal(await home.locator('#filterPills [data-filter="v6"]').getAttribute('aria-pressed'), 'true');
    assert.equal(await home.locator('#unifiedAxisToggle').isChecked(), true);
    assert.deepEqual(handoffRequests, [], 'opt-in navigation never starts a matrix request');
    await home.close();
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    const pageResponse = await page.goto(origin + '/chart-matrix-trial');
    assert.equal(pageResponse.status(), 200);
    await page.locator('.node').first().waitFor();
    for (const id of ['akari_jp', 'google_dns'])
      await page.locator(`.node[data-node-id="${id}"] .node-select`).click();
    await page.locator('#goBtn').click();
    await page.waitForFunction(() => document.getElementById('trialStatus').textContent.startsWith('Ready: 2 routes'));
    assert.equal(await page.locator('.card').count(), 2);
    assert.equal(await page.locator('.trial-plot').count(), 0);
    const design = await page.locator('.card').first().evaluate(card => {
      const edge = card.getBoundingClientRect();
      const line = card.querySelector('.card-right').getBoundingClientRect();
      const metrics = [...card.querySelectorAll('.stat-item')].map(item => {
        const label = item.querySelector('.stat-label').getBoundingClientRect();
        const value = item.querySelector('.stat-value').getBoundingClientRect();
        return Math.abs(label.left - value.left) < 1;
      });
      return { noBorder: getComputedStyle(card).borderTopWidth === '0px',
        fullSeparator: Math.abs(edge.left - line.left) < 1 && Math.abs(edge.right - line.right) < 1,
        aligned: metrics.every(Boolean) };
    });
    assert.deepEqual(design, { noBorder: true, fullSeparator: true, aligned: true });
    await page.locator('[data-mode="charts"]').click();
    await page.waitForTimeout(210);
    const motion = await page.locator('#viewMode').evaluate(group => {
      const button = group.querySelector('button.on'), indicator = group.querySelector('.segment-indicator');
      const selected = button.getBoundingClientRect(), slider = indicator.getBoundingClientRect();
      return { indicators: document.querySelectorAll('.segment-indicator').length,
        delta: Math.abs(selected.left - slider.left) + Math.abs(selected.width - slider.width),
        duration: getComputedStyle(indicator).transitionDuration,
        decorative: indicator.getAttribute('aria-hidden') };
    });
    assert.equal(motion.indicators, 3);
    assert.ok(motion.delta < 2 && motion.duration.includes('0.18s') && motion.decorative === 'true', JSON.stringify(motion));
    const chartStarted = performance.now();
    await page.locator('#goBtn').click();
    await page.waitForFunction(() => document.getElementById('trialStatus').textContent.startsWith('Ready: 2 routes'));
    const chartReadyMs = Math.round(performance.now() - chartStarted);
    await page.waitForFunction(() => ChartMatrixTrial.instanceCount > 0);
    assert.equal(await page.locator('.card').count(), 2);
    assert.deepEqual(await page.locator('.card').first().locator('.badge').allTextContents(), ['Ext', 'v4']);
    assert.deepEqual(await page.locator('#chart-key span').allTextContents(),
      ['Mean median RTT', 'Loss in every bucket', 'Peak within interval']);
    const keyMarks = await page.locator('.key-loss-fill,.key-loss-peak').evaluateAll(elements => elements.map(element => {
      const style = getComputedStyle(element, '::before');
      return { color: style.backgroundColor, alpha: style.opacity, image: style.backgroundImage };
    }));
    assert.deepEqual(keyMarks, Array(2).fill({ color: 'rgb(244, 155, 129)', alpha: '0.65', image: 'none' }));
    assert.equal(await page.locator('.u-cursor-x,.u-cursor-y').count(), 0);
    const screenshot = path.join(__dirname, '../test-results/p4-matrix-live.png');
    fs.mkdirSync(path.dirname(screenshot), { recursive: true });
    await page.locator('.card').first().screenshot({ path: screenshot });
    await page.locator('.node[data-node-id="legendsg"] .node-select').click();
    await page.locator('[data-pair-mode="fixed"]').click();
    for (const id of ['akari_jp', 'legendsg'])
      await page.locator(`.node[data-node-id="${id}"] .node-anchor`).click();
    await page.locator('#goBtn').click();
    await page.waitForFunction(() => document.getElementById('trialStatus').textContent.startsWith('Ready: 4 routes'));
    await page.waitForFunction(() => ChartMatrixTrial.instanceCount > 0);
    assert.equal(await page.locator('.card').count(), 4);
    assert.ok((await page.locator('.route').allTextContents()).every(title => title.includes('Google DNS')));
    assert.ok((await page.locator('.card').first().locator('.badge').allTextContents()).includes('Ext'));
    await page.emulateMedia({ reducedMotion: 'reduce' });
    assert.equal(await page.locator('#viewMode .segment-indicator').evaluate(indicator =>
      getComputedStyle(indicator).transitionDuration), '0s');
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ site: origin, total: data.total, end: data.end,
      compressed: response.headers.get('content-encoding'), v4MaxMs: full.summary.max_median_ms,
      multiFixedExternalRoutes: 4, chartReadyMs, motion,
      canvasInstances: await page.evaluate(() => ChartMatrixTrial.instanceCount),
      mainAppAsset: expectedAppAsset, mainStylesAsset: expectedStylesAsset,
      mainHandoffAsset: expectedHandoffAsset, handoffRequests, errors }, null, 2));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
