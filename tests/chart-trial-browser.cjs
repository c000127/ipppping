/* Isolated P3 browser lab. Python fixture -> v2 JSON -> real vendored uPlot. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const zlib = require('node:zlib');
const { execFileSync } = require('node:child_process');
const engine = process.env.BROWSER_ENGINE || 'chromium';
const browserType = require('playwright')[engine];
const root = path.resolve(__dirname, '..');
const out = path.join(root, `test-results/p3-${engine}`); fs.mkdirSync(out, { recursive: true });
const fixture = process.env.REAL_RRD_FIXTURE
  ? JSON.parse(fs.readFileSync(path.join(root, 'test-results/p3/rrd-24h-columns.json'), 'utf8'))
  : JSON.parse(execFileSync(process.env.PYTHON || 'python', ['-c', `import json,time
from test_series_v2 import fixture
from series_contract import snapshot,response
end=int(time.time())//60*60
values=[(10,0)]*1440
values[100]=(999,25)
values[101]=(None,100)
values[102]=(None,None)
latest={'rrd_updated_at':end,'measurement_updated_at':end,'current_ms':10,'current_loss_pct':0,'measurement_state':'measured'}
print(json.dumps(response(snapshot(fixture(values,start=end-86400),latest,end-86400,end,end),720,encoding='columns')))`], { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }));
async function waitFor(page, predicate) {
  const handle = await page.waitForFunction(predicate);
  await handle.dispose();
}
const nodes = [{ id: 'src', label: 'Source VPS', group: 'vps', v4: true, v6: true }, { id: 'ext', label: 'External Target', group: 'dns', v4: true, v6: true }];
let scenario = 'normal', requests = [], active = 0, peak = 0;
const csp = "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; font-src 'self'";
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://local'), pathname = url.pathname;
  res.setHeader('Content-Security-Policy', csp);
  if (pathname === '/api/nodes') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(nodes)); return; }
  if (pathname.startsWith('/api/')) {
    requests.push(pathname); peak = Math.max(peak, ++active);
    const mode = scenario;
    await new Promise(resolve => setTimeout(resolve, mode === 'slow' ? 400 : 40));
    active--;
    if (mode === 'busy') { res.writeHead(503, { 'Retry-After': '2' }).end('{}'); return; }
    if (pathname.endsWith('.png')) {
      res.setHeader('Content-Type', 'image/png');
      res.end(process.env.REAL_RRD_FIXTURE
        ? fs.readFileSync(path.join(root, 'test-results/p3/rrd-24h.png'))
        : Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=', 'base64'));
      return;
    }
    res.setHeader('Content-Type', 'application/json');
    if (mode === 'malformed') { res.end('{broken'); return; }
    const data = structuredClone(fixture);
    data.snapshot_id = url.searchParams.get('dur');
    const body = Buffer.from(JSON.stringify(data));
    if (process.env.GZIP_FIXTURE) {
      res.setHeader('Content-Encoding', 'gzip');
      res.setHeader('Vary', 'Accept-Encoding');
      res.end(zlib.gzipSync(body));
    } else res.end(body);
    return;
  }
  const relative = pathname === '/chart-trial' ? 'build/web-release/chart-trial.html'
    : pathname.startsWith('/static/assets/') ? 'build/web-release/assets/' + path.basename(pathname)
    : pathname.startsWith('/static/fonts/') ? 'web/fonts/' + path.basename(pathname) : null;
  if (!relative) { res.writeHead(404).end(); return; }
  try {
    res.setHeader('Content-Type', relative.endsWith('.js') ? 'text/javascript' : relative.endsWith('.css') ? 'text/css' : relative.endsWith('.html') ? 'text/html' : 'font/woff2');
    res.end(fs.readFileSync(path.join(root, relative)));
  } catch { res.writeHead(404).end(); }
});

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await browserType.launch({ headless: true, ...(engine === 'chromium' && process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : {}) });
  const report = { browser: browser.version(), mocked: true,
    fixture: process.env.REAL_RRD_FIXTURE ? 'synthetic RRDtool RRD' : 'pure Python buckets',
    gzipResponse: !!process.env.GZIP_FIXTURE, cases: [], samples: [] };
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    if (process.env.RUN_AXE) await page.addInitScript({ path: path.join(root, 'build/qa-deps/package/axe.min.js') });
    const errors = [], violations = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      window.cspViolations = [];
      document.addEventListener('securitypolicyviolation', event => window.cspViolations.push(event.violatedDirective));
      window.globalListeners = [];
      const add = EventTarget.prototype.addEventListener, remove = EventTarget.prototype.removeEventListener;
      EventTarget.prototype.addEventListener = function(type, listener, ...args) {
        if (this === window || this === document) globalListeners.push({ target: this === window ? 'window' : 'document', type, listener, stack: new Error().stack });
        return add.call(this, type, listener, ...args);
      };
      EventTarget.prototype.removeEventListener = function(type, listener, ...args) {
        if (this === window || this === document) {
          const index = globalListeners.findIndex(x => x.target === (this === window ? 'window' : 'document') && x.type === type && x.listener === listener);
          if (index >= 0) globalListeners.splice(index, 1);
        }
        return remove.call(this, type, listener, ...args);
      };
    });
    const url = `http://127.0.0.1:${server.address().port}/chart-trial`;
    await page.goto(url); await waitFor(page, () => !document.getElementById('load').disabled);
    assert.equal(requests.length, 0);
    assert.equal(await page.locator('#source option').count(), 1);
    if (process.env.REAL_RRD_FIXTURE) await page.locator('#duration').selectOption('86400');
    await page.locator('#load').click();
    await page.locator('canvas').waitFor();
    assert.equal(await page.evaluate(() => ChartTrial.instanceCount), 1);
    assert.equal(await page.evaluate(() => ChartTrial.snapshot.summary.max_median_ms), 999);
    assert.ok(await page.evaluate(() => {
      const canvas = document.querySelector('canvas');
      const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, Math.floor(canvas.height / 3)).data;
      let purple = 0;
      for (let i = 0; i < pixels.length; i += 4) if (pixels[i] > 150 && pixels[i + 2] > pixels[i] + 25 && pixels[i + 1] < pixels[i]) purple++;
      return purple > 0;
    }), 'isolated spike extremum is visibly drawn, even beside a missing bucket');
    assert.ok(await page.evaluate(() => ChartTrial.snapshot.bins.some(b => b.missing_latency_count > 0 && b.median_mean_ms === null)));
    if (process.env.RUN_AXE) {
      const audit = await page.evaluate(async () => (await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa'] } })).violations.map(v => ({ id:v.id, impact:v.impact, targets:v.nodes.map(n=>n.target) })));
      report.axe = audit;
      fs.writeFileSync(path.join(out, 'axe.json'), JSON.stringify(audit, null, 2));
      assert.deepEqual(audit, []);
    }
    await page.locator('#cursor').focus();
    const before = await page.locator('#cursor').inputValue();
    await page.keyboard.press('ArrowLeft');
    assert.equal(Number(await page.locator('#cursor').inputValue()), Number(before) - 1);
    await page.locator('#details summary').click();
    await waitFor(page, () => document.querySelectorAll('#rows tr').length === 50);
    assert.equal(await page.locator('#rows tr').count(), 50);
    await page.locator('#next').click();
    assert.match(await page.locator('#page-label').textContent(), /^2 /);
    await page.locator('#details summary').click();
    await waitFor(page, () => document.querySelectorAll('#rows tr').length === 0);
    assert.equal(await page.locator('#rows tr').count(), 0);
    report.cases.push('no-prefetch / legal sources / spike-gap-loss / keyboard inspection / bounded table');
    for (const width of [320,390,768,1440,1800]) {
      await page.setViewportSize({ width, height: 900 }); await page.waitForTimeout(100);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      assert.ok(await page.evaluate(() => [...document.querySelectorAll('canvas')].reduce((n,c) => n+c.width*c.height, 0)) <= 1280*280*4);
      if (!process.env.SKIP_SCREENSHOTS) await page.screenshot({ path: path.join(out, `canvas-${width}.png`), fullPage: true, caret: 'initial' });
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    for (let i = 0; i < 30; i++) {
      const start = Date.now(); await page.locator('#load').click();
      await waitFor(page, () => ChartTrial.snapshot && ChartTrial.instanceCount === 1);
      report.samples.push(Date.now() - start);
      assert.equal(await page.locator('canvas').count(), 1);
    }
    report.cases.push('30 submissions retain exactly one canvas');
    report.globalListeners = await page.evaluate(() => Object.fromEntries([...new Set(globalListeners.map(x => x.type))].map(type => [type, globalListeners.filter(x => x.type === type).length])));
    await page.locator('#png-mode').click(); await page.locator('#plot img').waitFor();
    assert.equal(await page.locator('canvas').count(), 0);
    if (process.env.REAL_RRD_FIXTURE && !process.env.SKIP_SCREENSHOTS)
      await page.screenshot({ path: path.join(out, 'png-comparison.png') });
    await page.locator('#canvas-mode').click(); await page.locator('canvas').waitFor();
    report.cases.push('explicit PNG fallback / canvas destruction');
    scenario = 'busy'; requests = [];
    await page.locator('#load').click(); await waitFor(page, () => document.getElementById('status').textContent.includes('HTTP 503'));
    await page.waitForTimeout(300);
    assert.deepEqual(requests, ['/api/v2/series']);
    scenario = 'malformed'; await page.locator('#load').click();
    await waitFor(page, () => !document.getElementById('status').textContent.includes('Loading a new'));
    assert.equal(await page.locator('canvas').count(), 0);
    scenario = 'slow';
    await page.locator('#duration').selectOption('3600'); await page.locator('#load').click();
    scenario = 'normal';
    await page.locator('#duration').selectOption('86400'); await page.locator('#load').click();
    await waitFor(page, () => ChartTrial.snapshot?.snapshot_id === '86400');
    await page.waitForTimeout(450);
    assert.equal(await page.evaluate(() => ChartTrial.snapshot.snapshot_id), '86400');
    report.cases.push('503 no fallback storm / malformed / cancelled-generation isolation');
    await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); });
    assert.equal(await page.locator('canvas').count(), 0);
    const count = requests.length;
    await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: false }); document.dispatchEvent(new Event('visibilitychange')); });
    await page.locator('canvas').waitFor();
    assert.equal(requests.length, count);
    report.cases.push('simulated visibility lifecycle, no background refetch');
    violations.push(...await page.evaluate(() => window.cspViolations));
    for (const [dpr, width] of [[1.5,390],[2,390],[3,390],[4,390],[2.07,1440],[2.625,1440],[3.33,1440]]) {
      const context = await browser.newContext({ viewport: { width, height: 844 }, deviceScaleFactor: dpr, hasTouch: true });
      const p = await context.newPage(); await p.goto(url); await waitFor(p, () => !document.getElementById('load').disabled);
      await p.locator('#load').tap();
      await waitFor(p, () => ChartTrial.snapshot !== null);
      await p.locator('canvas').waitFor();
      assert.ok(await p.evaluate(() => [...document.querySelectorAll('canvas')].reduce((n,c) => n+c.width*c.height, 0)) <= 1280*280*4);
      await context.close();
    }
    report.cases.push('mobile DPR 1.5 / 2 / 3 / 4 and fractional desktop DPR within pixel budget');
    if (process.env.SOAK_FAST_CYCLES) {
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Performance.enable');
      report.fastSoak = [];
      for (let i = 0; i < Number(process.env.SOAK_FAST_CYCLES); i++) {
        await page.locator('#load').click(); await waitFor(page, () => ChartTrial.snapshot && ChartTrial.instanceCount === 1);
        await page.locator('#png-mode').click(); await page.locator('#plot img').waitFor();
        await page.locator('#canvas-mode').click(); await page.locator('canvas').waitFor();
        if (i % 50 === 0 || i === Number(process.env.SOAK_FAST_CYCLES) - 1) {
          await cdp.send('HeapProfiler.collectGarbage');
          const m = await cdp.send('Performance.getMetrics');
          report.fastSoak.push({ cycle: i + 1, ...Object.fromEntries(m.metrics.filter(x => ['Nodes','JSEventListeners','JSHeapUsedSize'].includes(x.name)).map(x => [x.name,x.value])) });
          console.log('fast soak', JSON.stringify(report.fastSoak.at(-1)));
        }
      }
    }
    if (process.env.SOAK_MINUTES) {
      const minutes = Number(process.env.SOAK_MINUTES);
      if (!(minutes > 0 && minutes <= 60) || engine !== 'chromium') throw Error('Soak requires Chromium, 0 < minutes <= 60');
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Performance.enable');
      report.soak = { requestedMinutes: minutes, checkpoints: [], cycles: 0 };
      const start = Date.now(); let nextCheckpoint = 0;
      while (Date.now() - start < minutes * 60000) {
        await page.locator('#load').click();
        await waitFor(page, () => ChartTrial.snapshot && ChartTrial.instanceCount === 1);
        await page.locator('#details summary').click();
        await waitFor(page, () => document.querySelectorAll('#rows tr').length > 0);
        await page.locator('#details summary').click();
        await page.locator('#png-mode').click(); await page.locator('#plot img').waitFor();
        await page.locator('#canvas-mode').click(); await page.locator('canvas').waitFor();
        report.soak.cycles++;
        if (Date.now() - start >= nextCheckpoint) {
          await cdp.send('HeapProfiler.collectGarbage');
          const metrics = await cdp.send('Performance.getMetrics');
          const point = { seconds: Math.round((Date.now() - start) / 1000), ...Object.fromEntries(metrics.metrics.filter(m => ['JSHeapUsedSize','Nodes','Documents','JSEventListeners'].includes(m.name)).map(m => [m.name,m.value])) };
          report.soak.checkpoints.push(point);
          console.log('soak checkpoint', JSON.stringify(point));
          nextCheckpoint += 60000;
        }
        assert.equal(await page.locator('canvas').count(), 1);
        assert.ok(await page.locator('#rows tr').count() <= 50);
        fs.writeFileSync(path.join(out, 'soak-progress.json'), JSON.stringify(report.soak, null, 2));
        await page.waitForTimeout(5000);
      }
      report.soak.elapsedSeconds = (Date.now() - start) / 1000;
      const warmed = report.soak.checkpoints.slice(2);
      if (warmed.length >= 3) {
        assert.ok(warmed.at(-1).JSHeapUsedSize <= warmed[0].JSHeapUsedSize + 2 * 1024 * 1024, 'retained heap growth exceeds 2 MiB');
        assert.ok(warmed.at(-1).Nodes <= warmed[0].Nodes + 100, 'DOM growth');
        assert.ok(warmed.at(-1).JSEventListeners <= warmed[0].JSEventListeners + 20, 'listener growth');
      }
    }
    assert.deepEqual(errors, []); assert.deepEqual(violations, []);
    assert.ok(peak <= 4);
    report.peakServerRequests = peak; report.samples.sort((a,b) => a-b);
    report.medianMs = report.samples[14]; report.p95Ms = report.samples[28];
    fs.writeFileSync(path.join(out, 'browser-report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } finally { await browser.close(); server.close(); }
})().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
