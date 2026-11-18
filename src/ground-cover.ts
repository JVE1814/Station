import {
  BufferGeometry, Color, DoubleSide, DynamicDrawUsage, Float32BufferAttribute, InstancedBufferAttribute,
  InstancedMesh, MeshLambertMaterial, Object3D, Vector3,
} from 'three';
import type { VegetationWeather } from './vegetation.ts';

const spacing = 0.58;
const radius = 44;
const patchCells = 12;
const patchWidth = patchCells * spacing;
const capacity = Math.ceil(Math.PI * (radius + patchWidth * Math.SQRT2) ** 2 / spacing ** 2);

function bladeGeometry() {
  const vertices: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const vertex = (x: number, y: number, z: number, tone: number, nx: number, nz: number) => {
    vertices.push(x, y, z);
    normals.push(nx * .41, .912, nz * .41);
    colors.push(tone, tone, tone * (0.86 + 0.30 * y));
  };
  for (let blade = 0; blade < 5; blade++) {
    const theta = blade * 2.39996;
    const x = Math.cos(theta);
    const z = Math.sin(theta);
    const root = blade % 2 ? .057 : .092;
    const height = [.33, .24, .38, .29, .34][blade];
    const reach = [.16, .25, .11, .23, .14][blade];
    const width = blade % 2 ? .013 : .021;
    const start = vertices.length / 3;
    for (const side of [-1, 1]) vertex(x * root - z * side * width, 0, z * root + x * side * width, .34, x, z);
    for (const side of [-1, 1]) vertex(x * (root + reach * .3) - z * side * width * .66, height * .63,
      z * (root + reach * .3) + x * side * width * .66, .83, x, z);
    vertex(x * (root + reach), height * .94, z * (root + reach), 1.19, x, z);
    indices.push(start, start + 1, start + 2, start + 1, start + 3, start + 2, start + 2, start + 3, start + 4);
  }
  return new BufferGeometry()
    .setAttribute('position', new Float32BufferAttribute(vertices, 3))
    .setAttribute('color', new Float32BufferAttribute(colors, 3))
    .setAttribute('normal', new Float32BufferAttribute(normals, 3))
    .setIndex(indices);
}

