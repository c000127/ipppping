/* Low-rate read-only opt-in P4 smoke. Run only after an authorized deployment. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const origin = process.env.IPPPPING_SITE || 'https://ipppping.hachimihaqile.top';
const expectedAppAsset = '/static/assets/app.e036d7b6d2eaa8be.js';
const release = JSON.parse(fs.readFileSync(path.join(__dirname, '../build/web-release/manifest.json'), 'utf8'));
const expectedStylesAsset = '/static/assets/' + Object.keys(release.assets).find(name => name.startsWith('styles.'));
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
  assert.ok(!mainHtml.includes('chart-matrix-trial.js'));
  const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : {}) });
  try {
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
    await page.locator('#goBtn').click();
    await page.waitForFunction(() => document.getElementById('trialStatus').textContent.startsWith('Ready: 2 routes'));
    await page.waitForFunction(() => ChartMatrixTrial.instanceCount > 0);
    assert.equal(await page.locator('.card').count(), 2);
    assert.deepEqual(await page.locator('.card').first().locator('.badge').allTextContents(), ['Ext', 'v4']);
    assert.deepEqual(await page.locator('#chart-key span').allTextContents(),
      ['Mean median RTT', 'Median range', 'Peak loss']);
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
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ site: origin, total: data.total, end: data.end,
      compressed: response.headers.get('content-encoding'), v4MaxMs: full.summary.max_median_ms,
      multiFixedExternalRoutes: 4,
      canvasInstances: await page.evaluate(() => ChartMatrixTrial.instanceCount),
      mainAppAsset: expectedAppAsset, mainStylesAsset: expectedStylesAsset, errors }, null, 2));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
