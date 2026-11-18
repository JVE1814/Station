import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';
import { preview } from 'vite';
import { manualNotches } from './manual-driving.mjs';

const server = await preview({ preview: { host: '127.0.0.1', port: 4176 } });
try {
  const route = JSON.parse(await readFile(new URL('../public/data/service.json', import.meta.url), 'utf8'));
  const bridge = route.spans.find(span => span.bridge);
  assert.ok(bridge, 'The checkpoint route has no mapped bridge');
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH ?? '/usr/bin/chromium',
    args: ['--no-sandbox', '--enable-unsafe-swiftshader'],
  });
  try {
    const drivingViewport = { width: 480, height: 270 };
    const page = await browser.newPage({ viewport: drivingViewport });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await page.goto(server.resolvedUrls.local[0]);
    await page.waitForFunction(() => document.getElementById('world').dataset.stage === 'running', null,
      { timeout: 90_000, polling: 150 });

    const state = () => page.evaluate(() => {
      const read = id => document.getElementById(id);
      return {
        chainage: Number(read('world').dataset.chainage),
        structure: read('world').dataset.structure,
        view: read('world').dataset.view,
        remaining: Number(read('next-stop').textContent.match(/(\d+) m/)?.[1]),
        speed: Number(read('speed').textContent),
        limit: Number(read('limit').textContent) || 70,
        automatic: read('auto').getAttribute('aria-pressed') === 'true',
        notice: read('notice').textContent,
        complete: read('next-stop').textContent === 'Service complete',
      };
    });
    const keys = key => page.keyboard.press(key);
    const waitForPaint = () => page.evaluate(() =>
      new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    let controls = { traction: 0, brake: 5 };
    const setNotches = async (desired) => {
      const power = desired.traction - controls.traction;
      const brake = desired.brake - controls.brake;
      if (power || brake) {
        await page.evaluate(({ power, brake }) => {
          for (const [steps, increase, decrease] of [
            [power, 'more-power', 'less-power'], [brake, 'more-brake', 'less-brake'],
          ]) {
            const button = document.getElementById(steps > 0 ? increase : decrease);
            for (let index = 0; index < Math.abs(steps); index++) button.click();
          }
        }, { power, brake });
        controls = desired;
      }
    };
    await keys('t');
    await keys('t');
    await setNotches({ traction: 5, brake: 0 });
    await page.waitForFunction(() => Number(document.getElementById('speed').textContent) > 2, null,
      { timeout: 120_000, polling: 150 });
    const departed = await state();
    assert.equal(departed.automatic, false);
    console.log(`Manual departure · ${departed.speed} km/h, ${departed.remaining} m to Bulken`);
    await keys('2');
    await page.waitForFunction(() => document.getElementById('world').dataset.view === 'chase', null,
      { timeout: 90_000, polling: 150 });
    console.log('Switched to chase camera');
    await keys('3');
    await page.waitForFunction(() => document.getElementById('world').dataset.view === 'map', null,
      { timeout: 90_000, polling: 150 });
    console.log('Switched to bird’s-eye camera');
    await keys('1');
    console.log('Returned to cab camera');

    const snapshots = new Set();
    const cdp = await page.context().newCDPSession(page);
    await mkdir('evidence', { recursive: true });
    let deadline = Date.now() + 30 * 60_000;
    const capture = async (name, view) => {
      const started = Date.now();
      await keys('p');
      await keys(view === 'cab' ? '1' : '2');
      await page.waitForFunction(selected => document.getElementById('world').dataset.view === selected,
        view, { timeout: 120_000, polling: 150 });
      await page.setViewportSize({ width: 1920, height: 1080 });
      await page.waitForFunction(() => document.querySelector('#world canvas').width === 1920, null,
        { timeout: 120_000, polling: 150 });
      await waitForPaint();
      const shot = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true, optimizeForSpeed: true });
      await writeFile(`evidence/${name}.png`, Buffer.from(shot.data, 'base64'));
      console.log(`Captured ${name} at 1080p`);
      if (name !== 'station') {
        await page.setViewportSize(drivingViewport);
        await keys('1');
        await keys('p');
      }
      deadline += Date.now() - started;
    };
    let bridgeApproach = false;
    let approach = 0;
    let crossed = 0;
    for (;;) {
      const current = await state();
      assert.equal(current.automatic, false);
      if (current.complete) {
        await page.waitForFunction(() => document.getElementById('notice').textContent.includes('Score'), null,
          { timeout: 60_000, polling: 150 });
        console.log(await page.locator('#notice').textContent());
        await capture('station', 'chase');
        break;
      }
      assert.ok(Date.now() < deadline, 'Browser driving exceeded the allotted time');
      assert.ok(Number.isFinite(current.remaining), 'The next stopping marker is unavailable');
      assert.ok(!current.notice.includes('Stop missed'), `Missed the stop at route metre ${current.chainage}`);
      if (Math.floor(current.chainage / 500) > crossed) {
        crossed = Math.floor(current.chainage / 500);
        console.log(`Passed route metre ${Math.round(current.chainage)} at ${current.speed} km/h`);
      }
      const nextApproach = current.remaining <= 5 ? 3 : current.remaining <= 24 ? 2 : current.remaining <= 120 ? 1 : 0;
      if (nextApproach > approach) {
        approach = nextApproach;
        console.log(`Bulken approach · ${current.remaining} m remaining, ${current.speed} km/h`);
      }
      if (!bridgeApproach && current.chainage >= bridge.start - 120 && current.chainage < bridge.end) {
        bridgeApproach = true;
        await keys('t');
        await keys('t');
      }

      await setNotches(manualNotches(current.speed, current.remaining, current.limit));
      if (current.remaining <= 5 && current.speed === 0) {
        await keys('d');
        await waitForPaint();
        continue;
      }
      if (current.structure === 'bridge' && !snapshots.has('bridge')) {
        snapshots.add('bridge');
        await capture('bridge', 'chase');
        await keys('t');
      }
      if (current.structure === 'tunnel' && current.chainage > 1885 && !snapshots.has('tunnel')) {
        snapshots.add('tunnel');
        await capture('tunnel', 'cab');
      }
      await page.waitForTimeout(120);
    }
    assert.deepEqual([...snapshots].sort(), ['bridge', 'tunnel']);
    assert.deepEqual(errors, []);
    console.log('Manual browser run completed with zero console errors.');
  } finally {
    await browser.close();
  }
} finally {
  server.httpServer.close();
}
