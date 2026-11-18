import { CanvasTexture, RepeatWrapping, SRGBColorSpace } from 'three';
import type { MeshStandardMaterial } from 'three';
import type { Rail } from './rail.ts';
import type { TrackSpan } from './world-data.ts';

const clamp = (value: number) => Math.min(1, Math.max(0, value));
const smooth = (value: number) => { const t = clamp(value); return t * t * (3 - 2 * t); };
const reach = 105;

export function tunnelCutField(rail: Rail, spans: TrackSpan[]) {
  const tunnels: { start: number; end: number }[] = [];
  for (const span of spans) {
    if (!span.tunnel) continue;
    const last = tunnels.at(-1);
    if (last && Math.abs(last.end - span.start) < 0.1) last.end = span.end;
    else tunnels.push({ start: span.start, end: span.end });
  }
  const mouths = tunnels.flatMap(({ start, end }) => [
    { chainage: start, direction: -1 }, { chainage: end, direction: 1 },
  ]).map(({ chainage, direction }) => {
    const { position, tangent } = rail.pose(chainage);
    return { position, tangent: tangent.setY(0).normalize().multiplyScalar(direction) };
  });
  if (!mouths.length) return undefined;
  const index = new Map<number, Map<number, typeof mouths>>();
  for (const mouth of mouths) {
    const { x, z } = mouth.position;
    for (let column = Math.floor((x - reach) / reach); column <= Math.floor((x + reach) / reach); column++) {
      for (let row = Math.floor((z - reach) / reach); row <= Math.floor((z + reach) / reach); row++) {
        if (!index.has(column)) index.set(column, new Map());
        const cells = index.get(column)!;
        const near = cells.get(row);
        if (near) near.push(mouth);
        else cells.set(row, [mouth]);
      }
    }
  }
  return (x: number, y: number, z: number, gradeX: number, gradeZ: number, out: number[]) => {
    const nearby = index.get(Math.floor(x / reach))?.get(Math.floor(z / reach));
    if (!nearby) {
      out.push(0, 0);
      return;
    }
    let stone = 0;
    let scree = 0;
    const slope = Math.hypot(gradeX, gradeZ) / 6;
    for (const { position, tangent } of nearby) {
      const dx = x - position.x;
      const dz = z - position.z;
      const along = tangent.x * dx + tangent.z * dz;
      const lateral = Math.abs(tangent.z * dx - tangent.x * dz);
      const height = y - position.y;
      const apron = smooth((along + 42) / 29) * (1 - smooth((along - 52) / 48));
      const field = apron * (1 - smooth((lateral - 17) / 56));
      stone = Math.max(stone, field * smooth((slope - 0.28) / 0.38)
        * smooth((height + 0.4) / 2.9) * (1 - smooth((height - 35) / 49)));
      scree = Math.max(scree, field * (1 - smooth((lateral - 8) / 13))
        * smooth((lateral - 2.8) / 2.8) * (1 - smooth((height - 2.8) / 7.3)));
    }
    out.push(Math.round(255 * stone), Math.round(255 * scree));
  };
}

