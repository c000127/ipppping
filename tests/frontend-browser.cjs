/* Isolated browser regression lab. Never sends requests to production.
 * NODE_PATH=<playwright installation> node tests/frontend-browser.cjs [--baseline]
 * Set BROWSER_CHANNEL=chrome when bundled Chromium is unavailable.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { execFileSync } = require('node:child_process');
const engine = process.env.BROWSER_ENGINE || 'chromium';
const browserType = require('playwright')[engine];
const baseline = process.argv.includes('--baseline');
const root = path.resolve(__dirname, '..');
const out = path.join(root, 'test-results', baseline ? 'p0' : `p2-${engine}`);
fs.mkdirSync(out, { recursive: true });
async function waitFor(page, predicate) {
  const handle = await page.waitForFunction(predicate);
  await handle.dispose();
}
async function assertNoResultStatus(page, context) {
  const result = await page.evaluate(() => ({
    elements: document.querySelectorAll('.card .data-state').length,
    forbidden: [...document.querySelectorAll('.card')]
      .flatMap(card => card.innerText.match(/cached result|refresh needed|latest probe|last measurement|no measurement|stale measurement|refresh failed|no RRD data/gi) || [])
  }));
  assert.equal(result.elements, 0, `${context}: result cards must not render status elements`);
  assert.deepEqual(result.forbidden, [], `${context}: result cards must not contain status text`);
}
const nodes = Array.from({ length: 16 }, (_, i) => ({ id: `test_${i}`, label: `Test ${i}`, v4: true, v6: true, group: 'vps', region: 'Test' }));
nodes.push({ id: 'external', label: 'External DNS', v4: true, v6: true, group: 'dns', region: 'Test' });
nodes.push({ id: 'tg5', label: 'Telegram DC5', v4: true, v6: false, group: 'dns', region: 'Test' });
function pairs(ids, anchor) {
  const selected = nodes.filter(n => ids.includes(n.id)), results = [];
  const fixed = new Set(anchor?.split(',').filter(Boolean) || []);
  for (let i = 0; i < selected.length; i++) for (let j = i + 1; j < selected.length; j++) {
    const a = selected[i], b = selected[j];
    if (fixed.size && fixed.has(a.id) === fixed.has(b.id)) continue;
    for (const [s, t] of [[a,b],[b,a]]) {
      if (s.group !== 'vps') continue;
      for (const type of ['v4','v6']) if (s[type] && t[type]) results.push({ source: s.id, target: t.id, type });
    }
  }
  return results;
}
const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  if (pathname === '/api/test-stall') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.write('{"value":');
    const timer = setTimeout(() => res.end('1}'), 1000);
    res.on('close', () => clearTimeout(timer));
    return;
  }
  const name = pathname === '/' ? 'web/index.html' : pathname.startsWith('/static/') ? `web/${pathname.slice(8)}` : '';
  if (!name || name.includes('..')) { res.writeHead(404).end(); return; }
  try {
    const releaseName = name === 'web/index.html' ? 'build/web-release/index.html' : name.replace(/^web\/assets\//, 'build/web-release/assets/');
    const body = baseline ? execFileSync('git', ['show', `0b33aa6:${name}`], { cwd: root, stdio: ['ignore','pipe','ignore'] }) : fs.readFileSync(path.join(root, process.env.TEST_BUILT_RELEASE ? releaseName : name));
    res.setHeader('Content-Type', name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : name.endsWith('.html') ? 'text/html' : 'font/woff2');
    res.end(body);
  } catch { res.writeHead(404).end(); }
});
async function main() {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await browserType.launch({ headless: true, ...(engine === 'chromium' && process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : {}) });
  const report = { baseline, commit: baseline ? '0b33aa6' : 'working-tree', builtRelease: !!process.env.TEST_BUILT_RELEASE, browser: browser.version(), platform: process.platform, mocked: true, cases: [] };
  try {
    let mode = 'normal', requests = [], batchAnchors = [], active = 0, peak = 0;
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    if (process.env.RUN_AXE) await page.addInitScript({ path: path.join(root, 'build/qa-deps/package/axe.min.js') });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/**', async route => {
      const url = new URL(route.request().url());
      if (url.pathname === '/api/nodes') return route.fulfill({ json: nodes });
      const scenario = mode;
      requests.push(url.pathname);
      peak = Math.max(peak, ++active);
      try {
        await new Promise(resolve => setTimeout(resolve, scenario === 'slow' ? 250 : 40));
        if (scenario === 'network') return await route.abort('failed');
        if (url.pathname.endsWith('stats-batch.json') && ['busy','unsupported','malformed'].includes(scenario)) {
          return await route.fulfill({ status: scenario === 'busy' ? 503 : scenario === 'unsupported' ? 404 : 200,
            headers: { 'Retry-After': '0' }, body: scenario === 'malformed' ? '{broken' : '{}' });
        }
        if (url.pathname.endsWith('graph.png')) {
          const fixture = process.env.FIXTURE_PNG && path.join(root, 'test-results/p3', Number(url.searchParams.get('w')) <= 600 ? 'rrd-320.png' : 'rrd-900.png');
          return await route.fulfill({ contentType: 'image/png', body: fixture ? fs.readFileSync(fixture) : Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=', 'base64') });
        }
        const missing = scenario === 'missing', lost = scenario === 'loss';
        const stats = {
          current_ms: missing || lost ? null : Number(url.searchParams.get('dur')) / 3600,
          avg_ms: 20, min_ms: 10, max_ms: 30, loss_pct: missing ? null : lost ? 100 : 0,
          current_loss_pct: missing ? null : lost ? 100 : 0,
          measurement_updated_at: missing ? null : Math.floor(Date.now()/1000) - (scenario === 'stale' ? 1200 : 30),
          measurement_state: missing ? 'missing' : 'measured', stale_after_seconds: 600
        };
        if (url.pathname.endsWith('stats-batch.json')) {
          batchAnchors.push(url.searchParams.get('anchor'));
          const list = pairs(url.searchParams.get('nodes').split(','), url.searchParams.get('anchor'));
          return await route.fulfill({ json: { items: list.map((p,i) => scenario === 'partial' && i === 0 ? { ...p, error: 'rrd_error' } : { ...p, stats }) } });
        }
        return await route.fulfill({ json: stats });
      } finally { active--; }
    });
    async function reset(nextMode = 'normal') {
      mode = nextMode;
      if (page.url().startsWith('http:')) await page.evaluate(() => sessionStorage.clear());
      await page.goto(`http://127.0.0.1:${server.address().port}`);
      await page.locator('#n_test_0').waitFor();
      await page.evaluate(() => sessionStorage.clear());
      requests = []; batchAnchors = []; peak = 0;
    }
    async function select(ids = ['test_0','test_1','external'], charts = false) {
      await page.evaluate(({ids, charts}) => {
        ids.forEach(tog); if (charts) setViewMode('charts');
        document.getElementById('goBtn').click();
      }, { ids, charts });
    }
    async function ready() { await waitFor(page, () => [...document.querySelectorAll('.stat-primary .stat-value')].some(el => el.textContent.trim())); }
    await reset();
    assert.equal(requests.length, 0, 'startup must not prefetch matrix');
    await select(); await ready();
    assert.equal(await page.locator('.card').count(), 8);
    assert.equal(await page.locator('.card .badge-ext').count(), 4);
    assert.equal(await page.locator('.card .badge-v6').count(), 4);
    if (process.env.RUN_AXE) {
      const audit = await page.evaluate(async () => (await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa'] } })).violations.map(v => ({ id:v.id, impact:v.impact, targets:v.nodes.map(n=>n.target) })));
      report.axe = audit;
      fs.writeFileSync(path.join(out, 'axe.json'), JSON.stringify(audit, null, 2));
      assert.deepEqual(audit, []);
    }
    for (const width of [320,390,768,1024,1440,1800]) {
      await page.setViewportSize({ width, height: 900 });
      await page.waitForTimeout(350);
      if (!baseline) {
        const visual = await page.evaluate(() => {
          const card = document.querySelector('.card');
          const values = [...card.querySelectorAll('.stat-value')];
          return {
            metricCount: values.length,
            metricSizes: [...new Set(values.map(el => getComputedStyle(el).fontSize))],
            metricNumberSizes: [...card.querySelectorAll('.stat-number')].map(el => parseFloat(getComputedStyle(el).fontSize)),
            cardBorder: getComputedStyle(card).borderTopWidth,
            groupBorder: getComputedStyle(document.querySelector('.pills')).borderTopWidth,
            routeStatsTop: getComputedStyle(card.querySelector('.card-right')).borderTopWidth,
            routeStatsLeft: getComputedStyle(card.querySelector('.card-right')).borderLeftWidth,
            routeStatsPseudo: getComputedStyle(card.querySelector('.card-right'), '::before').borderLeftWidth,
            supportDivider: getComputedStyle(card.querySelector('.stat-support .stat-item')).borderLeftWidth,
            primaryDivider: getComputedStyle(card.querySelector('.stat-primary')).borderRightWidth,
            mainWidth: document.querySelector('#mainArea').getBoundingClientRect().width,
            checkboxClip: getComputedStyle(document.querySelector('.node-cb')).clipPath,
            horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
          };
        });
        assert.equal(visual.metricCount, 5);
        assert.equal(visual.metricSizes.length, 1, `metric sizes differ at ${width}px`);
        const primaryNumberSize = visual.metricNumberSizes[0];
        const secondaryNumberSize = visual.metricNumberSizes[1];
        assert.equal(primaryNumberSize, visual.mainWidth <= 460 || visual.mainWidth >= 1360
          ? secondaryNumberSize * 2 : secondaryNumberSize, `CURRENT numeric size is incorrect at ${width}px`);
        assert.equal(visual.cardBorder, '0px');
        assert.equal(visual.groupBorder, '0px');
        assert.equal(visual.routeStatsTop, visual.mainWidth >= 1360 ? '0px' : '1px');
        assert.equal(visual.routeStatsLeft, '0px');
        assert.equal(visual.routeStatsPseudo, visual.mainWidth >= 1360 ? '1px' : '0px');
        assert.equal(visual.supportDivider, visual.mainWidth >= 1360 || visual.mainWidth <= 460 ? '0px' : '1px');
        assert.equal(visual.primaryDivider, visual.mainWidth <= 460 ? '1px' : '0px');
        assert.equal(visual.checkboxClip, 'inset(50%)');
        assert.equal(visual.horizontalOverflow, false);
        await assertNoResultStatus(page, `normal results at ${width}px`);
        if (visual.mainWidth > 460 && visual.mainWidth < 1360) {
          const centered = await page.evaluate(() => [...document.querySelector('.card .stats').querySelectorAll('.stat-item')].every(item => {
            const center = rect => (rect.left + rect.right) / 2;
            return Math.abs(center(item.getBoundingClientRect()) - center(item.querySelector('.stat-label').getBoundingClientRect())) < 2
              && Math.abs(center(item.getBoundingClientRect()) - center(item.querySelector('.stat-value').getBoundingClientRect())) < 2;
          }));
          assert.equal(centered, true, `five-column metric content is not centered at ${width}px`);
        }
        if (visual.mainWidth <= 460 || visual.mainWidth >= 1360) {
          const divider = await page.evaluate(() => {
            const card = document.querySelector('.card');
            const support = card.querySelector('.stat-support');
            const text = [...support.querySelectorAll('.stat-label,.stat-value')].map(el => el.getBoundingClientRect());
            const textTop = Math.min(...text.map(rect => rect.top));
            const textBottom = Math.max(...text.map(rect => rect.bottom));
            if (document.querySelector('#mainArea').getBoundingClientRect().width <= 460) {
              const line = card.querySelector('.stat-primary').getBoundingClientRect();
              return { top: Math.abs(line.top - textTop), bottom: Math.abs(line.bottom - textBottom) };
            }
            const right = card.querySelector('.card-right');
            const rect = right.getBoundingClientRect();
            const style = getComputedStyle(right, '::before');
            return { top: Math.abs(rect.top + parseFloat(style.top) - textTop),
              bottom: Math.abs(rect.bottom - parseFloat(style.bottom) - textBottom) };
          });
          assert.ok(divider.top <= 4 && divider.bottom <= 4, `two-by-two divider misses text edges at ${width}px: ${JSON.stringify(divider)}`);
        }
      }
      await page.screenshot({ path: path.join(out, `results-${width}.png`), fullPage: true });
    }
    report.cases.push({ case: 'startup-labels-layout', cards: 8, requests: requests.length });
    if (!baseline) {
      assert.match(await page.locator('#selSummary').innerText(), /^3 nodes.*8 results$/);
      assert.match(await page.locator('#selFreshness').innerText(), /^Updated \d{2}:\d{2}$/);
      const freshness = await page.evaluate(() => {
        const now = Math.floor(Date.now() / 1000);
        for (const pair of currentPairs) statsCache[statsCacheKey(pair)].measurement_updated_at = now - 3600;
        const latest = currentPairs.find(pair => pair.type === 'v6');
        statsCache[statsCacheKey(latest)].measurement_updated_at = now - 120;
        updateSelectionFreshness();
        const all = document.getElementById('selFreshness').textContent;
        setFilter('v4');
        const v4 = document.getElementById('selFreshness').textContent;
        setFilter('all');
        return { all, v4, expectedAll: `Updated ${updateTimeFormat.format(new Date((now - 120) * 1000))}`,
          expectedV4: `Updated ${updateTimeFormat.format(new Date((now - 3600) * 1000))}` };
      });
      assert.equal(freshness.all, freshness.expectedAll, 'freshness should use the latest result timestamp');
      assert.equal(freshness.v4, freshness.expectedV4, 'freshness should follow the visible protocol filter');
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    if (!baseline) {
      await page.setViewportSize({ width: 1440, height: 600 });
      await reset();
      await page.locator('#n_tg5 .node-label').scrollIntoViewIfNeeded();
      const sidebarBeforeClick = await page.evaluate(() => ({ page: scrollY,
        sidebar: document.querySelector('#sidebar').scrollTop,
        list: document.querySelector('#sidebarInner').scrollTop }));
      await page.locator('#n_tg5 .node-label').click();
      const sidebarAfterClick = await page.evaluate(() => ({ page: scrollY,
        sidebar: document.querySelector('#sidebar').scrollTop,
        list: document.querySelector('#sidebarInner').scrollTop }));
      assert.equal(sidebarAfterClick.page, sidebarBeforeClick.page, 'bottom node selection scrolled page');
      assert.equal(sidebarAfterClick.sidebar, sidebarBeforeClick.sidebar, 'bottom node selection scrolled sidebar shell');
      assert.ok(Math.abs(sidebarAfterClick.list - sidebarBeforeClick.list) <= 4,
        `bottom node selection moved node list: ${sidebarBeforeClick.list} -> ${sidebarAfterClick.list}`);
      await page.setViewportSize({ width: 1440, height: 900 });
      await reset();
      const cb = page.locator('#c_test_0');
      await cb.focus(); await page.keyboard.press('Space');
      assert.equal(await cb.isChecked(), true);
      await page.locator('label[for="c_test_1"]').click();
      assert.equal(await page.locator('#c_test_1').isChecked(), true, 'whole node row must remain selectable');
      await page.locator('[data-pair-mode="fixed"]').click();
      await page.locator('[data-anchor-node="test_0"]').focus();
      await page.keyboard.press('Space');
      assert.equal(await cb.isChecked(), true, 'Fix must not toggle selection');
      await page.keyboard.press('Enter');
      assert.equal(await cb.isChecked(), true);
      assert.equal(await page.locator('.axis-option').isVisible(), false);
      await page.locator('[data-mode="charts"]').click();
      await page.locator('.axis-option').waitFor({ state: 'visible' });
      assert.equal(await page.locator('#goBtn').innerText(), 'Show Charts');
      await page.setViewportSize({ width: 390, height: 844 });
      await waitFor(page, () => document.getElementById('sidebar').inert);
      assert.equal(await page.locator('#sidebar').evaluate(el => el.inert), true);
      await page.locator('#toggleSidebar').click();
      assert.equal(await page.locator('#mainArea').evaluate(el => el.inert), true);
      await page.locator('#toggleSidebar').focus(); await page.keyboard.press('Shift+Tab');
      assert.equal(await page.evaluate(() => document.getElementById('sidebar').contains(document.activeElement)), true);
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('#toggleSidebar').evaluate(el => el === document.activeElement), true);
      assert.equal(await page.locator('#mainArea').evaluate(el => el.inert), false);
      await page.setViewportSize({ width: 1440, height: 900 });
      await reset(); await select(); await ready();
      assert.equal(await page.evaluate(() => {
        const stats = document.querySelector('.stats');
        if (!stats) throw Error('stats container missing');
        UIComponents.updateStats(stats, { current_ms: 1, avg_ms: 2, min_ms: 0, max_ms: 3, loss_pct: 0 });
        const before = [...stats.querySelectorAll('.stat-number')];
        UIComponents.updateStats(stats, { current_ms: 2, avg_ms: 3, min_ms: 0, max_ms: 4, loss_pct: 0 });
        return before.every((el, i) => el === stats.querySelectorAll('.stat-number')[i]);
      }), true);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      assert.equal(await page.evaluate(() => UIComponents.reducedMotion()), true);
      for (const width of [320,390,768,1024,1440,1800]) {
        await page.setViewportSize({ width, height: 900 });
        await page.waitForTimeout(100);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.getElementById('mainArea').scrollWidth <= document.getElementById('mainArea').clientWidth), true, `overflow at ${width}`);
      }
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      const fonts = await page.evaluate(() => performance.getEntriesByType('resource').filter(r => r.name.endsWith('.woff2')).map(r => r.name.split('/').at(-1)));
      assert.equal(new Set(fonts).size, 2);
      assert.ok(fonts.reduce((sum, name) => sum + fs.statSync(path.join(root, 'web/fonts', name)).size, 0) <= 200 * 1024);
      report.cases.push({ case: 'p2-keyboard-drawer-stable-metrics-responsive-font-budget', passed: true });
      await page.evaluate(() => {
        document.querySelectorAll('.route-node, .node-label').forEach(el => { el.textContent = 'LongNodeNameWithoutSpaces-'.repeat(5); });
      });
      for (const width of [320,390,768,1024,1440,1800]) {
        await page.setViewportSize({ width, height: 900 });
        await page.waitForTimeout(100);
        assert.equal(await page.evaluate(() => document.getElementById('mainArea').scrollWidth <= document.getElementById('mainArea').clientWidth), true, `long-name overflow at ${width}`);
      }
      await page.setViewportSize({ width: 640, height: 450 }); // 1280x900 at 200% browser zoom: equivalent CSS viewport.
      await page.locator('#toggleSidebar').click();
      await page.locator('#goBtn').scrollIntoViewIfNeeded();
      assert.equal(await page.locator('#goBtn').isVisible(), true);
      await page.screenshot({ path: path.join(out, 'zoom-equivalent-drawer.png') });
      await page.keyboard.press('Escape');
      await page.setViewportSize({ width: 1440, height: 900 });
      await reset(); await select(['test_0','test_1','external'], true); await ready();
      await waitFor(page, () => !!document.querySelector('.card-img img.ok'));
      for (const width of [390,1440,1800]) {
        await page.setViewportSize({ width, height: 900 });
        await page.waitForTimeout(200);
        const dividers = await page.evaluate(() => {
          const card = document.querySelector('.card');
          return {
            routeStats: getComputedStyle(card.querySelector('.card-right')).borderTopWidth,
            statsGraph: getComputedStyle(card.querySelector('.card-img')).borderTopWidth,
            statItems: getComputedStyle(card.querySelector('.stat-support .stat-item')).borderLeftWidth,
            mainWidth: document.querySelector('#mainArea').getBoundingClientRect().width,
          };
        });
        assert.equal(dividers.routeStats, '1px');
        assert.equal(dividers.statsGraph, '1px');
        assert.equal(dividers.statItems, dividers.mainWidth <= 460 ? '0px' : '1px');
        await page.screenshot({ path: path.join(out, `charts-${width}.png`) });
      }
      const touch = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: engine !== 'firefox', hasTouch: true });
      const touchPage = await touch.newPage();
      await touchPage.route('**/api/nodes', route => route.fulfill({ json: nodes }));
      await touchPage.goto(`http://127.0.0.1:${server.address().port}`);
      await touchPage.locator('#toggleSidebar').tap();
      await touchPage.locator('label[for="c_test_0"]').tap();
      assert.equal(await touchPage.locator('#c_test_0').isChecked(), true);
      await touchPage.locator('#toggleSidebar').tap();
      assert.equal(await touchPage.locator('#sidebar').evaluate(el => el.inert), true);
      await touchPage.setViewportSize({ width: 390, height: 600 });
      await touchPage.locator('#toggleSidebar').tap();
      await touchPage.locator('#n_tg5 .node-label').scrollIntoViewIfNeeded();
      const mobileBefore = await touchPage.evaluate(() => ({ page: scrollY,
        sidebar: document.querySelector('#sidebar').scrollTop,
        list: document.querySelector('#sidebarInner').scrollTop,
        footHeight: document.querySelector('.sidebar-foot').getBoundingClientRect().height }));
      await touchPage.locator('#n_tg5 .node-label').tap();
      const mobileAfter = await touchPage.evaluate(() => ({ page: scrollY,
        sidebar: document.querySelector('#sidebar').scrollTop,
        list: document.querySelector('#sidebarInner').scrollTop,
        footHeight: document.querySelector('.sidebar-foot').getBoundingClientRect().height }));
      assert.equal(mobileAfter.page, mobileBefore.page, 'mobile bottom selection scrolled page');
      assert.equal(mobileAfter.sidebar, mobileBefore.sidebar, 'mobile bottom selection scrolled sidebar shell');
      assert.equal(mobileAfter.footHeight, mobileBefore.footHeight, 'mobile footer height changed after selection');
      assert.ok(Math.abs(mobileAfter.list - mobileBefore.list) <= 4,
        `mobile bottom selection moved node list: ${mobileBefore.list} -> ${mobileAfter.list}`);
      await touch.close();
      report.cases.push({ case: 'p2-long-names-zoom-equivalent-touch-emulation-charts', passed: true });
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      await reset();
      const footerGeometry = () => page.evaluate(() => {
        const foot = document.querySelector('.sidebar-foot');
        const info = foot.querySelector('.sel-info');
        return {
          height: foot.getBoundingClientRect().height,
          listHeight: document.querySelector('#sidebarInner').getBoundingClientRect().height,
          statusHeight: info.getBoundingClientRect().height,
          statusRows: [...info.children].map(row => row.getBoundingClientRect().height),
          rows: ['.selection-controls', '.pairing-mode', '.view-mode', '.axis-option', '.go-btn', '.sel-info']
            .map(selector => foot.querySelector(selector).offsetTop - foot.offsetTop),
        };
      });
      const initialFooter = await footerGeometry();
      assert.equal(initialFooter.statusHeight, 40);
      assert.deepEqual(initialFooter.statusRows, [20, 20]);
      for (const id of ['test_0', 'test_1', 'test_2', 'external'])
        await page.locator(`label[for="c_${id}"]`).click();
      assert.deepEqual(await footerGeometry(), initialFooter, 'selection changed footer geometry');
      await page.locator('[data-pair-mode="fixed"]').click();
      assert.equal(await page.locator('#goBtn').isDisabled(), true);
      await page.locator('[data-anchor-node="test_0"]').click();
      await page.locator('[data-anchor-node="test_1"]').click();
      assert.equal(await page.locator('[data-anchor-node="test_0"]').getAttribute('aria-pressed'), 'true');
      assert.equal(await page.locator('[data-anchor-node="test_1"]').getAttribute('aria-pressed'), 'true');
      assert.equal(await page.locator('#goBtn').isEnabled(), true);
      assert.match(await page.locator('#selInfo').innerText(), /2 fixed.*12 results/);
      assert.equal(await page.locator('#selFreshness').innerText(), 'Unapplied changes');
      assert.deepEqual(await footerGeometry(), initialFooter, 'fixed-node selection changed footer geometry');
      await page.locator('#goBtn').click(); await ready();
      assert.match(await page.locator('#selFreshness').innerText(), /^Updated \d{2}:\d{2}$/);
      assert.equal(await page.locator('.card').count(), 12);
      assert.equal(batchAnchors.at(-1), 'test_0,test_1');
      assert.equal(await page.evaluate(() => currentPairs.some(p => ['test_0','test_1'].includes(p.source)
        && ['test_0','test_1'].includes(p.target))), false, 'fixed nodes generated mutual results');
      await page.locator('[data-anchor-node="test_2"]').click();
      await page.locator('[data-anchor-node="external"]').click();
      assert.equal(await page.locator('#goBtn').isDisabled(), true);
      assert.match(await page.locator('#selInfo').innerText(), /Select a non-fixed node/);
      assert.deepEqual(await footerGeometry(), initialFooter, 'validation message changed footer geometry');
      await page.locator('[data-anchor-node="test_2"]').click();
      await page.locator('[data-anchor-node="external"]').click();
      await page.locator('[data-mode="charts"]').click();
      await page.locator('.axis-option').waitFor({ state: 'visible' });
      await page.waitForTimeout(250);
      const chartFooter = await footerGeometry();
      assert.ok(chartFooter.height > initialFooter.height + 20, 'Charts option should expand the natural footer');
      assert.equal(chartFooter.statusHeight, 40);
      assert.deepEqual(chartFooter.statusRows, [20, 20]);
      const sidebarTransition = await page.locator('#sidebar').evaluate(el => getComputedStyle(el).transitionDuration);
      assert.notEqual(sidebarTransition, '0s');
      await page.locator('#toggleSidebar').click();
      await page.waitForFunction(() => document.querySelector('#sidebar').getBoundingClientRect().width < 1);
      assert.equal(await page.locator('#sidebar').evaluate(el => el.inert), true);
      await page.locator('#toggleSidebar').click();
      await page.waitForFunction(() => document.querySelector('#sidebar').getBoundingClientRect().width >= 279);
      assert.deepEqual(await footerGeometry(), chartFooter, 'sidebar toggle changed footer geometry');
      await page.locator('.view-mode-btn[data-mode="stats"]').click();
      await page.waitForTimeout(250);
      assert.deepEqual(await footerGeometry(), initialFooter, 'Results mode did not restore the compact footer');
      report.cases.push({ case: 'multi-fixed-two-line-status-natural-footer-animated-drawer', pairs: 12, passed: true });
    }
    await reset('busy'); await select();
    await page.waitForTimeout(3500);
    report.cases.push({ case: '503', batch: requests.filter(p => p.includes('batch')).length, singles: requests.filter(p => p === '/api/stats').length, peak });
    if (!baseline) {
      const boundaries = await page.evaluate(() => {
        let nodesLimit = false, pairsLimit = false;
        try { makePairs(Array(21).fill('test_0')); } catch { nodesLimit = true; }
        try { makePairs(nodes.filter(n => n.id !== 'tg5').map(n => n.id)); } catch { pairsLimit = true; }
        return { nodesLimit, pairsLimit,
          fixed: makePairs(['test_0','test_1','external'], 'external').length,
          multiFixed: makePairs(['test_0','test_1','test_2','external'], ['test_0','test_1']).length,
          allFixed: makePairs(['test_0','test_1'], ['test_0','test_1']).length,
          tg: makePairs(['test_0','tg5']).map(p => p.type) };
      });
      assert.deepEqual(boundaries, { nodesLimit: true, pairsLimit: true, fixed: 4,
        multiFixed: 12, allFixed: 0, tg: ['v4'] });
      report.cases.push({ case: 'selection-boundaries-fixed-external-single-stack', ...boundaries });
      assert.equal(requests.filter(p => p === '/api/stats').length, 0);
      assert.equal(requests.filter(p => p.includes('batch')).length, 3);
      await assertNoResultStatus(page, '503 failure');
      await page.evaluate(() => setFilter('v6'));
      await page.waitForTimeout(150);
      assert.equal(requests.length, 3, 'filter must not restart failed requests');
      for (const scenario of ['network','malformed','missing','loss','stale']) {
        await reset(scenario); await select(); await ready();
        await assertNoResultStatus(page, scenario);
        if (scenario === 'missing' || scenario === 'loss') {
          assert.doesNotMatch(await page.locator('.stat-primary').first().innerText(), /20/);
        }
        report.cases.push({ case: scenario, requests: requests.length, resultStatusElements: 0 });
      }
      await reset(); await select(); await ready();
      await waitFor(page, () => document.querySelectorAll('.card .stat-primary .stat-number').length === 8
        && [...document.querySelectorAll('.card .stat-primary .stat-number')].every(el => el.textContent !== '—')
        && batchLoadingGeneration === -1 && !document.querySelector('.stats-pending'));
      const beforePartialValues = await page.locator('.card .stat-primary .stat-number').allTextContents();
      mode = 'partial';
      await page.evaluate(() => showGraphs());
      await waitFor(page, () => statsFailures.size === 1 && batchLoadingGeneration === -1);
      await assertNoResultStatus(page, 'partial failure');
      assert.deepEqual(await page.locator('.card .stat-primary .stat-number').allTextContents(), beforePartialValues,
        'partial refresh failure should preserve the previous measurements without showing a per-card status');
      report.cases.push({ case: 'partial-failure-preserves-card-layout-without-status-copy', errors: 1 });
      mode = 'normal';
      const before = requests.length;
      await page.evaluate(() => showGraphs());
      await waitFor(page, () => statsFailures.size === 0 && batchLoadingGeneration === -1);
      assert.ok(requests.length > before, 'explicit submit must bypass fresh client cache');
      await page.evaluate(() => { for (const key in statsCacheTimes) statsCacheTimes[key] -= 61000; updateSelectionFreshness(); });
      await assertNoResultStatus(page, 'expired client cache');
      await reset('slow'); await select();
      await page.evaluate(() => { changeDuration('86400'); showGraphs(); });
      await waitFor(page, () => document.querySelector('.stat-primary .stat-number')?.textContent === '24.0');
      await page.waitForTimeout(400);
      assert.equal(await page.locator('.stat-primary .stat-number').first().innerText(), '24.0');
      report.cases.push({ case: 'generation-protection', current: '24.0' });
      await reset('unsupported'); await select(['test_0','test_1','test_2','external'], true); await ready();
      await waitFor(page, () => requestPool.active === 0 && requestPool.queue.length === 0 && activeLoads === 0);
      await page.setViewportSize({ width: 390, height: 844 });
      const narrowChartMetricScale = await page.evaluate(() => {
        const sizes = [...document.querySelector('.card').querySelectorAll('.stat-number')].map(el => parseFloat(getComputedStyle(el).fontSize));
        return { mainWidth: document.querySelector('#mainArea').getBoundingClientRect().width,
          primary: sizes[0], secondary: sizes[1], statsOnly: document.querySelector('#graphGrid').classList.contains('stats-only') };
      });
      assert.equal(narrowChartMetricScale.statsOnly, false);
      assert.ok(narrowChartMetricScale.mainWidth <= 460);
      assert.equal(narrowChartMetricScale.primary, narrowChartMetricScale.secondary * 2,
        'CURRENT must be double-sized in the left-plus-2x2 narrow layout');
      await page.setViewportSize({ width: 1800, height: 900 });
      const chartMetricScale = await page.evaluate(() => {
        const card = document.querySelector('.card');
        const sizes = [...card.querySelectorAll('.stat-number')].map(el => parseFloat(getComputedStyle(el).fontSize));
        return { mainWidth: document.querySelector('#mainArea').getBoundingClientRect().width,
          primary: sizes[0], secondary: sizes[1], statsOnly: document.querySelector('#graphGrid').classList.contains('stats-only') };
      });
      assert.equal(chartMetricScale.statsOnly, false);
      assert.ok(chartMetricScale.mainWidth >= 1360);
      assert.equal(chartMetricScale.primary, chartMetricScale.secondary,
        'five-column charts must keep numeric values at the same size');
      await assertNoResultStatus(page, 'charts results');
      assert.ok(peak <= 4, `mixed JSON/PNG peak ${peak}`);
      report.cases.push({ case: '404-compatibility-mixed-json-png', requests: requests.length, peak });
      // Timeout includes response-body parsing; a stalled body is cancelled.
      await page.route('**/api/test-stall', route => route.continue());
      const timeout = await page.evaluate(async () => {
        try { await fetchJson('/api/test-stall', undefined, 50); return 'unexpected success'; }
        catch (error) { return error.message; }
      });
      assert.equal(timeout, 'Request timed out');
      report.cases.push({ case: 'timeout-cancellation', message: timeout });
      const countBeforeDedup = requests.length;
      await page.evaluate(() => Promise.all(Array.from({ length: 5 }, () => fetchJson('/api/stats?dedup-test=1'))));
      assert.equal(requests.length - countBeforeDedup, 1);
      const bounded = await page.evaluate(() => {
        for (let i = 0; i < 1100; i++) rememberStats(`fixture-${i}`, { padding: 'x'.repeat(4096) });
        return statsLRU.size <= 1024 && statsCacheBytes <= MAX_STATS_CACHE_BYTES;
      });
      assert.ok(bounded);
      report.cases.push({ case: 'request-dedup-and-cache-bounds', passed: true });
      await reset(); await select(nodes.filter(n => n.group === 'vps').map(n => n.id));
      await waitFor(page, () => document.querySelectorAll('.stat-primary .stat-number').length === 480);
      report.cases.push({ case: 'large-matrix', cards: await page.locator('.card').count(), requests: requests.length });
    }
    // Fixed mock network (40ms), not a production/CWV benchmark.
    await reset(); await select(); await ready();
    const durations = [];
    for (let i = 0; i < 30; i++) {
      durations.push(await page.evaluate(async () => {
        statsCache = {}; statsCacheTimes = {};
        const start = performance.now(); await showGraphs();
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        return performance.now() - start;
      }));
    }
    durations.sort((a,b) => a-b);
    report.mockRefresh = { samples: 30, medianMs: durations[14], p95Ms: durations[28] };
    assert.deepEqual(errors, [], 'uncaught browser exceptions');
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } finally { await browser.close(); server.close(); }
}
main().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
