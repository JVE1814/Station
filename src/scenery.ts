import {
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  Mesh,
  MeshLambertMaterial,
  MeshStandardMaterial,
  Matrix4,
  Object3D,
  PointLight,
  Quaternion,
  Raycaster,
  RepeatWrapping,
  ShapeUtils,
  SRGBColorSpace,
  Vector2,
  Vector3,
} from 'three';
import type { Intersection, Material, Texture } from 'three';
import type { Rail } from './rail';
import { groundHeight, type LocalPoint, type TrackSpan, type WorldData } from './world-data.ts';

type Weather = 'clear' | 'rain' | 'snow';
type Transform = {
  position: Vector3;
  scale: Vector3;
  rotation?: Quaternion;
  color?: Color;
};
type Segment = {
  from: Vector3;
  to: Vector3;
  start: number;
  end: number;
  span: TrackSpan;
  tunnel?: { start: number; end: number };
};
type Nearest = { height: number; distance: number; span: TrackSpan; portalDistance: number };

const UP = new Vector3(0, 1, 0);
const X = new Vector3(1, 0, 0);
const LINE_WIDTH = 3.7;
const RAIL_OFFSET = (1.435 + 0.074) / 2;

function smoothstep(value: number) {
  const amount = Math.max(0, Math.min(1, value));
  return amount * amount * (3 - 2 * amount);
}

function generator(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function material(color: number, roughness = 0.85, metalness = 0) {
  return new MeshStandardMaterial({ color, roughness, metalness });
}

function texture(size: number, draw: (context: CanvasRenderingContext2D) => void) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas 2D is required for procedural railway materials');
  draw(context);
  const map = new CanvasTexture(canvas);
  map.colorSpace = SRGBColorSpace;
  map.wrapS = map.wrapT = RepeatWrapping;
  map.anisotropy = 8;
  return map;
}

function aggregate(geometry: BufferGeometry, surface: Material, values: Transform[]) {
  const mesh = new InstancedMesh(geometry, surface, values.length);
  const dummy = new Object3D();
  values.forEach((entry, index) => {
    dummy.position.copy(entry.position);
    dummy.scale.copy(entry.scale);
    if (entry.rotation) dummy.quaternion.copy(entry.rotation);
    else dummy.quaternion.identity();
    dummy.updateMatrix();
    mesh.setMatrixAt(index, dummy.matrix);
    if (entry.color) mesh.setColorAt(index, entry.color);
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingSphere();
  mesh.receiveShadow = true;
  return mesh;
}

function mesh(
  vertices: number[],
  indices: number[],
  surface: MeshStandardMaterial,
  colors?: number[],
  uv?: number[],
  normals?: number[],
) {
  const geometry = new BufferGeometry();
  geometry.setIndex(indices);
  geometry.setAttribute('position', new Float32BufferAttribute(vertices, 3));
  if (colors) geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  if (uv) geometry.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  if (normals) geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  else geometry.computeVertexNormals();
  const result = new Mesh(geometry, surface);
  result.receiveShadow = true;
  return result;
}

function beam(from: Vector3, to: Vector3, width: number, depth = width): Transform {
  const delta = to.clone().sub(from);
  return {
    position: from.clone().addScaledVector(delta, 0.5),
    scale: new Vector3(width, delta.length(), depth),
    rotation: new Quaternion().setFromUnitVectors(UP, delta.normalize()),
  };
}

function polygon(points: LocalPoint[]) {
  const filtered = points.filter((point, index) => index === 0 ||
    point[0] !== points[index - 1][0] || point[1] !== points[index - 1][1]);
  if (filtered.length > 2 && filtered[0][0] === filtered.at(-1)?.[0] &&
    filtered[0][1] === filtered.at(-1)?.[1]) filtered.pop();
  return filtered;
}

function coordinate(point: LocalPoint, y: number) {
  return new Vector3(point[0], y, -point[1]);
}

function elevationAt(data: WorldData, x: number, z: number) {
  return groundHeight(data.terrain, x, -z);
}

function centerOf(points: LocalPoint[]): LocalPoint {
  return [
    points.reduce((sum, point) => sum + point[0], 0) / points.length,
    points.reduce((sum, point) => sum + point[1], 0) / points.length,
  ];
}

function inside(point: LocalPoint, points: LocalPoint[]) {
  let within = false;
  for (let index = 0, previous = points.length - 1; index < points.length; previous = index++) {
    const [x, y] = points[index];
    const [px, py] = points[previous];
    if ((point[1] > y) !== (point[1] > py) &&
      point[0] < (px - x) * (point[1] - y) / (py - y) + x) within = !within;
  }
  return within;
}

function triangles(points: LocalPoint[], holes: LocalPoint[][] = []) {
  const ring = (outline: LocalPoint[]) => outline.map(([x, y]) => new Vector2(x, y));
  return ShapeUtils.triangulateShape(ring(points), holes.map(ring)).flat();
}

function routeIndex(rail: Rail, spans: TrackSpan[]) {
  const cells = new Map<string, Segment[]>();
  const step = 24;
  const interval = 8;
  let tunnel: Segment['tunnel'];
  for (const span of spans) {
    if (span.tunnel) {
      if (tunnel && Math.abs(span.start - tunnel.end) < 0.1) tunnel.end = span.end;
      else tunnel = { start: span.start, end: span.end };
    } else tunnel = undefined;
    for (let start = span.start; start < span.end; start += interval) {
      const end = Math.min(start + interval, span.end);
      const from = rail.position(start);
      const to = rail.position(end);
      const segment: Segment = { from, to, start, end, span, tunnel };
      for (let x = Math.floor((Math.min(from.x, to.x) - 30) / step); x <= Math.floor((Math.max(from.x, to.x) + 30) / step); x++) {
        for (let z = Math.floor((Math.min(from.z, to.z) - 30) / step); z <= Math.floor((Math.max(from.z, to.z) + 30) / step); z++) {
          const key = `${x}:${z}`;
          const cell = cells.get(key);
          if (cell) cell.push(segment);
          else cells.set(key, [segment]);
        }
      }
    }
  }
  return (x: number, z: number): Nearest | undefined => {
    let nearest: Nearest | undefined;
    for (const { from, to, start, end, span, tunnel } of cells.get(`${Math.floor(x / step)}:${Math.floor(z / step)}`) ?? []) {
      const dx = to.x - from.x;
      const dz = to.z - from.z;
      const lengthSquared = dx * dx + dz * dz;
      if (lengthSquared === 0) continue;
      const fraction = Math.max(0, Math.min(1, ((x - from.x) * dx + (z - from.z) * dz) / lengthSquared));
      const distance = Math.hypot(x - from.x - dx * fraction, z - from.z - dz * fraction);
      if (!nearest || nearest.distance > distance) {
        const chainage = start + (end - start) * fraction;
        const portalDistance = tunnel ? Math.min(chainage - tunnel.start, tunnel.end - chainage) : Infinity;
        nearest = { distance, span, portalDistance, height: from.y + (to.y - from.y) * fraction };
      }
    }
    return nearest;
  };
}

function forestCover(data: WorldData) {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas 2D is required for the OSM forest mask');
  const { east, north, width, height, spacing } = data.terrain;
  const xScale = (size - 1) / ((width - 1) * spacing);
  const zScale = (size - 1) / ((height - 1) * spacing);
  for (const feature of data.features) {
    if (feature.type !== 'forest') continue;
    context.beginPath();
    for (const ring of [feature.points, ...(feature.holes ?? [])]) {
      ring.forEach(([x, y], index) => {
        const imageX = (x - east) * xScale;
        const imageY = (north - y) * zScale;
        if (index === 0) context.moveTo(imageX, imageY);
        else context.lineTo(imageX, imageY);
      });
      context.closePath();
    }
    context.fill('evenodd');
  }
  const { data: pixels } = context.getImageData(0, 0, size, size);
  return (x: number, z: number) => {
    const column = Math.round(Math.max(0, Math.min(size - 1, (x - east) * xScale)));
    const row = Math.round(Math.max(0, Math.min(size - 1, (z + north) * zScale)));
    return pixels[(row * size + column) * 4 + 3] / 255;
  };
}

function gradedHeight(data: WorldData, nearby: ReturnType<typeof routeIndex>, x: number, z: number) {
  const source = elevationAt(data, x, z);
  const track = nearby(x, z);
  if (!track || track.span.bridge) return source;
  const mix = track.span.tunnel
    ? smoothstep((8 - track.distance) / 5) * (1 - smoothstep((track.portalDistance - 5) / 5))
    : smoothstep((15 - track.distance) / 12);
  const trackbed = track.height - 0.33;
  return source + (trackbed - source) * mix;
}

function createTerrain(
  data: WorldData,
  nearby: ReturnType<typeof routeIndex>,
  surface: MeshStandardMaterial,
  ownsCell?: (east: number, worldZ: number) => boolean,
) {
  const group = new Group();
  group.name = 'Graded Copernicus DEM';
  const tileCells = 18;
  const { terrain } = data;
  const { width, height, spacing, east, north } = terrain;
  const grade = (x: number, z: number) => gradedHeight(data, nearby, x, z);
  const grass = new Color(0xb8bd90);
  const rock = new Color(0xc1b4a5);
  const lowland = new Color(0xd4d7aa);
  const spruceShade = new Color(0x5e7755);
  const cover = forestCover(data);
  const soil = new Color();
  const fine = 4;
  const columns = width - 1;
  const rows = height - 1;
  const densities = new Uint8Array(columns * rows).fill(1);
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < columns; col++) {
      const x = east + (col + 0.5) * spacing;
      const z = -north + (row + 0.5) * spacing;
      if ((nearby(x, z)?.distance ?? Infinity) < 15 + spacing * Math.SQRT1_2) {
        densities[row * columns + col] = fine;
      }
    }
  }
  const density = (col: number, row: number) => {
    if (col < 0 || col >= columns || row < 0 || row >= rows) return fine;
    return densities[row * columns + col];
  };
  for (let tileRow = 0; tileRow < rows; tileRow += tileCells) {
    for (let tileCol = 0; tileCol < columns; tileCol += tileCells) {
      const vertices: number[] = [];
      const indices: number[] = [];
      const colors: number[] = [];
      const normals: number[] = [];
      const uv: number[] = [];
      const cached = new Map<number, number>();
      const vertex = (col: number, row: number, x: number, y: number, resolution: number) => {
        const column = col + x / resolution;
        const line = row + y / resolution;
        const key = line * fine * (columns * fine + 1) + column * fine;
        const existing = cached.get(key);
        if (existing !== undefined) return existing;
        const worldX = east + column * spacing;
        const worldZ = -north + line * spacing;
        let h = grade(worldX, worldZ);
        // At a transition, fine-edge vertices lie on the adjacent coarse edge.
        if (y > 0 && y < resolution &&
          (x === 0 && density(col - 1, row) === 1 || x === resolution && density(col + 1, row) === 1)) {
          const fraction = y / resolution;
          const a = grade(worldX, worldZ - spacing * fraction);
          const b = grade(worldX, worldZ + spacing * (1 - fraction));
          h = a + (b - a) * fraction;
        }
        if (x > 0 && x < resolution &&
          (y === 0 && density(col, row - 1) === 1 || y === resolution && density(col, row + 1) === 1)) {
          const fraction = x / resolution;
          const a = grade(worldX - spacing * fraction, worldZ);
          const b = grade(worldX + spacing * (1 - fraction), worldZ);
          h = a + (b - a) * fraction;
        }
        const index = vertices.length / 3;
        vertices.push(worldX, h, worldZ);
        uv.push(worldX / 9, worldZ / 9);
        const dx = grade(worldX + 3, worldZ) - grade(worldX - 3, worldZ);
        const dz = grade(worldX, worldZ + 3) - grade(worldX, worldZ - 3);
        const length = Math.hypot(dx, 6, dz);
        normals.push(-dx / length, 6 / length, -dz / length);
        const slope = 2 * (Math.abs(dx) + Math.abs(dz));
        const field = Math.sin(worldX * 0.029 + Math.sin(worldZ * 0.008)) *
          Math.cos(worldZ * 0.034 - Math.sin(worldX * 0.017));
        soil.copy(grass).lerp(lowland, 0.45 + field * 0.35).lerp(rock, smoothstep((slope - 4) / 19));
        soil.lerp(spruceShade, cover(worldX, worldZ) * 0.7);
        colors.push(soil.r, soil.g, soil.b);
        cached.set(key, index);
        return index;
      };
      const triangle = (a: number, b: number, c: number, resolution: number) => {
        if (resolution === fine) {
          const x = (vertices[a * 3] + vertices[b * 3] + vertices[c * 3]) / 3;
          const z = (vertices[a * 3 + 2] + vertices[b * 3 + 2] + vertices[c * 3 + 2]) / 3;
          const track = nearby(x, z);
          if (track?.span.tunnel && track.portalDistance >= 2.5 && track.distance < 4.2) {
            // A raster surface cannot describe a bore. Remove cells crossing the arch.
            const low = Math.min(vertices[a * 3 + 1], vertices[b * 3 + 1], vertices[c * 3 + 1]);
            const high = Math.max(vertices[a * 3 + 1], vertices[b * 3 + 1], vertices[c * 3 + 1]);
            const roof = track.height + 1.42 + 4.8 * Math.sqrt(1 - (track.distance / 4.2) ** 2);
            if (high > track.height + 0.22 && low < roof) return;
          }
        }
        indices.push(a, b, c);
      };
      for (let row = tileRow; row < Math.min(rows, tileRow + tileCells); row++) {
        for (let col = tileCol; col < Math.min(columns, tileCol + tileCells); col++) {
          const x = east + (col + 0.5) * spacing;
          const z = -north + (row + 0.5) * spacing;
          if (ownsCell && !ownsCell(x, z)) continue;
          const resolution = density(col, row);
          for (let y = 0; y < resolution; y++) {
            for (let x = 0; x < resolution; x++) {
              const a = vertex(col, row, x, y, resolution);
              const b = vertex(col, row, x, y + 1, resolution);
              const c = vertex(col, row, x + 1, y, resolution);
              const d = vertex(col, row, x + 1, y + 1, resolution);
              triangle(a, b, c, resolution);
              triangle(c, b, d, resolution);
            }
          }
        }
      }
      if (indices.length === 0) continue;
      const tile = mesh(vertices, indices, surface, colors, uv, normals);
      tile.geometry.computeBoundingSphere();
      group.add(tile);
    }
  }
  return group;
}

