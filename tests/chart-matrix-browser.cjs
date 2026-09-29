/* P4 opt-in matrix lab. A mock transport makes near-cap UI bounds repeatable. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const releaseRoot = process.env.TEST_RELEASE_ROOT || 'build/web-release';
assert.match(releaseRoot, /^build\/web-release(?:-[a-z0-9-]+)?$/);
const trialSource = fs.readFileSync(path.join(root, 'web/chart-matrix-trial.js'), 'utf8');
assert.doesNotMatch(trialSource, /ctx\.arc\(|ctx\.moveTo\(/, 'no per-sample cursor-like glyphs');
const nodes = Array.from({ length: 16 }, (_, i) => ({ id: `v${i}`, label: `VPS ${i}`, group: 'vps', v4: true, v6: true }));
nodes.push({ id: 'ext', label: 'External', group: 'dns', v4: true, v6: true });
nodes.push({ id: 'v16', label: 'VPS 16 v4', group: 'vps', v4: true, v6: false });
nodes.push({ id: 'v17', label: 'VPS 17 v4', group: 'vps', v4: true, v6: false });
nodes.push({ id: 'ext4', label: 'External v4', group: 'dns', v4: true, v6: false });
const requests = [];
let lastRoutes = [];
let partialMissing = false;
let statsEpoch = 0, statsDelayMs = 0, summaryDelayMs = 0, seriesDelayMs = 0, failNextStats = false;
async function chromePrivateMemory(session) {
  if (!session || process.platform !== 'win32') return null;
  const info = await session.send('SystemInfo.getProcessInfo');
  const ids = info.processInfo.map(item => item.id).filter(id => Number.isInteger(id) && id > 0);
  if (!ids.length) return null;
  const command = `$ids=@(${ids.join(',')}); Get-Process -Id $ids -ErrorAction SilentlyContinue | `
    + 'Select-Object Id,PrivateMemorySize64 | ConvertTo-Json -Compress';
  const raw = execFileSync('powershell.exe', ['-NoProfile', '-Command', command],
    { encoding: 'utf8', timeout: 10000 }).trim();
  if (!raw) return null;
  const values = JSON.parse(raw), list = Array.isArray(values) ? values : [values];
  const types = new Map(info.processInfo.map(item => [item.id, item.type]));
  const privateByType = {};
  for (const item of list) {
    const type = types.get(item.Id) || 'unknown';
    privateByType[type] = (privateByType[type] || 0) + item.PrivateMemorySize64;
  }
  return { processPrivateBytes: list.reduce((sum, item) => sum + item.PrivateMemorySize64, 0),
    gpuPrivateBytes: list.filter(item => types.get(item.Id) === 'GPU')
      .reduce((sum, item) => sum + item.PrivateMemorySize64, 0), privateByType };
}
function pairs(query) {
  const chosen = nodes.filter(node => query.get('nodes').split(',').includes(node.id));
  const fixed = new Set((query.get('anchor') || '').split(',').filter(Boolean));
  const combinations = [];
  for (let i = 0; i < chosen.length; i++) for (let j = i + 1; j < chosen.length; j++) {
    if (fixed.size && fixed.has(chosen[i].id) === fixed.has(chosen[j].id)) continue;
    combinations.push([chosen[i], chosen[j]]);
  }
  return combinations.flatMap(([a, b]) => {
    const protocols = ['v4', 'v6'].filter(type => a[type] && b[type]);
    if (a.group === 'dns' || b.group === 'dns') {
      const source = a.group === 'dns' ? b : a, target = a.group === 'dns' ? a : b;
      return protocols.map(type => ({ source: source.id, target: target.id, type,
        srcLabel: source.label, tgtLabel: target.label, ext: true,
        pairKey: [a.id, b.id].join('_'), direction: 0 }));
    }
    return [[a, b], [b, a]].flatMap(([source, target]) => protocols.map(type => ({
      source: source.id, target: target.id, type, srcLabel: source.label, tgtLabel: target.label,
      ext: false, pairKey: [a.id, b.id].join('_'), direction: source.id === a.id ? 0 : 1
    })));
  });
}
function summary(pair, end, dur, maximum) {
  const visualCase = pair.source === 'v0' && pair.target === 'ext' && pair.type === 'v4';
  const allLoss = pair.source === 'v0' && pair.target === 'ext' && pair.type === 'v6';
  return { source: pair.source, target: pair.target, protocol: pair.type,
    schema: 'ipppping.series.v2', snapshot_id: 'a'.repeat(24), window: { start: end - dur, end },
    current: { current_ms: allLoss ? null : visualCase ? 8 : 10, measurement_updated_at: end - 60 },
    summary: { average_ms: allLoss ? null : visualCase ? 7.25 : 10,
      min_median_ms: allLoss ? null : visualCase ? 3.3 : 10,
      max_median_ms: allLoss ? null : maximum,
      loss_pct: allLoss ? 100 : visualCase ? 25 : 0, measurement_coverage: 1 } };
}
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://local'), pathname = url.pathname;
  res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; font-src 'self'");
  if (pathname.startsWith('/api/')) {
    requests.push(pathname);
    res.setHeader('Content-Type', 'application/json');
    if (pathname === '/api/nodes') { res.end(JSON.stringify(nodes)); return; }
    const routes = pathname === '/api/v2/series' ? lastRoutes : pairs(url.searchParams);
    if (pathname !== '/api/v2/series') lastRoutes = routes;
    if (pathname === '/api/pairs') { res.end(JSON.stringify(routes)); return; }
    const end = url.searchParams.has('end') ? Number(url.searchParams.get('end')) : Math.floor(Date.now() / 60000) * 60;
    const dur = Number(url.searchParams.get('dur'));
    if (pathname === '/api/stats-batch.json') {
      if (failNextStats) {
        failNextStats = false;
        const fail = () => res.writeHead(500).end(JSON.stringify({ error: 'simulated' }));
        if (statsDelayMs) setTimeout(fail, statsDelayMs);
        else fail();
        return;
      }
      const result = JSON.stringify({ items: routes.map(pair => ({ ...pair,
        stats: { current_ms: 10 + statsEpoch, avg_ms: 10, min_ms: 8, max_ms: 12,
          loss_pct: pair.ext ? 2 + statsEpoch : 0, measurement_updated_at: end - 60 } })) });
      if (statsDelayMs) setTimeout(() => res.end(result), statsDelayMs);
      else res.end(result);
      return;
    }
    if (pathname === '/api/v2/summary-batch') {
      const offset = Number(url.searchParams.get('offset')), limit = Number(url.searchParams.get('limit'));
      const items = routes.slice(offset, offset + limit).map((pair, i) =>
        partialMissing && pair.source === 'v1' && pair.type === 'v6'
          ? { source: pair.source, target: pair.target, protocol: pair.type, error: 'no_data' }
          : summary(pair, end, dur, offset + i + 10));
      const result = JSON.stringify({ schema: 'ipppping.summary-batch.v2', selection_id: 'a'.repeat(64),
        end, dur, offset, limit, total: routes.length,
        next_offset: offset + items.length < routes.length ? offset + items.length : null, items });
      if (summaryDelayMs) setTimeout(() => res.end(result), summaryDelayMs);
      else res.end(result);
      return;
    }
    if (pathname === '/api/v2/series') {
      const pair = { source: url.searchParams.get('source'), target: url.searchParams.get('target'), type: url.searchParams.get('type') };
      const index = routes.findIndex(value => value.source === pair.source && value.target === pair.target && value.type === pair.type);
      const data = summary(pair, end, dur, index + 10);
      const start = end - dur;
      data.encoding = 'columns-v1';
      if (pair.source === 'v0' && pair.target === 'ext' && pair.type === 'v4') {
        const median = [4, 4.5, 5.5, null, 7.5, 9, null, 6.5, 8.5, 8];
        const lossMean = [0, 25, 0, 25, 25, 25, 100, 0, 37.5, 0];
        const lossMax = [0, 25, 0, 100, 25, 25, 100, 0, 50, 0];
        const events = [0, 1, 0, 1, 1, 1, 1, 0, 2, 0];
        const count = lossMean.map((_, i) => i === 3 ? 4 : i === 8 ? 2 : 1);
        data.columns = {
          start: median.map((_, i) => start + i * dur / median.length),
          end: median.map((_, i) => start + (i + 1) * dur / median.length),
          count, median_mean_ms: median,
          min_median_ms: median.map((value, i) => i === 3 ? 5.3 : value === null ? null : value - 0.7),
          max_median_ms: median.map((value, i) => i === 3 ? 6.7 : value === null ? null : value + 0.7),
          loss_mean_pct: lossMean, loss_max_pct: lossMax,
          loss_event_count: events,
          full_loss_count: lossMax.map((value, i) => Number(value === 100 && i !== 8)),
          missing_latency_count: median.map(value => Number(value === null)),
          missing_measurement_count: median.map(() => 0)
        };
      } else if (pair.source === 'v0' && pair.target === 'ext' && pair.type === 'v6') {
        const bins = Array.from({ length: 10 }, (_, i) => i);
        data.columns = {
          start: bins.map(i => start + i * dur / bins.length),
          end: bins.map(i => start + (i + 1) * dur / bins.length),
          count: bins.map(() => 1), median_mean_ms: bins.map(() => null),
          min_median_ms: bins.map(() => null), max_median_ms: bins.map(() => null),
          loss_mean_pct: bins.map(() => 100), loss_max_pct: bins.map(() => 100),
          loss_event_count: bins.map(() => 1), full_loss_count: bins.map(() => 1),
          missing_latency_count: bins.map(() => 1), missing_measurement_count: bins.map(() => 0)
        };
      } else data.columns = { start: [start, start + dur / 2], end: [start + dur / 2, end],
        count: [1, 1], median_mean_ms: [10, 10], min_median_ms: [10, 10], max_median_ms: [10, 10],
        loss_mean_pct: [0, 0], loss_max_pct: [0, 0], loss_event_count: [0, 0],
        full_loss_count: [0, 0], missing_latency_count: [0, 0], missing_measurement_count: [0, 0] };
      const body = JSON.stringify(data);
      if (seriesDelayMs) setTimeout(() => { if (!res.destroyed) res.end(body); }, seriesDelayMs);
      else res.end(body);
      return;
    }
    res.writeHead(404).end(); return;
  }
  const relative = pathname === '/chart-matrix-trial' ? releaseRoot + '/chart-matrix-trial.html'
    : pathname.startsWith('/static/assets/') ? releaseRoot + '/assets/' + path.basename(pathname)
    : pathname.startsWith('/static/fonts/') ? 'web/fonts/' + path.basename(pathname) : null;
  if (!relative) { res.writeHead(404).end(); return; }
  try {
    res.setHeader('Content-Type', relative.endsWith('.js') ? 'text/javascript' : relative.endsWith('.css') ? 'text/css' : relative.endsWith('.html') ? 'text/html' : 'font/woff2');
    res.end(fs.readFileSync(path.join(root, relative)));
  } catch { res.writeHead(404).end(); }
});

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true,
    ...(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : {}) });
  const origin = 'http://127.0.0.1:' + server.address().port;
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      window.__lossDraws = [];
      window.__captureLossDraws = true;
      const prototype = CanvasRenderingContext2D.prototype;
      const original = { rect: prototype.rect, clip: prototype.clip, fillRect: prototype.fillRect };
      prototype.rect = function(x, y, width, height) {
        if (window.__captureLossDraws) this.__lastTestRect = { x, y, width, height };
        return original.rect.call(this, x, y, width, height);
      };
      prototype.clip = function(...args) {
        if (window.__captureLossDraws) this.__lastTestClip = this.__lastTestRect;
        return original.clip.apply(this, args);
      };
      prototype.fillRect = function(x, y, width, height) {
        if (window.__captureLossDraws && this.fillStyle === '#f49b81')
          window.__lossDraws.push({ x, y, width, height, alpha: this.globalAlpha,
            color: this.fillStyle,
            clip: this.__lastTestClip,
            lossText: this.canvas.closest('.card')?.querySelector('[data-metric="4"] .stat-number')?.textContent });
        return original.fillRect.call(this, x, y, width, height);
      };
      window.__restoreLossDraws = () => {
        prototype.rect = original.rect; prototype.clip = original.clip; prototype.fillRect = original.fillRect;
      };
    });
    if (process.env.RUN_AXE) await page.addInitScript({ path: path.join(root, 'build/qa-deps/package/axe.min.js') });
    await page.goto(origin + '/chart-matrix-trial');
    await page.locator('.node').first().waitFor();
    async function assertSegment(groupSelector) {
      await page.waitForTimeout(210);
      const geometry = await page.locator(groupSelector).evaluate(group => {
        const active = group.querySelector('button.on'), indicator = group.querySelector('.segment-indicator');
        const a = active.getBoundingClientRect(), b = indicator.getBoundingClientRect();
        return { left: Math.abs(a.left - b.left), width: Math.abs(a.width - b.width),
          selected: group.querySelectorAll('button[aria-pressed="true"]').length,
          decorative: indicator.getAttribute('aria-hidden'),
          duration: getComputedStyle(indicator).transitionDuration };
      });
      assert.ok(geometry.left < 1 && geometry.width < 1, JSON.stringify(geometry));
      assert.equal(geometry.selected, 1);
      assert.equal(geometry.decorative, 'true');
      assert.match(geometry.duration, /0\.18s/);
    }
    assert.equal(await page.locator('.segment-indicator').count(), 3);
    await assertSegment('#filterPills');
    await assertSegment('#pairMode');
    await assertSegment('#viewMode');
    assert.equal(await page.locator('.node').count(), nodes.length);
    assert.equal(await page.locator('#chart-key').isVisible(), false);
    assert.deepEqual(requests, ['/api/nodes']);
    for (const id of ['v0', 'v1', 'ext'])
      await page.locator('.node[data-node-id="' + id + '"] .node-select').click();
    assert.match(await page.locator('#selSummary').textContent(), /3 nodes.*8 results/);
    await page.locator('#goBtn').click();
    await page.waitForFunction(() => document.getElementById('trialStatus').textContent.startsWith('Ready: 8 routes'));
    assert.equal(await page.locator('.card').count(), 8);
    const resultsAx = await page.locator('.card').first().ariaSnapshot();
    for (const metric of ['CURRENT', 'AVG', 'MIN', 'MAX', 'LOSS'])
      assert.ok(resultsAx.toLowerCase().includes(metric.toLowerCase()), `Results AX missing ${metric}: ${resultsAx}`);
    assert.equal(requests.filter(route => route === '/api/stats-batch.json').length, 1);
    assert.equal(requests.filter(route => route === '/api/v2/series').length, 0);
    assert.match(await page.locator('#selFreshness').textContent(), /^Updated \d\d:\d\d$/);
    await page.waitForTimeout(270);
    failNextStats = true; statsDelayMs = 300;
    await page.locator('#goBtn').click();
    await page.locator('[data-filter="ext"]').click();
    assert.equal(await page.locator('.card').count(), 8, 'old grid remains while query is pending');
    await page.waitForFunction(() => document.getElementById('trialStatus').textContent.startsWith('Query failed:'));
    assert.equal(await page.locator('.card').count(), 4, 'failure applies a draft filter to preserved cards');
    await page.locator('[data-filter="all"]').click();
    assert.equal(await page.locator('.card').count(), 8);
    assert.equal(await page.locator('.card').first().locator('[data-metric="0"] .stat-number').textContent(), '10.0');
    await page.evaluate(() => {
      window.__firstResultsCard = document.querySelector('.card');
      window.__oldPairKeys = ChartMatrixTrial.pairs.map(pair => [pair.source, pair.target, pair.type].join(':'));
    });
    statsEpoch = 1; statsDelayMs = 300;
    await page.locator('#goBtn').click();
    assert.match(await page.locator('#trialStatus').textContent(), /Loading Results/);
    assert.equal(await page.locator('.card').count(), 8, 'pending refresh must not blank the grid');
    await page.waitForFunction(() => document.getElementById('trialStatus').textContent.startsWith('Ready: 8 routes'));
    const reuseResult = await page.evaluate(() => ({ same: window.__firstResultsCard === document.querySelector('.card'),
      connected: window.__firstResultsCard.isConnected, oldKey: window.__firstResultsCard.dataset.cardKey,
      newKey: document.querySelector('.card')?.dataset.cardKey,
      samePairs: JSON.stringify(window.__oldPairKeys) === JSON.stringify(ChartMatrixTrial.pairs.map(pair =>
        [pair.source, pair.target, pair.type].join(':'))) }));
    assert.equal(reuseResult.same, true, 'same-route Results refresh should reuse the card DOM: ' + JSON.stringify(reuseResult));
    await page.waitForFunction(() => document.querySelector('.card [data-metric="0"] .stat-value')?.getAnimations().length > 0);
    const pulses = await page.evaluate(() => {
      const cards = [...document.querySelectorAll('.card')];
      const extCard = document.querySelector('.badge-ext')?.closest('.card');
      return { current: cards[0].querySelector('[data-metric="0"] .stat-number').textContent,
        loss: extCard?.querySelector('[data-metric="4"] .stat-number').textContent,
        lossPulse: extCard?.querySelector('[data-metric="4"] .stat-value').getAnimations().length,
        entrances: cards.filter(card => card.getAnimations().length).length };
    });
    assert.deepEqual([pulses.current, pulses.loss], ['11.0', '3.0']);
    assert.ok(pulses.lossPulse > 0 && pulses.entrances > 0 && pulses.entrances <= 6, JSON.stringify(pulses));
    statsEpoch = 0; statsDelayMs = 0;
    statsDelayMs = 300;
    await page.locator('#goBtn').click();
    assert.equal(await page.evaluate(() => ChartMatrixTrial.queryLoading), true);
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, value: true });
      document.dispatchEvent(new Event('visibilitychange'));
      delete document.hidden;
      document.dispatchEvent(new Event('visibilitychange'));
    });
    assert.equal(await page.evaluate(() => ChartMatrixTrial.queryLoading), false);
    assert.equal(await page.locator('.card').count(), 8);
    assert.match(await page.locator('#trialStatus').textContent(), /Previous results remain visible/);
    await page.waitForTimeout(330);
    statsDelayMs = 0;
    async function assertFiveColumnDesign() {
      const design = await page.evaluate(() => {
        const card = document.querySelector('.card'), edge = card.getBoundingClientRect();
        const separator = card.querySelector('.card-right').getBoundingClientRect();
        const metrics = [...card.querySelectorAll('.stat-item')].map(item => {
          const cell = item.getBoundingClientRect();
          const label = item.querySelector('.stat-label').getBoundingClientRect();
          const value = item.querySelector('.stat-value').getBoundingClientRect();
          const left = Math.min(label.left, value.left), right = Math.max(label.right, value.right);
          return { aligned: Math.abs(label.left - value.left) < 1,
            centered: Math.abs((left + right - cell.left - cell.right) / 2) < 2 };
        });
        return { cardBorder: getComputedStyle(card).borderTopWidth,
          controlsBorder: getComputedStyle(document.querySelector('.pills')).borderTopWidth,
          badgeBorder: getComputedStyle(card.querySelector('.badge')).borderTopWidth,
          keyBorder: getComputedStyle(document.querySelector('.matrix-key')).borderTopWidth,
          lineLeft: Math.abs(separator.left - edge.left), lineRight: Math.abs(separator.right - edge.right), metrics };
      });
      assert.deepEqual([design.cardBorder, design.controlsBorder, design.badgeBorder, design.keyBorder],
        ['0px', '0px', '0px', '0px']);
      assert.ok(design.lineLeft < 1 && design.lineRight < 1, JSON.stringify(design));
      assert.ok(design.metrics.every(metric => metric.aligned && metric.centered), JSON.stringify(design));
    }
    await assertFiveColumnDesign();
    await page.locator('[data-filter="ext"]').click();
    await page.waitForFunction(() => document.querySelector('#filterPills .segment-indicator').getAnimations().length > 0);
    await assertSegment('#filterPills');
    assert.equal(await page.locator('.card').count(), 4);
    assert.equal(await page.locator('.card .badge-ext').count(), 4);
    await page.locator('[data-filter="v6"]').click();
    await assertSegment('#filterPills');
    assert.equal(await page.locator('.card').count(), 4);
    await page.locator('[data-filter="all"]').click();
    await assertSegment('#filterPills');
    assert.equal(await page.locator('.card').count(), 8);
    await page.locator('[data-mode="charts"]').click();
    await assertSegment('#viewMode');
    assert.equal(await page.locator('#selFreshness').textContent(), 'Unapplied changes');
    assert.equal(await page.locator('.trial-plot').count(), 0);
    summaryDelayMs = 300;
    await page.locator('#goBtn').click();
    assert.equal(await page.evaluate(() => ChartMatrixTrial.queryLoading), true);
    assert.equal(await page.locator('.card').count(), 8);
    assert.equal(await page.locator('.trial-plot').count(), 0,
      'Results cards remain intact until the Charts summary is ready');
    await page.waitForFunction(() => document.getElementById('trialStatus').textContent.startsWith('Ready: 8 routes'));
    summaryDelayMs = 0;
    await page.waitForFunction(() => ChartMatrixTrial.instanceCount > 0);
    await page.waitForFunction(() => document.querySelector('.trial-reveal'));
    const revealGeometry = await page.locator('.trial-reveal').first().evaluate(cover => {
      const layer = cover.parentElement;
      return { left: parseFloat(cover.style.left), width: parseFloat(cover.style.width),
        height: parseFloat(cover.style.height), layerWidth: layer.clientWidth,
        duration: cover.getAnimations()[0]?.effect.getTiming().duration };
    });
    assert.ok(revealGeometry.left > 0 && revealGeometry.width < revealGeometry.layerWidth &&
      revealGeometry.height < 220 && revealGeometry.duration === 220, JSON.stringify(revealGeometry));
    await page.locator('.trial-reveal').first().waitFor({ state: 'detached' });
    assert.equal(await page.locator('#chart-key').isVisible(), true);
    assert.equal(await page.locator('.trial-plot').count(), 8);
    const chartsAx = await page.locator('.card').first().ariaSnapshot();
    for (const metric of ['CURRENT', 'AVG', 'MIN', 'MAX', 'LOSS'])
      assert.ok(chartsAx.toLowerCase().includes(metric.toLowerCase()), `Charts AX missing ${metric}: ${chartsAx}`);
    assert.equal(await page.locator('.card .badge-ext').count(), 4);
    await assertFiveColumnDesign();
    assert.deepEqual(await page.locator('#chart-key span').allTextContents(),
      ['Mean median RTT', 'Loss in every bucket', 'Peak within interval']);
    assert.equal(await page.locator('.key-range').count(), 0);
    await page.locator('.card').filter({ hasText: '25.0%' }).first().scrollIntoViewIfNeeded();
    await page.waitForFunction(() => [...document.querySelectorAll('.card')].some(item =>
      item.querySelector('.stat-item[data-metric="4"] .stat-number')?.textContent === '25.0' &&
      item.querySelector('.trial-plot .uplot')));
    await page.locator('.card').filter({ hasText: '100.0%' }).first().scrollIntoViewIfNeeded();
    await page.waitForFunction(() => [...document.querySelectorAll('.card')].some(item =>
      item.querySelector('.stat-item[data-metric="4"] .stat-number')?.textContent === '100.0' &&
      item.querySelector('.trial-plot .uplot')));
    const lossVisual = await page.evaluate(() => {
      const marked = [...document.querySelectorAll('.card')].find(item =>
        item.querySelector('.stat-item[data-metric="4"] .stat-number')?.textContent === '25.0');
      const full = [...document.querySelectorAll('.card')].find(item =>
        item.querySelector('.stat-item[data-metric="4"] .stat-number')?.textContent === '100.0');
      const zero = [...document.querySelectorAll('.card')].find(item =>
        item.querySelector('.stat-item[data-metric="4"] .stat-number')?.textContent === '0.0');
      const draws = [...new Map(window.__lossDraws.map(mark => [JSON.stringify(mark), mark])).values()];
      window.__captureLossDraws = false;
      window.__restoreLossDraws();
      return { colored: getComputedStyle(marked.querySelector('[data-metric="4"] .stat-value')).color,
        full: getComputedStyle(full.querySelector('[data-metric="4"] .stat-value')).color,
        zero: getComputedStyle(zero.querySelector('[data-metric="4"] .stat-value')).color,
        draws, keys: [...document.querySelectorAll('.key-loss-fill,.key-loss-peak')].map(element => {
          const style = getComputedStyle(element, '::before');
          return { color: style.backgroundColor, alpha: style.opacity, image: style.backgroundImage };
        }),
        medianBand: getComputedStyle(document.body).getPropertyValue('--trial-range-fill').trim() };
    });
    assert.equal(lossVisual.colored, 'rgb(247, 137, 17)');
    assert.equal(lossVisual.full, 'rgb(239, 68, 68)');
    assert.equal(lossVisual.zero, 'rgb(185, 185, 185)');
    assert.deepEqual(lossVisual.keys, Array(2).fill({
      color: 'rgb(244, 155, 129)', alpha: '0.65', image: 'none' }));
    assert.equal(lossVisual.medianBand, '');
    const visualDraws = lossVisual.draws.filter(mark => mark.lossText === '25.0');
    const fullDraws = lossVisual.draws.filter(mark => mark.lossText === '100.0');
    assert.ok([...visualDraws, ...fullDraws].every(mark => mark.color === '#f49b81' && mark.alpha === .65),
      'filled intervals and narrow peaks must have the same color and opacity');
    assert.equal(visualDraws.length, 6, JSON.stringify(visualDraws));
    const mixedPeak = visualDraws.find(mark => mark.width <= 10 && mark.y <= mark.clip.y);
    const meanPeak = visualDraws.find(mark => mark.width <= 10 && mark.y > mark.clip.y);
    const partialRuns = visualDraws.filter(mark => mark.width > 10 && mark.height < mark.clip.height / 2);
    const fullInterval = visualDraws.find(mark => mark.width > 10 && mark.y <= mark.clip.y);
    assert.ok(mixedPeak && meanPeak && fullInterval, JSON.stringify(visualDraws));
    assert.equal(partialRuns.length, 3, JSON.stringify(partialRuns));
    assert.ok(partialRuns.some(mark => mark.width > partialRuns[0].width * 1.8),
      'adjacent sustained-loss bins should merge into a wider block');
    assert.ok(mixedPeak.height >= mixedPeak.clip.height && mixedPeak.width <= 10);
    assert.ok(meanPeak.height < meanPeak.clip.height / 2 && meanPeak.width <= 10);
    assert.ok(partialRuns.some(mark => mark.y === meanPeak.y + meanPeak.height &&
      mark.x <= meanPeak.x && mark.x + mark.width >= meanPeak.x + meanPeak.width),
      'peak stem should meet, not overlap, the mean-loss block');
    assert.equal(fullDraws.length, 1, 'adjacent full-loss bins must merge into one span');
    const span = fullDraws[0], clip = span.clip;
    assert.ok(span.x <= clip.x && span.x + span.width >= clip.x + clip.width &&
      span.y <= clip.y && span.y + span.height >= clip.y + clip.height, JSON.stringify(span));
    fs.mkdirSync(path.join(root, 'test-results'), { recursive: true });
    const allLossCard = page.locator('.card').filter({ hasText: '100.0%' }).first();
    await allLossCard.scrollIntoViewIfNeeded();
    await allLossCard.locator('.trial-reveal').waitFor({ state: 'detached' });
    await allLossCard.screenshot({ path: path.join(root, 'test-results/p4-matrix-all-loss.png') });
    const allLossImage = await allLossCard.locator('canvas').screenshot();
    for (const fraction of [0, 1]) {
      await page.locator('#mainArea').evaluate((main, part) => {
        main.scrollTop = part * (main.scrollHeight - main.clientHeight);
      }, fraction);
      await page.waitForTimeout(250);
    }
    await allLossCard.scrollIntoViewIfNeeded();
    await allLossCard.locator('canvas').waitFor();
    assert.equal((await allLossCard.locator('canvas').screenshot()).equals(allLossImage), true,
      'pooled chart reassignment must preserve full-loss marks on return');
    const graphic = page.locator('.trial-plot .uplot').first();
    await graphic.hover();
    assert.equal(await page.locator('.u-cursor-x,.u-cursor-y').count(), 0);
    assert.equal(await page.evaluate(() => getComputedStyle(document.body).getPropertyValue('--trial-rule').trim()),
      await page.evaluate(() => ChartMatrixTrial.gridColor));
    assert.ok(await page.evaluate(() => ChartMatrixTrial.instanceCount <= 4 && ChartMatrixTrial.pendingCount <= 4));
    seriesDelayMs = 5000;
    await page.evaluate(() => {
      window.__nativeFetch = window.fetch;
      const race = window.__seriesRace = {
        started: 0, urls: [], abortPending: 0, abortSettled: 0,
        release: [], holdAborts: true, mutations: []
      };
      window.fetch = (url, options) => {
        const isSeries = String(url).startsWith('/api/v2/series?');
        if (isSeries) { race.started++; race.urls.push(String(url)); }
        const result = window.__nativeFetch(url, options);
        if (!isSeries) return result;
        return result.catch(error => error.name === 'AbortError' && race.holdAborts
          ? new Promise((resolve, reject) => {
            race.abortPending++;
            race.release.push(() => { race.abortSettled++; reject(error); });
          })
          : Promise.reject(error));
      };
    });
    await page.locator('#goBtn').click();
    await page.waitForFunction(() => document.getElementById('trialStatus').textContent.startsWith('Ready: 8 routes'));
    await page.waitForFunction(() => window.__seriesRace.started >= 2);
    const activeIndex = await page.evaluate(() => {
      const url = new URL(window.__seriesRace.urls[0], location.href);
      return ChartMatrixTrial.pairs.findIndex(pair => pair.source === url.searchParams.get('source') &&
        pair.target === url.searchParams.get('target') && pair.type === url.searchParams.get('type'));
    });
    assert.ok(activeIndex >= 0);
    const ownedPlot = await page.locator(`.card[data-index="${activeIndex}"] .trial-plot`).elementHandle();
    const firstStarted = await page.evaluate(() => window.__seriesRace.started);
    await page.locator('#goBtn').click();
    await page.waitForFunction(() => document.getElementById('trialStatus').textContent.startsWith('Ready: 8 routes'));
    await page.waitForFunction(() => window.__seriesRace.abortPending >= 2);
    await page.waitForFunction(plot => plot.getAttribute('aria-busy') === 'true', ownedPlot);
    assert.equal(await page.evaluate(() => window.__seriesRace.started), firstStarted,
      'replacement series must remain queued until the old fetch settles');
    await ownedPlot.evaluate(plot => {
      window.__seriesRace.observer = new MutationObserver(() => {
        window.__seriesRace.mutations.push(plot.getAttribute('aria-busy'));
      });
      window.__seriesRace.observer.observe(plot, { attributes: true, attributeFilter: ['aria-busy'] });
    });
    await page.evaluate(() => {
      window.__seriesRace.holdAborts = false;
      window.__seriesRace.release.splice(0).forEach(release => release());
    });
    await page.waitForFunction(() => window.__seriesRace.abortSettled >= 2);
    await page.waitForTimeout(100);
    assert.deepEqual(await page.evaluate(() => window.__seriesRace.mutations), [],
      'cancelled series must not briefly clear the replacement loading state');
    assert.equal(await ownedPlot.getAttribute('aria-busy'), 'true',
      'cancelled series must not clear the replacement request loading state');
    await page.waitForFunction(() => ChartMatrixTrial.instanceCount > 0);
    seriesDelayMs = 0;
    await page.evaluate(() => {
      window.__seriesRace.observer.disconnect();
      window.fetch = window.__nativeFetch;
      delete window.__nativeFetch;
      delete window.__seriesRace;
    });
    await page.locator('#unifiedAxisToggle').check();
    await page.waitForFunction(() => ChartMatrixTrial.instanceCount > 0);
    await page.locator('#unifiedAxisToggle').uncheck();
    await page.waitForFunction(() => ChartMatrixTrial.instanceCount > 0);
    summaryDelayMs = 300;
    await page.locator('#goBtn').click();
    assert.equal(await page.evaluate(() => ChartMatrixTrial.queryLoading), true);
    assert.ok(await page.locator('.trial-plot .uplot').count() > 0,
      'old charts stay visible while a new summary is pending');
    const hiddenState = await page.evaluate(() => {
      const canvas = document.querySelector('.trial-plot canvas');
      Object.defineProperty(document, 'hidden', { configurable: true, value: true });
      document.dispatchEvent(new Event('visibilitychange'));
      const state = { active: ChartMatrixTrial.instanceCount, pooled: ChartMatrixTrial.pooledCount,
        canvasWidth: canvas?.width, canvasHeight: canvas?.height };
      delete document.hidden;
      document.dispatchEvent(new Event('visibilitychange'));
      return state;
    });
    assert.deepEqual(hiddenState, { active: 0, pooled: 0, canvasWidth: 0, canvasHeight: 0 },
      'hiding the page should destroy pooled plots and release native backing stores');
    await page.waitForFunction(() => !ChartMatrixTrial.queryLoading && ChartMatrixTrial.instanceCount > 0);
    assert.equal(await page.locator('.card').count(), 8);
    assert.match(await page.locator('#trialStatus').textContent(), /Previous results remain visible/);
    await page.waitForTimeout(330);
    summaryDelayMs = 0;
    await page.locator('[data-pair-mode="fixed"]').click();
    await assertSegment('#pairMode');
    for (const id of ['v0', 'v1'])
      await page.locator('.node[data-node-id="' + id + '"] .node-anchor').click();
    assert.match(await page.locator('#selSummary').textContent(), /3 nodes.*2 fixed.*4 results/);
    await page.locator('#goBtn').click();
    await page.waitForFunction(() => document.getElementById('trialStatus').textContent.startsWith('Ready: 4 routes'));
    assert.equal(await page.locator('.card').count(), 4);
    assert.equal(await page.locator('.card .badge-ext').count(), 4);
    assert.equal(await page.evaluate(() => ChartMatrixTrial.pairs.every(pair => pair.ext)), true);
    await page.evaluate(() => { window.__firstChartsCard = document.querySelector('.card'); });
    partialMissing = true;
    await page.locator('#goBtn').click();
    await page.waitForFunction(() => document.getElementById('trialStatus').textContent.startsWith('Ready: 4 routes'));
    assert.equal(await page.evaluate(() => window.__firstChartsCard === document.querySelector('.card')), true,
      'same-route Charts refresh should reuse the card DOM');
    assert.equal(await page.locator('.trial-plot.problem').count(), 1);
    assert.match(await page.locator('.trial-plot.problem').textContent(), /No chart: no_data/);
    partialMissing = false;
    await page.locator('#goBtn').click();
    await page.waitForFunction(() => document.getElementById('trialStatus').textContent.startsWith('Ready: 4 routes'));
    assert.equal(await page.locator('.trial-plot.problem').count(), 0,
      'a recovered route must clear the prior error from its reused card');
    await page.locator('#toggleSidebar').click();
    assert.equal(await page.locator('#sidebar').getAttribute('aria-hidden'), 'true');
    await page.waitForTimeout(260);
    assert.equal(await page.evaluate(() => ChartMatrixTrial.instanceCount <= 4), true);
    await page.locator('#toggleSidebar').click();
    if (process.env.RUN_AXE) {
      const violations = await page.evaluate(async () => (await axe.run(document, {
        runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] }
      })).violations.map(value => ({ id: value.id, targets: value.nodes.map(node => node.target) })));
      assert.deepEqual(violations, []);
    }
    for (const width of [390, 720, 1440, 1800]) {
      await page.setViewportSize({ width, height: 900 });
      await page.waitForTimeout(260);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      if (width === 1800) await assertFiveColumnDesign();
    }
    await page.evaluate(() => { document.body.style.zoom = '2'; });
    await page.waitForTimeout(300);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.evaluate(() => { document.body.style.zoom = ''; });
    const screenshot = path.join(root, 'test-results/p4-matrix-trial.png');
    fs.mkdirSync(path.dirname(screenshot), { recursive: true });
    await page.screenshot({ path: screenshot });
    await page.locator('.card').first().screenshot({ path: path.join(root, 'test-results/p4-matrix-card.png') });
    await page.locator('[data-pair-mode="all"]').click();
    await page.locator('.node[data-node-id="ext"] .node-select').click();
    for (let i = 2; i < 16; i++)
      await page.locator('.node[data-node-id="v' + i + '"] .node-select').click();
    assert.match(await page.locator('#selSummary').textContent(), /16 nodes.*480 results/);
    const prior = requests.length;
    const fullStarted = performance.now();
    await page.locator('#goBtn').click();
    await page.waitForFunction(() => document.getElementById('trialStatus').textContent.startsWith('Ready: 480 routes'));
    const fullReadyMs = Math.round(performance.now() - fullStarted);
    assert.equal(await page.locator('.card').count(), 480);
    assert.equal(await page.evaluate(() => ChartMatrixTrial.matrix.unifiedMax), 489 * 1.1);
    assert.equal(requests.slice(prior).filter(route => route === '/api/v2/summary-batch').length, 15);
    await page.waitForFunction(() => ChartMatrixTrial.instanceCount > 0);
    assert.ok(requests.slice(prior).filter(route => route === '/api/v2/series').length < 20);
    assert.ok(await page.evaluate(() => ChartMatrixTrial.instanceCount <= 4 && ChartMatrixTrial.cacheCount <= 16));
    const filterMs = await page.evaluate(async () => {
      const start = performance.now();
      document.querySelector('[data-filter="v4"]').click();
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return Math.round(performance.now() - start);
    });
    assert.equal(await page.locator('.card').count(), 240);
    await page.locator('[data-filter="all"]').click();
    assert.equal(await page.locator('.card').count(), 480);
    await page.locator('#mainArea').evaluate(main => { main.scrollTop = 0; });
    await page.waitForFunction(() => document.querySelector('.card canvas'));
    const retainedCanvas = await page.locator('.card canvas').first().elementHandle();
    const retainedIndex = await retainedCanvas.evaluate(canvas => canvas.closest('.card').dataset.index);
    const firstImage = await page.locator(`.card[data-index="${retainedIndex}"] canvas`).screenshot();
    await page.waitForFunction(() => ChartMatrixTrial.instanceCount + ChartMatrixTrial.pooledCount === 4);
    const allocationsBeforeScroll = await page.evaluate(() => ChartMatrixTrial.chartAllocations);
    await page.locator('#mainArea').evaluate(main => { main.scrollTop = main.scrollHeight; });
    await page.waitForTimeout(600);
    assert.equal(await retainedCanvas.evaluate(canvas => canvas.width > 0 && canvas.height > 0), true,
      'a pooled Canvas should retain its backing store for a later visible route');
    assert.equal(await page.evaluate(() => ChartMatrixTrial.chartAllocations), allocationsBeforeScroll,
      'scrolling should recycle the four existing chart instances');
    await page.locator('#mainArea').evaluate(main => { main.scrollTop = 0; });
    await page.waitForFunction(index => document.querySelector(`.card[data-index="${index}"] canvas`), retainedIndex);
    assert.equal((await page.locator(`.card[data-index="${retainedIndex}"] canvas`).screenshot()).equals(firstImage), true,
      'a recycled chart must redraw the original route with the same frozen data');
    assert.ok(await page.evaluate(() => ChartMatrixTrial.instanceCount + ChartMatrixTrial.pooledCount <= 4));
    assert.ok(await page.evaluate(() => ChartMatrixTrial.instanceCount <= 4 && ChartMatrixTrial.cacheCount <= 16));
    const soakSeconds = Number(process.env.SOAK_SECONDS || 0);
    const samples = [];
    if (soakSeconds > 0) {
      const soakPattern = process.env.SOAK_PATTERN || 'scroll';
      const soakView = process.env.SOAK_VIEW || 'charts';
      assert.ok(['scroll', 'static'].includes(soakPattern));
      assert.ok(['charts', 'results'].includes(soakView));
      if (soakView === 'results') {
        await page.locator('[data-mode="stats"]').click();
        await page.locator('#goBtn').click();
        await page.waitForFunction(() => document.getElementById('trialStatus').textContent.startsWith('Ready: 480 routes'));
      }
      const cdp = await page.context().newCDPSession(page);
      const browserCdp = process.platform === 'win32' ? await browser.newBrowserCDPSession() : null;
      await cdp.send('Performance.enable');
      const sample = async elapsed => {
        await cdp.send('HeapProfiler.collectGarbage');
        const [dom, perf, client] = await Promise.all([
          cdp.send('Memory.getDOMCounters'), cdp.send('Performance.getMetrics'),
          page.evaluate(() => ({ instances: ChartMatrixTrial.instanceCount,
            pooled: ChartMatrixTrial.pooledCount, allocations: ChartMatrixTrial.chartAllocations,
            backingPixels: ChartMatrixTrial.backingPixels,
            cache: ChartMatrixTrial.cacheCount,
            cacheBytes: ChartMatrixTrial.cacheBytes, pending: ChartMatrixTrial.pendingCount,
            canvases: document.querySelectorAll('canvas').length,
            pixels: [...document.querySelectorAll('canvas')].reduce((sum, canvas) => sum + canvas.width * canvas.height, 0) }))
        ]);
        const heap = perf.metrics.find(metric => metric.name === 'JSHeapUsedSize')?.value;
        const row = { elapsed, ...dom, heap, ...client, ...await chromePrivateMemory(browserCdp) };
        samples.push(row);
        assert.ok(row.instances + row.pooled <= 4 && row.cache <= 16 && row.cacheBytes <= 2 * 1024 * 1024);
        assert.ok(row.pending <= 4 && row.canvases <= 4 && row.pixels <= 4 * 1280 * 220 * 4 &&
          row.backingPixels <= 4 * 1280 * 220 * 4);
      };
      const started = Date.now();
      let cycle = 0, previousSample = 0, submits = 0;
      const submitMs = [];
      await sample(0);
      while (Date.now() - started < soakSeconds * 1000) {
        if (soakPattern === 'scroll') await page.locator('#mainArea').evaluate((main, fraction) => {
          main.scrollTop = fraction * (main.scrollHeight - main.clientHeight);
        }, (cycle % 3) / 2);
        await page.waitForTimeout(2000);
        if (cycle % 30 === 29) {
          const submittedAt = Date.now();
          await page.locator('#goBtn').click();
          await page.waitForFunction(() => document.getElementById('trialStatus').textContent.startsWith('Ready: 480 routes'));
          if (soakView === 'charts') await page.waitForFunction(() => ChartMatrixTrial.instanceCount > 0);
          submitMs.push(Date.now() - submittedAt);
          submits++;
          assert.equal(await page.locator('.card').count(), 480);
        }
        const elapsed = Date.now() - started;
        if (elapsed - previousSample >= 60000) { await sample(elapsed); previousSample = elapsed; }
        cycle++;
      }
      await sample(Date.now() - started);
      const label = process.env.SOAK_LABEL || '';
      assert.match(label, /^[a-z0-9-]*$/, 'SOAK_LABEL must be lowercase letters, digits or hyphens');
      const target = path.join(root, 'test-results/p4-matrix-browser-soak-' + soakSeconds + 's' +
        (label ? '-' + label : '') + '.json');
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, JSON.stringify({ soakSeconds, soakPattern, soakView, releaseRoot,
        cycles: cycle, submits, submitMs,
        summaryRequests: requests.filter(route => route === '/api/v2/summary-batch').length,
        seriesRequests: requests.filter(route => route === '/api/v2/series').length,
        samples, errors }, null, 2));
      console.log('Soak report:', target);
      await cdp.detach();
      await browserCdp?.detach();
    }
    assert.equal(errors.length, 0, errors.join('\n'));
    const capPage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const capErrors = [];
    capPage.on('pageerror', error => capErrors.push(error.message));
    await capPage.goto(origin + '/chart-matrix-trial');
    await capPage.locator('.node').first().waitFor();
    for (const id of [...Array.from({ length: 15 }, (_, i) => `v${i}`), 'v16', 'v17', 'ext4'])
      await capPage.locator(`.node[data-node-id="${id}"] .node-select`).click();
    await capPage.locator('[data-mode="charts"]').click();
    assert.match(await capPage.locator('#selSummary').textContent(), /18 nodes.*499 results/);
    const capRequestStart = requests.length;
    await capPage.locator('#goBtn').click();
    await capPage.waitForFunction(() => document.getElementById('trialStatus').textContent.startsWith('Ready: 499 routes'));
    assert.equal(await capPage.locator('.card').count(), 499);
    assert.equal(await capPage.locator('.card .badge-v4').count(), 289);
    assert.equal(await capPage.locator('.card .badge-v6').count(), 210);
    assert.equal(await capPage.locator('.card .badge-ext').count(), 17);
    assert.equal(await capPage.locator('.card:has(.badge-ext) .badge-v6').count(), 0);
    assert.equal(requests.slice(capRequestStart).filter(route => route === '/api/v2/summary-batch').length, 16);
    await capPage.waitForFunction(() => ChartMatrixTrial.instanceCount > 0);
    assert.ok(await capPage.evaluate(() => ChartMatrixTrial.instanceCount + ChartMatrixTrial.pooledCount <= 4));
    assert.deepEqual(capErrors, []);
    await capPage.close();
    const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3.5 });
    const mobileErrors = [];
    mobile.on('pageerror', error => mobileErrors.push(error.message));
    await mobile.goto(origin + '/chart-matrix-trial');
    await mobile.locator('.node').first().waitFor({ state: 'attached' });
    await mobile.locator('#toggleSidebar').click();
    for (const id of ['v0', 'ext'])
      await mobile.locator('.node[data-node-id="' + id + '"] .node-select').click();
    await mobile.locator('[data-mode="charts"]').click();
    await mobile.locator('#goBtn').click();
    await mobile.waitForFunction(() => ChartMatrixTrial.instanceCount > 0);
    assert.equal(await mobile.locator('#sidebar').getAttribute('aria-hidden'), 'true');
    await mobile.waitForTimeout(260);
    assert.equal(await mobile.locator('#sidebar').evaluate(sidebar => getComputedStyle(sidebar).visibility), 'hidden');
    await mobile.screenshot({ path: path.join(root, 'test-results/p4-matrix-mobile.png') });
    await mobile.locator('.card').first().screenshot({ path: path.join(root, 'test-results/p4-matrix-card-mobile.png') });
    assert.ok(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth &&
      [...document.querySelectorAll('canvas')].reduce((sum, canvas) => sum + canvas.width * canvas.height, 0)
      <= ChartMatrixTrial.instanceCount * 1280 * 220 * 4));
    assert.deepEqual(mobileErrors, []);
    await mobile.close();
    const reduced = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    const reducedErrors = [];
    reduced.on('pageerror', error => reducedErrors.push(error.message));
    await reduced.goto(origin + '/chart-matrix-trial');
    await reduced.locator('.node').first().waitFor();
    for (const id of ['v0', 'ext'])
      await reduced.locator('.node[data-node-id="' + id + '"] .node-select').click();
    await reduced.locator('[data-mode="charts"]').click();
    await reduced.locator('#goBtn').click();
    await reduced.waitForFunction(() => ChartMatrixTrial.instanceCount > 0);
    await reduced.locator('[data-filter="v4"]').click();
    const reducedState = await reduced.evaluate(() => ({
      reveal: document.querySelectorAll('.trial-reveal').length,
      cards: [...document.querySelectorAll('.card')].filter(card => card.getAnimations().length).length,
      indicator: document.querySelector('#filterPills .segment-indicator').getAnimations().length,
      transition: getComputedStyle(document.querySelector('#filterPills .segment-indicator')).transitionDuration
    }));
    assert.deepEqual(reducedState, { reveal: 0, cards: 0, indicator: 0, transition: '0s' });
    assert.deepEqual(reducedErrors, []);
    await reduced.close();
    assert.equal(requests.includes('/api/graph.png'), false);
    console.log(JSON.stringify({ routes: 480, summaryPages: 15,
      fullReadyMs, filterMs,
      seriesRequests: requests.filter(route => route === '/api/v2/series').length,
      instanceCount: await page.evaluate(() => ChartMatrixTrial.instanceCount),
      cacheCount: await page.evaluate(() => ChartMatrixTrial.cacheCount), errors }, null, 2));
  } finally { await browser.close(); server.close(); }
})().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
