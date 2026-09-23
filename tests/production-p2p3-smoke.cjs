/* Low-volume, read-only verification of the public P2 page and opt-in P3 trial. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const origin = 'https://ipppping.hachimihaqile.top';
const release = path.join(root, 'build/web-release');
const output = path.join(root, 'test-results/production-p2p3');
const manifest = JSON.parse(fs.readFileSync(path.join(release, 'manifest.json'), 'utf8'));
const sha256 = data => crypto.createHash('sha256').update(data).digest('hex');
fs.mkdirSync(output, { recursive: true });

function verifyPublicHtml(body, pageName) {
  const original = body.toString('utf8');
  const withoutCdn = original
    .replace(/<script>\(function\(\)\{function c\(\).*?<\/script>/s, '')
    .replace(/<script type="module" src="https:\/\/static\.cloudflareinsights\.com\/beacon\.min\.js\/[^>]*><\/script>\r?\n?/s, '');
  assert.equal(sha256(Buffer.from(withoutCdn)), manifest.pages[pageName]);
  return { publicSha256: sha256(body), originSha256: manifest.pages[pageName],
    cloudflareInjected: original !== withoutCdn };
}

(async () => {
  const browser = await chromium.launch({ headless: true, channel: process.env.BROWSER_CHANNEL || 'chrome' });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [], csp = [], requests = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => {
      const url = new URL(request.url());
      if (url.origin === origin && url.pathname.startsWith('/api/')) requests.push(url.pathname);
    });
    await page.addInitScript(() => {
      window.qaCsp = [];
      document.addEventListener('securitypolicyviolation', event => qaCsp.push({
        directive: event.violatedDirective, blockedURI: event.blockedURI, sourceFile: event.sourceFile }));
    });

    const home = await page.goto(origin, { waitUntil: 'networkidle', timeout: 60000 });
    assert.equal(home.status(), 200);
    const homeHtml = verifyPublicHtml(await home.body(), 'index.html');
    await page.locator('#n_akari_jp').waitFor();
    assert.deepEqual(requests, ['/api/nodes']);
    const assets = {};
    for (const [name, expected] of Object.entries(manifest.assets)) {
      const response = await page.request.get(`${origin}/static/assets/${name}`);
      assert.equal(response.status(), 200, name);
      assets[name] = sha256(await response.body());
      assert.equal(assets[name], expected, name);
    }
    const legacy = await page.request.get(`${origin}/static/app.js`);
    assert.equal(legacy.status(), 200);

    await page.locator('#n_akari_jp .node-label').click();
    await page.locator('#n_google_dns .node-label').click();
    await page.locator('#goBtn').click();
    await page.waitForFunction(() => document.querySelectorAll('.data-state[data-state="measured"]').length === 2);
    const results = await page.evaluate(() => ({ cards: document.querySelectorAll('.card').length,
      ext: document.querySelectorAll('.card .badge-ext').length,
      v6: document.querySelectorAll('.card .badge-v6').length,
      overflow: document.documentElement.scrollWidth > innerWidth,
      metricSizes: [...new Set([...document.querySelector('.card').querySelectorAll('.stat-value')]
        .map(el => getComputedStyle(el).fontSize))],
      cardBorder: getComputedStyle(document.querySelector('.card')).borderTopWidth,
      controlsBorder: getComputedStyle(document.querySelector('.pills')).borderTopWidth,
      routeStatsDivider: getComputedStyle(document.querySelector('.card-right')).borderTopWidth,
      statItemDivider: getComputedStyle(document.querySelector('.stat-support .stat-item')).borderLeftWidth,
      checkboxClip: getComputedStyle(document.querySelector('.node-cb')).clipPath }));
    assert.equal(results.cards, 2);
    assert.equal(results.ext, 2);
    assert.equal(results.v6, 1);
    assert.equal(results.overflow, false);
    assert.equal(results.metricSizes.length, 1);
    assert.equal(results.cardBorder, '0px');
    assert.equal(results.controlsBorder, '0px');
    assert.equal(results.routeStatsDivider, '1px');
    assert.equal(results.statItemDivider, '1px');
    assert.equal(results.checkboxClip, 'inset(50%)');
    await page.screenshot({ path: path.join(output, 'results-desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    const mobile = await page.evaluate(() => ({
      metricSizes: [...new Set([...document.querySelector('.card').querySelectorAll('.stat-value')]
        .map(el => getComputedStyle(el).fontSize))],
      routeStatsDivider: getComputedStyle(document.querySelector('.card-right')).borderTopWidth,
      primaryDivider: getComputedStyle(document.querySelector('.stat-primary')).borderRightWidth,
      overflow: document.documentElement.scrollWidth > innerWidth }));
    assert.deepEqual(mobile, { metricSizes: ['16px'], routeStatsDivider: '1px',
      primaryDivider: '1px', overflow: false });
    await page.screenshot({ path: path.join(output, 'results-mobile.png'), fullPage: true });
    await page.locator('#toggleSidebar').click();
    assert.equal(await page.locator('#sidebar').evaluate(el => el.inert), false);
    await page.screenshot({ path: path.join(output, 'drawer-mobile.png') });
    await page.locator('#toggleSidebar').click();
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.locator('[data-mode="charts"]').click();
    await page.locator('#goBtn').click();
    await page.waitForFunction(() => document.querySelectorAll('.card-img img.ok').length === 2);
    const chartDividers = await page.evaluate(() => ({
      routeStats: getComputedStyle(document.querySelector('.card-right')).borderTopWidth,
      statsGraph: getComputedStyle(document.querySelector('.card-img')).borderTopWidth }));
    assert.deepEqual(chartDividers, { routeStats: '1px', statsGraph: '1px' });
    await page.screenshot({ path: path.join(output, 'charts-desktop.png'), fullPage: true });
    csp.push(...await page.evaluate(() => qaCsp));

    const trial = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const trialRequests = [];
    trial.on('pageerror', error => errors.push(error.message));
    trial.on('request', request => {
      const url = new URL(request.url());
      if (url.origin === origin && url.pathname.startsWith('/api/')) trialRequests.push(url.pathname);
    });
    await trial.addInitScript(() => {
      window.qaCsp = [];
      document.addEventListener('securitypolicyviolation', event => qaCsp.push({
        directive: event.violatedDirective, blockedURI: event.blockedURI, sourceFile: event.sourceFile }));
    });
    const trialHome = await trial.goto(origin + '/chart-trial', { waitUntil: 'networkidle', timeout: 60000 });
    assert.equal(trialHome.status(), 200);
    const trialHtml = verifyPublicHtml(await trialHome.body(), 'chart-trial.html');
    await trial.locator('#source option[value="akari_jp"]').waitFor({ state: 'attached' });
    assert.deepEqual(trialRequests, ['/api/nodes']); // No prefetch on the public trial.
    await trial.locator('#source').selectOption('akari_jp');
    await trial.locator('#target').selectOption('google_dns');
    await trial.locator('#protocol').selectOption('v6');
    await trial.locator('#load').click();
    await trial.waitForFunction(() => ChartTrial.snapshot?.schema === 'ipppping.series.v2' && ChartTrial.instanceCount === 1,
      null, { timeout: 45000 });
    const snapshot = await trial.evaluate(() => ({ schema: ChartTrial.snapshot.schema,
      bins: ChartTrial.snapshot.bins.length, mean: ChartTrial.snapshot.summary.average_ms,
      current: ChartTrial.snapshot.current.current_ms,
      canvas: document.querySelectorAll('canvas').length,
      overflow: document.documentElement.scrollWidth > innerWidth }));
    assert.equal(snapshot.canvas, 1);
    assert.ok(snapshot.bins > 0 && snapshot.bins <= 720);
    assert.ok(snapshot.mean !== null && snapshot.mean >= 0);
    assert.equal(snapshot.overflow, false);
    await trial.screenshot({ path: path.join(output, 'trial-canvas-mobile.png'), fullPage: true });
    await trial.locator('#png-mode').click();
    await trial.waitForFunction(() => {
      const img = document.querySelector('#plot img');
      return img?.complete && img.naturalWidth > 0;
    }, null, { timeout: 45000 });
    assert.equal(await trial.locator('canvas').count(), 0);
    await trial.screenshot({ path: path.join(output, 'trial-png-mobile.png'), fullPage: true });
    csp.push(...await trial.evaluate(() => qaCsp));

    const multi = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    multi.on('pageerror', error => errors.push(error.message));
    await multi.goto(origin, { waitUntil: 'networkidle', timeout: 60000 });
    const footerHeight = () => multi.locator('.sidebar-foot').evaluate(el => el.getBoundingClientRect().height);
    const initialFooterHeight = await footerHeight();
    for (const id of ['akari_jp', 'datawave_akari_hk', 'google_dns'])
      await multi.locator(`label[for="c_${id}"]`).click();
    await multi.locator('[data-pair-mode="fixed"]').click();
    for (const id of ['akari_jp', 'datawave_akari_hk'])
      await multi.locator(`[data-anchor-node="${id}"]`).click();
    assert.match(await multi.locator('#selInfo').innerText(), /2 fixed.*4 results/);
    assert.equal(await footerHeight(), initialFooterHeight);
    const pairResponse = await multi.request.get(`${origin}/api/pairs?nodes=akari_jp,datawave_akari_hk,google_dns&anchor=akari_jp,datawave_akari_hk`);
    assert.equal(pairResponse.status(), 200);
    const multiPairs = await pairResponse.json();
    assert.equal(multiPairs.length, 4);
    assert.ok(multiPairs.every(pair => pair.target === 'google_dns'));
    const batch = multi.waitForResponse(response => response.url().includes('/api/stats-batch.json')
      && (new URL(response.url()).searchParams.get('anchor') || '').split(',').sort().join(',')
        === 'akari_jp,datawave_akari_hk');
    await multi.locator('#goBtn').click();
    assert.equal((await batch).status(), 200);
    await multi.waitForFunction(() => document.querySelectorAll('.card').length === 4);
    assert.equal(await multi.locator('.card .badge-ext').count(), 4);
    await multi.screenshot({ path: path.join(output, 'multi-fixed-desktop.png'), fullPage: true });
    const multiFixed = { cards: 4, fixed: 2, footerHeight: await footerHeight() };

    assert.deepEqual(errors, []);
    const appCsp = csp.filter(event => !(
      event.blockedURI === 'inline' ||
      event.blockedURI.startsWith('https://static.cloudflareinsights.com/') ||
      event.blockedURI.includes('/cdn-cgi/challenge-platform/')));
    assert.deepEqual(appCsp, []);

    const report = { checkedAt: new Date().toISOString(), origin, browser: browser.version(),
      homeHtml, trialHtml, assets, legacyAssetAvailable: true,
      results, mobile, chartDividers, snapshot, multiFixed, requests, trialRequests, errors, csp };
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
