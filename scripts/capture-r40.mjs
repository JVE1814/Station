import assert from 'node:assert/strict';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { preview } from 'vite';
import { heroShots } from '../src/hero.ts';

const args = process.argv.slice(2);
const baseline = args.includes('--before');
const goldenOnly = args.includes('--golden-only');
const skipExisting = args.includes('--skip-existing');
const chosenLook = args.find(arg => arg.startsWith('--look='))?.slice(7);
const root = baseline ? resolve('.cache/r40-before') : process.cwd();
const buildDir = process.env.STATION_CAPTURE_BUILD ?? 'dist';
const output = resolve(args.find(arg => arg.startsWith('--out='))?.slice(6) ?? 'reference/r40');
const stage = baseline ? 'before' : 'final';
const chosen = args.find(arg => arg.startsWith('--only='))?.slice(7);
const manifest = JSON.parse(await readFile(resolve(root, buildDir, 'data/r40/network.json'), 'utf8'));
const shots = heroShots(manifest.services[0]).filter(shot => !chosen || shot.id.startsWith(chosen));
assert.ok(shots.length);
const port = Number(process.env.STATION_CAPTURE_PORT ?? 4188);
const server = await preview({root, build:{outDir:buildDir}, preview: {host:'127.0.0.1', port}});
const browser = await chromium.launch({executablePath: process.env.CHROMIUM_PATH ?? '/usr/bin/chromium', args:['--no-sandbox','--enable-unsafe-swiftshader']});
try {
  const page = await browser.newPage({viewport:{width:1920,height:1080}, deviceScaleFactor:1});
  const errors = [];
  page.on('pageerror', error => { errors.push(error.message); console.error(error.message); });
  page.on('console', entry => { if (entry.type() === 'error') { errors.push(entry.text()); console.error(entry.text()); } });
  await mkdir(output, {recursive:true});
  const cdp = await page.context().newCDPSession(page);
  for (const shot of shots) {
    const looks = !baseline && !goldenOnly && ['01-lakeside-chase','06-bulken-cab','07-lake-overlook'].includes(shot.id)
      ? ['golden','night','snow'] : ['golden'];
    let previousLook;
    for (const look of looks) {
      if (chosenLook && look !== chosenLook) continue;
      const name = resolve(output, `${shot.id}-${look}-${stage}.png`);
      if (skipExisting && await access(name).then(() => true, () => false)) continue;
      let previousFrame;
      if (previousLook) {
        previousFrame = await page.evaluate(({ previousLook, look }) => {
          const frame = document.getElementById('world').dataset.captureFrame;
          if ((previousLook === 'night') !== (look === 'night')) document.getElementById('day').click();
          if (look === 'snow') {
            document.getElementById('weather').click();
            document.getElementById('weather').click();
          }
          return frame;
        }, { previousLook, look });
      } else {
        const url = new URL(server.resolvedUrls.local[0]);
        url.search = new URLSearchParams({line:'R40',hero:shot.id,look,quality:'ultra'}).toString();
        await page.goto(url.href, {waitUntil:'domcontentloaded', timeout:180000});
      }
      await page.waitForFunction(({ view, previousFrame }) => {
        const world = document.getElementById('world');
        return (world.dataset.stage === 'running' && world.dataset.view === view
          && (!previousFrame || world.dataset.captureFrame !== previousFrame)) || world.dataset.stage === 'failed';
      }, { view: shot.view, previousFrame }, {timeout:180000,polling:250}).catch(async error => {
        console.error('Capture state', await page.locator('#world').evaluate(node => ({...node.dataset})));
        throw error;
      });
      assert.deepEqual(errors, []);
      const { data } = await cdp.send('Page.captureScreenshot', {format:'png', fromSurface:true});
      await writeFile(name, Buffer.from(data,'base64'));
      console.log(name, shot.distance.toFixed(1), await page.locator('#world').evaluate(node => [node.dataset.drawCalls,node.dataset.triangles]));
      assert.deepEqual(errors.splice(0), []);
      previousLook = await page.locator('#world').getAttribute('data-capture-frame') ? look : undefined;
    }
  }
} finally {
  await browser.close();
  server.httpServer.close();
}
