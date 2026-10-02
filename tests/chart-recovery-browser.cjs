'use strict';
// Main-page regression: real Chrome, isolated transport; no production stress.
const assert = require('node:assert/strict');
const path = require('node:path');
const { fork } = require('node:child_process');
const { chromium } = require('playwright');
const fixture = fork(path.join(__dirname, 'chart-matrix-browser.cjs'), [], {
  env: { ...process.env, MATRIX_FIXTURE_ONLY: '1' }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true
});
const message = type => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('fixture timeout')), 15000);
  const receive = value => { if (value.type === type) { clearTimeout(timer); fixture.off('message', receive); resolve(value); } };
  fixture.on('message', receive);
});
const configure = async settings => { const ready = message('configured'); fixture.send({ type: 'configure', settings }); await ready; };
(async () => {
  const { origin } = await message('ready');
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1800, height: 1400 } });
    page.setDefaultTimeout(15000);
    const requests = [], errors = [];
    page.on('request', r => requests.push(new URL(r.url()).pathname));
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(origin + '/?renderer=canvas');
    await page.locator('#n_v0').waitFor();
    for (const id of ['v0', 'v1', 'v2']) await page.locator('#n_' + id + ' .node-select').click();
    await page.locator('[data-mode="charts"]').click();
    await page.locator('#goBtn').click();
    const filled = async () => page.waitForFunction(() => {
      const bounds = document.getElementById('mainArea').getBoundingClientRect();
      const visible = [...document.querySelectorAll('.trial-plot')].filter(plot => {
        const r = plot.getBoundingClientRect(); return r.bottom > bounds.top && r.top < bounds.bottom;
      });
      return visible.length > 4 && visible.every(plot => {
        const img = plot.querySelector('img');
        return plot.querySelector('canvas') || img?.complete && img.naturalWidth > 300 &&
          getComputedStyle(img).opacity === '1' && getComputedStyle(img).visibility === 'visible';
      }) && MainCanvas.pendingCount === 0;
    }).catch(async error => {
      console.log(await page.evaluate(() => ({ status: document.getElementById('canvasStatus')?.textContent,
        pending: MainCanvas.pendingCount, previews: MainCanvas.previewCount,
        bounds: document.getElementById('mainArea').getBoundingClientRect().toJSON(),
        plots: [...document.querySelectorAll('.trial-plot')].map(p => ({ text: p.textContent,
          top: p.getBoundingClientRect().top, bottom: p.getBoundingClientRect().bottom,
          canvas: !!p.querySelector('canvas'), image: p.querySelector('img')?.naturalWidth })) })));
      throw error;
    });
    await filled();
    console.log('two-column initial viewport filled');
    assert.equal(await page.locator('#graphGrid').evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length), 2);
    const painted = await page.locator('.card:has(canvas), .card:has(.trial-preview)').evaluateAll(cards => cards.map(c => c.dataset.index));
    await page.locator('#mainArea').evaluate(el => { el.scrollTop = el.scrollHeight; });
    await filled();
    console.log('bottom viewport filled');
    for (const index of painted) assert.equal(await page.locator(`.card[data-index="${index}"] canvas, .card[data-index="${index}"] .trial-preview`).count(), 1);
    await page.setViewportSize({ width: 1700, height: 1400 });
    await filled();
    assert.ok(await page.evaluate(() => MainCanvas.instanceCount + MainCanvas.pooledCount <= 4));
    // Viewport scrolling and resize must not erase existing pictures.
    await page.locator('#mainArea').evaluate(el => { el.scrollTop = 0; });
    await filled();
    await configure({ failSeries: true });
    await page.locator('#goBtn').click();
    const retry = page.getByRole('button', { name: 'Retry chart', exact: true }).first();
    await retry.waitFor();
    await page.waitForFunction(() => MainCanvas.pendingCount === 0);
    const before = requests.length;
    await page.locator('#mainArea').evaluate(el => { el.scrollTop = 1; });
    await page.waitForTimeout(400);
    assert.equal(requests.length, before, 'failed requests do not retry on scroll');
    await configure({ failSeries: false });
    const retryIndex = await retry.evaluate(el => el.closest('.card').dataset.index);
    await retry.click();
    await page.locator(`.card[data-index="${retryIndex}"] canvas, .card[data-index="${retryIndex}"] .trial-preview`).waitFor();
    assert.equal(await page.locator(`.card[data-index="${retryIndex}"] .problem`).count(), 0);
    await configure({ changedSeries: true });
    await page.locator('#goBtn').click();
    const rebuild = page.getByRole('button', { name: 'Reload matrix', exact: true }).first();
    await rebuild.waitFor();
    // Leave a different duration and an extra node uncommitted.
    await page.locator('#durSelect').selectOption('21600');
    await page.locator('#n_v3 .node-select').click();
    await configure({ changedSeries: false });
    await rebuild.click();
    await filled();
    assert.equal(await page.evaluate(() => MainCanvas.matrix.dur), 10800);
    assert.equal(await page.evaluate(() => MainCanvas.pairs.some(p => p.source === 'v3' || p.target === 'v3')), false);
    assert.equal(await page.locator('#durSelect').inputValue(), '21600');
    assert.equal(await page.locator('#goBtn').getAttribute('data-pending'), 'true');
    assert.equal(await page.locator('.problem').count(), 0);
    assert.ok(!requests.some(p => /graph\.png|\/api\/stats/.test(p)));
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ passed: true, twoColumns: true, moreThanFourVisible: true,
      retainedOnScrollResize: true, retry: true, changedSummaryRebuild: true, preservesDraft: true }));
  } finally { await browser.close(); fixture.kill(); }
})().catch(error => { console.error(error); fixture.kill(); process.exitCode = 1; });
