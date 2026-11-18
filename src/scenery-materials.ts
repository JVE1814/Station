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
      .replace('#include <common>', '#include <common>\nattribute float rockExposure;\nvarying float vRockExposure;\nvarying vec3 vGround;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRockExposure = rockExposure;\nvGround = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D exposedRock;
        varying float vRockExposure;
        varying vec3 vGround;
        float groundGrain(vec2 p) {
          vec3 q = fract(vec3(p.xyx) * .1031);
          q += dot(q, q.yzx + 33.33);
          return fract((q.x + q.y) * q.z);
        }
        float groundPatch(vec2 p) {
          vec2 corner = floor(p);
          vec2 uv = fract(p);
          vec2 t = uv * uv * (3.0 - 2.0 * uv);
          return mix(mix(groundGrain(corner), groundGrain(corner + vec2(1,0)), t.x),
            mix(groundGrain(corner + vec2(0,1)), groundGrain(corner + vec2(1,1)), t.x), t.y);
        }
      `)
      .replace('#include <map_fragment>', `
        vec2 terrain = vGround.xz;
        float broad = groundPatch(terrain * .036 + vec2(8,12));
        float mottling = groundPatch(terrain * .31) * .65 + groundPatch(terrain * .81 + 91.0) * .35;
        vec2 swayed = vMapUv + vec2(broad, mottling) * .65;
        vec3 grass = texture2D(map, swayed).rgb;
        vec3 weathered = texture2D(map, mat2(.49,.87,-.87,.49) * vMapUv * 1.47 + vec2(13.2,55.3)).rgb;
        vec3 turf = mix(grass, weathered, smoothstep(.18, .76, mottling));
        float heather = smoothstep(.56, .8, broad * .57 + mottling * .43);
        vec3 autumn = mix(vec3(.86, .78, .52), vec3(.49, .27, .26), heather);
        float faded = smoothstep(.3, .81, broad * .73 + mottling * .27);
        turf = mix(turf * 1.35, mix(turf, autumn, .45), faded * .84);
        vec3 weights = abs(normalize(cross(dFdx(vGround), dFdy(vGround))));
        weights /= max(.001, weights.x + weights.y + weights.z);
        vec3 strata = texture2D(exposedRock, vGround.zy * .55).rgb * weights.x
          + texture2D(exposedRock, vGround.xz * .48).rgb * weights.y
          + texture2D(exposedRock, vGround.xy * .55).rgb * weights.z;
        float stone = smoothstep(.41, .88, vRockExposure * .72 + mottling * .40);
        vec3 groundColor = mix(turf, strata * (.73 + .36 * broad), stone);
        float dust = smoothstep(710.0, 1010.0, vGround.y + 90.0 * (broad - .5))
          * smoothstep(.2, .78, mottling) * smoothstep(.24, .82, weights.y);
        diffuseColor.rgb *= mix(groundColor, vec3(.75, .82, .89), dust * .86);
      `);
  };
  material.customProgramCacheKey = () => `${cache.call(material)}:exposed-rock`;
}
