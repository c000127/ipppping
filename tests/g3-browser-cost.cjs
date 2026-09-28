/* Low-rate, read-only Chrome cost audit of the deployed single-route trial.
 * The page's PNG button first needs a v2 snapshot; phases are reported
 * separately and must not be treated as a complete PNG-main-page benchmark.
 */
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { chromium } = require('playwright');

const origin = 'https://ipppping.hachimihaqile.top';
const rounds = Number(process.env.G3_ROUNDS || 30);
assert.ok(Number.isInteger(rounds) && rounds >= 1 && rounds <= 60);
const mode = process.env.G3_MODE || 'switch';
assert.ok(['switch', 'canvas-only', 'png-only'].includes(mode));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const resultName = process.env.G3_MODE || process.env.G3_ROUNDS
  ? `browser-cost-${mode}-${rounds}-rounds.json` : 'browser-cost.json';
const resultPath = path.resolve(__dirname, '../test-results/g3', resultName);
const metricNames = ['TaskDuration', 'ScriptDuration', 'LayoutDuration', 'RecalcStyleDuration',
  'JSHeapUsedSize', 'Nodes', 'Documents', 'JSEventListeners'];

async function waitFor(page, predicate, argument) {
  const handle = await page.waitForFunction(predicate, argument);
  await handle.dispose();
}

function percentile(values, fraction) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * fraction) - 1];
}

async function metrics(session) {
  const result = await session.send('Performance.getMetrics');
  return Object.fromEntries(result.metrics.filter(m => metricNames.includes(m.name))
    .map(m => [m.name, m.value]));
}

async function processCpu(session) {
  if (!session) return null;
  const result = await session.send('SystemInfo.getProcessInfo');
  return result.processInfo.reduce((sum, item) => sum + (item.cpuTime || 0), 0);
}

async function processMemory(session) {
  if (!session || process.platform !== 'win32') return null;
  const result = await session.send('SystemInfo.getProcessInfo');
  const ids = result.processInfo.map(item => item.id).filter(id => Number.isInteger(id) && id > 0);
  if (!ids.length) return null;
  const script = `$ids=@(${ids.join(',')}); Get-Process -Id $ids -ErrorAction SilentlyContinue | `
    + 'Select-Object Id,WorkingSet64,PrivateMemorySize64,PeakWorkingSet64 | ConvertTo-Json -Compress';
  const raw = execFileSync('powershell.exe', ['-NoProfile', '-Command', script], { encoding: 'utf8', timeout: 10000 }).trim();
  if (!raw) return null;
  const rows = JSON.parse(raw);
  const list = Array.isArray(rows) ? rows : [rows];
  const processTypes = new Map(result.processInfo.map(item => [item.id, item.type]));
  return {
    processCount: list.length,
    workingSetBytes: list.reduce((n, row) => n + (row.WorkingSet64 || 0), 0),
    privateBytes: list.reduce((n, row) => n + (row.PrivateMemorySize64 || 0), 0),
    summedProcessPeakWorkingSetBytes: list.reduce((n, row) => n + (row.PeakWorkingSet64 || 0), 0),
    processes: list.map(row => ({ type: processTypes.get(row.Id), id: row.Id,
      workingSetBytes: row.WorkingSet64, privateBytes: row.PrivateMemorySize64 })),
  };
}

async function phase(page, session, browserSession, action) {
  const before = await metrics(session);
  const cpuBefore = await processCpu(browserSession);
  const start = performance.now();
  await action();
  const wallMs = performance.now() - start;
  const after = await metrics(session);
  const cpuAfter = await processCpu(browserSession);
  const delta = Object.fromEntries(['TaskDuration', 'ScriptDuration', 'LayoutDuration', 'RecalcStyleDuration']
    .map(name => [name + 'Ms', Number.isFinite(after[name]) && Number.isFinite(before[name])
      ? (after[name] - before[name]) * 1000 : null]));
  return { wallMs, ...delta, processCpuMs: cpuBefore !== null && cpuAfter !== null
    ? (cpuAfter - cpuBefore) * 1000 : null };
}

