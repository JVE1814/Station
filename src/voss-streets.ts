import { BufferGeometry, Color, Float32BufferAttribute, Group, Mesh, MeshStandardMaterial } from 'three';
import type { LocalPoint } from './world-data.ts';

type StreetKind = 'road' | 'access' | 'path';
type Point = readonly [x: number, z: number];
type Segment = readonly [Point, Point];
type Triangle = readonly [Point, Point, Point];

export interface VossStreetData {
  version: 1;
  projection: string;
  osmSnapshot: string;
  stationOsmId: number;
  center: LocalPoint;
  radiusMetres: number;
  streets: {
    osmId: number;
    part: number;
    kind: StreetKind;
    points: LocalPoint[];
    widthMetres: number;
    tags: { highway: string } & Record<string, string>;
  }[];
}

interface StreetOptions {
  heightAt: (east: number, worldZ: number) => number;
  excluded?: (east: number, worldZ: number) => boolean;
  /** Running track centrelines in the source east/north convention. */
  railPaths?: readonly (readonly LocalPoint[])[];
  /** Platform footprints in the source east/north convention. */
  platformOutlines?: readonly (readonly LocalPoint[])[];
}

const runningGauge = 2.6;
const cellWidth = 16;
const cross = (a: Point, b: Point, c: Point) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
const mix = (a: Point, b: Point, t: number): Point => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

function distanceSquared([x, z]: Point, [a, b]: Segment) {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz || 1)));
  return (x - a[0] - dx * t) ** 2 + (z - a[1] - dz * t) ** 2;
}

function inTriangle(triangle: Triangle, point: Point) {
  const sides = triangle.map((q, i) => cross(q, triangle[(i + 1) % 3], point));
  return sides.every(side => side >= 0) || sides.every(side => side <= 0);
}

function crosses(a: Point, b: Point, p: Point, q: Point) {
  return cross(p, q, a) * cross(p, q, b) < 0 && cross(a, b, p) * cross(a, b, q) < 0;
}

function overlapsGauge(triangle: Triangle, [a, b]: Segment) {
  if (inTriangle(triangle, a) || inTriangle(triangle, b)) return true;
  const limit = runningGauge ** 2;
  return triangle.some((p, i) => {
    const q = triangle[(i + 1) % 3];
    return crosses(a, b, p, q) || distanceSquared(p, [a, b]) < limit
      || distanceSquared(a, [p, q]) < limit || distanceSquared(b, [p, q]) < limit;
  });
}

function railExclusion(paths: NonNullable<StreetOptions['railPaths']>) {
  const cells = new Map<string, Segment[]>();
  for (const path of paths) {
    for (let i = 1; i < path.length; i++) {
      const [x, n] = path[i - 1];
      const [u, m] = path[i];
      if (x === u && n === m) continue;
      const segment: Segment = [[x, -n], [u, -m]];
      for (let cx = Math.floor((Math.min(x, u) - runningGauge) / cellWidth);
        cx <= Math.floor((Math.max(x, u) + runningGauge) / cellWidth); cx++) {
        for (let cz = Math.floor((Math.min(-n, -m) - runningGauge) / cellWidth);
          cz <= Math.floor((Math.max(-n, -m) + runningGauge) / cellWidth); cz++) {
          const key = `${cx}:${cz}`;
          const cell = cells.get(key);
          if (cell) cell.push(segment);
          else cells.set(key, [segment]);
        }
      }
    }
  }
  return (triangle: Triangle) => {
    const columns = triangle.map(([x]) => Math.floor(x / cellWidth));
    const rows = triangle.map(([, z]) => Math.floor(z / cellWidth));
    for (let x = Math.min(...columns); x <= Math.max(...columns); x++) {
      for (let z = Math.min(...rows); z <= Math.max(...rows); z++) {
        if (cells.get(`${x}:${z}`)?.some(segment => overlapsGauge(triangle, segment))) return true;
      }
    }
    return false;
  };
}

function platformExclusion(outlines: NonNullable<StreetOptions['platformOutlines']>) {
  const footprints = outlines.filter(outline => outline.length >= 3).map(outline => {
    const points = outline.map(([x, n]): Point => [x, -n]);
    return {
      edges: points.map((point, i): Segment => [point, points[(i + 1) % points.length]]),
      left: Math.min(...points.map(([x]) => x)), right: Math.max(...points.map(([x]) => x)),
      top: Math.min(...points.map(([, z]) => z)), bottom: Math.max(...points.map(([, z]) => z)),
    };
  });
  return (triangle: Triangle) => footprints.some(({ edges, left, right, top, bottom }) => {
    if (triangle.every(([x]) => x < left) || triangle.every(([x]) => x > right)
      || triangle.every(([, z]) => z < top) || triangle.every(([, z]) => z > bottom)) return false;
    const [x, z] = triangle[0];
    let inside = false;
    for (const [a, b] of edges) {
      if (inTriangle(triangle, a)
        || triangle.some((point, i) => crosses(point, triangle[(i + 1) % 3], a, b))) return true;
      if ((a[1] > z) !== (b[1] > z) && x < a[0] + (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1])) inside = !inside;
    }
    return inside;
  });
}