function crossSection(
  rail: Rail,
  span: { start: number; end: number },
  section: [offset: number, height: number][],
  surface: MeshStandardMaterial,
  spacing = 2,
) {
  const vertices: number[] = [];
  const indices: number[] = [];
  const uv: number[] = [];
  const rows = Math.max(1, Math.ceil((span.end - span.start) / spacing));
  const count = section.length;
  for (let row = 0; row <= rows; row++) {
    const distance = span.start + (span.end - span.start) * row / rows;
    const { position, tangent, cant } = rail.pose(distance);
    const axis = new Vector3().crossVectors(tangent, UP).normalize();
    for (const [offset, height] of section) {
      const point = position.clone().addScaledVector(axis, offset);
      vertices.push(point.x, point.y + height + Math.sin(cant) * offset, point.z);
      uv.push(offset / 2, distance / 2);
    }
    if (row === rows) continue;
    for (let col = 0; col < count - 1; col++) {
      const a = row * count + col;
      indices.push(a, a + 1, a + count, a + 1, a + count + 1, a + count);
    }
  }
  return mesh(vertices, indices, surface, undefined, uv);
}

function addTrack(
  group: Group,
  data: WorldData,
  rail: Rail,
  ballast: MeshStandardMaterial,
  concrete: MeshStandardMaterial,
) {
  const full = { start: 0, end: rail.length };
  const steel = material(0x555d61, 0.32, 0.82);
  const gaugeFace = material(0x8e9aa1, 0.24, 0.82);
  const sleeper = material(0x7b7564, 0.86);
  const clips = material(0x453531, 0.46, 0.6);
  const wire = material(0x353e3c, 0.49, 0.7);
  const insulator = material(0x684f37, 0.41);
  const support = material(0x6d7165, 0.69, 0.55);
  const box = new BoxGeometry();
  const rails = [-RAIL_OFFSET, RAIL_OFFSET];
  const bedSpans: TrackSpan[] = [];
  for (const span of data.spans) {
    const previous = bedSpans.at(-1);
    if (previous && Math.abs(previous.end - span.start) < 0.1 &&
      previous.bridge === span.bridge && previous.tunnel === span.tunnel) {
      previous.end = span.end;
    } else bedSpans.push({ ...span });
  }
  for (const span of bedSpans) {
    const width = span.bridge ? 2.42 : LINE_WIDTH;
    const bed = crossSection(rail, span, [
      [-width, -0.45], [-1.82, -0.32], [-1.31, -0.16],
      [1.31, -0.16], [1.82, -0.32], [width, -0.45],
    ], ballast);
    bed.name = 'Running line ballast';
    group.add(bed);
  }
  for (const offset of rails) {
    group.add(crossSection(rail, full, [
      [offset - 0.077, -0.142], [offset - 0.019, -0.136], [offset - 0.018, -0.058],
      [offset - 0.037, -0.044], [offset - 0.037, -0.013], [offset + 0.037, -0.013],
      [offset + 0.037, -0.044], [offset + 0.018, -0.058], [offset + 0.019, -0.136],
      [offset + 0.077, -0.142],
    ], steel, 1.5));
    group.add(crossSection(rail, full, [
      [offset - 0.035, -0.012], [offset - 0.027, -0.001],
      [offset + 0.027, -0.001], [offset + 0.035, -0.012],
    ], gaugeFace, 1.5));
  }

  const ties: Transform[] = [];
  const fasteners: Transform[] = [];
  const posts: Transform[] = [];
  const conductors: Transform[] = [];
  const porcelain: Transform[] = [];
  const piers: Transform[] = [];
  const soil = new Color();
  const random = generator(6249);
  for (let distance = 0.25; distance < rail.length; distance += 0.62) {
    const { position, tangent, cant } = rail.pose(distance);
    const offset = new Vector3().crossVectors(tangent, UP).normalize();
    const twist = new Quaternion().setFromAxisAngle(tangent, cant);
    const rotation = twist.multiply(new Quaternion().setFromUnitVectors(X, offset));
    const base = position.clone().add(new Vector3(0, -0.167, 0));
    soil.setRGB(0.70 + random() * 0.25, 0.70 + random() * 0.20, 0.66 + random() * 0.20);
    ties.push({ position: base, scale: new Vector3(2.48, 0.145, 0.245), rotation, color: soil.clone() });
    for (const side of [-1, 1]) {
      fasteners.push({
        position: base.clone().addScaledVector(offset, side * RAIL_OFFSET).add(new Vector3(0, 0.088, 0)),
        scale: new Vector3(0.28, 0.035, 0.12),
        rotation,
      });
    }
  }
  const inSpan = (distance: number) => data.spans.find((span) => distance >= span.start && distance < span.end);
  for (let station = 12; station < rail.length; station += 45) {
    const span = inSpan(station);
    if (!span?.electrified || span.tunnel) continue;
    const { position, tangent } = rail.pose(station);
    const side = new Vector3().crossVectors(tangent, UP).normalize();
    const post = position.clone().addScaledVector(side, 3.2);
    const foot = post.clone().setY(span.bridge ? position.y - 0.43 : Math.min(position.y - 0.45, elevationAt(data, post.x, post.z)));
    const top = post.clone().setY(position.y + 7.25);
    const anchor = position.clone().setY(position.y + 6.2);
    posts.push(beam(foot, top, 0.22, 0.19));
    posts.push(beam(foot.clone().add(new Vector3(0, -0.25, 0)), foot.clone().add(new Vector3(0, 0.25, 0)), 0.58));
    posts.push(beam(top.clone().setY(position.y + 5.64), position.clone().setY(position.y + 5.42), 0.078));
    posts.push(beam(top.clone().setY(position.y + 6.8), anchor, 0.088));
    posts.push(beam(anchor, position.clone().setY(position.y + 5.42), 0.041));
    porcelain.push(beam(top.clone().setY(position.y + 6.8), top.clone().addScaledVector(side, -0.45).setY(position.y + 6.7), 0.16));
  }
  for (let distance = 0; distance < rail.length; distance += 5) {
    const finish = Math.min(distance + 5, rail.length);
    const span = inSpan((distance + finish) / 2);
    if (!span?.electrified) continue;
    const height = 5.42;
    const a = rail.position(distance).add(new Vector3(0, height, 0));
    const b = rail.position(finish).add(new Vector3(0, height, 0));
    if (span.tunnel) {
      conductors.push(beam(a, b, 0.022));
      if (Math.floor(distance / 5) % 4 === 0) {
        const side = rail.pose(distance).tangent.cross(UP).normalize();
        const insulatorMount = a.clone().addScaledVector(side, 0.45).add(new Vector3(0, 0.15, 0));
        const roofMount = a.clone().addScaledVector(side, 0.72).add(new Vector3(0, 0.91, 0));
        posts.push(beam(insulatorMount, roofMount, 0.08));
        porcelain.push(beam(a, insulatorMount, 0.095));
      }
      continue;
    }
    const sag = (chainage: number) => 0.29 + 0.45 * (1 - Math.sin(Math.PI * ((chainage + 33) % 45) / 45));
    const aboveA = a.clone().add(new Vector3(0, sag(distance), 0));
    const aboveB = b.clone().add(new Vector3(0, sag(finish), 0));
    conductors.push(beam(a, b, 0.021), beam(aboveA, aboveB, 0.016), beam(a, aboveA, 0.012));
  }

  const lining = material(0x615e55, 0.95);
  const tunnelSurface = material(0x403e3a, 0.96);
  const insideSection: [number, number][] = Array.from({ length: 17 }, (_, i) => {
    const angle = Math.PI * i / 16;
    return [-3.75 * Math.cos(angle), 1.42 + 4.8 * Math.sin(angle)];
  });
  insideSection.unshift([-3.75, -0.48]);
  insideSection.push([3.75, -0.48]);
  tunnelSurface.side = DoubleSide;
  lining.side = DoubleSide;
  const bridgeDetail: Transform[] = [];
  for (const span of bedSpans) {
    if (!span.bridge && !span.tunnel) continue;
    if (span.bridge) {
      group.add(crossSection(rail, span, [
        [-2.82, 0.55], [-2.82, -0.4], [-2.36, -0.77], [2.36, -0.77], [2.82, -0.4], [2.82, 0.55],
      ], lining));
      group.add(crossSection(rail, span, [
        [-2.35, -0.54], [-2.11, -1.02], [2.11, -1.02], [2.35, -0.54],
      ], concrete));
      const length = span.end - span.start;
      const supports = 1 + Math.floor(length / 24);
      for (const distance of [
        span.start + Math.min(1.2, length * 0.14),
        ...Array.from({ length: supports - 1 }, (_, i) => span.start + length * (i + 1) / supports),
        span.end - Math.min(1.2, length * 0.14),
      ]) {
        const { position, tangent } = rail.pose(distance);
        const top = position.add(new Vector3(0, -0.65, 0));
        const bottom = top.clone().setY(Math.min(top.y - 0.64, elevationAt(data, top.x, top.z) - 0.75));
        const support = beam(bottom, top, 4.6, 1.65);
        support.rotation = new Quaternion().setFromUnitVectors(X, tangent.cross(UP).normalize());
        piers.push(support);
      }
      for (const side of [-1, 1]) {
        group.add(crossSection(rail, span, [
          [side * 2.70 - 0.04, 0.91], [side * 2.70 - 0.03, 0.99],
          [side * 2.70 + 0.03, 0.99], [side * 2.70 + 0.04, 0.91],
        ], steel));
        for (let distance = span.start + 0.5; distance < span.end; distance += 2.35) {
          const { position, tangent } = rail.pose(distance);
          const edge = position.addScaledVector(tangent.cross(UP).normalize(), side * 2.70);
          bridgeDetail.push(beam(edge.clone().add(new Vector3(0, 0.50, 0)), edge.clone().add(new Vector3(0, 0.98, 0)), 0.065));
        }
      }
    } else {
      const bore = crossSection(rail, span, insideSection, tunnelSurface, 3);
      bore.name = 'Tunnel bore';
      const floor = crossSection(rail, span, [[-3.77, -0.48], [3.77, -0.48]], tunnelSurface, 3);
      floor.name = 'Tunnel bore';
      group.add(bore, floor);
      const outsideSection = insideSection.map(([x, y]): [number, number] => [x * 1.13, y * 1.1 + 0.05]);
      for (const end of [span.start, span.end]) {
        const portal = crossSection(rail, {
          start: Math.max(0, end - 0.9), end: Math.min(rail.length, end + 0.9),
        }, outsideSection, lining, 0.5);
        portal.name = 'Tunnel portal';
        const { position, tangent, cant } = rail.pose(end);
        const lateral = tangent.cross(UP).normalize();
        const vertices: number[] = [];
        const indices: number[] = [];
        for (let i = 0; i < insideSection.length; i++) {
          for (const [x, y] of [insideSection[i], outsideSection[i]]) {
            const point = position.clone().addScaledVector(lateral, x);
            vertices.push(point.x, point.y + y + Math.sin(cant) * x, point.z);
          }
          if (i + 1 === insideSection.length) continue;
          const first = i * 2;
          indices.push(first, first + 1, first + 2, first + 1, first + 3, first + 2);
        }
        const frontage = mesh(vertices, indices, lining);
        frontage.name = 'Tunnel portal';
        group.add(portal, frontage);
      }
    }
  }

  for (const [surface, entries] of [
    [sleeper, ties], [clips, fasteners], [support, posts], [wire, conductors],
    [insulator, porcelain], [concrete, piers], [steel, bridgeDetail],
  ] satisfies [MeshStandardMaterial, Transform[]][]) {
    if (!entries.length) continue;
    const detail = aggregate(box, surface, entries);
    detail.castShadow = entries !== fasteners && entries !== conductors;
    group.add(detail);
  }
}

