import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';
import { preview } from 'vite';

const viewport = { width: 1920, height: 1080 };
const captureOnly = process.argv.includes('--captures-only');
const captures = captureOnly || process.argv.includes('--captures');
const requestedCondition = process.argv.find(value => value.startsWith('--condition='))?.split('=')[1];
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
    const foreign = [];
    const origin = new URL(server.resolvedUrls.local[0]).origin;
    await page.route('**/*', request => {
      const target = new URL(request.request().url());
      if (target.origin === origin || target.protocol === 'data:' || target.protocol === 'blob:') {
        return request.continue();
      }
      foreign.push(target.href);
      return request.abort('internetdisconnected');
    });
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
            window.frameCosts.push({ time: entry.detail ?? entry.startTime, cpu: entry.duration });
          }
        }
      }).observe({ entryTypes: ['measure'] });
    });
    await page.goto(`${server.resolvedUrls.local[0]}?audit=trackbed`);
    await page.locator('#world canvas').waitFor();
    await page.waitForFunction(() => document.querySelector('#next-stop')?.textContent.length > 0, null, { timeout: 60_000, polling: 150 });
    const bed = JSON.parse(await page.locator('#world').getAttribute('data-trackbed-audit'));
    console.log(`Trackbed terrain audit: ${bed.sampleCount} samples, maximum gap ${bed.maxGap.toFixed(3)} m, missing ${bed.missingCount}.`);
    const activate = async (id) => page.evaluate(target => document.getElementById(target).click(), id);
    const setView = async (selector, view) => {
      if (await page.locator('#world').getAttribute('data-view') !== view) await activate(selector);
      await page.waitForFunction(name => document.querySelector('#world').dataset.view === name, view, { timeout: 120_000, polling: 150 });
    };
    const views = [['cab-view', 'cab'], ['chase-view', 'chase'], ['map-view', 'map']];
    const stats = [];
    let target;
    if (!captureOnly) {
      const renderer = await page.locator('#world').getAttribute('data-renderer');
      const software = /swiftshader|llvmpipe|software|softpipe/i.test(renderer);
      target = software ? 8 : 16.7;
      const traceSession = software ? await page.context().newCDPSession(page) : undefined;
      const cpuFrameTimes = async () => {
        const marks = [];
        const collect = ({ value }) => {
          for (const event of value) {
            if (event.name === 'station-frame-start' || event.name === 'station-frame-end') marks.push(event);
          }
        };
        traceSession.on('Tracing.dataCollected', collect);
        const complete = new Promise(resolve => traceSession.once('Tracing.tracingComplete', resolve));
        await traceSession.send('Tracing.end');
        await complete;
        traceSession.off('Tracing.dataCollected', collect);
        const costs = [];
        let start;
        for (const mark of marks) {
          if (mark.name === 'station-frame-start') start = mark;
          else if (start && mark.tid === start.tid && Number.isFinite(start.tts) && Number.isFinite(mark.tts)) {
            costs.push((mark.tts - start.tts) / 1000);
            start = undefined;
          }
        }
        assert.ok(costs.length >= 69, 'Chromium did not report enough per-frame main-thread CPU timestamps');
        return costs.slice(0, 69);
      };
      const p95 = values => [...values].sort((a, b) => a - b)[Math.ceil(values.length * 0.95) - 1];
      console.log(`1080p WebGL2 renderer: ${renderer}`);
      await activate('compression');
      await activate('compression');
      await activate('auto');
      console.log('Sampling the moving train at 5× simulation speed.');
      await page.waitForFunction(() => Number(document.querySelector('#speed')?.textContent) >= 5, null, { timeout: 120_000, polling: 150 });
      for (const [selector, view] of views) {
        await setView(selector, view);
        if (traceSession) await traceSession.send('Tracing.start', {
          categories: 'blink.user_timing', transferMode: 'ReportEvents',
        });
        await page.evaluate(() => { window.frameCosts.length = 0; });
        await page.waitForFunction(() => window.frameCosts.length >= 70, null,
          { timeout: software ? 600_000 : 120_000, polling: 150 });
        const sample = await page.evaluate(() => window.frameCosts.slice(0, 70));
        const intervals = sample.slice(1).map((frame, index) => frame.time - sample[index].time);
        const result = p95(traceSession ? await cpuFrameTimes() : intervals);
        stats.push([view, result]);
        console.log(`${view} p95: ${result.toFixed(2)} ms (${software ? 'renderer main-thread CPU proxy' : 'frame interval'})`);
        if (software) console.log(`  Software timing: ${p95(intervals).toFixed(2)} ms wall frame interval, ${p95(sample.map(frame => frame.cpu)).toFixed(2)} ms wall callback.`);
        const loads = await page.locator('#world').evaluate(world => ({
          draws: world.dataset.drawCalls, triangles: world.dataset.triangles,
        }));
        console.log(`  Last rendered frame: ${loads.draws} draw calls, ${loads.triangles} triangles.`);
      }
    }

    if (captures) {
      await page.waitForFunction(() => document.getElementById('world').dataset.structure !== 'tunnel', null,
        { timeout: 600_000, polling: 150 });
      await activate('pause');
      const marker = await page.locator('#world').getAttribute('data-chainage');
      console.log(`Capture location: R40 route metre ${marker}.`);
      await mkdir('evidence', { recursive: true });
      const cdp = await page.context().newCDPSession(page);
      const conditions = requestedCondition ? [requestedCondition] : ['day', 'night', 'snow'];
      let night = false;
      for (const condition of conditions) {
        if (!['day', 'night', 'snow'].includes(condition)) throw new Error(`Unknown capture condition ${condition}`);
        if ((condition === 'night') !== night) {
          await activate('day');
          night = !night;
        }
        if (condition === 'snow') {
          await activate('weather');
          await activate('weather');
        }
        for (const [selector, view] of views) {
          await setView(selector, view);
          const shot = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true, optimizeForSpeed: true });
          await writeFile(`evidence/${view}-${condition}.png`, Buffer.from(shot.data, 'base64'));
          console.log(`Captured ${view} · ${condition}`);
        }
      }
    }

    console.log(`Browser console errors: ${errors.length}; external requests: ${foreign.length}.`);
    assert.deepEqual(foreign, [], 'The offline build made a request outside the static server');
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
