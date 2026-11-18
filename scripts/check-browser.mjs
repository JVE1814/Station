import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { preview } from 'vite';

const server = await preview({preview:{host:'127.0.0.1', port:4187}});
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? '/usr/bin/chromium',
  args: ['--no-sandbox', '--enable-unsafe-swiftshader'],
});
try {
  const page = await browser.newPage({viewport:{width:1920,height:1080},deviceScaleFactor:1});
  const errors = [];
  const external = [];
  const origin = new URL(server.resolvedUrls.local[0]);
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin === origin.origin || ['blob:','data:'].includes(url.protocol)) return route.continue();
    external.push(url.href);
    return route.abort('internetdisconnected');
  });
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', item => { if (item.type() === 'error') errors.push(item.text()); });

  const launch = async (hero = '') => {
    const query = new URLSearchParams({line:'R40',quality:'high',audit:'trackbed'});
    if (hero) query.set('hero',hero);
    await page.goto(new URL('?' + query, origin).href,{timeout:180000});
    await page.waitForFunction(() => document.getElementById('world').dataset.stage === 'running',null,{timeout:180000,polling:250});
  };
  await launch('02-evanger-cab');
  const renderer = await page.locator('#world').getAttribute('data-renderer');
  const software = /swiftshader|llvmpipe|softpipe|software/i.test(renderer ?? '');
  console.log('1080p High renderer:',renderer);
  const views = [['cab','02-evanger-cab'],['chase','01-lakeside-chase'],['map','07-lake-overlook']];
  if (!software) {
    await launch();
    await page.keyboard.press('a');
    await page.waitForFunction(() => Number(document.getElementById('speed').textContent) >= 15,null,{timeout:120000});
  }
  for (const [index, [view, hero]] of views.entries()) {
    let previousFrame;
    if (software && index) {
      previousFrame = await page.evaluate(id => {
        const frame = document.getElementById('world').dataset.captureFrame;
        window.dispatchEvent(new CustomEvent('station-capture', {detail: {id, look:'golden'}}));
        return frame;
      }, hero);
      assert.ok(previousFrame, 'The first workload capture rendered a frame');
    }
    if (!software) await page.keyboard.press(String(index + 1));
    await page.waitForFunction(({view, previousFrame}) => {
      const state = document.getElementById('world').dataset;
      return state.view === view && (!previousFrame || (state.stage === 'running' && state.captureFrame !== previousFrame));
    }, {view, previousFrame}, {timeout:180000,polling:250});
    const info = await page.locator('#world').evaluate(el => ({
      calls: Number(el.dataset.drawCalls), triangles: Number(el.dataset.triangles)
    }));
    assert.ok(info.calls > 0 && info.triangles > 0, view + ' must render geometry');
    if (software) {
      console.log(`${view}: ${info.calls} draw calls, ${info.triangles} triangles (software renderer, timing omitted)`);
      continue;
    }
    const times = await page.evaluate(() => new Promise(resolve => {
      const values = [];
      function sample(now) {
        values.push(now);
        if (values.length < 121) requestAnimationFrame(sample);
        else resolve(values.slice(1).map((value, i) => value-values[i]).sort((a,b)=>a-b));
      }
      requestAnimationFrame(sample);
    }));
    const p95 = times[Math.ceil(times.length*.95)-1];
    console.log(`${view} p95: ${p95.toFixed(2)} ms, ${info.calls} draws, ${info.triangles} triangles`);
    assert.ok(p95 <= 16.7, view + ' exceeds the hardware frame budget');
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);

  const layout = await browser.newPage({viewport:{width:960, height:600}});
  await layout.route('**/assets/*.js', route => route.fulfill({contentType:'text/javascript', body:''}));
  await layout.goto(origin.href);
  for (const width of [960, 720]) {
    await layout.setViewportSize({width, height:600});
    const result = await layout.evaluate(() => {
      document.body.classList.add('showpiece');
      const card = document.getElementById('trip-result');
      card.hidden = false;
      for (const [id, value] of Object.entries({
        'result-title': 'Seimsgrend', 'result-score': '83 / 100', 'result-timing': '89 s late',
        'result-position': '1.1 m from marker', 'result-passengers': '10 boarded · 7 alighted',
        'brake-cue': 'Within stop zone · D to open doors',
      })) {
        const element = document.getElementById(id);
        element.hidden = false;
        element.textContent = value;
      }
      for (const button of document.querySelectorAll('.auxiliary button')) button.hidden = false;
      const button = document.getElementById('hide-result');
      const bounds = button.getBoundingClientRect();
      const front = document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
      return card.getBoundingClientRect().bottom < document.querySelector('.bottom-bar').getBoundingClientRect().top
        && button.contains(front);
    });
    assert.ok(result, `Stop results must clear the controls at ${width}×600`);
  }
  await layout.close();
  console.log('Stop result dismissal is visible and clickable at 960×600 and 720×600.');
} finally {
  await browser.close();
  server.httpServer.close();
}
