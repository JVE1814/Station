import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright-core';
import { preview } from 'vite';

const viewport = { width: 1920, height: 1080 };
const captureOnly = process.argv.includes('--captures-only');
const captures = captureOnly || process.argv.includes('--captures');
const server = await preview({ preview: { host: '127.0.0.1', port: 4173 } });
try {
  const executablePath = process.env.CHROMIUM_PATH ?? '/usr/bin/chromium';
  const browser = await chromium.launch({
    executablePath,
    args: ['--no-sandbox', '--enable-unsafe-swiftshader'],
  });
  try {
    const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
    const errors = [];
    page.on('pageerror', error => {
      errors.push(error.message);
      console.error(error.message);
    });
    page.on('console', message => {
      if (message.type() === 'error') {
        errors.push(message.text());
        console.error(message.text());
      }
    });
    await page.addInitScript(() => {
      window.frameCosts = [];
      new PerformanceObserver(list => {
        for (const entry of list.getEntries()) {
          if (entry.name === 'station-frame' && window.frameCosts.length < 10000) {
            window.frameCosts.push({ time: entry.startTime, cpu: entry.duration });
          }
        }
      }).observe({ entryTypes: ['measure'] });
    });
    await page.goto(`${server.resolvedUrls.local[0]}?audit=trackbed`);
    await page.locator('#world canvas').waitFor();
    await page.waitForFunction(() => document.querySelector('#next-stop')?.textContent.length > 0, null, { timeout: 60_000, polling: 150 });
    const bed = JSON.parse(await page.locator('#world').getAttribute('data-trackbed-audit'));
    console.log(`Trackbed terrain audit: ${bed.sampleCount} samples, maximum gap ${bed.maxGap.toFixed(3)} m, missing ${bed.missingCount}.`);
    const setView = async (selector, view) => {
      await page.locator(`#${selector}`).press('Enter', { timeout: 45_000 });
      await page.waitForFunction(name => document.querySelector('#world').dataset.view === name, view, { timeout: 60_000, polling: 150 });
    };
    const views = [['cab-view', 'cab'], ['chase-view', 'chase'], ['map-view', 'map']];
    const stats = [];
    let target;
    if (!captureOnly) {
      const renderer = await page.locator('#world').getAttribute('data-renderer');
      const software = /swiftshader|llvmpipe|software|softpipe/i.test(renderer);
      target = software ? 8 : 16.7;
      console.log(`1080p WebGL2 renderer: ${renderer}`);
      await page.locator('#auto').press('Enter', { timeout: 45_000 });
      await page.waitForFunction(() => Number(document.querySelector('#speed')?.textContent) >= 5, null, { timeout: 120_000, polling: 150 });
      for (const [selector, view] of views) {
        await setView(selector, view);
        await page.evaluate(() => { window.frameCosts.length = 0; });
        await page.waitForFunction(() => window.frameCosts.length >= 70, null, { timeout: 90_000, polling: 150 });
        const costs = await page.evaluate(useCpu => window.frameCosts
          .slice(1, 70)
          .map((frame, index) => useCpu ? frame.cpu : frame.time - window.frameCosts[index].time), software);
        costs.sort((a, b) => a - b);
        const result = costs[Math.ceil(costs.length * 0.95) - 1];
        stats.push([view, result]);
        console.log(`${view} p95: ${result.toFixed(2)} ms (${software ? 'main-thread CPU proxy' : 'frame interval'})`);
      }
    }

    if (captures) {
      await mkdir('evidence', { recursive: true });
      for (const condition of ['day', 'night', 'snow']) {
        if (condition === 'night') await page.locator('#day').press('Enter');
        if (condition === 'snow') {
          await page.locator('#day').press('Enter');
          await page.locator('#weather').press('Enter');
          await page.locator('#weather').press('Enter');
        }
        for (const [selector, view] of views) {
          await setView(selector, view);
          await page.screenshot({ path: `evidence/${view}-${condition}.png`, timeout: 45_000 });
        }
      }
    }

    console.log(`Browser console errors: ${errors.length}`);
    assert.ok(bed.sampleCount > 0 && bed.missingCount === 0, 'Trackbed terrain check has missing intersections');
    assert.ok(bed.maxGap <= 0.5, `Trackbed terrain gap ${bed.maxGap} m exceeds 0.5 m`);
    if (errors.length) throw new Error(errors.join('\n'));
    const failing = stats.filter(([, time]) => target !== undefined && time > target);
    if (failing.length) throw new Error(`p95 limit ${target} ms exceeded: ${failing.map(([view]) => view).join(', ')}`);
  } finally {
    await browser.close();
  }
} finally {
  server.httpServer.close();
}
