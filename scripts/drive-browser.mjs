import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright-core';
import { preview } from 'vite';

const { values } = parseArgs({ options: {
  captures: { type: 'boolean' }, url: { type: 'string' }, quality: { type: 'string' },
} });
assert.ok(values.quality === undefined || ['low', 'high', 'ultra'].includes(values.quality));
const server = values.url ? null : await preview({ preview: { host: '127.0.0.1', port: 4176, strictPort: true } });
const url = new URL(values.url ?? server.resolvedUrls.local[0]);
url.searchParams.set('line', 'R40');
url.searchParams.set('quality', values.quality ?? url.searchParams.get('quality') ?? 'high');
const output = new URL('../evidence/r40-keyboard/', import.meta.url);
if (values.captures) await mkdir(output, { recursive: true });

try {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH ?? '/usr/bin/chromium',
    args: ['--no-sandbox', '--enable-unsafe-swiftshader'],
  });
  try {
    const page = await browser.newPage({ viewport: { width: 800, height: 500 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await page.goto(url.href);
    await page.waitForFunction(() => document.getElementById('world').dataset.stage === 'running', null,
      { timeout: 90_000, polling: 120 });

    const state = () => page.evaluate(() => {
      const element = id => document.getElementById(id);
      const text = id => element(id).textContent.trim();
      return {
        distance: Number(element('world').dataset.chainage),
        view: element('world').dataset.view,
        speed: Number(text('speed')),
        power: Math.round(element('power').value * 5),
        brake: Math.round(element('brake').value * 5),
        stoppedAt: text('next-stop'),
        cue: text('brake-cue'),
        doors: element('doors').getAttribute('aria-pressed') === 'true',
        automatic: element('auto').getAttribute('aria-pressed') === 'true',
        notice: text('notice'),
        result: element('trip-result').hidden ? null : {
          station: text('result-title'),
          score: text('result-score'),
          timing: text('result-timing'),
          position: text('result-position'),
          passengers: text('result-passengers'),
        },
      };
    });
    const press = key => page.keyboard.press(key);
    const waitForView = view => page.waitForFunction(selected => document.getElementById('world').dataset.view === selected,
      view, { timeout: 60_000, polling: 120 });
    const setNotch = async (change, up, down) => {
      const key = change > 0 ? up : down;
      for (let step = 0; step < Math.abs(change); step++) await press(key);
    };
    const setControls = async (current, power, brake) => {
      if (power === current.power && brake === current.brake) return;
      await setNotch(power - current.power, 'w', 's');
      await setNotch(brake - current.brake, 'e', 'q');
      await page.waitForFunction(([power, brake]) => Math.round(document.getElementById('power').value * 5) === power
        && Math.round(document.getElementById('brake').value * 5) === brake,
      [power, brake], { timeout: 15_000, polling: 120 });
    };
    const switchDoors = async open => {
      await press('d');
      await page.waitForFunction(expected => document.getElementById('doors').getAttribute('aria-pressed') === String(expected),
        open, { timeout: 15_000, polling: 100 });
    };

    const departure = await state();
    await press('t');
    await press('t');
    await setControls(departure, 5, 0);
    await page.waitForFunction(() => Number(document.getElementById('speed').textContent) >= 5, null,
      { timeout: 60_000, polling: 120 });
    for (const [key, view] of [['2', 'chase'], ['3', 'map'], ['1', 'cab']]) {
      await press(key);
      await waitForView(view);
    }
    console.log('Left Evanger in manual mode and switched through all three cameras by keyboard.');

    const deadline = Date.now() + 35 * 60_000;
    const cards = [];
    let lastKilometre = -1;
    for (;;) {
      const current = await state();
      assert.equal(current.automatic, false);
      assert.ok(Date.now() < deadline, `Keyboard run exceeded its wall-clock allowance near ${current.distance} m`);
      assert.ok(!current.notice.includes('Stop missed'), `Missed ${current.stoppedAt} at ${current.distance} m`);
      if (current.result && cards.at(-1)?.station !== current.result.station) {
        cards.push(current.result);
        console.log(Object.values(current.result).join(' · '));
        if (values.captures) {
          const target = new URL(`${cards.length}-result.png`, output);
          await writeFile(target, await page.locator('#trip-result').screenshot({ timeout: 30_000 }));
        }
      }
      if (current.stoppedAt === 'Service complete') break;
      if (current.distance > (lastKilometre + 1) * 1000) {
        lastKilometre = Math.floor(current.distance / 1000);
        console.log(`Metre ${current.distance.toFixed(0)} · ${current.speed} km/h · ${current.stoppedAt}`);
      }

      if (current.doors) {
        if (current.cue.includes('D to close')) await switchDoors(false);
      } else if (current.cue.includes('D to open') && current.speed === 0) {
        await switchDoors(true);
      } else {
        const brake = Number(current.cue.match(/\bBrake (\d)/i)?.[1] ?? 0);
        const advice = current.cue.match(/\bPower (\d)/i)?.[1];
        const aim = Number(current.cue.match(/(\d+) km\/h/)?.[1]);
        const belowAim = aim - current.speed;
        const power = brake ? 0 : advice !== undefined ? Number(advice) : belowAim > 3 ? 5 : belowAim > 1 ? 2 : 0;
        await setControls(current, power, brake);
      }
      await page.waitForTimeout(120);
    }
    assert.deepEqual(cards.map(card => card.station.split(' · ')[0]), ['Seimsgrend', 'Bulken', 'Voss']);
    assert.ok(cards.at(-1).station.includes('Grade'));
    if (values.captures) await writeFile(new URL('results.json', output), JSON.stringify(cards, null, 2) + '\n');
    await press('r');
    await page.waitForFunction(() => document.getElementById('next-stop').textContent.includes('Seimsgrend')
      && document.getElementById('trip-result').hidden, null, { timeout: 45_000, polling: 120 });
    assert.deepEqual(errors, []);
    console.log('Served all three stations and retried from Evanger using only keyboard inputs.');
  } finally {
    await browser.close();
  }
} finally {
  server?.httpServer.close();
}
