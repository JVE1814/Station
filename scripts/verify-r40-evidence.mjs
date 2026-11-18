import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { createCanvas, loadImage } from '@napi-rs/canvas';

export const panelWidth = 1920;
export const panelHeight = 1080;
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const shots = [
  '01-lakeside-chase', '02-evanger-cab', '03-seimsgrend', '04-river-bridge',
  '05-tunnel-mouth', '06-bulken-cab', '07-lake-overlook', '08-voss-overlook',
];
const variantShots = new Set(['01-lakeside-chase', '06-bulken-cab', '07-lake-overlook']);

export function galleryOptions(args = process.argv.slice(2)) {
  const { values } = parseArgs({
    args,
    options: {
      dir: { type: 'string', default: 'reference/r40' },
      only: { type: 'string' },
    },
  });
  const selected = values.only ? shots.filter(shot => shot.startsWith(values.only)) : shots;
  assert.ok(selected.length, `No R40 hero shot matches ${values.only}`);
  return { directory: resolve(values.dir), selected };
}

export function galleryPath(directory, shot, stage, look = 'golden') {
  return resolve(directory, `${shot}-${look}-${stage}.png`);
}

async function readPng(path, width, height) {
  const bytes = await readFile(path);
  assert.ok(bytes.subarray(0, pngSignature.length).equals(pngSignature), `${path} is not PNG`);
  let image;
  try {
    image = await loadImage(bytes);
  } catch (cause) {
    throw new Error(`Unable to decode ${path}`, { cause });
  }
  if (width === undefined) {
    assert.ok(image.width > 0 && image.height > 0, `${path} has invalid dimensions`);
  } else {
    assert.equal(image.width, width, `${path} width`);
    assert.equal(image.height, height, `${path} height`);
  }
  return image;
}

function panelPixels(context, image, left) {
  context.clearRect(0, 0, panelWidth, panelHeight);
  context.drawImage(image, left, 0, panelWidth, panelHeight, 0, 0, panelWidth, panelHeight);
  const { data } = context.getImageData(0, 0, panelWidth, panelHeight);
  return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
}

if (import.meta.main) {
  const { directory, selected } = galleryOptions();
  const context = createCanvas(panelWidth, panelHeight).getContext('2d');
  const errors = [];
  let variants = 0;
  for (const shot of selected) {
    try {
      const before = await readPng(galleryPath(directory, shot, 'before'), panelWidth, panelHeight);
      await readPng(galleryPath(directory, shot, 'paintover'));
      const final = await readPng(galleryPath(directory, shot, 'final'), panelWidth, panelHeight);
      const comparison = await readPng(galleryPath(directory, shot, 'comparison'), panelWidth * 3, panelHeight);
      assert.ok(panelPixels(context, before, 0).equals(panelPixels(context, comparison, 0)),
        `${shot} comparison left panel differs from its baseline capture`);
      assert.ok(panelPixels(context, final, 0).equals(panelPixels(context, comparison, panelWidth * 2)),
        `${shot} comparison right panel differs from its final render`);
    } catch (error) {
      errors.push(`${shot}: ${error.message}`);
    }
    if (!variantShots.has(shot)) continue;
    for (const look of ['night', 'snow']) {
      try {
        await readPng(galleryPath(directory, shot, 'final', look), panelWidth, panelHeight);
        variants++;
      } catch (error) {
        errors.push(`${shot} ${look}: ${error.message}`);
      }
    }
  }
  if (errors.length) {
    for (const error of errors) console.error(error);
    process.exitCode = 1;
  } else {
    console.log(`Verified ${selected.length} golden-hour triptychs at 5760 × 1080 and ${variants} weather variants at 1920 × 1080.`);
  }
}
