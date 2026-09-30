/* Chrome memory isolation without Playwright's Network instrumentation. Local fixtures only. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const releaseRoot = process.env.TEST_RELEASE_ROOT || 'build/web-release';
assert.match(releaseRoot, /^build\/web-release(?:-[a-z0-9-]+)?$/);
const networkInspector = process.env.CDP_NETWORK || 'off';
assert.ok(['off', 'default', 'zero-buffer'].includes(networkInspector));
const soakSeconds = Number(process.env.SOAK_SECONDS || 720);
assert.ok(Number.isInteger(soakSeconds) && soakSeconds >= 60 && soakSeconds <= 7200);
const viewport = { width: Number(process.env.SOAK_WIDTH || 1800), height: 900, deviceScaleFactor: 1 };
assert.ok([1440, 1800].includes(viewport.width));
const label = process.env.SOAK_LABEL || 'diagnostic';
assert.match(label, /^[a-z0-9-]+$/);
const scrollPath = process.env.SOAK_PATH || 'three-positions';
assert.ok(['three-positions', 'sweep'].includes(scrollPath));
const seriesPoints = Number(process.env.MATRIX_SERIES_POINTS || 2);
assert.ok([2, 120].includes(seriesPoints));
const manifestBytes = fs.readFileSync(path.join(root, releaseRoot, 'manifest.json'));
const manifest = JSON.parse(manifestBytes);
const chartAsset = Object.keys(manifest.assets).find(name => name.startsWith('chart-matrix-trial.') && name.endsWith('.js'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

class Protocol {
  constructor(url) {
    this.socket = new WebSocket(url);
    this.nextId = 0; this.pending = new Map(); this.listeners = [];
    this.ready = new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, { once: true });
      this.socket.addEventListener('error', reject, { once: true });
    });
    this.socket.addEventListener('message', event => {
      const message = JSON.parse(String(event.data));
      if (message.id) {
        const item = this.pending.get(message.id);
        if (!item) return;
        clearTimeout(item.timer); this.pending.delete(message.id);
        if (message.error) item.reject(new Error(item.method + ': ' + message.error.message));
        else item.resolve(message.result);
      } else for (const listener of this.listeners) listener(message);
    });
    this.socket.addEventListener('close', () => {
      for (const item of this.pending.values()) { clearTimeout(item.timer); item.reject(new Error('Chrome protocol closed')); }
      this.pending.clear();
    });
  }
  async send(method, params = {}, sessionId) {
    await this.ready;
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id); reject(new Error('CDP timed out: ' + method));
      }, 45000);
      this.pending.set(id, { resolve, reject, timer, method });
      this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }
}

async function privateMemory(protocol) {
  const info = await protocol.send('SystemInfo.getProcessInfo');
  const ids = info.processInfo.map(item => item.id).filter(id => Number.isInteger(id) && id > 0);
  const raw = execFileSync('powershell.exe', ['-NoProfile', '-Command',
    `$p4Ids=@(${ids.join(',')}); Get-Process -Id $p4Ids -ErrorAction SilentlyContinue | ` +
    'Select-Object Id,PrivateMemorySize64 | ConvertTo-Json -Compress'], { encoding: 'utf8', timeout: 10000 }).trim();
  const values = JSON.parse(raw), rows = Array.isArray(values) ? values : [values];
  const types = new Map(info.processInfo.map(item => [item.id, item.type]));
  const privateByType = {};
  for (const row of rows) {
    const type = types.get(row.Id) || 'unknown';
    privateByType[type] = (privateByType[type] || 0) + row.PrivateMemorySize64;
  }
  return { privateByType, processPrivateBytes: rows.reduce((sum, row) => sum + row.PrivateMemorySize64, 0),
    gpuPrivateBytes: privateByType.GPU || 0 };
}

(async () => {
  assert.equal(process.platform, 'win32', 'this process-memory driver targets the installed Windows Chrome');
  const chromePath = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
  assert.ok(fs.existsSync(chromePath));
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ipppping-cdp-soak-'));
  const fixture = spawn(process.execPath, [path.join(__dirname, 'chart-matrix-browser.cjs')], {
    cwd: root, env: { ...process.env, TEST_RELEASE_ROOT: releaseRoot, MATRIX_FIXTURE_ONLY: '1' },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true
  });
  let protocol, chrome, fixtureError = '', chromeError = '';
  fixture.stderr.on('data', chunk => { fixtureError = (fixtureError + chunk).slice(-4096); });
  try {
    const origin = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('fixture startup timed out: ' + fixtureError)), 15000);
      fixture.on('message', message => { if (message.type === 'ready') { clearTimeout(timer); resolve(message.origin); } });
      fixture.once('exit', code => { clearTimeout(timer); reject(new Error('fixture exited: ' + code + ' ' + fixtureError)); });
    });
    chrome = spawn(chromePath, ['--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + profile,
      '--window-size=' + viewport.width + ',900', '--no-first-run', '--no-default-browser-check', '--disable-extensions',
      '--disable-background-networking', '--disable-component-update', '--disable-default-apps', '--disable-sync',
      '--disable-client-side-phishing-detection', '--disable-hang-monitor', '--disable-popup-blocking',
      '--metrics-recording-only', '--enable-automation', '--password-store=basic', '--no-startup-window'],
    { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    chrome.stderr.on('data', chunk => { chromeError = (chromeError + chunk).slice(-4096); });
    const portFile = path.join(profile, 'DevToolsActivePort');
    const launched = Date.now();
    while (!fs.existsSync(portFile)) {
      if (Date.now() - launched > 15000 || chrome.exitCode !== null) throw new Error('Chrome startup failed: ' + chromeError);
      await wait(100);
    }
    const [port, socketPath] = fs.readFileSync(portFile, 'utf8').trim().split(/\r?\n/);
    protocol = new Protocol('ws://127.0.0.1:' + port + socketPath);
    const browser = await protocol.send('Browser.getVersion');
    const { targetId } = await protocol.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await protocol.send('Target.attachToTarget', { targetId, flatten: true });
    const send = (method, params) => protocol.send(method, params, sessionId);
    const errors = [];
    protocol.listeners.push(message => {
      if (message.sessionId === sessionId && message.method === 'Runtime.exceptionThrown')
        errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
    });
    await send('Runtime.enable'); await send('Page.enable'); await send('Performance.enable');
    await send('Emulation.setDeviceMetricsOverride', { ...viewport, mobile: false });
    if (networkInspector !== 'off') await send('Network.enable', networkInspector === 'zero-buffer'
      ? { maxTotalBufferSize: 0, maxResourceBufferSize: 0 } : {});
    const evaluate = async expression => {
      const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
      return result.result.value;
    };
    const until = async expression => {
      const started = Date.now();
      while (!(await evaluate(expression))) {
        if (Date.now() - started > 45000) throw new Error('page did not settle: ' + expression);
        await wait(50);
      }
    };
    await send('Page.navigate', { url: origin + '/chart-matrix-trial' });
    await until("document.querySelectorAll('.node').length === 20");
    await evaluate("document.fonts.ready.then(() => true)");
    await evaluate(`(() => {
      for (let i = 0; i < 16; i++) document.querySelector('.node[data-node-id="v' + i + '"] .node-select').click();
      document.querySelector('[data-mode="charts"]').click(); document.getElementById('goBtn').click();
    })()`);
    const ready = "document.getElementById('trialStatus').textContent.startsWith('Ready: 480 routes')";
    const settled = ready + " && ChartMatrixTrial.instanceCount > 0 && ChartMatrixTrial.pendingCount === 0 && " +
      "document.querySelectorAll('.trial-reveal').length === 0 && document.getAnimations().length === 0";
    await until(settled);
    assert.equal(await evaluate("document.querySelectorAll('.card').length"), 480);
    if (viewport.width === 1800) assert.equal(await evaluate('ChartMatrixTrial.instanceCount + ChartMatrixTrial.pooledCount'), 4);
    const report = { driver: 'direct-cdp', browser: browser.product, networkInspector, viewport,
      soakSeconds, soakPattern: 'scroll', scrollPath, seriesPoints,
      soakView: 'charts', soakRender: 'normal', soakMotion: 'normal',
      releaseRoot, releaseManifestSha256: hash(manifestBytes), chartAsset,
      fixtureHarnessSha256: hash(fs.readFileSync(path.join(__dirname, 'chart-matrix-browser.cjs'))),
      harnessSha256: hash(fs.readFileSync(__filename)), complete: false,
      cycles: 0, submits: 0, submitMs: [], samples: [], errors, visitedRoutes: 0 };
    const visitedRoutes = new Set();
    const destination = path.join(root, 'test-results', `p4-matrix-cdp-soak-${soakSeconds}s-${networkInspector}-${label}.json`);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    const sample = async elapsed => {
      // Fix the sampling phase before the run: measure settled charts, not a transient reveal.
      await until(settled); await send('HeapProfiler.collectGarbage');
      const [dom, perf, client, memory] = await Promise.all([
        send('Memory.getDOMCounters'), send('Performance.getMetrics'),
        evaluate(`({ instances: ChartMatrixTrial.instanceCount, pooled: ChartMatrixTrial.pooledCount,
          allocations: ChartMatrixTrial.chartAllocations, backingPixels: ChartMatrixTrial.backingPixels,
          cache: ChartMatrixTrial.cacheCount, cacheBytes: ChartMatrixTrial.cacheBytes, pending: ChartMatrixTrial.pendingCount,
          canvases: document.querySelectorAll('canvas').length,
          pixels: [...document.querySelectorAll('canvas')].reduce((n,c) => n+c.width*c.height,0),
          animations: document.getAnimations().length,
          scrollTop: document.getElementById('mainArea').scrollTop,
          routeIndexes: [...document.querySelectorAll('canvas')].map(c => Number(c.closest('.card').dataset.index)) })`), privateMemory(protocol)
      ]);
      const row = { elapsed, ...dom, heap: perf.metrics.find(item => item.name === 'JSHeapUsedSize').value, ...client, ...memory };
      assert.ok(row.instances + row.pooled <= 4 && row.cache <= 16 && row.cacheBytes <= 2 * 1024 * 1024 &&
        row.backingPixels <= 4 * 1280 * 220 * 4 && row.pending <= 4 && row.canvases <= 4 && errors.length === 0);
      report.samples.push(row);
      fs.writeFileSync(destination, JSON.stringify(report, null, 2));
      console.log(JSON.stringify({ minutes: +(elapsed / 60000).toFixed(1), rendererMiB: +(memory.privateByType.renderer / 1048576).toFixed(2),
        heapMiB: +(row.heap / 1048576).toFixed(2), canvases: row.canvases, networkInspector }));
    };
    const started = Date.now(); let previousSample = 0;
    await sample(0);
    while (Date.now() - started < soakSeconds * 1000) {
      await evaluate(`(() => {
        const main=document.getElementById('mainArea'), max=main.scrollHeight-main.clientHeight;
        const step=main.clientHeight*.6, count=Math.ceil(max/step), position=${report.cycles}%(2*count);
        main.scrollTop=${scrollPath === 'sweep' ? 'Math.min(max,(position<=count?position:2*count-position)*step)' : (report.cycles % 3) / 2 + '*max'};
      })()`);
      await wait(2000);
      const routes = await evaluate("[...document.querySelectorAll('canvas')].map(c => Number(c.closest('.card').dataset.index))");
      routes.forEach(index => visitedRoutes.add(index)); report.visitedRoutes = visitedRoutes.size;
      if (report.cycles % 30 === 29) {
        const submittedAt = Date.now();
        await evaluate("document.getElementById('goBtn').click()"); await until(ready);
        report.submitMs.push(Date.now() - submittedAt); report.submits++;
      }
      const elapsed = Date.now() - started;
      if (elapsed - previousSample >= 60000) { await sample(elapsed); previousSample = elapsed; }
      report.cycles++;
    }
    await sample(Date.now() - started);
    const requests = await new Promise(resolve => {
      const listener = message => { if (message.type === 'metrics') { fixture.removeListener('message', listener); resolve(message); } };
      fixture.on('message', listener); fixture.send({ type: 'metrics' });
    });
    Object.assign(report, { summaryRequests: requests.summaryRequests, seriesRequests: requests.seriesRequests, complete: true });
    if (scrollPath === 'sweep') assert.ok(visitedRoutes.size >= 400, 'the sweep must inspect most matrix routes');
    if (networkInspector !== 'off') {
      await send('Network.disable'); await send('HeapProfiler.collectGarbage'); await wait(1000);
      report.afterNetworkDisable = await privateMemory(protocol);
    }
    fs.writeFileSync(destination, JSON.stringify(report, null, 2));
    console.log('Completed report: ' + destination);
  } finally {
    if (protocol) {
      try { await protocol.send('Browser.close'); } catch {}
      protocol.socket.close();
    }
    if (chrome && chrome.exitCode === null) {
      await Promise.race([new Promise(resolve => chrome.once('exit', resolve)), wait(5000)]);
      if (chrome.exitCode === null) chrome.kill();
    }
    if (fixture.exitCode === null) fixture.kill();
    // Only this driver's newly created, absolute temporary profile is removed.
    assert.equal(path.dirname(profile), path.resolve(os.tmpdir()));
    assert.ok(path.basename(profile).startsWith('ipppping-cdp-soak-'));
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 15, retryDelay: 200 });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
