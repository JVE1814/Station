import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { preview } from 'vite';

const server = await preview({ preview: { host: '127.0.0.1', port: 4177 } });
try {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH ?? '/usr/bin/chromium',
    args: ['--no-sandbox', '--enable-unsafe-swiftshader'],
  });
  try {
    const expected = new Map([['F4', 'Bergen'], ['F5', 'Stavanger'], ['F6', 'Trondheim']]);
    for (const [ref, destination] of expected) {
      const page = await browser.newPage({ viewport: { width: 800, height: 450 } });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => {
        if (message.type() === 'error') errors.push(message.text());
      });
      const uri = new URL(server.resolvedUrls.local[0]);
      uri.searchParams.set('line', ref);
      await page.route('**/*', route => {
        const request = new URL(route.request().url());
        return request.origin === uri.origin || request.protocol === 'data:' || request.protocol === 'blob:'
          ? route.continue() : route.abort('internetdisconnected');
      });
      await page.goto(uri.href);
      await page.waitForFunction(() => document.getElementById('world').dataset.stage === 'running', null,
        { timeout: 240_000, polling: 200 });
      assert.equal(await page.locator('#line').textContent(), ref);
      assert.match(await page.locator('#journey').textContent(), new RegExp(destination));
      await page.evaluate(() => {
        document.getElementById('pause').click();
        document.getElementById('map-view').click();
        document.getElementById('fit-network').click();
      });
      await page.waitForFunction(() => document.getElementById('world').dataset.view === 'map', null,
        { timeout: 180_000, polling: 200 });
      assert.deepEqual(errors, []);
      console.log(`${ref} offline WebGL2 service and whole-network camera loaded with zero console errors.`);
      await page.close();
    }
  } finally {
    await browser.close();
  }
} finally {
  server.httpServer.close();
}
