/* Physical Android Chrome QA against the local, fingerprinted P2/P3 build.
 * Never serves production RRDs or navigates existing Chrome tabs.
 * Requires NODE_PATH with Playwright, adb, an adb CDP forward (default tcp:9222),
 * and synthetic fixtures from tests/run-series-lab.py.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const zlib = require('node:zlib');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'test-results/android-device');
const release = path.join(root, 'build/web-release');
const fixtureDir = path.join(root, 'test-results/p3');
fs.mkdirSync(output, { recursive: true });
const auditPath = path.join(output, 'operations.log');
const audit = message => fs.appendFileSync(auditPath, `${new Date().toISOString()} ${message}\n`);
const pngMobile = fs.readFileSync(path.join(fixtureDir, 'rrd-320.png'));
const pngDesktop = fs.readFileSync(path.join(fixtureDir, 'rrd-900.png'));
const png24h = fs.readFileSync(path.join(fixtureDir, 'rrd-24h.png'));
const series = JSON.parse(fs.readFileSync(path.join(fixtureDir, 'rrd-24h-columns.json'), 'utf8'));
const nodes = [
  { id: 'akari_jp', label: 'Halo Akari JP', v4: true, v6: true, group: 'vps', region: 'JP' },
  { id: 'datawave_akari_lax', label: 'DataWave Akari LAX', v4: true, v6: true, group: 'vps', region: 'US' },
  { id: 'google_dns', label: 'Google DNS', v4: true, v6: true, group: 'dns', region: 'Global' },
  { id: 'tg5', label: 'Telegram DC5', v4: true, v6: false, group: 'dns', region: 'Global' },
];
const nodeById = new Map(nodes.map(n => [n.id, n]));
const security = "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; font-src 'self'";
const requests = {};
const adb = args => {
  audit(`ADB ${args.join(' ')}`);
  return execFileSync('adb', args, { encoding: 'utf8', timeout: 10000 }).trim();
};
const serial = process.env.ANDROID_SERIAL || adb(['get-serialno']);
if (!serial || serial === 'unknown') throw Error('Exactly one authorized ADB device is required, or set ANDROID_SERIAL');
const onDevice = args => adb(['-s', serial, ...args]);

function pairs(ids, anchor) {
  const selected = nodes.filter(n => ids.includes(n.id)), results = [];
  const fixed = new Set(anchor?.split(',').filter(Boolean) || []);
  for (let i = 0; i < selected.length; i++) for (let j = i + 1; j < selected.length; j++) {
    const a = selected[i], b = selected[j];
    if (fixed.size && fixed.has(a.id) === fixed.has(b.id)) continue;
    for (const [source, target] of [[a, b], [b, a]]) {
      if (source.group !== 'vps') continue;
      for (const type of ['v4', 'v6']) if (source[type] && target[type])
        results.push({ source: source.id, target: target.id, type });
    }
  }
  return results;
}

function respond(res, body, type, extra = {}) {
  const data = Buffer.isBuffer(body) ? body : Buffer.from(body);
  res.writeHead(200, { 'Content-Type': type, 'Content-Length': data.length,
    'Content-Security-Policy': security, 'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-cache', ...extra });
  res.end(data);
}

function stats() {
  const stamp = Math.floor(Date.now() / 1000) - 30;
  return { current_ms: 55.2, avg_ms: 56.1, min_ms: 51.4, max_ms: 62.7, loss_pct: 0.2,
    current_loss_pct: 0, measurement_updated_at: stamp, rrd_updated_at: stamp,
    measurement_state: 'measured', stale_after_seconds: 600 };
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost'), p = url.pathname;
  if (p.startsWith('/api/')) requests[p] = (requests[p] || 0) + 1;
  if (p === '/api/nodes') return respond(res, JSON.stringify(nodes), 'application/json');
  if (p === '/api/stats-batch.json') {
    const selected = (url.searchParams.get('nodes') || '').split(',');
    const items = pairs(selected, url.searchParams.get('anchor')).map(pair => ({ ...pair, stats: stats() }));
    return respond(res, JSON.stringify({ items }), 'application/json');
  }
  if (p === '/api/stats') return respond(res, JSON.stringify(stats()), 'application/json');
  if (p === '/api/graph.png') {
    return respond(res, Number(url.searchParams.get('w')) <= 600 ? pngMobile : pngDesktop, 'image/png');
  }
  if (p === '/api/v2/series') {
    const source = url.searchParams.get('source'), target = url.searchParams.get('target');
    if (!nodeById.get(source) || !nodeById.get(target) || source === target || nodeById.get(source).group !== 'vps') {
      res.writeHead(400).end(); return;
    }
    const body = Buffer.from(JSON.stringify({ ...series, source, target, protocol: url.searchParams.get('type') }));
    const gzip = /(?:^|,)\s*gzip\b/.test(req.headers['accept-encoding'] || '');
    return respond(res, gzip ? zlib.gzipSync(body, { level: 3 }) : body, 'application/json',
      gzip ? { 'Content-Encoding': 'gzip', Vary: 'Accept-Encoding' } : { Vary: 'Accept-Encoding' });
  }
  if (p === '/chart-trial' || p === '/' || p === '/index.html') {
    const file = p === '/chart-trial' ? 'chart-trial.html' : 'index.html';
    return respond(res, fs.readFileSync(path.join(release, file)), 'text/html; charset=utf-8');
  }
  if (/^\/static\/assets\/[a-z-]+\.[0-9a-f]{16}\.(js|css)$/.test(p)) {
    const file = path.join(release, 'assets', path.basename(p));
    if (fs.existsSync(file)) return respond(res, fs.readFileSync(file), p.endsWith('.css') ? 'text/css' : 'text/javascript');
  }
  if (/^\/static\/fonts\/[A-Za-z-]+\.woff2$/.test(p)) {
    const file = path.join(root, 'web/fonts', path.basename(p));
    if (fs.existsSync(file)) return respond(res, fs.readFileSync(file), 'font/woff2');
  }
  res.writeHead(404, { 'Content-Length': '0' }).end();
});

async function waitFor(page, predicate, arg) {
  const handle = await page.waitForFunction(predicate, arg);
  await handle.dispose();
}

async function metrics(cdp) {
  await cdp.send('HeapProfiler.collectGarbage');
  const result = await cdp.send('Performance.getMetrics');
  return Object.fromEntries(result.metrics.filter(item =>
    ['JSHeapUsedSize', 'Nodes', 'JSEventListeners', 'Documents'].includes(item.name)).map(item => [item.name, item.value]));
}

async function touch(cdp, locator, position = null) {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  if (!box) throw Error('Touch target has no visible box');
  const x = box.x + (position?.x ?? box.width / 2);
  const y = box.y + (position?.y ?? box.height / 2);
  audit(`CDP touch ${locator.toString()} at CSS (${Math.round(x)}, ${Math.round(y)})`);
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x, y, radiusX: 1, radiusY: 1, force: 1, id: 0 }]
  });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

(async () => {
  let browser, page, reverseName;
  audit(`START local fixture QA, serial=${serial}; no ADB device-file operations (Chrome may update its ordinary cache/history)`);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const port = server.address().port;
    audit(`HOST fixture HTTP listen 127.0.0.1:${port}`);
    reverseName = `tcp:${port}`;
    onDevice(['reverse', reverseName, reverseName]);
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${process.env.ANDROID_CDP_PORT || 9222}`);
    audit(`CDP connected to Android Chrome ${browser.version()}`);
    const context = browser.contexts()[0];
    page = await context.newPage(); // Preserve every pre-existing tab.
    audit('CDP created one new QA tab; pre-existing tabs untouched');
    const cdp = await context.newCDPSession(page);
    const errors = [];
    page.on('pageerror', error => { errors.push(error.message); audit(`PAGE ERROR ${error.message}`); });
    await page.addInitScript(() => {
      window.qaCsp = [];
      document.addEventListener('securitypolicyviolation', event => qaCsp.push(event.violatedDirective));
    });
    const report = { serial, auditLog: 'test-results/android-device/operations.log',
      model: onDevice(['shell', 'getprop', 'ro.product.model']),
      android: onDevice(['shell', 'getprop', 'ro.build.version.release']),
      physicalSize: onDevice(['shell', 'wm', 'size']), density: onDevice(['shell', 'wm', 'density']),
      chrome: browser.version(), fixture: 'local synthetic RRD, not production', p2: {}, p3: {} };
    const origin = `http://127.0.0.1:${port}`;

    audit(`CDP navigate QA tab to ${origin}`);
    await page.goto(origin, { waitUntil: 'domcontentloaded' });
    await page.locator('#n_akari_jp').waitFor({ state: 'attached' });
    console.log('Android QA: P2 nodes loaded');
    report.p2.viewport = await page.evaluate(() => ({ width: innerWidth, dpr: devicePixelRatio,
      deviceMemory: navigator.deviceMemory ?? null, hardwareConcurrency: navigator.hardwareConcurrency ?? null }));
    await touch(cdp, page.locator('#toggleSidebar'));
    await waitFor(page, () => !document.getElementById('sidebar').inert);
    for (const id of ['akari_jp', 'datawave_akari_lax', 'google_dns']) {
      await touch(cdp, page.locator(`label[for="c_${id}"]`));
      await waitFor(page, id => document.getElementById(`c_${id}`).checked, id);
    }
    await page.locator('#goBtn').waitFor({ state: 'visible' });
    await waitFor(page, () => !document.getElementById('goBtn').disabled);
    await touch(cdp, page.locator('#goBtn'));
    await waitFor(page, () => document.querySelectorAll('.card').length === 8 &&
      [...document.querySelectorAll('.stat-primary .stat-value')].some(el => el.textContent.includes('55')));
    report.p2.results = await page.evaluate(() => ({ cards: document.querySelectorAll('.card').length,
      extBadges: document.querySelectorAll('.card .badge-ext').length,
      v6Badges: document.querySelectorAll('.card .badge-v6').length,
      overflow: document.documentElement.scrollWidth > innerWidth,
      statFontPx: parseFloat(getComputedStyle(document.querySelector('.stat-primary .stat-value')).fontSize),
      drawerInert: document.getElementById('sidebar').inert }));
    assert.equal(report.p2.results.overflow, false);
    assert.equal(report.p2.results.drawerInert, true);
    assert.equal(report.p2.results.cards, 8);
    assert.equal(report.p2.results.extBadges, 4);
    assert.equal(report.p2.results.v6Badges, 4);
    audit('CDP screenshot QA tab -> p2-results.png (host only)');
    await page.screenshot({ path: path.join(output, 'p2-results.png') });
    await page.locator('.badge-ext').first().scrollIntoViewIfNeeded();
    audit('CDP screenshot QA tab -> p2-ext-tags.png (host only)');
    await page.screenshot({ path: path.join(output, 'p2-ext-tags.png') });
    console.log('Android QA: P2 results verified');

    await touch(cdp, page.locator('#toggleSidebar'));
    await waitFor(page, () => !document.getElementById('sidebar').inert);
    audit('CDP screenshot QA tab -> p2-drawer.png (host only)');
    await page.screenshot({ path: path.join(output, 'p2-drawer.png') });
    await touch(cdp, page.locator('[data-mode="charts"]'));
    await touch(cdp, page.locator('#goBtn'));
    await page.locator('.card-img img.ok').first().waitFor();
    report.p2.charts = await page.evaluate(() => ({ images: document.querySelectorAll('.card-img img.ok').length,
      overflow: document.documentElement.scrollWidth > innerWidth }));
    assert.equal(report.p2.charts.overflow, false);
    audit('CDP screenshot QA tab -> p2-charts.png (host only)');
    await page.screenshot({ path: path.join(output, 'p2-charts.png') });
    await page.locator('.card-img img').last().scrollIntoViewIfNeeded();
    await waitFor(page, () => [...document.querySelectorAll('.card-img img')].every(img => img.complete && img.naturalWidth > 0));
    report.p2.charts.imagesAfterScroll = await page.locator('.card-img img.ok').count();
    assert.equal(report.p2.charts.imagesAfterScroll, 8);
    audit('CDP screenshot QA tab -> p2-chart-last.png (host only)');
    await page.screenshot({ path: path.join(output, 'p2-chart-last.png') });
    console.log('Android QA: P2 charts verified');

    audit(`CDP navigate QA tab to ${origin}/chart-trial`);
    await page.goto(origin + '/chart-trial', { waitUntil: 'domcontentloaded' });
    await page.locator('#load').waitFor();
    await waitFor(page, () => !document.getElementById('load').disabled);
    audit('CDP select QA fixture source=akari_jp, target=google_dns, duration=86400');
    await page.locator('#source').selectOption('akari_jp');
    await page.locator('#target').selectOption('google_dns');
    await page.locator('#duration').selectOption('86400');
    await touch(cdp, page.locator('#load'));
    await page.locator('canvas').waitFor();
    report.p3.canvas = await page.evaluate(() => {
      const canvas = document.querySelector('canvas');
      return { width: innerWidth, dpr: devicePixelRatio,
        backingPixels: canvas.width * canvas.height,
        budget: 1280 * 280 * 4,
        maxMedianMs: ChartTrial.snapshot.summary.max_median_ms,
        gaps: ChartTrial.snapshot.bins.filter(b => b.missing_latency_count > 0).length,
        overflow: document.documentElement.scrollWidth > innerWidth,
        canvasCount: document.querySelectorAll('canvas').length };
    });
    assert.ok(report.p3.canvas.backingPixels <= report.p3.canvas.budget);
    assert.equal(report.p3.canvas.overflow, false);
    assert.equal(report.p3.canvas.maxMedianMs, 999);
    await page.locator('#plot').scrollIntoViewIfNeeded();
    audit('CDP screenshot QA tab -> p3-canvas.png (host only)');
    await page.screenshot({ path: path.join(output, 'p3-canvas.png') });
    console.log('Android QA: P3 canvas verified');

    const beforeReadout = await page.locator('#point-readout').innerText();
    await touch(cdp, page.locator('#cursor'), { x: 30, y: 20 });
    report.p3.touchInspectorChanged = (await page.locator('#point-readout').innerText()) !== beforeReadout;
    assert.equal(report.p3.touchInspectorChanged, true);
    await touch(cdp, page.locator('#details summary'));
    await waitFor(page, () => document.querySelectorAll('#rows tr').length === 50);
    await touch(cdp, page.locator('#next'));
    report.p3.table = { rows: await page.locator('#rows tr').count(), page: await page.locator('#page-label').innerText() };
    assert.match(report.p3.table.page, /^2 /);
    await touch(cdp, page.locator('#details summary'));
    await touch(cdp, page.locator('#png-mode'));
    await page.locator('#plot img').waitFor();
    report.p3.pngLoaded = await page.locator('#plot img').evaluate(img => img.complete && img.naturalWidth > 0);
    assert.equal(report.p3.pngLoaded, true);
    await page.locator('#plot').scrollIntoViewIfNeeded();
    audit('CDP screenshot QA tab -> p3-png.png (host only)');
    await page.screenshot({ path: path.join(output, 'p3-png.png') });
    await touch(cdp, page.locator('#canvas-mode'));
    await page.locator('canvas').waitFor();

    await cdp.send('Performance.enable');
    report.p3.beforeCycles = await metrics(cdp);
    report.p3.reloadMs = [];
    report.p3.cycleMetrics = [];
    const cycles = Number(process.env.ANDROID_CYCLES || 20);
    if (!Number.isInteger(cycles) || cycles < 1 || cycles > 300) throw Error('ANDROID_CYCLES must be 1..300');
    report.p3.cycles = cycles;
    audit(`CDP begin ${cycles} repeated fixture submissions (no production requests)`);
    for (let i = 0; i < cycles; i++) {
      const start = Date.now();
      const previousRequests = requests['/api/v2/series'] || 0;
      await touch(cdp, page.locator('#load'));
      await waitFor(page, () => ChartTrial.snapshot !== null && ChartTrial.instanceCount === 1);
      await page.locator('canvas').waitFor();
      assert.ok((requests['/api/v2/series'] || 0) > previousRequests);
      report.p3.reloadMs.push(Date.now() - start);
      if ((i + 1) % 20 === 0) {
        const sample = { cycles: i + 1, ...await metrics(cdp) };
        report.p3.cycleMetrics.push(sample);
        audit(`CDP progress ${i + 1}/${cycles}: nodes=${sample.Nodes}, listeners=${sample.JSEventListeners}, heap=${sample.JSHeapUsedSize}`);
      }
    }
    report.p3.afterCycles = await metrics(cdp);
    assert.ok(report.p3.afterCycles.Nodes <= report.p3.beforeCycles.Nodes + 100);
    assert.ok(report.p3.afterCycles.JSEventListeners <= report.p3.beforeCycles.JSEventListeners + 20);
    report.p3.reloadMs.sort((a, b) => a - b);
    report.p3.medianTapToCanvasMs = report.p3.reloadMs[Math.floor((cycles - 1) / 2)];
    report.p3.p95TapToCanvasMs = report.p3.reloadMs[Math.ceil(cycles * 0.95) - 1];
    report.requests = requests;
    report.pageErrors = errors;
    report.cspViolations = await page.evaluate(() => qaCsp);
    assert.deepEqual(errors, []);
    assert.deepEqual(report.cspViolations, []);
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
    audit('HOST wrote report.json; QA completed');
    console.log(JSON.stringify({ report: path.join(output, 'report.json'), cycles,
      p2: report.p2, p3: { ...report.p3, reloadMs: '[see report.json]' },
      pageErrors: errors, cspViolations: report.cspViolations }, null, 2));
  } finally {
    if (page) { audit('CDP close only QA-created tab'); await page.close().catch(() => {}); }
    if (browser) await browser.close().catch(() => {});
    if (reverseName) { try { onDevice(['reverse', '--remove', reverseName]); } catch (_) {} }
    server.closeAllConnections();
    server.close();
    audit('END fixture server closed; temporary reverse mapping cleanup attempted');
  }
})().catch(error => { audit(`FAIL ${error.stack || error}`); console.error(error); process.exitCode = 1; });
