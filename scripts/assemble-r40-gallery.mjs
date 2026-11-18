import { spawnSync } from 'node:child_process';
import { rename, rm } from 'node:fs/promises';
import { galleryOptions, galleryPath, panelHeight, panelWidth } from './verify-r40-evidence.mjs';

const compose = `
from sys import argv
from PIL import Image, ImageOps

width, height = map(int, argv[1:3])
comparison = Image.new('RGB', (width * 3, height), (16, 20, 25))
for panel, path in enumerate(argv[3:6]):
    with Image.open(path) as source:
        frame = source.convert('RGB')
        if panel == 1:
            frame = ImageOps.contain(frame, (width, height), Image.Resampling.LANCZOS)
        elif frame.size != (width, height):
            raise ValueError(f'{path} must be {width} × {height}')
        x = panel * width + (width - frame.width) // 2
        y = (height - frame.height) // 2
        comparison.paste(frame, (x, y))
comparison.save(argv[6], format='PNG', compress_level=6)
`;

const { directory, selected } = galleryOptions();
for (const shot of selected) {
  const sources = ['before', 'paintover', 'final'].map(stage => galleryPath(directory, shot, stage));
  const target = galleryPath(directory, shot, 'comparison');
  const temporary = `${target}.${process.pid}.tmp`;
  try {
    const result = spawnSync('python3', ['-c', compose, String(panelWidth), String(panelHeight), ...sources, temporary],
      { stdio: 'inherit' });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`Could not assemble ${shot}`);
    await rename(temporary, target);
    console.log(target);
  } finally {
    await rm(temporary, { force: true });
  }
}
