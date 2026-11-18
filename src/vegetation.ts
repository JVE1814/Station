import {
  BufferGeometry, CanvasTexture, Color, DoubleSide, Float32BufferAttribute, Group,
  InstancedBufferAttribute, InstancedMesh, MeshDepthMaterial, MeshLambertMaterial,
  Object3D, RGBADepthPacking, SRGBColorSpace, Vector3,
} from 'three';
import type { Material, Texture } from 'three';
import type { Rail } from './rail.ts';
import { createGroundCover } from './ground-cover.ts';
import { groundHeight } from './world-data.ts';
import type { LocalPoint, TrackSpan, WorldData, WorldFeature } from './world-data.ts';

export type VegetationWeather = 'clear' | 'rain' | 'snow';

type TreeImage = CanvasImageSource & { width: number; height: number };

export interface VegetationOptions {
  ownsCell?: (east: number, worldZ: number) => boolean;
  heightAt?: (east: number, worldZ: number) => number;
  meadowAllowed?: (east: number, north: number) => boolean;
  portalRail?: Rail;
  portalSpans?: readonly TrackSpan[];
  spruceImage?: TreeImage;
  pineAndBirchImage?: TreeImage;
}

export type PlantKind = 'spruce' | 'pine' | 'birch' | 'willow' | 'grass' | 'fern' | 'fireweed';

export interface Plant {
  kind: PlantKind;
  dry: number;
  east: number;
  north: number;
  height: number;
  width: number;
  rotation: number;
  tint: number;
}

const forest: readonly PlantKind[] = ['spruce', 'pine', 'birch'];
const cells: readonly PlantKind[] = [...forest, 'willow', 'grass', 'fern', 'fireweed'];
const cellWidth = 384;
const atlasWidth = cellWidth * 4;
const atlasHeight = cellWidth * 2;

function hash(a: number, b: number, salt: number) {
  let value = (Math.imul(a, 73856093) ^ Math.imul(b, 19349663) ^ Math.imul(salt, 83492791)) | 0;
  value = Math.imul(value ^ value >>> 16, 0x21f0aaad);
  value = Math.imul(value ^ value >>> 15, 0x735a2d97);
  return ((value ^ value >>> 15) >>> 0) / 0x100000000;
}

function sequence(seed: number) {
  let index = 0;
  return () => hash(index++, seed, 77);
}

type Bounds = { minX: number; maxX: number; minY: number; maxY: number };

