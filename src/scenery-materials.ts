import { CanvasTexture, RepeatWrapping, SRGBColorSpace } from 'three';
import type { MeshStandardMaterial, Texture } from 'three';

function noiseLayer(size: number, seed: number) {
  const grid = new Float32Array(size * size);
  let state = seed;
  for (let index = 0; index < grid.length; index++) {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    grid[index] = state / 0x100000000;
  }
  return (x: number, y: number) => {
    const fx = x * size;
    const fy = y * size;
    const first = Math.floor(fx);
    const second = Math.floor(fy);
    const ix = ((first % size) + size) % size;
    const iy = ((second % size) + size) % size;
    const jx = (ix + 1) % size;
    const jy = (iy + 1) % size;
    const dx = fx - first;
    const dy = fy - second;
    const u = dx * dx * (3 - 2 * dx);
    const v = dy * dy * (3 - 2 * dy);
    const north = grid[iy * size + ix] * (1 - u) + grid[iy * size + jx] * u;
    const south = grid[jy * size + ix] * (1 - u) + grid[jy * size + jx] * u;
    return north * (1 - v) + south * v;
  };
}

export function civilTexture(kind: 'rock' | 'concrete'): CanvasTexture | undefined {
  const canvas = document.createElement('canvas');
  const size = 256;
  canvas.width = canvas.height = size;
  const context = canvas.getContext('2d');
  if (!context) return;
  const image = context.createImageData(size, size);
  const broad = noiseLayer(9, 1303);
  const medium = noiseLayer(29, 50333);
  const fine = noiseLayer(123, 6118);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const east = x / size;
      const north = y / size;
      const stratum = broad(east, north);
      const grain = fine(east, north);
      const pockets = medium(east, north);
      const trace = 2 * Math.PI * (3 * north + east + 0.36 * stratum);
      const fissure = Math.max(0, Math.sin(trace) - 0.77) * 95;
      const streak = broad(east, north * 0.3) * medium(east * 2, north);
      const light = kind === 'rock'
        ? 116 + stratum * 42 + pockets * 28 + grain * 26 - fissure
        : 165 + stratum * 24 + grain * 16 - streak * 43;
      const index = (y * size + x) * 4;
      image.data[index] = light + (kind === 'concrete' ? 7 : 1);
      image.data[index + 1] = light + 1;
      image.data[index + 2] = light - (kind === 'concrete' ? 6 : 3);
      image.data[index + 3] = 255;
    }
  }
  context.putImageData(image, 0, 0);
  const result = new CanvasTexture(canvas);
  result.wrapS = result.wrapT = RepeatWrapping;
  result.colorSpace = SRGBColorSpace;
  result.anisotropy = 8;
  return result;
}

export function blendExposedRock(material: MeshStandardMaterial, rock: Texture): void {
  const compile = material.onBeforeCompile;
  const cache = material.customProgramCacheKey;
  material.onBeforeCompile = (shader, renderer) => {
    compile.call(material, shader, renderer);
    shader.uniforms.exposedRock = { value: rock };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float rockExposure;\nvarying float vRockExposure;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRockExposure = rockExposure;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D exposedRock;\nvarying float vRockExposure;')
      .replace('#include <map_fragment>', `
        #include <map_fragment>
        vec3 strata = texture2D(exposedRock, vMapUv * 1.28).rgb;
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuse * strata, vRockExposure);
      `);
  };
  material.customProgramCacheKey = () => `${cache.call(material)}:exposed-rock`;
}