function rows(path: LocalPoint[]) {
  const result: Point[] = [];
  for (const [east, north] of path) {
    const point: Point = [east, -north];
    const before = result.at(-1);
    if (!before) {
      result.push(point);
      continue;
    }
    const steps = Math.ceil(Math.hypot(east - before[0], -north - before[1]) / 2.4);
    for (let i = 1; i <= steps; i++) result.push(mix(before, point, i / steps));
  }
  return result;
}

function perpendicular(a: Point, b: Point): Point {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const length = Math.hypot(dx, dz) || 1;
  return [-dz / length, dx / length];
}

const palette: Record<StreetKind, { surface: number; shoulder: number; roughness: number }> = {
  road: { surface: 0x5d6060, shoulder: 0x797569, roughness: 0.91 },
  access: { surface: 0x756f62, shoulder: 0x88806a, roughness: 0.96 },
  path: { surface: 0x918371, shoulder: 0x8b856d, roughness: 0.99 },
};

function surfaceColor(street: VossStreetData['streets'][number]) {
  switch (street.tags.surface) {
    case 'asphalt': return 0x5a5e60;
    case 'concrete': return 0x777a78;
    case 'paving_stones':
    case 'sett': return 0x83817a;
    case 'gravel':
    case 'fine_gravel':
    case 'compacted': return 0x8a806d;
    case 'dirt':
    case 'ground':
    case 'earth': return 0x7f6b53;
    default: return palette[street.kind].surface;
  }
}

type Batch = { positions: number[]; colors: number[]; indices: number[] };

export function createVossStreets(data: VossStreetData, options: StreetOptions) {
  const group = new Group();
  group.name = 'Voss OSM streets';
  const batches = new Map<StreetKind, Batch>();
  const nearTrack = options.railPaths?.length ? railExclusion(options.railPaths) : undefined;
  const onPlatform = options.platformOutlines?.length ? platformExclusion(options.platformOutlines) : undefined;
  const blocked = (triangle: Triangle) => nearTrack?.(triangle) || onPlatform?.(triangle) || options.excluded && [
    ...triangle, ...triangle.map((point, index) => mix(point, triangle[(index + 1) % 3], 0.5)),
    mix(mix(triangle[0], triangle[1], 0.5), triangle[2], 1 / 3),
  ].some(([x, z]) => options.excluded?.(x, z));

  for (const street of data.streets) {
    if (street.tags.tunnel && street.tags.tunnel !== 'no'
      || !(street.widthMetres > 0) || !Number.isFinite(street.widthMetres)) continue;
    const path = rows(street.points);
    if (path.length < 2) continue;
    const style = palette[street.kind];
    const paving = new Color(surfaceColor(street));
    const shoulder = new Color(style.shoulder);
    const tint = new Color();
    const halfWidth = street.widthMetres / 2;
    const verge = Math.min(0.32, halfWidth * 0.21);
    const steps = Math.max(1, Math.ceil(halfWidth / 1.35));
    const offsets = [-halfWidth - verge,
      ...Array.from({ length: 2 * steps + 1 }, (_, index) => (index / steps - 1) * halfWidth),
      halfWidth + verge];
    const width = offsets.length;
    const batch = batches.get(street.kind) ?? { positions: [], colors: [], indices: [] };
    batches.set(street.kind, batch);
    const start = batch.positions.length / 3;
    const vertices: Point[] = [];

    for (let row = 0; row < path.length; row++) {
      const center = path[row];
      const left = perpendicular(path[Math.max(0, row - 1)], path[Math.max(1, row)]);
      const right = perpendicular(path[Math.min(path.length - 2, row)], path[Math.min(path.length - 1, row + 1)]);
      const sumX = left[0] + right[0];
      const sumZ = left[1] + right[1];
      const sumLength = Math.hypot(sumX, sumZ);
      const axis = sumLength < 0.1 ? right : [sumX / sumLength, sumZ / sumLength];
      const miter = 1 / Math.max(0.66, axis[0] * right[0] + axis[1] * right[1]);
      for (const offset of offsets) {
        const x = center[0] + axis[0] * offset * miter;
        const z = center[1] + axis[1] * offset * miter;
        const edge = Math.min(1, Math.max(0, (Math.abs(offset) - halfWidth) / verge));
        const elevation = options.heightAt(x, z) + 0.075 - edge * 0.053;
        const variation = Math.sin(x * 2.9 + z * 3.1 + street.osmId % 4096) * 0.05;
        tint.copy(paving).lerp(shoulder, edge * 0.83).multiplyScalar(1 + variation);
        vertices.push([x, z]);
        batch.positions.push(x, elevation, z);
        batch.colors.push(tint.r, tint.g, tint.b);
      }
      if (row === 0) continue;
      for (let column = 0; column + 1 < width; column++) {
        const a = (row - 1) * width + column;
        const b = a + 1;
        const c = a + width;
        const d = c + 1;
        for (const face of [[a, c, b], [b, c, d]]) {
          const triangle = [vertices[face[0]], vertices[face[1]], vertices[face[2]]] as const;
          const orientation = cross(...triangle);
          if (Math.abs(orientation) < 0.000001 || blocked(triangle)) continue;
          if (orientation > 0) face.reverse();
          const keys = face.map(index => 3 * (start + index) + 1);
          const faceCenter = mix(mix(triangle[0], triangle[1], 0.5), triangle[2], 1 / 3);
          const interpolated = (batch.positions[keys[0]] + batch.positions[keys[1]] + batch.positions[keys[2]]) / 3;
          const lift = options.heightAt(...faceCenter) + 0.012 - interpolated;
          // A street triangle can span a different terrain diagonal. Lift all shared corners together.
          if (lift > 0) for (const key of keys) batch.positions[key] += lift;
          batch.indices.push(...face.map(index => start + index));
        }
      }
    }
  }

  for (const [kind, batch] of batches) {
    if (!batch.indices.length) continue;
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(batch.positions, 3));
    geometry.setAttribute('color', new Float32BufferAttribute(batch.colors, 3));
    geometry.setIndex(batch.indices);
    geometry.computeVertexNormals();
    const surface = new MeshStandardMaterial({
      vertexColors: true, roughness: palette[kind].roughness,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
    });
    const street = new Mesh(geometry, surface);
    street.name = `OSM Voss ${kind}`;
    street.receiveShadow = true;
    group.add(street);
  }
  return group;
}