function polygonBounds(points: readonly LocalPoint[]): Bounds {
  return points.reduce((box, [east, north]) => ({
    minX: Math.min(east, box.minX), maxX: Math.max(east, box.maxX),
    minY: Math.min(north, box.minY), maxY: Math.max(north, box.maxY),
  }), { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
}

function inBounds(x: number, y: number, bounds: Bounds) {
  return x >= bounds.minX && x <= bounds.maxX && y >= bounds.minY && y <= bounds.maxY;
}

class SpatialBins<T> {
  private readonly bins = new Map<string, T[]>();
  private readonly size: number;

  constructor(size: number) {
    this.size = size;
  }

  insert(value: T, bounds: Bounds) {
    for (let i = Math.floor(bounds.minX / this.size); i <= Math.floor(bounds.maxX / this.size); i++) {
      for (let j = Math.floor(bounds.minY / this.size); j <= Math.floor(bounds.maxY / this.size); j++) {
        const key = `${i}:${j}`;
        let values = this.bins.get(key);
        if (!values) {
          values = [];
          this.bins.set(key, values);
        }
        values.push(value);
      }
    }
  }

  candidates(x: number, y: number): readonly T[] {
    return this.bins.get(`${Math.floor(x / this.size)}:${Math.floor(y / this.size)}`) ?? [];
  }
}

function ringContains(points: readonly LocalPoint[], extent: Bounds) {
  const stride = 44;
  const rows = new Map<number, Array<{ x: number; y: number; y2: number; slope: number }>>();
  for (let current = 0, previous = points.length - 1; current < points.length; previous = current++) {
    const [x, y] = points[current];
    const [x2, y2] = points[previous];
    if (y === y2) continue;
    const bottom = Math.max(Math.min(y, y2), extent.minY);
    const top = Math.min(Math.max(y, y2), extent.maxY);
    if (bottom > top) continue;
    const edge = { x, y, y2, slope: (x2 - x) / (y2 - y) };
    for (let index = Math.floor(bottom / stride); index <= Math.floor(top / stride); index++) {
      let row = rows.get(index);
      if (!row) {
        row = [];
        rows.set(index, row);
      }
      row.push(edge);
    }
  }
  return (x: number, y: number) => {
    let inside = false;
    for (const edge of rows.get(Math.floor(y / stride)) ?? []) {
      if ((edge.y > y) !== (edge.y2 > y) && x < edge.x + (y - edge.y) * edge.slope) inside = !inside;
    }
    return inside;
  };
}

interface PlantingPolygon {
  feature: WorldFeature;
  bounds: Bounds;
  contains: (x: number, y: number) => boolean;
  holes: ((x: number, y: number) => boolean)[];
}

function collectPolygons(data: WorldData, extent: Bounds) {
  const woods = new SpatialBins<PlantingPolygon>(240);
  const open = new SpatialBins<PlantingPolygon>(120);
  for (const feature of data.features) {
    if (!['forest', 'building', 'platform', 'water'].includes(feature.type) || feature.points.length < 3) continue;
    const bounds = polygonBounds(feature.points);
    const clipped = {
      minX: Math.max(bounds.minX, extent.minX), maxX: Math.min(bounds.maxX, extent.maxX),
      minY: Math.max(bounds.minY, extent.minY), maxY: Math.min(bounds.maxY, extent.maxY),
    };
    if (clipped.minX > clipped.maxX || clipped.minY > clipped.maxY) continue;
    (feature.type === 'forest' ? woods : open).insert({
      feature, bounds, contains: ringContains(feature.points, clipped),
      holes: feature.holes?.map(hole => ringContains(hole, clipped)) ?? [],
    }, clipped);
  }
  const enclosed = (east: number, north: number, polygon: PlantingPolygon) =>
    inBounds(east, north, polygon.bounds) && polygon.contains(east, north)
      && !polygon.holes.some(hole => hole(east, north));
  return {
    woodAt: (east: number, north: number) =>
      woods.candidates(east, north).find(polygon => enclosed(east, north, polygon))?.feature,
    excluded: (east: number, north: number) =>
      open.candidates(east, north).some(polygon => enclosed(east, north, polygon)),
  };
}

interface LineSegment {
  x: number; y: number; dx: number; dy: number;
}

function collectSurfaceTrack(data: WorldData) {
  const index = new SpatialBins<LineSegment>(56);
  const insert = (a: LocalPoint, b: LocalPoint) => {
    const padding = 48;
    index.insert({ x: a[0], y: a[1], dx: b[0] - a[0], dy: b[1] - a[1] }, {
      minX: Math.min(a[0], b[0]) - padding, maxX: Math.max(a[0], b[0]) + padding,
      minY: Math.min(a[1], b[1]) - padding, maxY: Math.max(a[1], b[1]) + padding,
    });
  };
  let spanIndex = 0;
  for (let i = 1; i < data.rail.length; i++) {
    const a = data.rail[i - 1];
    const b = data.rail[i];
    const chainage = (a.distance + b.distance) / 2;
    while (spanIndex < data.spans.length - 1 && chainage >= data.spans[spanIndex].end) spanIndex++;
    if (!data.spans[spanIndex]?.tunnel) insert([a.east, a.north], [b.east, b.north]);
  }
  for (const feature of data.features) {
    if (feature.type !== 'track' || feature.tags.tunnel && feature.tags.tunnel !== 'no') continue;
    for (let i = 1; i < feature.points.length; i++) insert(feature.points[i - 1], feature.points[i]);
  }

  return (east: number, north: number) => {
    let nearest = Infinity;
    for (const segment of index.candidates(east, north)) {
      const { x, y, dx, dy } = segment;
      const length = dx * dx + dy * dy;
      const t = length > 0 ? Math.max(0, Math.min(1, ((east - x) * dx + (north - y) * dy) / length)) : 0;
      nearest = Math.min(nearest, (east - x - dx * t) ** 2 + (north - y - dy * t) ** 2);
    }
    return Math.sqrt(nearest);
  };
}

function collectRailApproaches(rail: Rail) {
  const samples = new SpatialBins<LocalPoint>(480);
  for (let distance = 0; distance <= rail.length + 28; distance += 28) {
    const { x, z } = rail.position(distance);
    const padding = 665;
    samples.insert([x, -z], { minX: x - padding, maxX: x + padding, minY: -z - padding, maxY: -z + padding });
  }
  return (x: number, y: number) => {
    let closest = 665 ** 2;
    for (const [east, north] of samples.candidates(x, y)) {
      closest = Math.min(closest, (east - x) ** 2 + (north - y) ** 2);
    }
    return Math.sqrt(closest);
  };
}

function treeKind(feature: WorldFeature, roll: number): PlantKind {
  const leaf = feature.tags.leaf_type;
  if (leaf === 'broadleaved') return 'birch';
  if (leaf === 'needleleaved') return roll < 0.76 ? 'spruce' : 'pine';
  if (leaf === 'mixed') return roll < 0.52 ? 'spruce' : roll < 0.75 ? 'pine' : 'birch';
  return forest[roll < 0.68 ? 0 : roll < 0.87 ? 1 : 2];
}

function tunnelMouths(rail: Rail, spans: readonly TrackSpan[]) {
  const tunnels: { start: number; end: number }[] = [];
  for (const span of spans) {
    if (!span.tunnel) continue;
    const preceding = tunnels.at(-1);
    if (preceding && span.start <= preceding.end + 0.025) preceding.end = Math.max(preceding.end, span.end);
    else tunnels.push({ start: span.start, end: span.end });
  }
  const mouths: LocalPoint[] = [];
  for (const tunnel of tunnels) {
    for (const [chainage, direction] of [[tunnel.start, -1], [tunnel.end, 1]]) {
      const end = rail.position(chainage);
      // A window clipped in the middle of a bore has no open approach.
      if (rail.position(chainage + direction * 0.4).distanceToSquared(end) < 1e-5) continue;
      mouths.push([end.x, -end.z]);
    }
  }
  return mouths;
}

type BankPlant = { east: number; north: number; height: number; width: number; seed: number; rank: number; willow: boolean };

function bankCandidates(data: WorldData, extent: Bounds, approaches: (east: number, north: number) => number) {
  const candidates: BankPlant[] = [];
  for (const feature of data.features) {
    if (feature.type !== 'water') continue;
    const rings = [feature.points, ...(feature.holes ?? [])];
    for (const [ringIndex, ring] of rings.entries()) {
      if (ring.length < 3) continue;
      const signedArea = ring.reduce((area, [x, y], index) => {
        const [a, b] = ring[(index + 1) % ring.length];
        return area + x * b - y * a;
      }, 0);
      if (signedArea === 0) continue;
      // The interior of a hole is land, the interior of the outer ring is water.
      const landSide = Math.sign(signedArea) * (ringIndex === 0 ? -1 : 1);
      for (const [edge, [x, y]] of ring.entries()) {
        const [a, b] = ring[(edge + 1) % ring.length];
        if (Math.max(x, a) < extent.minX - 3 || Math.min(x, a) > extent.maxX + 3 ||
            Math.max(y, b) < extent.minY - 3 || Math.min(y, b) > extent.maxY + 3) continue;
        const dx = a - x;
        const dy = b - y;
        const length = Math.hypot(dx, dy);
        if (length < 0.4) continue;
        const samples = Math.max(1, Math.floor(length / 5.7));
        for (let index = 0; index < samples; index++) {
          const seed = feature.osmId + edge * 163 + ringIndex * 1597 + index * 379;
          const variance = hash(seed, 71, 53);
          if (variance < 0.29) continue;
          const fraction = (index + 0.16 + hash(seed, 19, 57) * 0.68) / samples;
          const willow = variance > 0.82;
          const height = willow ? 0.46 + hash(seed, 23, 63) * 0.46 : 0.28 + hash(seed, 23, 61) * 0.52;
          const width = height * (willow ? 1.45 : 0.89);
          const offset = width * 0.5 + 0.25 + hash(seed, 27, 67) ** 2 * 1.55;
          const east = x + fraction * dx - dy / length * landSide * offset;
          const north = y + fraction * dy + dx / length * landSide * offset;
          if (!inBounds(east, north, extent)) continue;
          const approach = approaches(east, north);
          if (approach > 155) continue;
          candidates.push({ east, north, height, width, seed, willow, rank: approach / 180 + hash(seed, 11, 31) });
        }
      }
    }
  }
  return candidates.sort((a, b) => a.rank - b.rank);
}

function maintainedHeight(maturity: number, setback: number, morph: number) {
  const young = Math.min(maturity, 1.25 + Math.min(30, Math.max(0, setback - 6)) * 0.115 + morph * 0.94);
  const recovery = Math.max(0, Math.min(1, (setback - 14) / 32)) ** 3;
  return young + (maturity - young) * recovery;
}

function vegetationSite(data: WorldData, rail: Rail, options: VegetationOptions) {
  const terrain = data.terrain;
  const extent = {
    minX: terrain.east, maxX: terrain.east + (terrain.width - 1) * terrain.spacing,
    minY: terrain.north - (terrain.height - 1) * terrain.spacing, maxY: terrain.north,
  };
  const { excluded, woodAt } = collectPolygons(data, extent);
  const distanceToTrack = collectSurfaceTrack(data);
  const accepted = (x: number, y: number) =>
    inBounds(x, y, extent) && (options.ownsCell?.(x, -y) ?? true) && !excluded(x, y);
  const mouths = tunnelMouths(options.portalRail ?? rail, options.portalSpans ?? data.spans);
  const groundSlope = (x: number, y: number) => Math.hypot(
    groundHeight(terrain, x + 2, y) - groundHeight(terrain, x - 2, y),
    groundHeight(terrain, x, y + 2) - groundHeight(terrain, x, y - 2),
  ) / 4;
  return { extent, woodAt, distanceToTrack, accepted, mouths, groundSlope };
}

export function placeVegetation(data: WorldData, rail: Rail, options: VegetationOptions = {}): Plant[] {
  return plantVegetation(data, rail, vegetationSite(data, rail, options));
}

function plantVegetation(data: WorldData, rail: Rail, site: ReturnType<typeof vegetationSite>): Plant[] {
  const { extent, woodAt, distanceToTrack, accepted, mouths, groundSlope } = site;
  const terrain = data.terrain;
  const plants: Plant[] = [];
  const grow = (x: number, y: number, kind: PlantKind, height: number, width: number, seed: number, dry = 0) => {
    const clearance = 12.8 + width * 0.5;
    if (mouths.some(([east, north]) => (x - east) ** 2 + (y - north) ** 2 < clearance ** 2)) return;
    plants.push({
      kind, dry, east: x, north: y, height, width, rotation: hash(seed, 59, 19) * 2 * Math.PI,
      tint: 0.65 + hash(seed, 15, 23) * 0.35,
    });
  };

  const dryBank = (x: number, y: number, railHeight: number, slope = groundSlope(x, y)) =>
    slope >= 0.20 && groundHeight(terrain, x, y) > railHeight + 0.4
      && (!woodAt(x, y) || distanceToTrack(x, y) <= 22);
  const placeDry = (x: number, y: number, roll: number, seed: number) => {
    const kind = roll < 0.54 ? 'grass' : 'willow';
    const height = 0.19 + hash(seed, 18, 49) * (kind === 'grass' ? 0.47 : 0.41);
    const width = height * (kind === 'grass' ? 1.32 : 2.12);
    if (distanceToTrack(x, y) < (kind === 'willow' ? 5.8 : 3.05) + width * 0.55) return;
    const tone = (kind === 'grass' ? 0.42 : 0.73) + hash(seed, 74, 13) * 0.25;
    grow(x, y, kind, height, width, seed, tone);
  };

  const approaches = collectRailApproaches(rail);
  const placeTree = (x: number, y: number, row: number, col: number, variant: number) => {
    const feature = woodAt(x, y);
    if (!feature || !accepted(x, y)) return;
    const morph = hash(col, row, variant + 3);
    const gap = Math.sin(x * 0.021 + Math.sin(y * 0.013)) * Math.cos(y * 0.017 - Math.sin(x * 0.008));
    if (morph < Math.max(0, gap * 0.26)) return;
    const kind = treeKind(feature, hash(col, row, variant + 4));
    const maturity = (kind === 'spruce' ? 7.5 : kind === 'pine' ? 7 : 5.4) + Math.pow(morph, 1.4) * 12;
    const setback = distanceToTrack(x, y);
    const height = maintainedHeight(maturity, setback, morph);
    const width = height * (kind === 'spruce' ? 0.28 : kind === 'pine' ? 0.43 : 0.4);
    if (setback < width * 0.52 + 4.8) return;
    grow(x, y, kind, height, width, Math.floor(hash(col, row, variant + 6) * 2 ** 30));
  };
  const cell = 24;
  for (let row = Math.floor(extent.minY / cell); row * cell <= extent.maxY; row++) {
    for (let col = Math.floor(extent.minX / cell); col * cell <= extent.maxX; col++) {
      const distance = approaches((col + 0.5) * cell, (row + 0.5) * cell);
      const subdivisions = distance < 295 ? 3 : distance < 640 ? 2 : 1;
      for (let iy = 0; iy < subdivisions; iy++) {
        for (let ix = 0; ix < subdivisions; ix++) {
          const variant = (iy * subdivisions + ix) * 17;
          const x = (col + (ix + 0.13 + hash(col, row, variant + 1) * 0.74) / subdivisions) * cell;
          const y = (row + (iy + 0.13 + hash(col, row, variant + 2) * 0.74) / subdivisions) * cell;
          placeTree(x, y, row, col, variant);
        }
      }
    }
  }

  const spanAt = (distance: number): TrackSpan | undefined => data.spans.find(
    span => distance >= span.start && distance < span.end,
  );
  const along = new Vector3();
  const tangent = new Vector3();
  const shoulder = new Vector3();
  let span: TrackSpan | undefined;
  for (let d = 1; d < rail.length; d += 2.7) {
    if (!span || d >= span.end) span = spanAt(d);
    if (!span || span.tunnel || span.bridge) continue;
    rail.position(d, along);
    rail.position(d + 0.7, tangent);
    tangent.sub(along);
    shoulder.set(-tangent.z, 0, tangent.x).normalize();
    const seed = Math.floor(d * 100) + Math.round(along.x + along.z);
    for (const side of [-1, 1]) {
      for (let strip = 0; strip < 3; strip++) {
        const offset = 3.65 + strip * 4.8 + hash(seed, strip, side) * (3.8 + strip * 1.3);
        const x = along.x + side * shoulder.x * offset;
        const y = -along.z - side * shoulder.z * offset;
        if (!accepted(x, y)) continue;
        const roll = hash(seed, strip, side + 17);
        if (dryBank(x, y, along.y)) {
          placeDry(x, y, roll, seed + strip * 24 + side);
          continue;
        }
        const kind = strip === 0 || roll < 0.25 ? 'grass' : roll < 0.53 ? 'fern'
          : roll < 0.77 ? 'fireweed' : 'willow';
        const height = kind === 'willow' ? 0.8 + 1.4 * roll : kind === 'fireweed'
          ? 0.58 + 0.48 * roll : 0.32 + 0.62 * roll;
        const width = height * (kind === 'willow' ? 1.42 : kind === 'grass' ? 1.25 : 0.95);
        if (distanceToTrack(x, y) < (kind === 'willow' ? 5.8 : 3.05) + width * 0.55) continue;
        grow(x, y, kind, height, width, seed + strip * 24 + side);
      }
      const patch = Math.floor(d / 10.8);
      if (Math.floor((d - 2.7) / 10.8) !== patch && hash(patch, side, 84) > 0.27) {
        const offset = 11 + 22 * hash(patch, side, 85);
        const count = 3 + Math.floor(7 * hash(patch, side, 87));
        for (let stem = 0; stem < count; stem++) {
          const jitter = (hash(patch, stem * side, 92) - 0.5) * 10;
          const alongShift = (hash(patch, stem * side, 93) - 0.5) * 18;
          const x = along.x + side * shoulder.x * (offset + jitter) + shoulder.z * alongShift;
          const y = -along.z - side * shoulder.z * (offset + jitter) + shoulder.x * alongShift;
          if (!accepted(x, y)) continue;
          const slope = groundSlope(x, y);
          if (slope > 0.82) continue;
          const mix = hash(patch, stem + side * 61, 97);
          if (dryBank(x, y, along.y, slope)) {
            placeDry(x, y, mix, patch * 37 + side * stem);
            continue;
          }
          const kind = mix < 0.68 ? 'willow' : mix < 0.87 ? 'fern' : 'fireweed';
          const height = kind === 'willow' ? 1.15 + 1.42 * mix : 0.52 + 0.53 * mix;
          const width = height * (kind === 'willow' ? 1.62 : 1.26);
          if (distanceToTrack(x, y) < (kind === 'willow' ? 5.8 : 3.05) + width * 0.55) continue;
          grow(x, y, kind, height, width, patch * 37 + side * stem);
        }
      }
      // Draw juvenile trees along the edges of the mapped forest cover.
      if (hash(seed, side, 121) > 0.88) {
        const offset = 15 + 9 * hash(seed, side, 188);
        const x = along.x + side * shoulder.x * offset;
        const y = -along.z - side * shoulder.z * offset;
        const canopy = woodAt(x, y);
        const setback = distanceToTrack(x, y);
        if (canopy && accepted(x, y) && setback >= 10) {
          const kind = treeKind(canopy, hash(seed, side, 48));
          const morph = hash(seed, side, 81);
          const height = maintainedHeight(1.6 + 3.25 * morph, setback, morph);
          grow(x, y, kind, height, height * 0.43, seed * side);
        }
      }
    }
  }
  const bankCells = new Set<string>();
  const priorCount = plants.length;
  for (const candidate of bankCandidates(data, extent, approaches)) {
    if (plants.length - priorCount >= 220) break;
    const { east, north, height, width, seed, willow } = candidate;
    const cell = `${Math.floor(east / 2.5)}:${Math.floor(north / 2.5)}`;
    if (bankCells.has(cell) || !accepted(east, north) || groundSlope(east, north) > 0.58) continue;
    if (distanceToTrack(east, north) < (willow ? 5.8 : 3.05) + width * 0.55) continue;
    bankCells.add(cell);
    grow(east, north, willow ? 'willow' : 'grass', height, width, seed);
  }
  return plants;
}

function line(ctx: CanvasRenderingContext2D, color: string, width: number, ...points: number[]) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(points[0], points[1]);
  for (let index = 2; index < points.length; index += 2) ctx.lineTo(points[index], points[index + 1]);
  ctx.stroke();
}

function leaf(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, angle: number, color: string) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(x, y, width, height, angle, 0, Math.PI * 2);
  ctx.fill();
}

