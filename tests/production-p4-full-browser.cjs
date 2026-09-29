/* Explicit one-shot public Chrome matrix check; no repeated refresh or load test. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
if (process.env.P4_FULL_BROWSER !== '1') throw new Error('Set P4_FULL_BROWSER=1 for one public full-matrix check');
const origin = process.env.IPPPPING_SITE || 'https://ipppping.hachimihaqile.top';
(async () => {
  const nodesResponse = await fetch(origin + '/api/nodes', { signal: AbortSignal.timeout(10000) });
  assert.equal(nodesResponse.status, 200);
  const nodes = await nodesResponse.json();
  const selected = [...nodes.filter(node => node.group === 'vps'),
    ...nodes.filter(node => node.group === 'dns' && node.v4 && node.v6).slice(0, 5)].map(node => node.id);
  assert.ok(selected.length >= 18 && selected.length <= 20);
  const browser = await chromium.launch({ headless: true,
    ...(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : {}) });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [], requests = [], badResponses = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => {
      if (request.url().includes('/api/')) requests.push(new URL(request.url()).pathname);
    });
    page.on('response', response => {
      if (response.url().includes('/api/') && response.status() >= 400)
        badResponses.push({ path: new URL(response.url()).pathname, status: response.status() });
    });
    await page.goto(origin + '/chart-matrix-trial');
    await page.locator('.node').first().waitFor();
    await page.evaluate(ids => {
      for (const id of ids) {
        const box = document.querySelector(`.node[data-node-id="${id}"] .node-cb`);
        box.checked = true;
        box.dispatchEvent(new Event('change', { bubbles: true }));
      }
      document.querySelector('[data-mode="charts"]').click();
    }, selected);
    const summary = await page.locator('#selSummary').textContent();
    assert.match(summary, /20 nodes.*477 results/);
    const started = performance.now();
    await page.locator('#goBtn').click();
    await page.waitForFunction(() => document.getElementById('trialStatus').textContent.startsWith('Ready: 477 routes'),
      null, { timeout: 60000 });
    const readyMs = Math.round(performance.now() - started);
    await page.waitForFunction(() => ChartMatrixTrial.instanceCount > 0);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Performance.enable');
    await cdp.send('HeapProfiler.collectGarbage');
    const [dom, perf, client] = await Promise.all([
      cdp.send('Memory.getDOMCounters'), cdp.send('Performance.getMetrics'),
      page.evaluate(() => ({ cards: document.querySelectorAll('.card').length,
        instances: ChartMatrixTrial.instanceCount, cache: ChartMatrixTrial.cacheCount,
        canvases: document.querySelectorAll('canvas').length,
        pixels: [...document.querySelectorAll('canvas')].reduce((sum, canvas) => sum + canvas.width * canvas.height, 0) }))
    ]);
    await cdp.detach();
    await page.locator('#mainArea').evaluate(main => { main.scrollTop = main.scrollHeight; });
    await page.waitForTimeout(800);
    assert.ok(await page.evaluate(() => ChartMatrixTrial.instanceCount <= 4 && ChartMatrixTrial.cacheCount <= 16));
    assert.equal(requests.filter(route => route === '/api/v2/summary-batch').length, 15);
    assert.ok(requests.filter(route => route === '/api/v2/series').length <= 12);
    assert.deepEqual(badResponses, []);
    assert.deepEqual(errors, []);
    const target = path.join(__dirname, '../test-results/p4-real-full-browser.json');
    const report = { checkedAt: new Date().toISOString(), origin, selected: selected.length,
      readyMs, summaryPages: 15, seriesRequests: requests.filter(route => route === '/api/v2/series').length,
      ...dom, heap: perf.metrics.find(metric => metric.name === 'JSHeapUsedSize')?.value,
      ...client, badResponses, errors };
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, JSON.stringify(report, null, 2));
    await page.screenshot({ path: path.join(__dirname, '../test-results/p4-real-full-browser.png') });
    console.log(JSON.stringify(report, null, 2));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
