// Explicit, low-volume read-only public-site verification after deployment.
// NODE_PATH=<playwright location> BROWSER_CHANNEL=chrome node tests/production-smoke.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const origin = 'https://ipppping.hachimihaqile.top';
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'build/web-release/manifest.json'), 'utf8'));
const output = path.join(root, 'test-results', 'production-p1');
fs.mkdirSync(output, { recursive: true });
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : {}) });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [], requests = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (request.url().includes('/api/')) requests.push(new URL(request.url()).pathname); });
    const home = await page.goto(origin, { waitUntil: 'networkidle', timeout: 60000 });
    assert.equal(home.status(), 200);
    await page.waitForSelector('#n_akari_jp');
    assert.deepEqual(requests, ['/api/nodes']);
    assert.equal(await page.locator('.refresh-mode').innerText(), 'Manual refresh');
    const assets = {};
    for (const [name, expected] of Object.entries(manifest.assets)) {
      const response = await page.request.get(`${origin}/static/assets/${name}`);
      assert.equal(response.status(), 200, name);
      assets[name] = hash(await response.body());
      assert.equal(assets[name], expected, `public ${name} must match the release manifest`);
    }
    await page.locator('#n_akari_jp .node-label').click();
    await page.locator('#n_google_dns .node-label').click();
    await page.locator('#goBtn').click();
    await page.waitForFunction(() => {
      const values = [...document.querySelectorAll('.card .stat-primary .stat-number')];
      return values.length === 2 && values.every(el => el.textContent.trim() && el.textContent.trim() !== '—');
    }, null, { timeout: 45000 });
    assert.equal(await page.locator('.card .data-state').count(), 0);
    const sizes = await page.locator('.card').first().locator('.stat-number').evaluateAll(items =>
      items.map(el => parseFloat(getComputedStyle(el).fontSize)));
    assert.equal(sizes[0], sizes[1], 'five-column results must keep numeric values at the same size');
    assert.equal(await page.locator('.card .badge-ext').count(), 2);
    assert.equal(await page.locator('.card .badge-v6').count(), 1);
    await page.screenshot({ path: path.join(output, 'results-desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(350);
    await page.screenshot({ path: path.join(output, 'results-mobile.png'), fullPage: true });
    const mobileSizes = await page.locator('.card').first().locator('.stat-number').evaluateAll(items =>
      items.map(el => parseFloat(getComputedStyle(el).fontSize)));
    assert.deepEqual(mobileSizes, [32, 16, 16, 16, 16], 'narrow left-plus-2x2 layout must emphasize CURRENT');
    await page.setViewportSize({ width: 1440, height: 900 });
    const query = '/api/stats?source=akari_jp&target=google_dns&type=v6&dur=10800';
    const old = await (await page.request.get(origin + query)).json();
    assert.deepEqual(Object.keys(old).sort(), ['avg_ms','current_ms','loss_pct','max_ms','min_ms']);
    const fresh = await (await page.request.get(origin + query + '&state=p1')).json();
    assert.equal(fresh.freshness_source, 'rrd_lastupdate');
    assert.equal(fresh.stats_semantics, 'p1-raw-current');
    assert.ok(Date.now()/1000 - fresh.measurement_updated_at < 600);
    await page.locator('[data-mode="charts"]').click();
    await page.locator('#goBtn').click();
    await page.waitForFunction(() => document.querySelectorAll('.card img.ok').length === 2, null, { timeout: 45000 });
    await page.screenshot({ path: path.join(output, 'charts-desktop.png'), fullPage: true });
    assert.deepEqual(errors, []);
    const report = { checkedAt: new Date().toISOString(), origin, browser: browser.version(),
      nodes: await page.locator('.node[data-node-id]').count(), cards: 2, graphImages: 2,
      startupOnlyNodes: true, legacyFiveFields: true, stats: fresh, assets, requests, errors };
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