function colorFrom(palette: readonly string[], value: number) {
  return palette[Math.min(palette.length - 1, Math.floor(value * palette.length))];
}

function spruce(ctx: CanvasRenderingContext2D, random: () => number) {
  line(ctx, '#6d5140', 5, 196, 372, 192, 28, 190, 13);
  const tones = ['#294335', '#334c3b', '#3f5845', '#4a644b', '#61785b', '#758660'];
  for (let i = 0; i < 31; i++) {
    const fraction = i / 31;
    const y = 24 + i * 10.7;
    const width = 9 + 161 * Math.pow(fraction, 0.85);
    for (const side of [-1, 1]) {
      const span = width * (0.71 + random() * 0.34);
      const tipY = y + 12 + 18 * fraction * random();
      const middle = 192 + side * span * 0.47;
      line(ctx, '#3b4736', 0.9 + fraction * 2, 192, y + 3, middle, y + 9, 192 + side * span, tipY);
      for (let needle = 0; needle < 72; needle++) {
        const t = random();
        const x = 192 + side * span * t;
        const thickness = Math.sin(Math.PI * t) * (7 + 19 * fraction);
        const base = y + (tipY - y) * t + (random() - 0.44) * thickness;
        const tip = x + side * (3 + random() * 18) * (1 - t * 0.45);
        const shade = colorFrom(tones, Math.min(0.999, random() * 0.72 + (base < y + 9 ? 0.23 : 0)));
        line(ctx, shade, 0.5 + random() * 1.4, x, base, tip, base + (random() - 0.73) * (9 + 10 * fraction));
      }
    }
  }
  for (let tuft = 0; tuft < 250; tuft++) {
    const y = 14 + random() * 345;
    const x = 190 + (random() - 0.5) * (10 + y * 0.3);
    line(ctx, colorFrom(tones, random()), 1.5, x, y, x + (random() - 0.5) * 12, y + 3 + random() * 6);
  }
}

