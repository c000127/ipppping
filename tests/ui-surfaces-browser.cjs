/* Local Chrome surface/Fixed regression; optional explicitly authorized small public check. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { fork } = require('node:child_process');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const publicPass = process.env.UI_PUBLIC_PASS === '1';
const releaseRoot = process.env.TEST_RELEASE_ROOT || 'build/web-release-ui-20261001';
assert.match(releaseRoot, /^build\/web-release(?:-[a-z0-9-]+)?$/);
const manifestBytes = fs.readFileSync(path.join(root, releaseRoot, 'manifest.json'));
const manifest = JSON.parse(manifestBytes);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const longName = 'Halo Akari VeryLongNodeNameWithoutAnySpaces JP';
let fixture;
async function origin() {
  if (publicPass) return 'https://ipppping.hachimihaqile.top';
  fixture = fork(path.join(__dirname, 'chart-matrix-browser.cjs'), [], {
    cwd: root, env: { ...process.env, MATRIX_FIXTURE_ONLY: '1' },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true
  });
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('fixture timeout')), 15000);
    fixture.on('message', value => { if (value.type === 'ready') { clearTimeout(timeout); resolve(value.origin); } });
  });
}
async function theme(page) {
  await page.mouse.move(1, 1);
  await page.waitForTimeout(200);
  return page.evaluate(() => {
    const body = getComputedStyle(document.body);
    const selectors = ['body', '.topbar', '.sidebar', '.sidebar-foot', '.pills', '.range-select', '.card'];
    return {
      tokens: Object.fromEntries(['--bg', '--bg-panel', '--bg-header', '--bg-card', '--bg-actions',
        '--bg-control', '--bg-selected', '--bg-plot', '--text', '--text-sec', '--text-dim', '--border', '--radius']
        .map(key => [key, body.getPropertyValue(key).trim()])),
      surfaces: Object.fromEntries(selectors.map(selector => [selector, getComputedStyle(document.querySelector(selector)).backgroundColor])),
      text: getComputedStyle(document.querySelector('.node-label')).color
    };
  });
}
function assertHierarchy(value) {
  const s = value.surfaces;
  assert.equal(new Set([s.body, s['.sidebar'], s['.topbar'], s['.card'], s['.sidebar-foot'], s['.pills']]).size, 6,
    'canvas shell/sidebar/header/cards/actions/controls need distinct neutral surfaces');
}
async function fixedGeometry(page, id) {
  return page.locator('.node[data-node-id="' + id + '"]').evaluate(row => {
    const label = row.querySelector('.node-label'), pick = row.querySelector('.node-select');
    const protocol = row.querySelector('.node-protocols'), button = row.querySelector('.node-anchor');
    const r = el => { const b = el.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; };
    return { label: r(label), row: r(row), protocol: r(protocol), button: r(button), title: pick.title,
      text: label.textContent, whiteSpace: getComputedStyle(label).whiteSpace,
      overflow: getComputedStyle(label).textOverflow, icon: !!button.querySelector('svg[aria-hidden="true"]'),
      border: getComputedStyle(button).borderTopWidth, pressed: button.getAttribute('aria-pressed'),
      accessible: button.getAttribute('aria-label'), motion: getComputedStyle(button).animationName };
  });
}
(async () => {
  const base = await origin();
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const report = { public: publicPass, manifestSha256: hash(manifestBytes), cases: [], errors: [] };
  const out = path.join(root, 'test-results', publicPass ? 'ui-surfaces-public-20261001' : 'ui-surfaces-local-20261001');
  fs.mkdirSync(out, { recursive: true });
  try {
    if (publicPass) {
      for (const [name, expected] of Object.entries(manifest.assets)) {
        const response = await fetch(base + '/static/assets/' + name, { signal: AbortSignal.timeout(20000) });
        assert.equal(response.status, 200); assert.equal(hash(Buffer.from(await response.arrayBuffer())), expected);
      }
    }
    for (const entry of ['/?renderer=canvas', '/?renderer=png', '/chart-matrix-trial']) {
      const trial = entry.includes('trial'), canvas = !entry.includes('png');
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      const requests = [], loaded = [];
      page.on('pageerror', error => report.errors.push(error.message));
      page.on('request', request => { const p = new URL(request.url()).pathname; loaded.push(p); if (p.startsWith('/api/')) requests.push(p); });
      if (!publicPass) await page.route('**/api/nodes', async route => {
        const response = await route.fetch(), data = await response.json();
        data.find(node => node.id === 'v0').label = longName;
        await route.fulfill({ response, json: data });
      });
      // The matrix fixture has JSON routes only. This image exercises the real
      // PNG loading path/geometry, not RRDtool image content or transmission cost.
      if (!publicPass) await page.route('**/api/graph.png*', route => route.fulfill({
        contentType: 'image/png',
        body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=', 'base64')
      }));
      await page.goto(base + entry);
      await page.locator('.node').first().waitFor();
      await page.evaluate(() => document.fonts.ready);
      assert.deepEqual(requests, ['/api/nodes'], 'opening any entry must not query matrix');
      if (!trial) assert.ok(!loaded.some(p => /uplot|matrix-renderer|chart-matrix-trial\.\w+\.css/.test(p)), 'Results does not load Canvas');
      const ids = publicPass ? ['akari_jp', 'google_dns'] : ['v0', 'ext'];
      for (const id of ids) await page.locator('.node[data-node-id="' + id + '"] .node-select').click();
      const before = await fixedGeometry(page, ids[0]);
      await page.locator('[data-pair-mode="fixed"]').click();
      const fixedButton = page.locator('[data-anchor-node="' + ids[0] + '"]');
      await fixedButton.focus(); await page.keyboard.press('Space');
      const after = await fixedGeometry(page, ids[0]);
      assert.equal(after.pressed, 'true'); assert.ok(after.icon);
      assert.match(after.accessible, /Remove .* from fixed nodes/);
      assert.equal(after.title, after.text);
      assert.equal(after.whiteSpace, 'nowrap'); assert.equal(after.overflow, 'ellipsis');
      assert.equal(after.label.w, before.label.w); assert.equal(after.row.h, before.row.h);
      assert.equal(after.label.h, before.label.h); assert.ok(after.button.w >= 32);
      assert.ok(after.label.x + after.label.w <= after.button.x);
      assert.ok(after.protocol.y >= after.label.y + after.label.h);
      assert.equal(after.border, '0px');
      assert.equal(requests.length, 1, 'Fixed keyboard interaction must not query data');
      await page.locator('#goBtn').click();
      await page.waitForFunction(() => [...document.querySelectorAll('.stat-number')].some(el => el.textContent !== '—'));
      const resultsTheme = await theme(page); assertHierarchy(resultsTheme);
      await page.screenshot({ path: path.join(out, (trial ? 'trial' : canvas ? 'canvas' : 'png') + '-results.png') });
      await page.locator('[data-mode="charts"]').click();
      await page.locator('#goBtn').click();
      if (canvas) await page.waitForFunction(() => document.querySelector('canvas') && !document.querySelector('.trial-reveal'));
      else await page.waitForFunction(() => [...document.querySelectorAll('.card-img img')].some(img => img.complete && img.naturalWidth > 0));
      const chartsTheme = await theme(page);
      assert.deepEqual(chartsTheme, resultsTheme, 'Results -> Charts must not repaint shared surfaces or tokens');
      const plotBg = await page.locator('.card-img').first().evaluate(el => getComputedStyle(el).backgroundColor);
      assert.notEqual(plotBg, chartsTheme.surfaces['.card'], 'drawing surface needs a separate luminance from metrics');
      if (canvas) assert.ok(!requests.some(p => p === '/api/graph.png'), 'Canvas must not load PNG');
      await page.screenshot({ path: path.join(out, (trial ? 'trial' : canvas ? 'canvas' : 'png') + '-charts.png') });
      await page.locator('[data-mode="stats"]').click(); await page.locator('#goBtn').click();
      await page.waitForFunction(() => !document.querySelector('canvas') && !!document.querySelector('.stats-only'));
      assert.deepEqual(await theme(page), resultsTheme, 'returning from Canvas must keep theme after lazy CSS loaded');
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await fixedButton.click();
      assert.equal((await fixedGeometry(page, ids[0])).motion, 'none');
      await fixedButton.focus(); await page.keyboard.press('Enter');
      assert.equal(await fixedButton.getAttribute('aria-pressed'), 'true');
      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForTimeout(200); await page.locator('#toggleSidebar').click();
      const mobile = await fixedGeometry(page, ids[0]);
      assert.ok(mobile.button.w >= 40 && mobile.button.h >= 40);
      assert.equal(mobile.label.h, before.label.h);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.screenshot({ path: path.join(out, (trial ? 'trial' : canvas ? 'canvas' : 'png') + '-fixed-mobile.png') });
      report.cases.push({ entry, theme: chartsTheme, plotBg, fixed: after, mobile });
      await page.close();
    }
    assert.deepEqual(report.errors, []);
    report.passed = true;
    console.log(JSON.stringify({ passed: true, public: publicPass, cases: report.cases.length, errors: report.errors }));
  } finally {
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; })
  .finally(() => { if (fixture && fixture.exitCode === null) fixture.kill(); });