export function dressTunnelCut(material: MeshStandardMaterial): void {
  const compile = material.onBeforeCompile;
  const cache = material.customProgramCacheKey;
  material.onBeforeCompile = (shader, renderer) => {
    compile.call(material, shader, renderer);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 tunnelCut;\nvarying vec2 vTunnelCut;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvTunnelCut = tunnelCut;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec2 vTunnelCut;
        float seam(float p, float thickness) {
          float f = fract(p);
          return 1.0 - smoothstep(thickness, thickness * 2.9, min(f, 1.0 - f));
        }
      `)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        vec2 cutRelief = vec2(0.0);
        if (max(vTunnelCut.x, vTunnelCut.y) > .004) {
          vec2 plan = vec2(dot(vGround.xz, vec2(.81, .58)), dot(vGround.xz, vec2(-.58, .81)));
          float drift = groundPatch(plan * vec2(.062, .084));
          float flecks = groundPatch(plan * 2.9 + vGround.yy * vec2(.73, 1.41));
          float erosion = groundPatch(vec2(plan.x * .31, vGround.y * .39) + vec2(41.0, plan.y * .21));
          float fold = vGround.y * .74 - plan.x * .195 + plan.y * .09 + (drift - .5) * 1.55;
          float foliation = fold * .94 + (erosion - .5) * .23;
          float bedding = seam(foliation, .021) * (.39 + erosion * .61);
          float hairline = seam(fold * 2.53 - erosion * .29, .011);
          float fracture = seam(plan.x * .80 + vGround.y * .34 + erosion * .56, .019)
            * smoothstep(.22, .62, groundPatch(vec2(plan.x * .22, vGround.y * .55)));
          float stratum = .45 + .32 * sin(foliation * 6.2831853 + .46) + .23 * sin(fold * 3.8 + 1.8);
          float mineral = smoothstep(.36, .78, drift * .46 + erosion * .45 + .18 * stratum);
          float glint = smoothstep(.62, .86, flecks) * (.24 + mineral * .43);
          float rind = smoothstep(.32, .71, .61 * drift + .29 * erosion + .16 * flecks);
          float wall = vTunnelCut.x * smoothstep(.21, .57, .54 * erosion + .57 * drift + .18 * stratum);
          vec3 gneiss = mix(vec3(.19, .205, .199), vec3(.45, .382, .299), mineral);
          gneiss *= (.69 + .33 * stratum + .22 * flecks + .28 * glint)
            * (1.0 - .43 * bedding - .17 * hairline - .4 * fracture);
          gneiss = mix(gneiss, gneiss * vec3(.73, .83, .61), rind * .37);

          vec2 stones = vGround.xz * 11.7;
          float rubble = groundPatch(stones + vec2(.0, floor(stones.x) * .13));
          float grit = groundPatch(vGround.xz * 46.0 + vec2(3.7, 13.0));
          float sand = groundPatch(vGround.xz * 3.6 + 9.0);
          float clast = smoothstep(.41, .7, rubble);
          float debris = smoothstep(.27, .69, sand * .48 + drift * .37 + erosion * .15);
          vec3 apron = mix(vec3(.20, .178, .138), vec3(.40, .376, .323), clast) * (.75 + .41 * grit);
          diffuseColor.rgb = mix(diffuseColor.rgb, apron, vTunnelCut.y * debris * .82 * (1.0 - cover));
          diffuseColor.rgb = mix(diffuseColor.rgb, gneiss, wall * .94 * (1.0 - cover * .45));
          float relief = wall * (stratum * .45 - bedding * .21 - fracture * .14 + flecks * .10)
            + vTunnelCut.y * debris * (clast * .3 + grit * .11);
          cutRelief = vec2(dFdx(relief), dFdy(relief)) * .20;
        }
      `)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        #ifdef USE_BUMPMAP
          normal = perturbNormalArb(-vViewPosition, normal, cutRelief, faceDirection);
        #endif
      `);
  };
  material.customProgramCacheKey = () => `${cache.call(material)}:tunnel-cut-foliation`;
}

export function tunnelWingStone(material: MeshStandardMaterial) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const context = canvas.getContext('2d');
  if (!context) return material;
  const size = canvas.width;
  const pixels = context.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const row = Math.floor(y / 64);
      const stagger = (x + (row % 2) * 32) % size;
      const column = Math.floor(stagger / 64);
      const joint = Math.min(stagger % 64, 64 - stagger % 64, y % 64, 64 - y % 64);
      const grain = Math.sin(x * 5.157 + y * 5.233 + x * y * 0.003);
      const weathering = 14 * Math.sin(x * Math.PI / 64) * Math.cos(y * Math.PI / 128);
      const tone = 140 + ((column * 11 + row * 23) % 37) + grain * 9 + weathering;
      const light = joint < 2 ? 77 + grain * 7 : tone + 31 * Math.exp(-(joint - 2) / 2);
      const index = (y * size + x) * 4;
      pixels.data[index] = light + 3;
      pixels.data[index + 1] = light;
      pixels.data[index + 2] = light - 8;
      pixels.data[index + 3] = 255;
    }
  }
  context.putImageData(pixels, 0, 0);
  const map = new CanvasTexture(canvas);
  map.wrapS = map.wrapT = RepeatWrapping;
  map.colorSpace = SRGBColorSpace;
  map.anisotropy = 8;
  const wings = material.clone();
  wings.name = 'Coursed tunnel wing stone';
  wings.map = wings.bumpMap = map;
  wings.bumpScale = 0.044;
  return wings;
}