function pine(ctx: CanvasRenderingContext2D, random: () => number) {
  const bark = ['#78624e', '#92745a', '#b18d68', '#634d3d'];
  line(ctx, '#715242', 9, 197, 371, 190, 252, 199, 151, 182, 44);
  for (let i = 0; i < 500; i++) {
    const y = 47 + random() * 321;
    const x = 190 + (random() - 0.5) * 8 + Math.sin(y / 65) * 3;
    line(ctx, colorFrom(bark, random()), 0.5 + random() * 0.95, x, y, x + (random() - 0.5) * 3, y + random() * 8);
  }
  const foliage = ['#263e37', '#314d41', '#416052', '#4f6b54', '#688066', '#788867'];
  for (let branch = 0; branch < 24; branch++) {
    const t = branch / 24;
    const base = 62 + t * 182;
    const side = branch % 2 ? 1 : -1;
    const x = 191 + side * (19 + 130 * Math.sin(Math.pow(t, 1.07) * Math.PI * 0.93) * (0.55 + random() * 0.46));
    const y = base - 16 - random() * 28;
    line(ctx, '#715645', 1.2 + t * 1.8, 192, base, (x + 384) / 3, base - 8, x, y);
    const width = 19 + random() * 34;
    for (let fascicle = 0; fascicle < 125; fascicle++) {
      const angle = random() * Math.PI * 2;
      const radius = Math.sqrt(random());
      const fx = x + Math.cos(angle) * width * radius;
      const fy = y + Math.sin(angle) * radius * (12 + width * 0.33);
      const shade = colorFrom(foliage, Math.min(0.999, random() * 0.76 + (fy < y ? 0.20 : 0)));
      leaf(ctx, fx, fy, 1.4 + random() * 4.9, 0.8 + random() * 2.1, (random() - 0.5) * Math.PI, shade);
    }
  }
}

