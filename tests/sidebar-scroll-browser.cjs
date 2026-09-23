/* Read-only reproduction of sidebar movement when selecting lower nodes. */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const origin = process.env.ORIGIN || 'https://ipppping.hachimihaqile.top';
const output = path.join(__dirname, '..', 'test-results', 'sidebar-scroll');
fs.mkdirSync(output, { recursive: true });

async function snapshot(page) {
  return page.evaluate(() => {
    const inner = document.querySelector('#sidebarInner');
    const sidebar = document.querySelector('#sidebar');
    return {
      windowY: scrollY,
      viewportOffsetY: visualViewport?.offsetTop,
      viewportHeight: visualViewport?.height,
      innerHeight,
      sidebarY: inner.scrollTop,
      sidebarMaxY: inner.scrollHeight - inner.clientHeight,
      sidebarShellY: sidebar.scrollTop,
      sidebarRectY: sidebar.getBoundingClientRect().y,
      sidebarHeight: sidebar.getBoundingClientRect().height,
      footerY: document.querySelector('.sidebar-foot').getBoundingClientRect().y,
      footerHeight: document.querySelector('.sidebar-foot').getBoundingClientRect().height,
      mainY: document.querySelector('#mainArea').scrollTop,
      active: document.activeElement?.id,
      activeRectY: document.activeElement?.getBoundingClientRect().y,
    };
  });
}

(async () => {
  const browser = await chromium.launch({ headless: true, channel: process.env.BROWSER_CHANNEL || 'chrome' });
  try {
    const report = [];
    for (const { name, width, height, mobile, target } of [
      { name: 'desktop-last-vps', width: 1440, height: 900, mobile: false, target: '.section:first-child .node-select:last-of-type' },
      { name: 'desktop-last-node', width: 1440, height: 900, mobile: false, target: '.node-select' },
      { name: 'mobile-last-vps', width: 390, height: 844, mobile: true, target: '.section:first-child .node-select:last-of-type' },
      { name: 'mobile-last-node', width: 390, height: 844, mobile: true, target: '.node-select' },
    ]) {
      const context = await browser.newContext({ viewport: { width, height }, isMobile: mobile, hasTouch: mobile });
      const page = await context.newPage();
      await page.goto(origin, { waitUntil: 'networkidle', timeout: 60000 });
      await page.locator('.node-select').last().waitFor({ state: 'attached' });
      if (mobile) await page.locator('#toggleSidebar').click();
      const row = page.locator(target).last();
      await row.scrollIntoViewIfNeeded();
      const before = await snapshot(page);
      if (mobile) await row.tap(); else await row.click();
      await page.waitForTimeout(150);
      const after = await snapshot(page);
      report.push({ name, node: await row.locator('.node-label').innerText(), before, after });
      assert.equal(after.windowY, before.windowY, `${name} scrolled the page`);
      assert.equal(after.sidebarShellY, before.sidebarShellY, `${name} scrolled the sidebar shell`);
      assert.ok(Math.abs(after.sidebarY - before.sidebarY) <= 4, `${name} moved the node list`);
      await page.screenshot({ path: path.join(output, `${name}.png`) });
      await context.close();
    }
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