async function resource(page, pathFragment) {
  return page.evaluate(fragment => {
    const entries = performance.getEntriesByType('resource').filter(entry => entry.name.includes(fragment));
    const entry = entries.at(-1);
    return entry && { startTime: entry.startTime, duration: entry.duration,
      transferSize: entry.transferSize, encodedBodySize: entry.encodedBodySize,
      decodedBodySize: entry.decodedBodySize };
  }, pathFragment);
}

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const report = {
    origin, route: { source: 'akari_jp', target: 'google_dns', type: 'v4', dur: 10800, points: 720 },
    rounds, mode, startedAt: new Date().toISOString(), browser: browser.version(),
    boundaries: ['public Chrome trial page', 'v2 load, PNG switch, and Canvas redraw are separate phases in switch mode',
      'trial PNG mode reuses the v2 snapshot and is not the PNG-only main page',
      'Chrome process memory checkpoints are samples, not a continuous peak trace'],
    samples: [], checkpoints: [], pageErrors: [], responses: [],
  };
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.5 });
    const page = await context.newPage();
    page.on('pageerror', error => report.pageErrors.push(error.message));
    page.on('response', response => {
      if (/\/api\/(?:v2\/series|graph\.png)/.test(response.url())) {
        const headers = response.headers();
        const url = new URL(response.url());
        report.responses.push({ urlType: response.url().includes('/v2/series') ? 'v2' : 'png',
          status: response.status(), cfCacheStatus: headers['cf-cache-status'] || null,
          contentLength: Number(headers['content-length']) || null,
          cacheControl: headers['cache-control'] || null,
          width: url.searchParams.get('w'), height: url.searchParams.get('h'),
          refresh: url.searchParams.get('refresh') });
      }
    });
    const session = await context.newCDPSession(page);
    await session.send('Performance.enable');
    let browserSession = null;
    try { browserSession = await browser.newBrowserCDPSession();
      await browserSession.send('SystemInfo.getProcessInfo');
    } catch (error) { report.processInfoUnavailable = error.message; browserSession = null; }

    await page.goto(origin + '/chart-trial', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await waitFor(page, () => !document.querySelector('#load').disabled);
    await page.locator('#source').selectOption('akari_jp');
    await page.locator('#target').selectOption('google_dns');
    await page.locator('#protocol').selectOption('v4');
    await page.locator('#duration').selectOption('10800');
    await page.locator('#points').selectOption('720');
    assert.equal(await page.locator('#canvas-mode').getAttribute('aria-pressed'), 'true');
    if (mode === 'png-only') await page.locator('#png-mode').click();
    await page.locator('#load').click();
    await waitFor(page, pngOnly => pngOnly
      ? document.querySelector('#plot img')?.complete && document.querySelector('#plot img')?.naturalWidth > 0
      : document.querySelector('#plot canvas') && ChartTrial.instanceCount === 1, mode === 'png-only');
    assert.equal(await page.evaluate(() => ChartTrial.snapshot?.schema), 'ipppping.series.v2');

    const checkpoint = async round => {
      await session.send('HeapProfiler.collectGarbage');
      report.checkpoints.push({ round, metrics: await metrics(session),
        processMemory: await processMemory(browserSession), processCpuSeconds: await processCpu(browserSession) });
    };
    await checkpoint(0);
    for (let i = 0; i < rounds; i++) {
      const v2 = await phase(page, session, browserSession, async () => {
        await page.locator('#load').click();
        await waitFor(page, pngOnly => (pngOnly
          ? document.querySelector('#plot img')?.complete && document.querySelector('#plot img')?.naturalWidth > 0
          : document.querySelector('#plot canvas') && ChartTrial.instanceCount === 1)
          && !document.querySelector('#status').textContent.includes('Loading a new'), mode === 'png-only');
      });
      const series = await resource(page, '/api/v2/series');
      const snapshotId = await page.evaluate(() => ChartTrial.snapshot?.snapshot_id);
      const sample = { round: i + 1, snapshotId, seriesResource: series,
        [mode === 'png-only' ? 'pngLoad' : 'v2']: v2 };
      if (mode === 'switch') {
        sample.png = await phase(page, session, browserSession, async () => {
          await page.locator('#png-mode').click();
          await waitFor(page, () => { const image = document.querySelector('#plot img');
            return image && image.complete && image.naturalWidth > 0; });
        });
        const pngUrl = new URL(await page.locator('#plot img').getAttribute('src'), origin);
        sample.pngResource = await resource(page, '/api/graph.png');
        sample.pngWidth = pngUrl.searchParams.get('w');
        sample.pngHeight = pngUrl.searchParams.get('h');
        sample.canvasRedraw = await phase(page, session, browserSession, async () => {
          await page.locator('#canvas-mode').click();
          await waitFor(page, () => document.querySelector('#plot canvas') && ChartTrial.instanceCount === 1);
        });
      }
      report.samples.push(sample);
      if ((i + 1) % 5 === 0) {
        await checkpoint(i + 1);
        console.log(`Chrome cost ${i + 1}/${rounds}: ${mode === 'png-only' ? 'PNG load' : 'v2'} ${Math.round(v2.wallMs)} ms`
          + (sample.png ? `, PNG ${Math.round(sample.png.wallMs)} ms, Canvas redraw ${Math.round(sample.canvasRedraw.wallMs)} ms` : ''));
      }
      await pause(1000);
    }
    assert.deepEqual(report.pageErrors, []);
    assert.ok(report.responses.every(response => response.status === 200));
    if (mode === 'switch') {
      const pngResponses = report.responses.filter(response => response.urlType === 'png');
      assert.ok(pngResponses.length >= rounds, 'each submitted snapshot must request PNG when explicitly switched');
      assert.equal(new Set(pngResponses.map(response => response.refresh)).size, rounds,
        'PNG refresh token must be unique per submitted snapshot');
    }
    report.finishedAt = new Date().toISOString();
    report.summary = Object.fromEntries((mode === 'switch' ? ['v2', 'png', 'canvasRedraw']
      : [mode === 'png-only' ? 'pngLoad' : 'v2']).map(name => {
      const values = report.samples.map(item => item[name]);
      return [name, {
        wallMedianMs: percentile(values.map(item => item.wallMs), 0.5),
        wallP95Ms: percentile(values.map(item => item.wallMs), 0.95),
        taskMedianMs: percentile(values.map(item => item.TaskDurationMs), 0.5),
        taskP95Ms: percentile(values.map(item => item.TaskDurationMs), 0.95),
        processCpuMedianMs: values.every(item => item.processCpuMs !== null)
          ? percentile(values.map(item => item.processCpuMs), 0.5) : null,
      }];
    }));
    fs.mkdirSync(path.dirname(resultPath), { recursive: true });
    fs.writeFileSync(resultPath, JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ report: resultPath, summary: report.summary,
      checkpoints: report.checkpoints, responses: report.responses.length }, null, 2));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