function addParallelTracks(
  group: Group,
  data: WorldData,
  nearby: ReturnType<typeof routeIndex>,
  ballast: MeshStandardMaterial,
) {
  const ballastVertices: number[] = [];
  const ballastUv: number[] = [];
  const ballastIndices: number[] = [];
  const railVertices: number[] = [];
  const railIndices: number[] = [];
  const sleepers: Transform[] = [];
  const feet: Transform[] = [];
  const wires: Transform[] = [];
  const shoulder = [[-1.85, -0.28], [-1.17, -0.15], [1.17, -0.15], [1.85, -0.28]];
  const trackRail = [[-0.062, -0.145], [-0.034, -0.014], [0.034, -0.014], [0.062, -0.145]];
  const appendStrip = (
    vertices: number[],
    indices: number[],
    from: Vector3,
    to: Vector3,
    lateral: Vector3,
    section: number[][],
    baseOffset = 0,
  ) => {
    const first = vertices.length / 3;
    for (const point of [from, to]) {
      for (const [offset, height] of section) {
        const center = point.clone().addScaledVector(lateral, offset + baseOffset);
        vertices.push(center.x, center.y + height, center.z);
      }
    }
    for (let index = 0; index < section.length - 1; index++) {
      const current = first + index;
      const below = current + section.length;
      indices.push(current, current + 1, below, current + 1, below + 1, below);
    }
  };
  for (const feature of data.features) {
    if (feature.type !== 'track' || feature.tags.tunnel && feature.tags.tunnel !== 'no') continue;
    const path = feature.points;
    const railPoint = (point: LocalPoint) => {
      const center = coordinate(point, 0);
      const alignment = nearby(center.x, center.z);
      const ground = elevationAt(data, center.x, center.z) + 0.22;
      const blend = alignment && !alignment.span.tunnel && !alignment.span.bridge
        ? smoothstep((15 - alignment.distance) / 11) : 0;
      return center.setY(ground + ((alignment?.height ?? ground) - ground) * blend);
    };
    let nextTie = 0.2;
    let nextPole = 16;
    for (let index = 1; index < path.length; index++) {
      const from = railPoint(path[index - 1]);
      const to = railPoint(path[index]);
      const delta = to.clone().sub(from);
      const length = delta.length();
      if (length < 0.015) continue;
      const center = from.clone().addScaledVector(delta, 0.5);
      const nearest = nearby(center.x, center.z);
      if (nearest && !nearest.span.tunnel && nearest.distance < 0.28) continue;
      const tangent = delta.clone().normalize();
      const axis = tangent.clone().cross(UP).normalize();
      const rotation = new Quaternion().setFromUnitVectors(X, axis);
      if (!nearest || nearest.distance > 1.58 || nearest.span.tunnel) {
        appendStrip(ballastVertices, ballastIndices, from, to, axis, shoulder);
        for (const point of [from, to]) {
          for (const [offset] of shoulder) ballastUv.push(offset / 2, (point.x + point.z) / 2);
        }
      }
      for (const railOffset of [-RAIL_OFFSET, RAIL_OFFSET]) {
        appendStrip(railVertices, railIndices, from, to, axis, trackRail, railOffset);
      }
      for (; nextTie < length; nextTie += nearest && nearest.distance < 10 ? 0.64 : 1.28) {
        sleepers.push({
          position: from.clone().addScaledVector(tangent, nextTie).add(new Vector3(0, -0.18, 0)),
          scale: new Vector3(2.45, 0.14, 0.23),
          rotation,
        });
      }
      nextTie -= length;
      if (feature.tags.electrified !== 'contact_line') continue;
      wires.push(beam(from.clone().add(new Vector3(0, 5.4, 0)), to.clone().add(new Vector3(0, 5.4, 0)), 0.020));
      for (; nextPole < length; nextPole += 46) {
        const track = from.clone().addScaledVector(tangent, nextPole);
        const nearbyMain = nearby(track.x, track.z);
        if (nearbyMain && nearbyMain.distance < 7) continue;
        const post = track.clone().addScaledVector(axis, 3.05);
        const top = post.clone().add(new Vector3(0, 7.0, 0));
        feet.push(beam(post.clone().add(new Vector3(0, -0.33, 0)), top, 0.19));
        feet.push(beam(top.clone().add(new Vector3(0, -0.85, 0)), track.clone().add(new Vector3(0, 5.4, 0)), 0.068));
      }
      nextPole -= length;
    }
  }
  if (!railVertices.length) return;
  const box = new BoxGeometry();
  if (ballastVertices.length) group.add(mesh(ballastVertices, ballastIndices, ballast, undefined, ballastUv));
  group.add(
    mesh(railVertices, railIndices, material(0x69747a, 0.31, 0.78)),
    aggregate(box, material(0x756f62, 0.86), sleepers),
  );
  if (feet.length) {
    const masts = aggregate(box, material(0x6d7165, 0.64, 0.53), feet);
    masts.castShadow = true;
    group.add(masts);
  }
  if (wires.length) group.add(aggregate(box, material(0x363e38, 0.61, 0.66), wires));
}