export function createGroundCover(bounds: { minX: number; maxX: number; minY: number; maxY: number },
  ground: (east: number, z: number) => number, eligible: (east: number, north: number) => boolean,
  random: (row: number, column: number, salt: number) => number) {
  const geometry = bladeGeometry();
  const material = new MeshLambertMaterial({ side: DoubleSide, vertexColors: true });
  const time = {value: 0};
  const wind = {value: .022};
  const powder = {value: 0};
  material.onBeforeCompile = shader => {
    shader.uniforms.turfClock = time;
    shader.uniforms.turfWind = wind;
    shader.uniforms.turfPowder = powder;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float turfClock; uniform float turfWind; uniform float turfPowder;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vec3 tuft = (modelMatrix * instanceMatrix[3]).xyz;
        float falloff = 1.0 - smoothstep(27.0, 38.0, distance(cameraPosition, tuft));
        float breeze = sin(turfClock * 2.35 + tuft.x * .44 + tuft.z * .77) * .65
          + sin(turfClock * 3.69 + tuft.z * .58) * .35;
        transformed.x += breeze * turfWind * pow(position.y * 2.5, 1.6);
        transformed *= falloff * (1.0 - turfPowder * .58);
      `);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float turfPowder;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.67,.74,.78), turfPowder * .69);
      `);
  };
  material.customProgramCacheKey = () => 'turf-blades';
  const mesh = new InstancedMesh(geometry, material, capacity);
  mesh.name = 'Short meadow grass';
  mesh.instanceMatrix.setUsage(DynamicDrawUsage);
  const instanceColor = new InstancedBufferAttribute(new Float32Array(capacity * 3), 3).setUsage(DynamicDrawUsage);
  mesh.instanceColor = instanceColor;
  mesh.frustumCulled = false;
  mesh.receiveShadow = true;
  mesh.count = 0;
  const grass = new Color(0x7e8a45);
  const sunbleached = new Color(0xbda56b);
  const heath = new Color(0x81674a);
  const tint = new Color();
  const dummy = new Object3D();
  const patches = new Map<string, { east: number; north: number; matrices: Float32Array; colors: Float32Array }>();
  let centerEast = Infinity;
  let centerNorth = Infinity;

  function createPatch(row: number, column: number) {
    const matrices: number[] = [];
    const colors: number[] = [];
    for (let j = row * patchCells; j < (row + 1) * patchCells; j++) {
      for (let i = column * patchCells; i < (column + 1) * patchCells; i++) {
        const x = (i + (random(j, i, 175) - .5) * .85) * spacing;
        const y = (j + (random(j, i, 181) - .5) * .85) * spacing;
        const mixture = .48 + .28 * Math.sin(x * .23 + Math.sin(y * .18)) * Math.cos(y * .31)
          + .17 * Math.sin(y * .12 - x * .18);
        const roll = random(j, i, 191);
        if (roll > .45 + mixture * .5 || !eligible(x, y)) continue;
        const spread = .61 + random(j, i, 163) * .50;
        dummy.position.set(x, ground(x, -y) - .035, -y);
        dummy.rotation.y = random(j, i, 177) * Math.PI * 2;
        dummy.scale.set(spread, .28 + mixture * .56 + roll ** 2 * .69, spread);
        dummy.updateMatrix();
        matrices.push(...dummy.matrix.elements);
        tint.copy(grass).lerp(roll < .3 ? heath : sunbleached, 1 - mixture);
        colors.push(tint.r, tint.g, tint.b);
      }
    }
    return { east: column * patchWidth, north: row * patchWidth,
      matrices: Float32Array.from(matrices), colors: Float32Array.from(colors) };
  }

  return {
    mesh,
    update(camera: Vector3, seconds: number, weather: VegetationWeather) {
      time.value += seconds;
      wind.value = weather === 'rain' ? .076 : .027;
      powder.value = weather === 'snow' ? 1 : 0;
      const east = camera.x;
      const north = -camera.z;
      mesh.visible = east >= bounds.minX - radius && east <= bounds.maxX + radius
        && north >= bounds.minY - radius && north <= bounds.maxY + radius
        && camera.y - ground(east, -north) < 30;
      if (!mesh.visible || Math.hypot(east - centerEast, north - centerNorth) <= 5.5) return;
      centerEast = east;
      centerNorth = north;
      let count = 0;
      for (let row = Math.floor(Math.max(bounds.minY, north - radius) / patchWidth);
        row * patchWidth <= Math.min(bounds.maxY, north + radius); row++) {
        for (let column = Math.floor(Math.max(bounds.minX, east - radius) / patchWidth);
          column * patchWidth <= Math.min(bounds.maxX, east + radius); column++) {
          const x = column * patchWidth;
          const y = row * patchWidth;
          const dx = Math.max(x - east, east - x - patchWidth, 0);
          const dy = Math.max(y - north, north - y - patchWidth, 0);
          if (dx * dx + dy * dy > radius * radius) continue;
          const key = `${row}:${column}`;
          let patch = patches.get(key);
          if (!patch) {
            patch = createPatch(row, column);
            patches.set(key, patch);
          }
          mesh.instanceMatrix.array.set(patch.matrices, count * 16);
          instanceColor.array.set(patch.colors, count * 3);
          count += patch.colors.length / 3;
        }
      }
      for (const [key, patch] of patches) {
        if (Math.hypot(patch.east - east, patch.north - north) > radius * 1.8) patches.delete(key);
      }
      mesh.count = count;
      mesh.instanceMatrix.clearUpdateRanges();
      mesh.instanceMatrix.addUpdateRange(0, 16 * count);
      mesh.instanceMatrix.needsUpdate = true;
      instanceColor.clearUpdateRanges();
      instanceColor.addUpdateRange(0, 3 * count);
      instanceColor.needsUpdate = true;
    },
    dispose() { mesh.dispose(); geometry.dispose(); material.dispose(); },
  };
}