function broadleaf(ctx: CanvasRenderingContext2D, random: () => number, willow: boolean) {
  const branchColor = willow ? '#6e5e48' : '#d8d3b8';
  const palette = willow
    ? ['#40543c', '#536b50', '#62795b', '#798964', '#8b9b71']
    : ['#466035', '#5b733b', '#708747', '#819956', '#94a45d', '#a3ae64'];
  line(ctx, branchColor, willow ? 5 : 8, 187, 373, 192, 258, 190, 212, 206, 142, 184, 48);
  for (let i = 0; i < 46; i++) {
    const y = 84 + random() * 282;
    const x = (y > 238 ? 190 : 196) + (random() - 0.5) * 4;
    line(ctx, willow ? '#5f543f' : '#483f34', 1.2 + random() * 1.5, x - 3, y, x + 2.7, y + random() * 1.7);
  }
  for (let branch = 0; branch < 36; branch++) {
    const t = branch / 36;
    const startY = willow ? 155 + t * 184 : 57 + t * 235;
    const theta = Math.sin(t * Math.PI * 0.96);
    const side = branch % 2 ? 1 : -1;
    const x = 193 + side * (13 + theta * (56 + random() * 81));
    const y = startY - 15 - random() * (30 + theta * 23);
    const elbow = (x + 386) / 3;
    line(ctx, branchColor, 1.2 + theta * 1.4, 192, startY, elbow, startY - 10, x, y);
    for (let twig = 0; twig < 5; twig++) {
      const u = random();
      const fx = elbow + (x - elbow) * u;
      const fy = startY - 10 + (y - startY + 10) * u;
      const direction = (twig % 2 ? 1 : -1) * side;
      const ex = fx + direction * (9 + random() * 28);
      const ey = fy - 3 - random() * 25;
      line(ctx, '#807950', 0.6, fx, fy, ex, ey);
      for (let i = 0; i < 32; i++) {
        const z = random();
        const px = fx + (ex - fx) * z + (random() - 0.5) * (22 + 12 * theta);
        const py = fy + (ey - fy) * z + (random() - 0.5) * (24 + 16 * theta);
        leaf(ctx, px, py, 1 + 2.6 * random(), 1.8 + random() * 3.8,
          random() * Math.PI, colorFrom(palette, random()));
      }
    }
  }
}

function verge(ctx: CanvasRenderingContext2D, random: () => number, kind: PlantKind) {
  const tones = ['#4e6232', '#647441', '#788751', '#8a9958', '#a4a765', '#a3a07a'];
  const count = kind === 'grass' ? 61 : kind === 'fern' ? 10 : 12;
  for (let blade = 0; blade < count; blade++) {
    const x = 191 + (random() - 0.5) * 97;
    const y = 357 - random() * 16;
    const u = (blade % 2 ? 1 : -1) * Math.pow(random(), 0.9);
    const endX = 192 + u * (kind === 'fireweed' ? 80 : 163);
    const endY = 32 + random() * (kind === 'fern' ? 182 : 212);
    const bendX = x * 0.52 + endX * 0.48 - u * 33;
    const bendY = (endY + y * 3) / 4;
    const color = colorFrom(tones, random());
    line(ctx, color, 1 + random() * 2.4, x, y, bendX, bendY, endX, endY);
    if (kind === 'grass') {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(x - 1, y);
      ctx.quadraticCurveTo(bendX - 5, bendY - 9, endX + u * 11, endY);
      ctx.quadraticCurveTo(bendX + 7, bendY - 16, x + 1.5, y);
      ctx.fill();
      if (blade % 5 === 0) {
        for (let bud = 0; bud < 11; bud++) leaf(ctx, endX - u * bud * 1.5, endY + bud * 3, 2.1, 3.6, u * 0.88, '#b2ab78');
      }
      continue;
    }
    for (let sprig = 2; sprig <= 13; sprig++) {
      const t = sprig / 16;
      const px = bendX + (endX - bendX) * t;
      const py = bendY + (endY - bendY) * t;
      const spread = Math.sin(Math.PI * t) * (kind === 'fern' ? 39 : 24);
      for (const side of [-1, 1]) {
        const ny = py - 12 * (1 - t);
        line(ctx, color, 1.8, px, py, px + side * spread, ny);
        for (let segment = 1; segment < 8; segment++) {
          const v = segment / 8;
          leaf(ctx, px + v * spread * side, py + (ny - py) * v,
            (1 - v) * (kind === 'fern' ? 7 : 12) + 1, 1.2 + (1 - v) * 3, side * -0.6,
            colorFrom(tones, random() * 0.67 + 0.12));
        }
      }
    }
    if (kind === 'fireweed') {
      const blooms = ['#a65977', '#ca789b', '#d998b0', '#a44668'];
      for (let flower = 0; flower < 21; flower++) {
        const value = random();
        const fx = endX - u * value * 14 + (random() - 0.5) * (7 + value * 19);
        const fy = endY + value * 47;
        leaf(ctx, fx, fy, 2.2 + value * 3.8, 2.6 + value * 1.6, value * 90, colorFrom(blooms, random()));
      }
    }
  }
}

