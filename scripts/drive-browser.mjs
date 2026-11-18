import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';
import { preview } from 'vite';

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
    const drivingViewport = { width: 800, height: 450 };
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
        traction: Math.round(read('power').value * 5),
        brake: Math.round(read('brake').value * 5),
        automatic: read('auto').getAttribute('aria-pressed') === 'true',
        notice: read('notice').textContent,
      };
    });
    const keys = key => page.keyboard.press(key);
    const setNotches = async (measured, desired, increase, decrease) => {
      if (measured === desired) return;
      const controls = { w: 'more-power', s: 'less-power', e: 'more-brake', q: 'less-brake' };
      const id = controls[measured < desired ? increase : decrease];
      await page.evaluate(({ control, steps }) => {
        for (let index = 0; index < steps; index++) document.getElementById(control).click();
      }, { control: id, steps: Math.abs(measured - desired) });
    };
    await keys('t');
    await keys('t');
    await setNotches(5, 0, 'e', 'q');
    await setNotches(0, 5, 'w', 's');
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
    let deadline = Date.now() + 18 * 60_000;
    const capture = async (name, view) => {
      const started = Date.now();
      await keys('p');
      await page.setViewportSize({ width: 1920, height: 1080 });
      await keys(view === 'cab' ? '1' : '2');
      await page.waitForFunction(selected => {
        const world = document.getElementById('world');
        return world.dataset.view === selected && world.querySelector('canvas').width === 1920;
      }, view, { timeout: 120_000, polling: 150 });
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
    let terminal = false;
    let crossed = 0;
    for (;;) {
      const current = await state();
      assert.equal(current.automatic, false);
      if (current.notice.includes('Score')) {
        console.log(current.notice);
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
      if (current.remaining <= 75 && !terminal) {
        terminal = true;
        await keys('t');
      }
      if (!bridgeApproach && current.chainage >= bridge.start - 120 && current.chainage < bridge.end) {
        bridgeApproach = true;
        await keys('t');
      }

      let traction = 0;
      let brake = 0;
      if (current.remaining <= 4) {
        brake = 5;
        if (current.speed === 0 && current.brake === 5) {
          await keys('d');
          await page.waitForTimeout(300);
          continue;
        }
      } else {
        const target = current.remaining < 32
          ? Math.max(3, Math.sqrt(0.50 * (current.remaining - 3)) * 3.6)
          : Math.min(current.limit - 9, 62, Math.sqrt(0.54 * (current.remaining - 4)) * 3.6);
        if (current.speed > target + 2) brake = current.speed > target + 8 ? 3 : 2;
        else if (current.speed < target - 2) traction = current.remaining < 30 ? 2 : 5;
        else traction = Math.min(current.traction, 1);
      }
      await setNotches(current.traction, traction, 'w', 's');
      await setNotches(current.brake, brake, 'e', 'q');
      if (current.structure === 'bridge' && !snapshots.has('bridge')) {
        snapshots.add('bridge');
        await capture('bridge', 'chase');
        await keys('t');
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