type BuildingBatches = {
  walls: number[];
  wallIndices: number[];
  wallUv: number[];
  colors: number[];
  roofs: number[];
  roofIndices: number[];
  roofUv: number[];
};

function appendWall(
  batches: BuildingBatches,
  a: LocalPoint,
  b: LocalPoint,
  base: number,
  height: number,
  color: Color,
) {
  const index = batches.walls.length / 3;
  batches.walls.push(a[0], base, -a[1], b[0], base, -b[1], a[0], height, -a[1], b[0], height, -b[1]);
  const u = Math.hypot(b[0] - a[0], b[1] - a[1]) / 1.8;
  const v = (height - base) / 2.8;
  batches.wallUv.push(0, 0, u, 0, 0, v, u, v);
  for (let corner = 0; corner < 4; corner++) batches.colors.push(color.r, color.g, color.b);
  batches.wallIndices.push(index, index + 1, index + 2, index + 1, index + 3, index + 2);
}

function appendRoof(batches: BuildingBatches, points: LocalPoint[], height: number, rise: number) {
  const index = batches.roofs.length / 3;
  const centroid = centerOf(points);
  const inner = points.map(([x, y]): LocalPoint => [
    centroid[0] + (x - centroid[0]) * 0.58,
    centroid[1] + (y - centroid[1]) * 0.58,
  ]);
  for (const [x, y] of points) {
    batches.roofs.push(x, height, -y);
    batches.roofUv.push(x / 2.7, y / 2.7);
  }
  for (const [x, y] of inner) {
    batches.roofs.push(x, height + rise, -y);
    batches.roofUv.push(x / 2.7, y / 2.7);
  }
  for (let outward = 0; outward < points.length; outward++) {
    const next = (outward + 1) % points.length;
    const a = index + outward;
    const b = index + next;
    batches.roofIndices.push(a, b, a + points.length, b, b + points.length, a + points.length);
  }
  for (const corner of triangles(inner)) batches.roofIndices.push(index + points.length + corner);
}

function addBuildings(
  group: Group,
  data: WorldData,
  windowsSurface: MeshStandardMaterial,
  roofsSurface: MeshStandardMaterial,
  siding?: Texture,
) {
  const facade = material(0xffffff);
  facade.map = siding ?? null;
  facade.vertexColors = true;
  facade.side = DoubleSide;
  roofsSurface.side = DoubleSide;
  const buildingWindows: Transform[] = [];
  const frames: Transform[] = [];
  const batches: BuildingBatches = { walls: [], wallIndices: [], wallUv: [], colors: [], roofs: [], roofIndices: [], roofUv: [] };
  const paint = [0xb97b57, 0xe0d0b1, 0xbfc3b6, 0x9b5542, 0xaaa8a0, 0xb38d69, 0xe6d7c6];

  for (const feature of data.features) {
    if (feature.type !== 'building') continue;
    const outline = polygon(feature.points);
    if (outline.length < 3) continue;
    const random = generator(feature.osmId);
    const center = centerOf(outline);
    const point = coordinate(center, 0);
    const ground = elevationAt(data, point.x, point.z);
    const base = Math.min(ground, ...outline.map(([x, y]) => elevationAt(data, x, -y))) - 0.25;
    const taggedHeight = Number.parseFloat(feature.tags.height ?? '');
    const levels = Number.parseFloat(feature.tags['building:levels'] ?? '') || 1 + Math.floor(random() * 2);
    const structureHeight = taggedHeight > 1 ? taggedHeight : 2.75 * levels;
    const height = ground + structureHeight;
    const taggedColor = feature.tags['building:colour'];
    const color = new Color(taggedColor && /^#[0-9a-f]{6}$/i.test(taggedColor)
      ? taggedColor : paint[Math.floor(random() * paint.length)]);
    const shed = feature.tags.building === 'shed' || feature.tags.building === 'garage';
    const roofRise = feature.tags['roof:shape'] === 'flat' || outline.length > 10 ? 0.15 : Math.min(1.9, structureHeight * 0.23);

    for (let index = 0; index < outline.length; index++) {
      const a = outline[index];
      const b = outline[(index + 1) % outline.length];
      const dx = b[0] - a[0];
      const dz = a[1] - b[1];
      const length = Math.hypot(dx, dz);
      if (length === 0) continue;
      appendWall(batches, a, b, base, height, color);
      if (shed || length < 3.4) continue;

      const direction = new Vector3(dx / length, 0, dz / length);
      const rotation = new Quaternion().setFromUnitVectors(X, direction);
      const normal = new Vector3(-direction.z, 0, direction.x);
      const across = Math.max(1, Math.floor(length / 2.9));
      const floors = Math.min(16, Math.max(1, Math.floor(structureHeight / 2.6)));
      for (let floor = 0; floor < floors; floor++) {
        const sill = ground + (floor + 0.55) * structureHeight / floors;
        for (let column = 0; column < across; column++) {
          const position = coordinate(a, sill).addScaledVector(direction, length * (column + 0.5) / across);
          frames.push({ position, rotation, scale: new Vector3(1.12, 1.24, 0.14) });
          buildingWindows.push({
            position: position.clone().addScaledVector(normal, 0.002),
            rotation,
            scale: new Vector3(0.93, 1.07, 0.16),
            color: new Color().setScalar(0.62 + random() * 0.38),
          });
        }
      }
    }
    appendRoof(batches, outline, height, roofRise);
  }

  if (batches.walls.length) {
    const walls = mesh(batches.walls, batches.wallIndices, facade, batches.colors, batches.wallUv);
    const roof = mesh(batches.roofs, batches.roofIndices, roofsSurface, undefined, batches.roofUv);
    walls.name = 'OSM building walls';
    roof.name = 'OSM building roofs';
    walls.castShadow = roof.castShadow = true;
    group.add(walls, roof);
  }
  if (buildingWindows.length) {
    const box = new BoxGeometry();
    group.add(aggregate(box, material(0x8c8580), frames), aggregate(box, windowsSurface, buildingWindows));
  }
}

