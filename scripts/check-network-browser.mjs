import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';
import { preview } from 'vite';

const server = await preview({ preview: { host: '127.0.0.1', port: 4177 } });
const captures = process.argv.includes('--captures');
try {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH ?? '/usr/bin/chromium',
    args: ['--no-sandbox', '--enable-unsafe-swiftshader'],
  });
  try {
    if (captures) await mkdir('evidence', { recursive: true });
    const expected = new Map([['F4', 'Bergen'], ['F5', 'Stavanger'], ['F6', 'Trondheim']]);
    for (const [ref, destination] of expected) {
      const captureLine = captures && ref === 'F4';
      const viewport = captureLine ? { width: 1920, height: 1080 } : { width: 640, height: 360 };
      const page = await browser.newPage({ viewport });
      page.setDefaultTimeout(180_000);
      const cdp = captureLine ? await page.context().newCDPSession(page) : undefined;
      const capture = async (name) => {
        if (!cdp) return;
        const image = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true, optimizeForSpeed: true });
        await writeFile(`evidence/${name}.png`, Buffer.from(image.data, 'base64'));
      };
      const errors = [];
      const foreignRequests = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => {
        if (message.type() === 'error') errors.push(message.text());
      });
      const uri = new URL(server.resolvedUrls.local[0]);
      uri.searchParams.set('line', ref);
      await page.route('**/*', route => {
        const request = new URL(route.request().url());
        if (request.origin === uri.origin || request.protocol === 'data:' || request.protocol === 'blob:') {
          return route.continue();
        }
        foreignRequests.push(request.href);
        return route.abort('internetdisconnected');
      });
      await page.goto(uri.href);
      const boot = await page.waitForFunction(() => {
        if (document.getElementById('world').dataset.stage !== 'running') return false;
        document.getElementById('pause').click();
        return {
          line: document.getElementById('line').textContent,
          journey: document.getElementById('journey').textContent,
        };
      }, null, { timeout: 240_000, polling: 200 });
      const service = await boot.jsonValue();
      assert.equal(service.line, ref);
      assert.match(service.journey, new RegExp(destination));
      await page.evaluate(() => {
        document.getElementById('map-view').click();
        document.getElementById('fit-network').click();
      });
      await page.waitForFunction(() => document.getElementById('world').dataset.view === 'map', null,
        { timeout: 180_000, polling: 200 });
      await capture('whole-network');
      if (ref === 'F4') {
        await page.locator('#map-station').selectOption({ label: 'Stavanger' });
        await page.waitForFunction(() => {
          const { detailLine, view } = document.getElementById('world').dataset;
          return detailLine === 'F5' && view === 'map';
        }, null, { timeout: 180_000, polling: 200 });
        assert.equal(await page.locator('#line').textContent(), 'F4');
        await capture('map-stavanger');
        console.log('Zoomed from the whole network to mapped Stavanger platforms without changing the F4 service.');
      }
      assert.deepEqual(errors, []);
      assert.deepEqual(foreignRequests, []);
      console.log(`${ref} offline WebGL2 service and whole-network camera loaded with zero console errors.`);
      await page.close();
    }
  } finally {
    await browser.close();
  }
} finally {
  server.httpServer.close();
}
