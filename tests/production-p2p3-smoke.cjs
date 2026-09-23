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
    await page.waitForFunction(() => {
      const values = [...document.querySelectorAll('.card .stat-primary .stat-number')];
      return values.length === 2 && values.every(el => el.textContent.trim() && el.textContent.trim() !== '—');
    });
    const results = await page.evaluate(() => ({ cards: document.querySelectorAll('.card').length,
      ext: document.querySelectorAll('.card .badge-ext').length,
      v6: document.querySelectorAll('.card .badge-v6').length,
      overflow: document.documentElement.scrollWidth > innerWidth,
      metricSizes: [...new Set([...document.querySelector('.card').querySelectorAll('.stat-value')]
        .map(el => getComputedStyle(el).fontSize))],
      metricNumberSizes: [...document.querySelector('.card').querySelectorAll('.stat-number')]
        .map(el => parseFloat(getComputedStyle(el).fontSize)),
      cardBorder: getComputedStyle(document.querySelector('.card')).borderTopWidth,
      controlsBorder: getComputedStyle(document.querySelector('.pills')).borderTopWidth,
      routeStatsDivider: getComputedStyle(document.querySelector('.card-right')).borderTopWidth,
      statItemDivider: getComputedStyle(document.querySelector('.stat-support .stat-item')).borderLeftWidth,
      checkboxClip: getComputedStyle(document.querySelector('.node-cb')).clipPath,
      resultStatusElements: document.querySelectorAll('.card .data-state').length,
      resultStatusText: [...document.querySelectorAll('.card')].some(card =>
        /cached result|refresh needed|latest probe|last measurement|no measurement|stale measurement|refresh failed|no RRD data/i.test(card.innerText)),
      footerHeight: document.querySelector('.sidebar-foot').getBoundingClientRect().height,
      statusRows: [...document.querySelector('#selInfo').children].map(el => el.getBoundingClientRect().height),
      freshness: document.querySelector('#selFreshness').textContent,
      metricsCentered: [...document.querySelector('.card .stats').querySelectorAll('.stat-item')].every(item => {
        const center = rect => (rect.left + rect.right) / 2;
        return Math.abs(center(item.getBoundingClientRect()) - center(item.querySelector('.stat-label').getBoundingClientRect())) < 2
          && Math.abs(center(item.getBoundingClientRect()) - center(item.querySelector('.stat-value').getBoundingClientRect())) < 2;
      }) }));
    assert.equal(results.cards, 2);
    assert.equal(results.ext, 2);
    assert.equal(results.v6, 1);
    assert.equal(results.overflow, false);
    assert.equal(results.metricSizes.length, 1);
    assert.equal(results.metricNumberSizes[0], results.metricNumberSizes[1],
      'five-column desktop results should keep numeric values at the same size');
    assert.equal(results.cardBorder, '0px');
    assert.equal(results.controlsBorder, '0px');
    assert.equal(results.routeStatsDivider, '1px');
    assert.equal(results.statItemDivider, '1px');
    assert.equal(results.checkboxClip, 'inset(50%)');
    assert.equal(results.resultStatusElements, 0);
    assert.equal(results.resultStatusText, false);
    assert.deepEqual(results.statusRows, [20, 20]);
    assert.match(results.freshness, /^Updated \d{2}:\d{2}$/);
    assert.equal(results.metricsCentered, true);
    await page.screenshot({ path: path.join(output, 'results-desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    const mobile = await page.evaluate(() => ({
      metricSizes: [...new Set([...document.querySelector('.card').querySelectorAll('.stat-value')]
        .map(el => getComputedStyle(el).fontSize))],
      metricNumberSizes: [...document.querySelector('.card').querySelectorAll('.stat-number')]
        .map(el => parseFloat(getComputedStyle(el).fontSize)),
      currentLine: (() => {
        const item = document.querySelector('.card .stat-primary');
        const value = item.querySelector('.stat-value');
        const number = value.querySelector('.stat-number').getBoundingClientRect();
        const unit = value.querySelector('.stat-unit').getBoundingClientRect();
        const primary = item.getBoundingClientRect();
        return { unit: value.querySelector('.stat-unit').textContent,
          gap: unit.left - number.right,
          sameLine: number.bottom > unit.top && unit.bottom > number.top,
          noOverflow: value.scrollWidth <= value.clientWidth + 1,
          dividerClearance: primary.right - 1 - unit.right };
      })(),
      routeStatsDivider: getComputedStyle(document.querySelector('.card-right')).borderTopWidth,
      primaryDivider: getComputedStyle(document.querySelector('.stat-primary')).borderRightWidth,
      overflow: document.documentElement.scrollWidth > innerWidth,
      dividerTextGap: (() => {
        const card = document.querySelector('.card');
        const line = card.querySelector('.stat-primary').getBoundingClientRect();
        const text = [...card.querySelectorAll('.stat-support .stat-label,.stat-support .stat-value')]
          .map(el => el.getBoundingClientRect());
        return Math.max(Math.abs(line.top - Math.min(...text.map(rect => rect.top))),
          Math.abs(line.bottom - Math.max(...text.map(rect => rect.bottom))));
      })() }));
    const { metricNumberSizes, currentLine, ...mobileLayout } = mobile;
    assert.deepEqual({ ...mobileLayout, dividerTextGap: undefined }, { metricSizes: ['16px'], routeStatsDivider: '1px',
      primaryDivider: '1px', overflow: false, dividerTextGap: undefined });
    assert.ok(Math.abs(metricNumberSizes[0] / metricNumberSizes[1] - 1.66) < 0.01);
    assert.deepEqual(metricNumberSizes.slice(1), [16, 16, 16, 16]);
    assert.ok(currentLine.unit === 'ms' || currentLine.unit === 'μs');
    assert.ok(Math.abs(currentLine.gap - 2) < 1);
    assert.equal(currentLine.sameLine, true);
    assert.equal(currentLine.noOverflow, true);
    assert.ok(currentLine.dividerClearance >= 7);
    assert.ok(mobile.dividerTextGap <= 4);
    await page.screenshot({ path: path.join(output, 'results-mobile.png'), fullPage: true });
    await page.locator('#toggleSidebar').click();
    assert.equal(await page.locator('#sidebar').evaluate(el => el.inert), false);
    await page.waitForFunction(() => Math.abs(document.getElementById('sidebar').getBoundingClientRect().left) < 1);
    await page.screenshot({ path: path.join(output, 'drawer-mobile.png') });
    await page.locator('#toggleSidebar').click();
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.locator('[data-mode="charts"]').click();
    await page.waitForTimeout(250);
    assert.ok(await page.locator('.sidebar-foot').evaluate(el => el.getBoundingClientRect().height) > results.footerHeight + 20);
    await page.locator('#goBtn').click();
    await page.waitForFunction(() => document.querySelectorAll('.card-img img.ok').length === 2);
    const chartScale = await page.evaluate(() => [...document.querySelector('.card').querySelectorAll('.stat-number')]
      .map(el => parseFloat(getComputedStyle(el).fontSize)));
    assert.equal(chartScale[0], chartScale[1], 'five-column charts must keep numeric values at the same size');
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
    const animatedAnchor = multi.locator('[data-anchor-node="akari_jp"]');
    const anchorWidth = await animatedAnchor.evaluate(el => el.offsetWidth);
    await animatedAnchor.click();
    assert.equal(await animatedAnchor.getAttribute('aria-pressed'), 'true');
    assert.equal(await animatedAnchor.evaluate(el => getComputedStyle(el).animationName), 'fixed-node-select');
    assert.equal(await animatedAnchor.evaluate(el => el.offsetWidth), anchorWidth);
    await animatedAnchor.click();
    assert.equal(await animatedAnchor.getAttribute('aria-pressed'), 'false');
    assert.equal(await animatedAnchor.evaluate(el => getComputedStyle(el).animationName), 'fixed-node-deselect');
    assert.equal(await animatedAnchor.evaluate(el => el.offsetWidth), anchorWidth);
    await animatedAnchor.click();
    await multi.locator('[data-anchor-node="datawave_akari_hk"]').click();
    assert.match(await multi.locator('#selInfo').innerText(), /2 fixed.*4 results/);
    assert.equal(await multi.locator('#selFreshness').innerText(), 'Unapplied changes');
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
    const batchResponse = await batch;
    assert.equal(batchResponse.status(), 200);
    const batchData = await batchResponse.json();
    const newest = Math.max(...batchData.items.map(item => item.stats?.measurement_updated_at || 0));
    const expectedFreshness = `Updated ${new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Shanghai', hour12: false, hour: '2-digit', minute: '2-digit'
    }).format(new Date(newest * 1000))}`;
    await multi.waitForFunction(expected => document.getElementById('selFreshness').textContent === expected, expectedFreshness);
    await multi.waitForFunction(() => document.querySelectorAll('.card').length === 4);
    assert.equal(await multi.locator('.card .badge-ext').count(), 4);
    assert.equal(await multi.locator('.card .data-state').count(), 0);
    await multi.screenshot({ path: path.join(output, 'multi-fixed-desktop.png'), fullPage: true });
    const multiFixed = { cards: 4, fixed: 2, animation: 'selection-and-cancellation', footerHeight: await footerHeight(), freshness: expectedFreshness };

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