function addPlatforms(
  group: Group,
  data: WorldData,
  rail: Rail,
  concrete: MeshStandardMaterial,
  platformLights: MeshStandardMaterial,
) {
  const topMaterial = material(0x696b67, 0.91);
  topMaterial.side = DoubleSide;
  concrete.side = DoubleSide;
  const stripes: Transform[] = [];
  const posts: Transform[] = [];
  const lamps: Transform[] = [];
  const bulbs: PointLight[] = [];
  const platforms: { outline: LocalPoint[]; level: number }[] = [];
  const stripe = material(0xd5bb6c, 0.85);
  const metal = material(0x3d4950, 0.63, 0.46);
  const geometry = new BoxGeometry();
  for (const feature of data.features) {
    if (feature.type !== 'platform') continue;
    const outline = contours(data, polygon(feature.points));
    if (outline.length < 3) continue;
    const center = centerOf(outline);
    const station = data.stations.reduce<typeof data.stations[number] | undefined>((closest, candidate) => {
      if (!closest) return candidate;
      const distance = Math.hypot(center[0] - candidate.position[0], center[1] - candidate.position[1]);
      const previousDistance = Math.hypot(center[0] - closest.position[0], center[1] - closest.position[1]);
      return distance < previousDistance ? candidate : closest;
    }, undefined);
    const ground = elevationAt(data, center[0], -center[1]);
    const nearbyStation = station && Math.hypot(center[0] - station.position[0], center[1] - station.position[1]) < 170;
    const trackHeight = nearbyStation ? rail.position(station.stopDistance).y : ground - 0.4;
    const level = Math.max(ground + 0.24, trackHeight + 0.64);
    platforms.push({ outline, level });
    const surface = outline.flatMap(([x, y]) => [x, level, -y]);
    const top = mesh(surface, triangles(outline), topMaterial);
    const trim: BuildingBatches = { walls: [], wallIndices: [], wallUv: [], colors: [], roofs: [], roofIndices: [], roofUv: [] };
    const grey = new Color(0xffffff);
    for (let index = 0; index < outline.length; index++) {
      const a = outline[index];
      const b = outline[(index + 1) % outline.length];
      const origin = coordinate(a, level + 0.008);
      const end = coordinate(b, level + 0.008);
      appendWall(trim, a, b, Math.min(level - 0.7, ground - 0.15), level, grey);
      const delta = end.clone().sub(origin);
      const length = delta.length();
      const along = delta.clone().normalize();
      const normal = along.clone().cross(UP);
      const middle = origin.clone().addScaledVector(along, length * 0.5);
      if (!inside([middle.x + normal.x * 0.2, -(middle.z + normal.z * 0.2)], outline)) normal.negate();
      if (length > 1) {
        stripes.push({
          position: middle.clone().addScaledVector(normal, 0.18),
          scale: new Vector3(length, 0.014, 0.115),
          rotation: new Quaternion().setFromUnitVectors(X, along),
        });
      }

      if (length < 25 || !station) continue;
      const track = rail.position(station.stopDistance);
      if (middle.distanceTo(track) > 150 || normal.dot(track.clone().sub(middle)) > 0) continue;
      const luminaires = Math.min(5, Math.max(1, Math.floor(length / 36)));
      for (let i = 0; i < luminaires; i++) {
        const foot = origin.clone().addScaledVector(along, length * (i + 0.5) / luminaires).addScaledVector(normal, 0.7);
        const mast = foot.clone().add(new Vector3(0, 4.1, 0));
        const hood = mast.clone().addScaledVector(normal, 0.62).add(new Vector3(0, -0.1, 0));
        posts.push(beam(foot, mast, 0.11), beam(mast, hood, 0.052));
        lamps.push({ position: hood, scale: new Vector3(0.32, 0.07, 0.32) });
        if (bulbs.length < 5 && hood.distanceTo(track) < 68) {
          const light = new PointLight(0xffcc85, 0, 19, 2);
          light.position.copy(hood).add(new Vector3(0, -0.14, 0));
          bulbs.push(light);
          group.add(light);
        }
      }
    }
    group.add(top, mesh(trim.walls, trim.wallIndices, concrete));
  }

  for (const station of data.stations) {
    const { position, tangent } = rail.pose(station.stopDistance);
    const side = tangent.clone().cross(UP).normalize();
    const center = coordinate(station.position, position.y);
    if (center.clone().sub(position).dot(side) < 0) side.negate();
    const along = tangent.clone().setY(0).normalize();
    const sign = position.clone().addScaledVector(side, 5.45).add(new Vector3(0, 2.15, 0));
    const candidates = [5.4, 5, 4.6, 4.2, 3.8, 3.4, 3, 2.6].flatMap(offset =>
      [0, -3, 3, -6, 6].map(distance =>
        position.clone().addScaledVector(side, offset).addScaledVector(along, distance),
      ),
    );
    for (const candidate of candidates) {
      const platform = platforms.find(({ outline }) => [-1.32, 0, 1.32].every((edge) => {
        const foot = candidate.clone().addScaledVector(along, edge);
        return inside([foot.x, -foot.z], outline);
      }));
      if (platform) {
        sign.copy(candidate).setY(platform.level + 1.55);
        break;
      }
    }
    const canvas = document.createElement('canvas');
    canvas.width = 768;
    canvas.height = 180;
    const ctx = canvas.getContext('2d');
    if (!ctx) continue;
    ctx.fillStyle = '#193750';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#e5eaf0';
    ctx.fillRect(18, 16, 732, 3);
    ctx.fillRect(18, 161, 732, 3);
    ctx.font = '600 90px sans-serif';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    ctx.fillText(station.name, 384, 92, 699);
    const map = new CanvasTexture(canvas);
    map.colorSpace = SRGBColorSpace;
    map.anisotropy = 8;
    const face = material(0xffffff, 0.68);
    face.map = map;
    face.emissiveMap = map;
    face.emissive.setHex(0x666666);
    face.emissiveIntensity = 0.34;
    const rotation = new Quaternion().setFromUnitVectors(X, along);
    const board = new Mesh(new BoxGeometry(3.2, 0.75, 0.095), [metal, metal, metal, metal, face, face]);
    board.quaternion.copy(rotation);
    board.position.copy(sign);
    group.add(board);
    for (const edge of [-1.32, 1.32]) {
      const post = sign.clone().addScaledVector(along, edge);
      const bottom = post.clone().setY(Math.min(sign.y - 1.6, elevationAt(data, post.x, post.z)));
      posts.push(beam(bottom, post, 0.075));
    }
  }

  if (stripes.length) group.add(aggregate(geometry, stripe, stripes));
  if (posts.length) group.add(aggregate(geometry, metal, posts));
  if (lamps.length) group.add(aggregate(geometry, platformLights, lamps));
  return bulbs;
}

function contours(data: WorldData, points: LocalPoint[]) {
  const minimumX = data.terrain.east;
  const maximumX = minimumX + (data.terrain.width - 1) * data.terrain.spacing;
  const maximumY = data.terrain.north;
  const minimumY = maximumY - (data.terrain.height - 1) * data.terrain.spacing;
  const limit: { axis: 0 | 1; value: number; sign: 1 | -1 }[] = [
    { axis: 0, value: minimumX, sign: 1 }, { axis: 0, value: maximumX, sign: -1 },
    { axis: 1, value: minimumY, sign: 1 }, { axis: 1, value: maximumY, sign: -1 },
  ];
  let result = points;
  for (const { axis, value, sign } of limit) {
    if (!result.length) break;
    const clipped: LocalPoint[] = [];
    for (let index = 0; index < result.length; index++) {
      const point = result[index];
      const previous = result[(index + result.length - 1) % result.length];
      const currentInside = (point[axis] - value) * sign >= 0;
      const previousInside = (previous[axis] - value) * sign >= 0;
      if (currentInside !== previousInside) {
        const blend = (value - previous[axis]) / (point[axis] - previous[axis]);
        clipped.push([
          previous[0] + (point[0] - previous[0]) * blend,
          previous[1] + (point[1] - previous[1]) * blend,
        ]);
      }
      if (currentInside) clipped.push(point);
    }
    result = clipped;
  }
  return result;
}

function addWater(group: Group, data: WorldData, surface: MeshStandardMaterial) {
  for (const feature of data.features) {
    if (feature.type !== 'water') continue;
    const outline = contours(data, polygon(feature.points));
    if (outline.length < 3) continue;
    const heights = outline.map(([x, y]) => elevationAt(data, x, -y)).sort((a, b) => a - b);
    const waterLevel = heights[Math.floor(heights.length * 0.38)] + 0.11;
    const holes = (feature.holes ?? []).map((hole) => contours(data, polygon(hole))).filter((hole) => hole.length >= 3);
    const rings = [...outline, ...holes.flat()];
    const vertices = rings.flatMap(([x, y]) => [x, waterLevel, -y]);
    const uv = rings.flatMap(([x, y]) => [x / 18, y / 18]);
    const water = mesh(vertices, triangles(outline, holes), surface, undefined, uv);
    water.receiveShadow = false;
    group.add(water);
  }
}

function spruceGeometry() {
  const positions: number[] = [];
  const indices: number[] = [];
  const colors: number[] = [];
  const normals: number[] = [];
  const uv: number[] = [];
  const random = generator(49019);
  const whorls = [
    { height: 0.14, radius: 0.82, count: 7 },
    { height: 0.24, radius: 0.97, count: 8 },
    { height: 0.35, radius: 0.85, count: 7 },
    { height: 0.46, radius: 0.71, count: 7 },
    { height: 0.57, radius: 0.62, count: 6 },
    { height: 0.68, radius: 0.49, count: 6 },
    { height: 0.78, radius: 0.36, count: 5 },
    { height: 0.88, radius: 0.25, count: 5 },
  ];
  for (const { height, radius, count } of whorls) {
    const phase = random() * Math.PI * 2;
    for (let branch = 0; branch < count; branch++) {
      const angle = phase + (branch + random() * 0.34) * Math.PI * 2 / count;
      const x = Math.cos(angle);
      const z = Math.sin(angle);
      const length = radius * (0.77 + random() * 0.26);
      const fall = (random() - 0.77) * 0.095;
      const start = 0.009 + random() * 0.017;
      const tip = height + fall;
      const width = length * 0.28;
      const tilt = 0.035 + random() * 0.06;
      const face = (rootWidth: number, endWidth: number, rootSlope: number, endSlope: number) => {
        const index = positions.length / 3;
        positions.push(
          start * x + rootWidth * z, height + rootSlope, start * z - rootWidth * x,
          start * x - rootWidth * z, height - rootSlope, start * z + rootWidth * x,
          length * x + endWidth * z, tip + endSlope, length * z - endWidth * x,
          length * x - endWidth * z, tip - endSlope, length * z + endWidth * x,
        );
        uv.push(0, 1, 0, 0, 1, 1, 1, 0);
        const tone = 0.61 + random() * 0.25;
        colors.push(tone, tone, tone, tone, tone, tone, 1, 1, 1, 1, 1, 1);
        for (let vertex = 0; vertex < 4; vertex++) normals.push(x * 0.73, 0.68, z * 0.73);
        indices.push(index, index + 1, index + 2, index + 1, index + 3, index + 2);
      };
      face(width * 0.65, width, tilt * 0.16, tilt * 0.21);
      face(width * 0.31, width * 0.45, tilt * 0.43, tilt * 0.59);
    }
  }
  // Overlapping slanted crown sprays close the top without a solid cone.
  for (let side = 0; side < 5; side++) {
    const angle = side * Math.PI * 2 / 5;
    const x = Math.cos(angle) * 0.12;
    const z = Math.sin(angle) * 0.12;
    const index = positions.length / 3;
    positions.push(x - z, 0.83, z + x, x + z, 0.83, z - x, -z * 0.3, 1.035, x * 0.3, z * 0.3, 1.035, -x * 0.3);
    uv.push(0, 1, 0, 0, 1, 1, 1, 0);
    for (let vertex = 0; vertex < 4; vertex++) {
      normals.push(x * 6, 0.71, z * 6);
      colors.push(0.96, 0.97, 0.95);
    }
    indices.push(index, index + 1, index + 2, index + 1, index + 3, index + 2);
  }
  const geometry = new BufferGeometry();
  geometry.setIndex(indices);
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  return geometry;
}

