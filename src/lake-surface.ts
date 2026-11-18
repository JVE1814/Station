import { Color, DataTexture, LinearFilter, RedFormat, Vector4 } from 'three';
import type { MeshStandardMaterial } from 'three';
import type { TerrainData, WorldFeature } from './world-data';

function distanceToBank(mask: Uint8ClampedArray, width: number, height: number, dx: number, dz: number): Uint8Array {
  const distances = new Float32Array(width * height);
  for (let index = 0; index < distances.length; index++) distances[index] = mask[index * 4 + 3] >= 128 ? Infinity : 0;
  const diagonal = Math.hypot(dx, dz);
  for (const direction of [1, -1]) {
    const firstColumn = direction > 0 ? 0 : width - 1;
    const firstRow = direction > 0 ? 0 : height - 1;
    for (let y = firstRow; y >= 0 && y < height; y += direction) {
      for (let x = firstColumn; x >= 0 && x < width; x += direction) {
        const current = y * width + x;
        if (distances[current] === 0) continue;
        const previousX = x - direction;
        const previousY = y - direction;
        if (previousX >= 0 && previousX < width) {
          distances[current] = Math.min(distances[current], distances[current - direction] + dx);
        }
        if (previousY < 0 || previousY >= height) continue;
        const upper = previousY * width + x;
        distances[current] = Math.min(distances[current], distances[upper] + dz);
        if (x > 0) distances[current] = Math.min(distances[current], distances[upper - 1] + diagonal);
        if (x < width - 1) distances[current] = Math.min(distances[current], distances[upper + 1] + diagonal);
      }
    }
  }
  const bank = Math.min(dx, dz) * .45;
  return Uint8Array.from(distances, distance => Math.round(Math.min(1, Math.max(0, distance - bank) / 28) * 255));
}

export function createShorelineField(terrain: TerrainData, water: readonly WorldFeature[]) {
  const across = Math.max(1, (terrain.width - 1) * terrain.spacing);
  const along = Math.max(1, (terrain.height - 1) * terrain.spacing);
  const width = Math.min(1024, Math.max(24, Math.ceil(across / 6)));
  const height = Math.min(1024, Math.max(24, Math.ceil(along / 6)));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('The water shoreline requires a 2D canvas');
  for (const feature of water) {
    context.beginPath();
    for (const ring of [feature.points, ...(feature.holes ?? [])]) {
      for (const [index, [east, north]] of ring.entries()) {
        const x = (east - terrain.east) * width / across;
        const y = (terrain.north - north) * height / along;
        if (index === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      }
      context.closePath();
    }
    context.fill('evenodd');
  }
  const pixels = context.getImageData(0, 0, width, height).data;
  const samples = distanceToBank(pixels, width, height, across / width, along / height);
  const texture = new DataTexture(samples, width, height, RedFormat);
  texture.magFilter = texture.minFilter = LinearFilter;
  texture.needsUpdate = true;
  return { texture, extent: new Vector4(terrain.east, -terrain.north, across, along) };
}

export function applyWaterBanks(material: MeshStandardMaterial, field: ReturnType<typeof createShorelineField>): void {
  const before = material.onBeforeCompile;
  const cache = material.customProgramCacheKey;
  material.transparent = true;
  material.forceSinglePass = true;
  material.onBeforeCompile = (shader, renderer) => {
    before.call(material, shader, renderer);
    shader.uniforms.waterBankField = {value: field.texture};
    shader.uniforms.waterBankExtent = {value: field.extent};
    shader.uniforms.waterShallowColor = {value: new Color(0x99b4a3)};
    shader.uniforms.waterDeepColor = {value: new Color(0x486777)};
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vWaterBank;')
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        vWaterBank = (modelMatrix * vec4(transformed, 1.0)).xz;
      `);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        #define WATER_BANK_FIELD
        varying vec2 vWaterBank;
        uniform sampler2D waterBankField;
        uniform vec4 waterBankExtent;
        uniform vec3 waterShallowColor;
        uniform vec3 waterDeepColor;
      `)
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec2 waterBankUv = (vWaterBank - waterBankExtent.xy) / waterBankExtent.zw;
        float waterDepth = texture2D(waterBankField, waterBankUv).r;
        float edgeTint = (1.0 - smoothstep(.06, .70, waterDepth)) * .73;
        diffuseColor.rgb *= mix(waterDeepColor, waterShallowColor, edgeTint);
        diffuseColor.a *= mix(.05, 1.0, smoothstep(.01, .30, waterDepth));
      `);
  };
  material.customProgramCacheKey = () => `${cache.call(material)}:mapped-banks`;
  material.addEventListener('dispose', () => field.texture.dispose());
}
