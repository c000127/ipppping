/* Isolated browser regression lab. Never sends requests to production.
 * NODE_PATH=<playwright installation> node tests/frontend-browser.cjs [--baseline]
 * Set BROWSER_CHANNEL=chrome when bundled Chromium is unavailable.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright');
const baseline = process.argv.includes('--baseline');
const root = path.resolve(__dirname, '..');
const out = path.join(root, 'test-results', baseline ? 'p0' : 'p1');
fs.mkdirSync(out, { recursive: true });
const nodes = Array.from({ length: 16 }, (_, i) => ({ id: `test_${i}`, label: `Test ${i}`, v4: true, v6: true, group: 'vps', region: 'Test' }));
nodes.push({ id: 'external', label: 'External DNS', v4: true, v6: true, group: 'dns', region: 'Test' });
nodes.push({ id: 'tg5', label: 'Telegram DC5', v4: true, v6: false, group: 'dns', region: 'Test' });
function pairs(ids, anchor) {
  const selected = nodes.filter(n => ids.includes(n.id)), results = [];
  for (let i = 0; i < selected.length; i++) for (let j = i + 1; j < selected.length; j++) {
    const a = selected[i], b = selected[j];
    if (anchor && a.id !== anchor && b.id !== anchor) continue;
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
    const body = baseline ? execFileSync('git', ['show', `0b33aa6:${name}`], { cwd: root, stdio: ['ignore','pipe','ignore'] }) : fs.readFileSync(path.join(root, name));
    res.setHeader('Content-Type', name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : name.endsWith('.html') ? 'text/html' : 'font/woff2');
    res.end(body);
  } catch { res.writeHead(404).end(); }
});
async function main() {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : {}) });
  const report = { baseline, commit: '0b33aa6', browser: browser.version(), platform: process.platform, mocked: true, cases: [] };
  try {
    let mode = 'normal', requests = [], active = 0, peak = 0;
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
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
          return await route.fulfill({ contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=', 'base64') });
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
      await page.waitForSelector('#n_test_0');
      await page.evaluate(() => sessionStorage.clear());
      requests = []; peak = 0;
    }
    async function select(ids = ['test_0','test_1','external'], charts = false) {
      await page.evaluate(({ids, charts}) => {
        ids.forEach(tog); if (charts) setViewMode('charts');
        document.getElementById('goBtn').click();
      }, { ids, charts });
    }
    async function ready() { await page.waitForFunction(() => [...document.querySelectorAll('.stat-primary .stat-value')].some(el => el.textContent.trim())); }
    await reset();
    assert.equal(requests.length, 0, 'startup must not prefetch matrix');
    await select(); await ready();
    assert.equal(await page.locator('.card').count(), 8);
    assert.equal(await page.locator('.card .badge-ext').count(), 4);
    assert.equal(await page.locator('.card .badge-v6').count(), 4);
    for (const width of [390,768,1024,1440,1800]) {
      await page.setViewportSize({ width, height: 900 });
      await page.waitForTimeout(350);
      await page.screenshot({ path: path.join(out, `results-${width}.png`), fullPage: true });
    }
    report.cases.push({ case: 'startup-labels-layout', cards: 8, requests: requests.length });
    await page.setViewportSize({ width: 1440, height: 900 });
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
          tg: makePairs(['test_0','tg5']).map(p => p.type) };
      });
      assert.deepEqual(boundaries, { nodesLimit: true, pairsLimit: true, fixed: 4, tg: ['v4'] });
      report.cases.push({ case: 'selection-boundaries-fixed-external-single-stack', ...boundaries });
      assert.equal(requests.filter(p => p === '/api/stats').length, 0);
      assert.equal(requests.filter(p => p.includes('batch')).length, 3);
      assert.match(await page.locator('.data-state').first().innerText(), /refresh failed/);
      await page.evaluate(() => setFilter('v6'));
      await page.waitForTimeout(150);
      assert.equal(requests.length, 3, 'filter must not restart failed requests');
      for (const scenario of ['network','malformed','missing','loss','stale']) {
        await reset(scenario); await select(); await ready();
        const text = await page.locator('.data-state').first().innerText();
        if (scenario === 'missing' || scenario === 'loss') {
          assert.doesNotMatch(await page.locator('.stat-primary').first().innerText(), /20/);
          assert.match(text, scenario === 'missing' ? /No measurement/ : /100% loss/);
        } else assert.match(text, scenario === 'stale' ? /Stale/ : /refresh failed/);
        report.cases.push({ case: scenario, requests: requests.length, status: text });
      }
      await reset(); await select(); await ready();
      mode = 'partial';
      await page.evaluate(() => showGraphs());
      await page.waitForFunction(() => document.querySelector('[data-state="error"]'));
      assert.equal(await page.locator('[data-state="error"]').count(), 1);
      report.cases.push({ case: 'partial-failure-preserves-old-data', errors: 1 });
      mode = 'normal';
      const before = requests.length;
      await page.evaluate(() => showGraphs());
      await page.waitForFunction(() => !document.querySelector('[data-state="error"]'));
      assert.ok(requests.length > before, 'explicit submit must bypass fresh client cache');
      await page.evaluate(() => { for (const key in statsCacheTimes) statsCacheTimes[key] -= 61000; refreshVisibleDataStates(); });
      assert.match(await page.locator('.data-state').first().innerText(), /refresh needed/);
      await reset('slow'); await select();
      await page.evaluate(() => { changeDuration('86400'); showGraphs(); });
      await page.waitForFunction(() => document.querySelector('.stat-primary .stat-number')?.textContent === '24.0');
      await page.waitForTimeout(400);
      assert.equal(await page.locator('.stat-primary .stat-number').first().innerText(), '24.0');
      report.cases.push({ case: 'generation-protection', current: '24.0' });
      await reset('unsupported'); await select(['test_0','test_1','test_2','external'], true); await ready();
      await page.waitForFunction(() => requestPool.active === 0 && requestPool.queue.length === 0 && activeLoads === 0);
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
      await page.waitForFunction(() => document.querySelectorAll('.stat-primary .stat-number').length === 480);
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