function spruceTexture() {
  return texture(256, (context) => {
    const random = generator(81037);
    const greens = ['#203c29', '#294833', '#355846', '#456646', '#55724c', '#527c54', '#60815b'];
    const line = (x: number, y: number, ex: number, ey: number, width: number, shade: string) => {
      context.strokeStyle = shade;
      context.lineWidth = width;
      context.beginPath();
      context.moveTo(x, y);
      context.lineTo(ex, ey);
      context.stroke();
    };
    context.lineCap = 'round';
    line(2, 132, 241, 124, 2.8, '#564d36');
    for (let root = 19; root < 230; root += 7.5) {
      for (const side of [-1, 1]) {
        const extent = (30 + 60 * Math.sin(Math.PI * (root - 7) / 233)) * (0.49 + random() * 0.56);
        const x0 = root + random() * 6;
        const y0 = 132 - x0 / 33;
        const x1 = x0 + extent * (0.19 + random() * 0.32);
        const y1 = y0 + side * extent;
        context.fillStyle = greens[1];
        context.beginPath();
        context.moveTo(x0, y0);
        for (let edge = 1; edge <= 9; edge++) {
          const t = edge / 9;
          const width = Math.sin(t * Math.PI) * (3.0 + random() * 6.7);
          context.lineTo(x0 + (x1 - x0) * t - width, y0 + (y1 - y0) * t);
        }
        for (let edge = 8; edge >= 1; edge--) {
          const t = edge / 9;
          const width = Math.sin(t * Math.PI) * (3.5 + random() * 8);
          context.lineTo(x0 + (x1 - x0) * t + width, y0 + (y1 - y0) * t);
        }
        context.closePath();
        context.fill();
        line(x0, y0, x1, y1, 1.48, '#34452e');
        const needles = 14 + Math.floor(extent * 0.31);
        for (let index = 0; index < needles; index++) {
          const fraction = (index + random() * 0.8) / needles;
          const baseX = x0 + fraction * (x1 - x0);
          const baseY = y0 + fraction * (y1 - y0);
          const size = (4 + random() * 16) * (0.52 + 0.66 * (1 - fraction));
          const orientation = index % 2 === 0 ? -1 : 1;
          const shade = greens[Math.floor(random() * greens.length)];
          line(baseX, baseY, baseX + orientation * size, baseY + side * size * (0.40 + random() * 0.65),
            1.4 + random() * 2.3, shade);
        }
      }
    }
  });
}

function distantSpruceTexture(branches: CanvasTexture, spruce?: Texture) {
  const spray = branches.image as CanvasImageSource;
  return texture(512, (context) => {
    const random = generator(20799);
    if (spruce) {
      context.drawImage(spruce.image as CanvasImageSource, 1, 1, 254, 254);
    } else {
      context.fillStyle = '#594f3d';
      context.beginPath();
      context.moveTo(122, 251);
      context.lineTo(132, 251);
      context.lineTo(130, 16);
      context.lineTo(126, 16);
      context.fill();
      for (let level = 0; level <= 12; level++) {
        const fraction = level / 12;
        const width = 84 * (1 - fraction) ** 0.77 + 5;
        for (const side of [-1, 1]) {
          context.save();
          context.translate(128, 213 - 187 * fraction);
          context.scale(side, 1);
          context.rotate(0.16 + random() * 0.25);
          context.drawImage(spray, 0, -22, width * (0.77 + random() * 0.34), 46 - 25 * fraction);
          context.restore();
        }
      }
    }
    context.save();
    context.translate(384, 128);
    for (let crown = 0; crown < 24; crown++) {
      context.rotate(2.39996323);
      context.drawImage(spray, 0, -23, 69 + random() * 48, 36 + random() * 17);
    }
    context.restore();
  });
}

function distantSpruceGeometry() {
  const geometry = new BufferGeometry();
  const positions = [
    -1, 0, 0, 1, 0, 0, -1, 1, 0, 1, 1, 0,
    0, 0, -1, 0, 0, 1, 0, 1, -1, 0, 1, 1,
    -1.05, 0.68, -1.05, 1.05, 0.72, -1.05, -1.05, 0.67, 1.05, 1.05, 0.70, 1.05,
  ];
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new Float32BufferAttribute([
    -0.45, 0.72, 0.4, 0.45, 0.72, 0.4, -0.45, 0.72, 0.4, 0.45, 0.72, 0.4,
    0.4, 0.72, -0.45, 0.4, 0.72, 0.45, 0.4, 0.72, -0.45, 0.4, 0.72, 0.45,
    0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0,
  ], 3));
  geometry.setAttribute('uv', new Float32BufferAttribute([
    0.003, 0.501, 0.497, 0.501, 0.003, 0.999, 0.497, 0.999,
    0.003, 0.501, 0.497, 0.501, 0.003, 0.999, 0.497, 0.999,
    0.503, 0.501, 0.997, 0.501, 0.503, 0.999, 0.997, 0.999,
  ], 2));
  geometry.setIndex([0, 1, 2, 1, 3, 2, 4, 5, 6, 5, 7, 6, 8, 10, 9, 9, 10, 11]);
  return geometry;
}