function treeCutout(context: CanvasRenderingContext2D, image: TreeImage, fractionStart: number, fractionEnd: number) {
  const crop = document.createElement('canvas');
  crop.width = crop.height = 384;
  const source = crop.getContext('2d', { willReadFrequently: true });
  if (!source) return false;
  const left = image.width * fractionStart;
  const span = image.width * fractionEnd - left;
  source.drawImage(image, left, 0, span, image.height, 0, 0, crop.width, crop.height);
  const alpha = source.getImageData(0, 0, crop.width, crop.height).data;
  let minX = crop.width;
  let maxX = 0;
  let minY = crop.height;
  let maxY = 0;
  for (let y = 0; y < crop.height; y++) {
    for (let x = 0; x < crop.width; x++) {
      if (alpha[(y * crop.width + x) * 4 + 3] < 128) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  if (minX >= maxX || minY >= maxY) return false;
  const width = maxX - minX + 1;
  const height = maxY - minY + 1;
  context.drawImage(crop, minX, minY, width, height, 15, 12, cellWidth - 30, cellWidth - 20);
  return true;
}

function canopyFromAbove(context: CanvasRenderingContext2D) {
  const random = sequence(854);
  const tones = ['#334735', '#41583f', '#4e6547', '#637751', '#788863'];
  for (let bough = 0; bough < 39; bough++) {
    const angle = bough * 2.39996;
    const radius = Math.sqrt((bough + 1) / 39) * (127 + 19 * random());
    const bx = 192 + Math.cos(angle) * radius;
    const by = 192 + Math.sin(angle) * radius;
    const bend = 22 + 30 * random() * (1 - radius / 190);
    for (let needle = 0; needle < 265; needle++) {
      const t = random() * Math.PI * 2;
      const reach = Math.sqrt(random());
      const x = bx + Math.cos(t) * bend * reach;
      const y = by + Math.sin(t) * bend * reach * (0.77 + 0.28 * random());
      const value = Math.min(0.999, random() * 0.8 + 0.18 * Math.cos(t + Math.PI * 0.4) ** 2);
      leaf(context, x, y, 0.7 + random() * 4, 1.2 + random() * 4.1, t, colorFrom(tones, value));
    }
  }
}

function buildAtlas(options: VegetationOptions) {
  const canvas = document.createElement('canvas');
  canvas.width = atlasWidth;
  canvas.height = atlasHeight;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas 2D is required to build vegetation materials');
  context.lineCap = 'round';
  cells.forEach((kind, index) => {
    const x = index % 4 * cellWidth;
    const y = Math.floor(index / 4) * cellWidth;
    const random = sequence(577 + index * 23);
    context.save();
    context.translate(x, y);
    context.beginPath();
    context.rect(6, 6, cellWidth - 12, cellWidth - 12);
    context.clip();
    if (kind === 'spruce') {
      if (!options.spruceImage || !treeCutout(context, options.spruceImage, 0, 1)) spruce(context, random);
    } else if (kind === 'pine') {
      if (!options.pineAndBirchImage || !treeCutout(context, options.pineAndBirchImage, 0, 0.5)) pine(context, random);
    } else if (kind === 'birch') {
      if (!options.pineAndBirchImage || !treeCutout(context, options.pineAndBirchImage, 0.5, 1)) broadleaf(context, random, false);
    } else if (kind === 'willow') broadleaf(context, random, true);
    else verge(context, random, kind);
    context.restore();
  });
  context.save();
  context.translate(cellWidth * 3, cellWidth);
  canopyFromAbove(context);
  context.restore();
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function cardGeometry(layout: 'detailed' | 'distant') {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const crowns: number[] = [];
  const indices: number[] = [];
  const add = (corners: number[], normal: Vector3, crown = 0) => {
    const index = positions.length / 3;
    positions.push(...corners);
    uvs.push(0, 0, 1, 0, 1, 1, 0, 1);
    for (let vertex = 0; vertex < 4; vertex++) {
      normals.push(normal.x, normal.y, normal.z);
      crowns.push(crown);
    }
    indices.push(index, index + 1, index + 2, index, index + 2, index + 3);
  };
  const sides = layout === 'detailed' ? 3 : 2;
  for (let side = 0; side < sides; side++) {
    const angle = side * Math.PI / sides;
    const x = Math.cos(angle) / 2;
    const z = Math.sin(angle) / 2;
    add([-x, 0, -z, x, 0, z, x, 1, z, -x, 1, -z], new Vector3(-z, 0.36, x).normalize());
  }
  add([-0.47, 0.59, -0.48, 0.46, 0.72, -0.48, 0.46, 0.89, 0.48, -0.47, 0.70, 0.48],
    new Vector3(-0.12, 0.98, -0.14).normalize(), 1);
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  geometry.setAttribute('plantCrown', new Float32BufferAttribute(crowns, 1));
  geometry.setIndex(indices);
  return geometry;
}

function understoryGeometry() {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  // Three staggered stems spread their foliage outward and droop at the tips.
  const stems = [
    { heading: 0.28, rootX: -0.10, rootZ: -0.12, height: 1, reach: 0.44, width: 0.66 },
    { heading: 2.03, rootX: 0.12, rootZ: -0.07, height: 0.83, reach: 0.50, width: 0.76 },
    { heading: 4.55, rootX: -0.03, rootZ: 0.14, height: 0.69, reach: 0.45, width: 0.57 },
  ];
  const sweep = [
    { lift: 0, bend: 0, spread: 0.28, v: 0 },
    { lift: 0.93, bend: 0.43, spread: 1, v: 0.57 },
    { lift: 0.78, bend: 1, spread: 0.72, v: 1 },
  ];
  for (const { heading, rootX, rootZ, height, reach, width } of stems) {
    const x = Math.cos(heading);
    const z = Math.sin(heading);
    const first = positions.length / 3;
    for (const { lift, bend, spread, v } of sweep) {
      const centerX = rootX + x * reach * bend;
      const centerZ = rootZ + z * reach * bend;
      for (const side of [-1, 1]) {
        const edge = side * width * spread / 2;
        positions.push((centerX - z * edge) * 0.86, height * lift, (centerZ + x * edge) * 0.86);
        uvs.push(side < 0 ? 0 : 1, v);
      }
    }
    indices.push(first, first + 1, first + 2, first + 1, first + 3, first + 2,
      first + 2, first + 3, first + 4, first + 3, first + 5, first + 4);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  geometry.setAttribute('plantCrown', new Float32BufferAttribute(new Float32Array(positions.length / 3), 1));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function understoryLeafGeometry() {
  const positions: number[] = [];
  const colors: number[] = [];
  const edges: number[] = [];
  const indices: number[] = [];
  const vertex = (x: number, y: number, z: number, tone: number, edgeX = 0, edgeZ = 0) => {
    positions.push(x * 0.82, y, z * 0.82);
    edges.push(edgeX * 0.82, 0, edgeZ * 0.82);
    colors.push(tone, tone, tone);
  };
  for (let stem = 0; stem < 6; stem++) {
    const angle = stem * 2.39996 + 0.22;
    const east = Math.cos(angle);
    const north = Math.sin(angle);
    const height = [0.87, 0.69, 0.94, 0.58, 0.78, 0.66][stem];
    const reach = [0.35, 0.31, 0.26, 0.39, 0.33, 0.37][stem];
    const crown = stem % 2 === 0 ? 0.94 : 0.79;
    const base = positions.length / 3;
    const rootX = east * 0.065;
    const rootZ = north * 0.065;
    const bendX = rootX + east * reach * 0.44;
    const bendZ = rootZ + north * reach * 0.44;
    for (const side of [-1, 1]) {
      const edgeX = -north * side * 0.022;
      const edgeZ = east * side * 0.022;
      vertex(rootX + edgeX, 0, rootZ + edgeZ, 0.68, edgeX, edgeZ);
    }
    for (const side of [-1, 1]) {
      const edgeX = -north * side * 0.039;
      const edgeZ = east * side * 0.039;
      vertex(bendX + edgeX, height * 0.66, bendZ + edgeZ, crown, edgeX, edgeZ);
    }
    vertex(rootX + east * reach, height * 0.91, rootZ + north * reach, 1.06);
    indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2, base + 2, base + 3, base + 4);
    for (const side of [-1, 1]) {
      const startX = bendX - north * side * 0.015;
      const startZ = bendZ + east * side * 0.015;
      const wingX = -north * side * 0.115 + east * 0.055;
      const wingZ = east * side * 0.115 + north * 0.055;
      const leaf = positions.length / 3;
      vertex(startX - east * 0.016, height * 0.58, startZ - north * 0.016, 0.71);
      vertex(startX + wingX * 0.55 - east * 0.034, height * 0.75, startZ + wingZ * 0.55 - north * 0.034,
        crown, -east * 0.034, -north * 0.034);
      vertex(startX + wingX, height * (0.73 + side * 0.045), startZ + wingZ, 1.05);
      vertex(startX + wingX * 0.57 + east * 0.045, height * 0.66, startZ + wingZ * 0.57 + north * 0.045,
        0.85, east * 0.045, north * 0.045);
      indices.push(leaf, leaf + 1, leaf + 3, leaf + 1, leaf + 2, leaf + 3);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  geometry.setAttribute('plantLeafEdge', new Float32BufferAttribute(edges, 3));
  geometry.setAttribute('plantCrown', new Float32BufferAttribute(new Float32Array(positions.length / 3), 1));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

type PlantUniforms = {
  time: { value: number };
  breeze: { value: number };
  powder: { value: number };
  wet: { value: number };
};

function plantShader(material: Material, uniforms: PlantUniforms, shaded: boolean, leaves = false) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.plantTime = uniforms.time;
    shader.uniforms.plantBreeze = uniforms.breeze;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
attribute vec4 plantAtlas;
attribute float plantCrown;
${leaves ? 'attribute vec3 plantLeafEdge;\nvarying float vPlantSpecies;' : ''}
uniform float plantTime;
uniform float plantBreeze;
varying float vPlantTip;
varying float vPlantOpacity;
varying float vBirchAutumn;`)
      .replace('#include <uv_vertex>', `#include <uv_vertex>
#ifdef USE_MAP
vec2 tile = mix(plantAtlas.xy, vec2(0.75, 0.0), plantCrown);
vMapUv = tile + vec2(mix(0.009, 0.991, vMapUv.x) * 0.25,
                    mix(0.009, 0.991, vMapUv.y) * 0.5);
#endif`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
float sway = sin(plantTime * 1.34 + plantAtlas.z) * 0.62
  + sin(plantTime * 2.28 + plantAtlas.z * 0.49) * 0.33;
float tip = position.y * position.y;
${leaves ? `
vPlantSpecies = floor(plantAtlas.x * 4.0 + 0.5) + (plantAtlas.y < 0.25 ? 4.0 : 0.0);
transformed -= plantLeafEdge * (vPlantSpecies == 4.0 ? 0.69 : 0.0);
` : ''}
transformed.x += sway * tip * plantBreeze;
transformed.z += sin(plantTime * 1.07 + plantAtlas.z * 0.84) * tip * plantBreeze * 0.46;
vec4 root = vec4(0.0, 0.0, 0.0, 1.0);
#ifdef USE_INSTANCING
root = instanceMatrix * root;
#endif
vec3 lookFrom = cameraPosition - (modelMatrix * root).xyz;
float viewElevation = lookFrom.y / max(0.01, length(lookFrom));
vPlantOpacity = mix(1.0, smoothstep(0.52, 0.77, viewElevation), plantCrown);
vPlantTip = position.y;
vBirchAutumn = plantAtlas.w;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vPlantOpacity;')
      .replace('#include <alphatest_fragment>', 'diffuseColor.a *= vPlantOpacity;\n#include <alphatest_fragment>');
    if (!shaded) return;
    shader.uniforms.plantPowder = uniforms.powder;
    shader.uniforms.plantWet = uniforms.wet;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform float plantPowder;
uniform float plantWet;
varying float vPlantTip;
varying float vBirchAutumn;
${leaves ? 'varying float vPlantSpecies;' : ''}`)
      .replace('#include <map_fragment>', `#include <map_fragment>
vec3 leafColor = diffuseColor.rgb;
${leaves ? `
leafColor = vPlantSpecies < 3.5 ? vec3(0.105, 0.169, 0.051)
  : vPlantSpecies < 4.5 ? vec3(0.230, 0.285, 0.072)
  : vPlantSpecies < 5.5 ? vec3(0.139, 0.214, 0.048)
  : vec3(0.227, 0.208, 0.073);
` : ''}
float greenSeparation = (leafColor.g - leafColor.r) / max(leafColor.g, 0.045);
float goldMask = smoothstep(0.020, 0.17, greenSeparation)
  * smoothstep(0.009, 0.039, leafColor.g - leafColor.b);
float greenValue = max(0.03, leafColor.g);
vec3 autumnGold = vec3(2.52, 1.37, 0.19) * greenValue;
vec3 autumn = mix(leafColor, autumnGold, goldMask * max(vBirchAutumn, 0.0));
float dryAmount = max(-vBirchAutumn, 0.0);
float dryValue = dot(leafColor, vec3(0.29, 0.56, 0.15));
vec3 tawnyGrass = vec3(2.3, 1.55, 0.66) * dryValue;
vec3 russetHeath = vec3(1.53, 0.92, 0.55) * dryValue;
vec3 heath = mix(tawnyGrass, russetHeath, smoothstep(0.60, 0.88, dryAmount));
diffuseColor.rgb = mix(autumn, heath, smoothstep(0.0, 0.43, dryAmount) * 0.93);`)
      .replace('#include <color_fragment>', `#include <color_fragment>
float inLeaf = smoothstep(0.16, 0.58, vPlantTip);
float leafTone = max(diffuseColor.g, diffuseColor.r);
float frost = plantPowder * (0.22 + inLeaf * 0.58)
  * smoothstep(0.05, 0.21, leafTone);
diffuseColor.rgb *= mix(vec3(1.0), vec3(0.74, 0.81, 0.83), plantWet);
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.68, 0.73, 0.76), frost);`);
  };
  material.customProgramCacheKey = () => leaves ? 'rooted-understory-leaves'
    : shaded ? 'rooted-vegetation-light' : 'rooted-vegetation-shadow';
}

type PlantBatch = { detailed?: InstancedMesh; simpler: InstancedMesh; cover: boolean };

function buildBatch(plants: Plant[], base: BufferGeometry, detailedBase: BufferGeometry | null,
  material: Material, detailMaterial: Material, depth: Material, heightAt: (x: number, z: number) => number, cover: boolean): PlantBatch {
  const atlas = new Float32Array(plants.length * 4);
  const geometry = base.clone();
  const detailedGeometry = detailedBase?.clone();
  const atlasAttribute = new InstancedBufferAttribute(atlas, 4);
  geometry.setAttribute('plantAtlas', atlasAttribute);
  detailedGeometry?.setAttribute('plantAtlas', atlasAttribute);
  const simpler = new InstancedMesh(geometry, material, plants.length);
  const detailed = detailedGeometry ? new InstancedMesh(detailedGeometry, detailMaterial, plants.length) : undefined;
  const dummy = new Object3D();
  const color = new Color();
  plants.forEach((plant, index) => {
    const tile = cells.indexOf(plant.kind);
    atlas[index * 4] = tile % 4 / 4;
    atlas[index * 4 + 1] = tile < 4 ? 0.5 : 0;
    atlas[index * 4 + 2] = plant.rotation * 2.35;
    const succession = Math.sin(plant.east * 0.016 + Math.sin(plant.north * 0.021));
    atlas[index * 4 + 3] = plant.kind === 'birch' ? 0.68 + 0.21 * succession + plant.tint * 0.10 : -plant.dry;
    dummy.position.set(plant.east, heightAt(plant.east, -plant.north) - 0.085, -plant.north);
    dummy.rotation.y = plant.rotation;
    dummy.scale.set(plant.width, plant.height, plant.width);
    dummy.updateMatrix();
    simpler.setMatrixAt(index, dummy.matrix);
    color.setRGB(plant.tint, 0.80 + plant.tint * 0.20, 0.83 + plant.tint * 0.17);
    simpler.setColorAt(index, color);
  });
  simpler.name = cover ? 'Railway understory' : 'Mapped woodland canopy';
  simpler.computeBoundingSphere();
  if (simpler.boundingSphere) simpler.boundingSphere.radius += 1.5;
  if (detailed) {
    detailed.name = cover ? 'Railway understory leaf detail' : 'Woodland crown detail';
    detailed.instanceMatrix = simpler.instanceMatrix;
    detailed.instanceColor = simpler.instanceColor;
    detailed.computeBoundingSphere();
    if (detailed.boundingSphere) detailed.boundingSphere.radius += 1.5;
    if (!cover) detailed.customDepthMaterial = depth;
    detailed.castShadow = !cover;
    detailed.receiveShadow = true;
    detailed.visible = false;
  }
  return { cover, simpler, detailed };
}

interface SharedVegetationMaterials {
  atlas: Texture;
  material: MeshLambertMaterial;
  leaves: MeshLambertMaterial;
  depth: MeshDepthMaterial;
  uniforms: PlantUniforms;
  users: number;
}

let shared: SharedVegetationMaterials | undefined;

function vegetationMaterials(options: VegetationOptions): SharedVegetationMaterials {
  if (shared) {
    shared.users += 1;
    return shared;
  }
  const atlas = buildAtlas(options);
  const material = new MeshLambertMaterial({ map: atlas, alphaTest: 0.43, side: DoubleSide });
  const leaves = new MeshLambertMaterial({ side: DoubleSide, vertexColors: true });
  const depth = new MeshDepthMaterial({ map: atlas, alphaTest: 0.43, side: DoubleSide, depthPacking: RGBADepthPacking });
  const uniforms: PlantUniforms = {
    time: { value: 0 }, breeze: { value: 0.025 }, powder: { value: 0 }, wet: { value: 0 },
  };
  plantShader(material, uniforms, true);
  plantShader(depth, uniforms, false);
  plantShader(leaves, uniforms, true, true);
  shared = { atlas, material, leaves, depth, uniforms, users: 1 };
  return shared;
}

export function createVegetation(data: WorldData, rail: Rail, options: VegetationOptions = {}) {
  const site = vegetationSite(data, rail, options);
  const plants = plantVegetation(data, rail, site);
  const group = new Group();
  group.name = 'Norwegian woodland and railway understory';
  const heightAt = options.heightAt ?? ((east, z) => groundHeight(data.terrain, east, -z));
  const meadow = createGroundCover(site.extent, heightAt, (x, y) => {
    const distance = site.distanceToTrack(x, y);
    if (distance < 3.55 || distance > 45 || !site.accepted(x, y) || options.meadowAllowed?.(x, y) === false) return false;
    if (site.mouths.some(([east, north]) => (x - east) ** 2 + (y - north) ** 2 < 13.3 ** 2)) return false;
    return site.groundSlope(x, y) < .71 && (distance < 16 || !site.woodAt(x, y))
      && site.accepted(x + .24, y) && site.accepted(x - .24, y)
      && site.accepted(x, y + .24) && site.accepted(x, y - .24);
  }, hash);
  group.add(meadow.mesh);
  const buckets = new Map<string, { plants: Plant[]; cover: boolean }>();
  for (const plant of plants) {
    const cover = !forest.includes(plant.kind);
    const size = cover ? 190 : 550;
    const key = `${size}:${Math.floor(plant.east / size)}:${Math.floor(plant.north / size)}`;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { plants: [], cover };
      buckets.set(key, bucket);
    }
    bucket.plants.push(plant);
  }

  const resources = vegetationMaterials(options);
  const distant = cardGeometry('distant');
  const detailed = cardGeometry('detailed');
  const understory = understoryGeometry();
  const leafDetail = understoryLeafGeometry();
  const batches = [...buckets.values()].map(bucket => {
    const batch = buildBatch(bucket.plants, bucket.cover ? understory : distant, bucket.cover ? leafDetail : detailed,
      resources.material, bucket.cover ? resources.leaves : resources.material, resources.depth, heightAt, bucket.cover);
    group.add(batch.simpler);
    if (batch.detailed) group.add(batch.detailed);
    return batch;
  });
  distant.dispose();
  detailed.dispose();
  understory.dispose();
  leafDetail.dispose();

  let elapsed = resources.uniforms.time.value;
  let disposed = false;
  return {
    group,
    update(camera: Vector3, seconds: number, weather: VegetationWeather) {
      meadow.update(camera, seconds, weather);
      elapsed += seconds;
      resources.uniforms.time.value = elapsed;
      resources.uniforms.breeze.value = weather === 'rain' ? 0.08 : weather === 'snow' ? 0.053 : 0.031;
      resources.uniforms.powder.value = weather === 'snow' ? 1 : 0;
      resources.uniforms.wet.value = weather === 'rain' ? 1 : 0;
      for (const batch of batches) {
        const sphere = batch.simpler.boundingSphere;
        if (!sphere) continue;
        const distance = Math.max(0, camera.distanceTo(sphere.center) - sphere.radius * 0.67);
        const useDetail = distance < (batch.cover ? 72 : 245);
        batch.simpler.visible = !useDetail && distance < (batch.cover ? 170 : 5600);
        if (batch.detailed) batch.detailed.visible = useDetail;
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      meadow.dispose();
      for (const batch of batches) {
        batch.simpler.dispose();
        batch.simpler.geometry.dispose();
        batch.detailed?.dispose();
        batch.detailed?.geometry.dispose();
      }
      if (--resources.users !== 0) return;
      resources.material.dispose();
      resources.leaves.dispose();
      resources.depth.dispose();
      resources.atlas.dispose();
      shared = undefined;
    },
  };
}