/** Sample the triangulated terrain itself so road edges follow DEM cell diagonals. */
export function sampleVossStreetTerrain(
  terrain: Group,
  data: Pick<VossStreetData, 'center' | 'radiusMetres'>,
  fallback: StreetOptions['heightAt'],
): StreetOptions['heightAt'] {
  const margin = data.radiusMetres + 18;
  const [east, north] = data.center;
  const left = east - margin;
  const top = -north - margin;
  const right = east + margin;
  const bottom = -north + margin;
  const spacing = 8;
  const size = Math.ceil(margin * 2 / spacing) + 1;
  type Surface = { triangle: Triangle; a: number; b: number; c: number };
  const cells: Surface[][] = [];
  const column = (x: number) => Math.floor((x - left) / spacing);
  const row = (z: number) => Math.floor((z - top) / spacing);

  for (const object of terrain.children) {
    if (!(object instanceof Mesh)) continue;
    const geometry = object.geometry;
    const bounds = geometry.boundingBox;
    const faces = geometry.getIndex();
    if (!faces || !bounds || bounds.max.x < left || bounds.min.x > right
      || bounds.max.z < top || bounds.min.z > bottom) continue;
    const p = geometry.getAttribute('position');
    for (let i = 0; i < faces.count; i += 3) {
      const a = faces.getX(i);
      const b = faces.getX(i + 1);
      const c = faces.getX(i + 2);
      const xs = [p.getX(a), p.getX(b), p.getX(c)];
      const zs = [p.getZ(a), p.getZ(b), p.getZ(c)];
      const xMin = Math.min(...xs);
      const zMin = Math.min(...zs);
      const xMax = Math.max(...xs);
      const zMax = Math.max(...zs);
      if (xMax < left || xMin > right || zMax < top || zMin > bottom) continue;
      const entry: Surface = {
        triangle: [[xs[0], zs[0]], [xs[1], zs[1]], [xs[2], zs[2]]],
        a: p.getY(a), b: p.getY(b), c: p.getY(c),
      };
      for (let x = column(Math.max(left, xMin)); x <= column(Math.min(right, xMax)); x++) {
        for (let z = row(Math.max(top, zMin)); z <= row(Math.min(bottom, zMax)); z++) {
          (cells[z * size + x] ??= []).push(entry);
        }
      }
    }
  }

  return (x, z) => {
    if (x >= left && z >= top && x <= right && z <= bottom) {
      const point: Point = [x, z];
      for (const { triangle: [u, v, w], a, b, c } of cells[row(z) * size + column(x)] ?? []) {
        const signedArea = cross(u, v, w);
        const A = cross(v, w, point) / signedArea;
        const B = cross(w, u, point) / signedArea;
        const C = 1 - A - B;
        if (A >= -1e-6 && B >= -1e-6 && C >= -1e-6) return A * a + B * b + C * c;
      }
    }
    return fallback(x, z);
  };
}