function addForests(
  group: Group,
  data: WorldData,
  nearby: ReturnType<typeof routeIndex>,
  foliage: MeshStandardMaterial,
  distantFoliage: MeshLambertMaterial,
  ownsCell?: (east: number, worldZ: number) => boolean,
) {
  type ForestTile = { near: Transform[]; far: Transform[]; trunks: Transform[] };
  const tileSize = 320;
  const tiles = new Map<string, ForestTile>();
  const land = data.terrain;
  for (const feature of data.features) {
    if (feature.type !== 'forest') continue;
    const outline = contours(data, polygon(feature.points));
    if (outline.length < 3) continue;
    const holes = (feature.holes ?? []).map(polygon).filter((hole) => hole.length >= 3);
    const xs = outline.map(([x]) => x);
    const ys = outline.map(([, y]) => y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const random = generator(feature.osmId);
    const step = Math.max(11.4, Math.sqrt((maxX - minX) * (maxY - minY) / 4200));
    for (let y = minY; y < maxY; y += step) {
      for (let x = minX; x < maxX; x += step) {
        const east = x + random() * step;
        const north = y + random() * step;
        if (east > land.east + (land.width - 1) * land.spacing ||
          north > land.north || !inside([east, north], outline) || random() < 0.11) continue;
        if (holes.some((hole) => inside([east, north], hole))) continue;
        if (ownsCell && !ownsCell(east, -north)) continue;
        const nearest = nearby(east, -north);
        if (nearest && nearest.distance < 8 && !nearest.span.tunnel) continue;
        const near = nearest && nearest.distance < 32;
        const height = 5 + random() ** 0.65 * 12.5;
        const radius = height * (0.15 + random() * 0.08);
        const ground = coordinate([east, north], elevationAt(data, east, -north));
        const scale = 0.68 + random() * 0.32;
        const rotation = new Quaternion().setFromAxisAngle(UP, random() * Math.PI * 2);
        const key = `${Math.floor(east / tileSize)}:${Math.floor(north / tileSize)}`;
        let tile = tiles.get(key);
        if (!tile) {
          tile = { near: [], far: [], trunks: [] };
          tiles.set(key, tile);
        }
        const trees = near ? tile.near : tile.far;
        trees.push({
          position: ground,
          scale: new Vector3(radius, height, radius),
          rotation,
          color: new Color().setRGB(scale, 0.7 + random() * 0.3, scale * 0.88),
        });
        if (near) {
          tile.trunks.push({
            position: ground.clone().add(new Vector3(0, height * 0.22, 0)),
            scale: new Vector3(radius * 0.16, height * 0.45, radius * 0.16),
            rotation,
          });
        }
      }
    }
  }
  const sprays = spruceGeometry();
  const silhouettes = distantSpruceGeometry();
  const trunk = new CylinderGeometry(0.3, 0.6, 1, 6);
  const bark = material(0x504234);
  for (const tile of tiles.values()) {
    if (tile.near.length) {
      const spruce = aggregate(sprays, foliage, tile.near);
      spruce.name = 'Trackside spruce';
      spruce.castShadow = true;
      group.add(spruce, aggregate(trunk, bark, tile.trunks));
    }
    if (tile.far.length) {
      const canopy = aggregate(silhouettes, distantFoliage, tile.far);
      canopy.name = 'Distant spruce';
      group.add(canopy);
    }
  }
}

type SignalAspect = 'clear' | 'approach' | 'stop';

function addSignals(
  group: Group,
  data: WorldData,
  nearest: ReturnType<typeof routeIndex>,
) {
  const poles: Transform[] = [];
  const housing: Transform[] = [];
  const lamps = new Map<number, MeshStandardMaterial>();
  const sides = data.features.filter(item => item.type === 'track');
  const distanceToTrack = (x: number, z: number) => {
    let clearance = nearest(x, z)?.distance ?? 30;
    for (const side of sides) {
      for (let index = 1; index < side.points.length; index++) {
        const [x0, y0] = side.points[index - 1];
        const [x1, y1] = side.points[index];
        const dx = x1 - x0;
        const dz = y0 - y1;
        const length = dx * dx + dz * dz;
        if (length === 0) continue;
        const portion = Math.max(0, Math.min(1, ((x - x0) * dx + (z + y0) * dz) / length));
        clearance = Math.min(clearance, Math.hypot(x - x0 - dx * portion, z + y0 - dz * portion));
      }
    }
    return clearance;
  };
  const lensGeometry = new CylinderGeometry(0.086, 0.086, 0.031, 16);
  const matrix = new Matrix4();
  const towardDriver = new Vector3();
  for (const feature of data.features) {
    if (feature.type !== 'signal' || !feature.points.length) continue;
    const point = feature.points[0];
    const [east, north] = feature.heading ?? [0, 0];
    const heading = new Vector3(east, 0, -north).normalize();
    const foot = coordinate(point, 0);
    if (heading.lengthSq() > 0) {
      const side = new Vector3().crossVectors(heading, UP).multiplyScalar(2.85);
      const right = foot.clone().add(side);
      const left = foot.clone().sub(side);
      foot.copy(distanceToTrack(right.x, right.z) >= distanceToTrack(left.x, left.z) ? right : left);
    }
    foot.y = elevationAt(data, foot.x, foot.z);
    const top = foot.clone().add(new Vector3(0, 3.5, 0));
    const direction = heading.lengthSq() > 0 ? heading : new Vector3(0, 0, -1);
    towardDriver.copy(top).sub(direction);
    const attitude = new Quaternion().setFromRotationMatrix(matrix.lookAt(towardDriver, top, UP));
    poles.push(beam(foot, top, 0.13));
    housing.push({ position: top, scale: new Vector3(0.42, 0.67, 0.24), rotation: attitude });

    const lampMaterial = material(0x46564a, 0.27);
    lampMaterial.emissiveIntensity = 0.4;
    const lamp = new Mesh(lensGeometry, lampMaterial);
    lamp.position.copy(top).addScaledVector(direction, -0.135);
    lamp.position.y -= 0.10;
    lamp.quaternion.setFromUnitVectors(UP, direction);
    lamp.name = 'Railway signal';
    lamps.set(feature.osmId, lampMaterial);
    group.add(lamp);
  }
  if (poles.length) {
    const box = new BoxGeometry();
    const bases = aggregate(box, material(0x7f8278, 0.69, 0.55), poles);
    const heads = aggregate(box, material(0x252927, 0.77), housing);
    bases.name = heads.name = 'Railway signal';
    group.add(bases, heads);
  }
  const palette = { clear: 0x78ef8a, approach: 0xf7bf55, stop: 0xfa4841 };
  return (aspect: SignalAspect, osmId: number) => {
    const lamp = lamps.get(osmId);
    if (!lamp) return;
    lamp.emissive.setHex(palette[aspect]);
    lamp.emissiveIntensity = 1.6;
  };
}

function coatedBySnow(base: MeshStandardMaterial | MeshLambertMaterial, strength: number, branchCanopy = false) {
  const coverage = { value: 0 };
  base.onBeforeCompile = (shader) => {
    shader.uniforms.snowCoverage = coverage;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float snowCoverage;')
      .replace('#include <alphatest_fragment>', `
        #include <alphatest_fragment>
        float cover = snowCoverage * ${strength.toFixed(2)};
        if (cover > 0.001) {
          vec3 powder = vec3(0.74, 0.80, 0.83);
          #ifdef USE_MAP
            vec3 grain = texture2D(map, vMapUv).rgb;
            powder *= 0.87 + 0.28 * grain.g;
            ${branchCanopy ? 'cover *= 0.55 + 0.45 * smoothstep(0.1, 0.39, grain.g);' : ''}
          #endif
          diffuseColor.rgb = mix(diffuseColor.rgb, powder, cover);
        }
      `);
    if (base instanceof MeshStandardMaterial) {
      shader.fragmentShader = shader.fragmentShader.replace('#include <roughnessmap_fragment>',
        '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.91, cover);');
    }
  };
  base.customProgramCacheKey = () => `snow-${base.type}-${strength}-${branchCanopy}`;
  return coverage;
}

function addTracksideGrass(group: Group, data: WorldData, rail: Rail, nearby: ReturnType<typeof routeIndex>) {
  const random = generator(19217);
  const vertices: number[] = [];
  const faces: number[] = [];
  for (let index = 0; index < 12; index++) {
    const angle = random() * Math.PI * 2;
    const width = 0.012 + random() * 0.015;
    const height = 0.18 + random() * 0.35;
    const x = (random() - 0.5) * 0.27;
    const z = (random() - 0.5) * 0.27;
    const dx = Math.cos(angle);
    const dz = Math.sin(angle);
    const base = vertices.length / 3;
    vertices.push(x - dz * width, 0, z + dx * width, x + dz * width, 0, z - dx * width,
      x + dx * height * 0.15, height * 0.64, z + dz * height * 0.15,
      x + dx * height * 0.41, height, z + dz * height * 0.41);
    faces.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(vertices, 3));
  geometry.setIndex(faces);
  geometry.computeVertexNormals();
  const verge = material(0x89965a);
  verge.side = DoubleSide;
  const tileGroups = new Map<number, Transform[]>();
  const excluded = data.features.filter(feature => ['water', 'building', 'platform'].includes(feature.type))
    .map(feature => {
      const points = polygon(feature.points);
      const east = points.map(point => point[0]);
      const north = points.map(point => point[1]);
      return { points, left: Math.min(...east), right: Math.max(...east),
        bottom: Math.min(...north), top: Math.max(...north) };
    });
  for (const span of data.spans) {
    if (span.bridge || span.tunnel) continue;
    for (let distance = span.start + 0.5; distance < span.end; distance += 0.95 + random() * 1.25) {
      const { position, tangent } = rail.pose(distance);
      const axis = tangent.cross(UP).normalize();
      for (const side of [-1, 1]) {
        const base = position.clone().addScaledVector(axis, side * (2.85 + random() * 2.2));
        if (excluded.some(({ points, left, right, bottom, top }) => base.x >= left &&
          base.x <= right && -base.z >= bottom && -base.z <= top && inside([base.x, -base.z], points))) continue;
        base.y = gradedHeight(data, nearby, base.x, base.z) - 0.09;
        const scale = 0.55 + random() * 0.6;
        const rotation = new Quaternion().setFromAxisAngle(UP, random() * 2 * Math.PI);
        const tile = Math.floor(distance / 120);
        if (!tileGroups.has(tile)) tileGroups.set(tile, []);
        tileGroups.get(tile)?.push({ position: base, rotation, scale: new Vector3(scale, scale, scale),
          color: new Color().setRGB(0.75 + random() * 0.25, 0.72 + random() * 0.26, 0.66) });
      }
    }
  }
  const tiles = [...tileGroups.values()].map(entries => {
    const patch = aggregate(geometry, verge, entries);
    patch.name = 'Ballast shoulder grasses';
    patch.receiveShadow = false;
    group.add(patch);
    return patch;
  });
  return {
    material: verge,
    applyDistance(camera: Vector3) {
      for (const patch of tiles) patch.visible = camera.distanceToSquared(patch.boundingSphere!.center) < 205 ** 2;
    },
  };
}

function groundTexture(gravel: boolean) {
  const random = generator(gravel ? 339 : 4103);
  return texture(256, (context) => {
    context.fillStyle = gravel ? '#a09a91' : '#bcbdab';
    context.fillRect(0, 0, 256, 256);
    for (let index = 0; index < 3200; index++) {
      const shade = Math.floor(115 + random() * 120);
      context.fillStyle = `rgba(${shade}, ${shade - 4}, ${shade - 8}, ${gravel ? 0.75 : 0.28})`;
      const x = random() * 256;
      const y = random() * 256;
      const length = random() * (gravel ? 6 : 9) + 1;
      if (!gravel) context.fillRect(x, y, length, random() * 3 + 1);
      else {
        context.beginPath();
        context.moveTo(x - length * 0.45, y - length * 0.16);
        context.lineTo(x + length * 0.2, y - length * 0.47);
        context.lineTo(x + length * 0.47, y + length * 0.23);
        context.lineTo(x + length * 0.32, y + length * 0.5);
        context.lineTo(x - length * 0.38, y + length * 0.35);
        context.fill();
      }
    }
  });
}

function waterNormals() {
  const result = texture(128, (context) => {
    const pixels = context.createImageData(128, 128);
    for (let y = 0; y < 128; y++) {
      for (let x = 0; x < 128; x++) {
        const u = x * Math.PI * 2 / 128;
        const v = y * Math.PI * 2 / 128;
        const nx = Math.cos(3 * u + 4 * v) * 22 + Math.cos(9 * u + 3 * v) * 9 + Math.cos(17 * u - 7 * v) * 4;
        const ny = Math.cos(7 * v - 2 * u) * 18 + Math.cos(15 * v - 4 * u) * 9 + Math.cos(11 * v + 12 * u) * 5;
        const index = (y * 128 + x) * 4;
        pixels.data[index] = 127 + nx;
        pixels.data[index + 1] = 127 + ny;
        pixels.data[index + 2] = 251;
        pixels.data[index + 3] = 255;
      }
    }
    context.putImageData(pixels, 0, 0);
  });
  result.colorSpace = '';
  return result;
}

export interface SceneryMaps {
  grass?: Texture;
  ballast?: Texture;
  spruce?: Texture;
  siding?: Texture;
  roofing?: Texture;
}

export interface SceneryPlacement {
  ownsCell: (east: number, worldZ: number) => boolean;
  gradeRail: Rail;
  gradeSpans: TrackSpan[];
}

export function createScenery(data: WorldData, rail: Rail, maps: SceneryMaps = {}, placement?: SceneryPlacement) {
  const group = new Group();
  group.name = 'OpenStreetMap railway corridor';
  const ground = material(0xffffff, 0.95);
  ground.vertexColors = true;
  ground.map = maps.grass ?? groundTexture(false);
  ground.bumpMap = ground.map;
  ground.bumpScale = 0.035;
  const distantGround = new MeshLambertMaterial({
    color: 0xffffff,
    vertexColors: true,
    map: ground.map,
  });
  const ballast = material(0xc1b7aa, 0.97);
  ballast.map = maps.ballast ?? groundTexture(true);
  ballast.bumpMap = ballast.map;
  ballast.bumpScale = 0.05;
  const concrete = material(0x8a8880, 0.86);
  const roofs = material(maps.roofing ? 0xc9c0bb : 0x4b484a, 0.81);
  roofs.map = maps.roofing ?? null;
  roofs.bumpMap = roofs.map;
  roofs.bumpScale = 0.04;
  const foliage = material(0xabbda2, 0.91);
  foliage.side = DoubleSide;
  foliage.vertexColors = true;
  const spruceAlbedo = spruceTexture();
  foliage.map = spruceAlbedo;
  foliage.alphaTest = 0.36;
  foliage.alphaToCoverage = true;
  const distantFoliage = new MeshLambertMaterial({
    color: 0xa6bb9d,
    side: DoubleSide,
    map: distantSpruceTexture(spruceAlbedo, maps.spruce),
    alphaTest: 0.36,
  });
  const windows = material(0x46565b, 0.36, 0.25);
  windows.emissive.setHex(0xffb75b);
  const fixtures = material(0xf0d2a4, 0.57);
  fixtures.emissive.setHex(0xffc581);
  const water = material(0x365762, 0.19, 0.05);
  water.side = DoubleSide;
  water.normalMap = waterNormals();
  water.normalScale.set(0.22, 0.28);
  water.envMapIntensity = 1.15;

  const snow = [coatedBySnow(ground, 0.92), coatedBySnow(distantGround, 0.92), coatedBySnow(ballast, 0.57),
    coatedBySnow(foliage, 0.64, true), coatedBySnow(distantFoliage, 0.64, true),
    coatedBySnow(roofs, 0.87), coatedBySnow(concrete, 0.29)];
  const nearby = routeIndex(placement?.gradeRail ?? rail, placement?.gradeSpans ?? data.spans);
  const terrain = createTerrain(data, nearby, ground, placement?.ownsCell);
  const terrainTiles = terrain.children.filter(tile => tile instanceof Mesh);
  group.add(terrain);
  addTrack(group, data, rail, ballast, concrete);
  addParallelTracks(group, data, nearby, ballast);
  addWater(group, data, water);
  addBuildings(group, data, windows, roofs, maps.siding);
  addForests(group, data, nearby, foliage, distantFoliage, placement?.ownsCell);
  const grass = addTracksideGrass(group, data, rail, nearby);
  const setSignal = addSignals(group, data, nearby);
  const bulbs = addPlatforms(group, data, rail, concrete, fixtures);
  group.traverse(object => {
    object.updateMatrix();
    object.matrixAutoUpdate = false;
  });

  const setWeather = (weather: Weather) => {
    grass.material.color.setHex(weather === 'snow' ? 0xa6ac91 : 0x89965a);
    for (const amount of snow) amount.value = weather === 'snow' ? 1 : 0;
    ground.roughness = weather === 'rain' ? 0.63 : 0.95;
    ballast.roughness = weather === 'rain' ? 0.66 : 0.97;
    roofs.roughness = weather === 'rain' ? 0.42 : 0.81;
    water.roughness = weather === 'rain' ? 0.33 : 0.2;
    ground.color.setHex(weather === 'rain' ? 0xb0b5af : 0xffffff);
    distantGround.color.copy(ground.color);
  };
  let nightLighting = false;
  const setNight = (night: boolean) => {
    nightLighting = night;
    windows.emissiveIntensity = night ? 0.72 : 0;
    fixtures.emissiveIntensity = night ? 2.4 : 0;
    for (const bulb of bulbs) {
      bulb.visible = false;
      bulb.intensity = night ? 31 : 0;
    }
    water.color.setHex(night ? 0x20354b : 0x365762);
  };
  let waterTime = 0;
  const update = (seconds: number, camera: Vector3) => {
    grass.applyDistance(camera);
    for (const tile of terrainTiles) {
      const center = tile.geometry.boundingSphere?.center;
      const detailed = center && camera.distanceToSquared(center) <= 390 ** 2;
      tile.material = detailed ? ground : distantGround;
    }
    for (const bulb of bulbs) bulb.visible = nightLighting && bulb.position.distanceToSquared(camera) < 105 ** 2;
    waterTime += seconds;
    water.normalMap?.offset.set((waterTime * 0.016) % 1, (waterTime * 0.010) % 1);
  };
  setNight(false);

  return { group, setWeather, setNight, setSignal, update };
}


export interface TrackbedAudit {
  sampleCount: number;
  missingCount: number;
  maxGap: number;
  maxTerrainOverBed: number;
  worstLocation: { distance: number; lateral: number } | null;
}

export function auditTrackbed(
  group: Group,
  rail: Rail,
  data: WorldData,
  spacing = 5,
): TrackbedAudit {
  if (!Number.isFinite(spacing) || spacing <= 0) throw new Error('Positive trackbed audit spacing is required');
  const ground = group.getObjectByName('Graded Copernicus DEM');
  const beds = group.children.filter((object) => object.name === 'Running line ballast');
  if (!ground || !beds.length) throw new Error('The scene is missing rendered ground or trackbed geometry');
  group.updateWorldMatrix(true, true);
  const ray = new Raycaster();
  const direction = new Vector3(0, -1, 0);
  const surface: Intersection[] = [];
  const ballast: Intersection[] = [];
  const result: TrackbedAudit = {
    sampleCount: 0,
    missingCount: 0,
    maxGap: 0,
    maxTerrainOverBed: 0,
    worstLocation: null,
  };
  const highestPoint = data.terrain.samples.reduce((height, sample) => Math.max(height, sample), -Infinity);
  const origin = new Vector3();
  for (const span of data.spans) {
    if (span.tunnel || span.bridge || span.end <= span.start) continue;
    const divisions = Math.ceil((span.end - span.start) / spacing);
    for (let sample = 0; sample < divisions; sample++) {
      const distance = span.start + (span.end - span.start) * (sample + 0.5) / divisions;
      const { position, tangent } = rail.pose(distance);
      const axis = tangent.cross(UP).normalize();
      for (const lateral of [-2.55, 0, 2.55]) {
        surface.length = ballast.length = 0;
        origin.copy(position).addScaledVector(axis, lateral);
        origin.y = Math.max(position.y, highestPoint) + 25;
        ray.set(origin, direction);
        ray.intersectObjects(ground.children, false, surface);
        ray.intersectObjects(beds, false, ballast);
        result.sampleCount++;
        if (!surface.length || !ballast.length) {
          result.missingCount++;
          continue;
        }
        const difference = surface[0].point.y - ballast[0].point.y;
        result.maxTerrainOverBed = Math.max(result.maxTerrainOverBed, difference);
        const gap = Math.abs(difference);
        if (gap > result.maxGap) {
          result.maxGap = gap;
          result.worstLocation = { distance, lateral };
        }
      }
    }
  }
  return result;
}


export function auditVehicleClearance(group: Group, rail: Rail, spacing = 2) {
  if (!Number.isFinite(spacing) || spacing <= 0) throw new Error('Positive clearance sample spacing is required');
  const terrain = group.getObjectByName('Graded Copernicus DEM');
  if (!terrain) throw new Error('The scene is missing rendered terrain');
  const structures = new Set(['Tunnel portal', 'Tunnel bore', 'OSM building walls', 'OSM building roofs', 'Railway signal']);
  const obstacles = [...terrain.children, ...group.children.filter(object => structures.has(object.name))];
  const hits: Intersection[] = [];
  const direction = new Vector3();
  const body = new Vector3();
  const origin = new Vector3();
  const axial = new Vector3(0, 0, 1);
  const downward = new Vector3(0, -1, 0);
  const bodyAttitude = new Quaternion();
  const cant = new Quaternion();
  const matrix = new Matrix4();
  const ray = new Raycaster();
  ray.far = 3.4;
  const result = { samples: 0, intersections: 0, first: null as null | { distance: number; object: string } };
  group.updateWorldMatrix(true, true);

  for (let distance = 12; distance < rail.length - 12; distance += spacing) {
    const front = rail.position(distance + 8.3);
    const rear = rail.position(distance - 8.3);
    body.copy(front).lerp(rear, 0.5);
    bodyAttitude.setFromRotationMatrix(matrix.lookAt(rear, front, UP));
    bodyAttitude.multiply(cant.setFromAxisAngle(axial, rail.pose(distance, 6).cant));
    direction.copy(downward).applyQuaternion(bodyAttitude);
    for (const length of [-11.8, -8, 0, 8, 11.8]) {
      for (const side of [-1.45, 0, 1.45]) {
        origin.set(side, 4.14, length).applyQuaternion(bodyAttitude).add(body);
        ray.set(origin, direction);
        hits.length = 0;
        ray.intersectObjects(obstacles, false, hits);
        result.samples++;
        if (hits.length) {
          result.intersections++;
          result.first ??= { distance, object: hits[0].object.name || 'terrain' };
        }
      }
    }
  }
  return result;
}
