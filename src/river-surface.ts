import type { LocalPoint } from './world-data';

const SURFACE_CLEARANCE = 0.12;
const EDGE_EPSILON = 1e-8;

export interface RiverSurface {
  points: LocalPoint[];
  heights: number[];
  indices: number[];
}

function clip(points: LocalPoint[], signedDistance: (point: LocalPoint) => number): LocalPoint[] {
  const output: LocalPoint[] = [];
  for (let index = 0; index < points.length; index++) {
    const current = points[index];
    const previous = points[(index + points.length - 1) % points.length];
    const a = signedDistance(previous);
    const b = signedDistance(current);
    if ((a < 0) !== (b < 0)) {
      const fraction = a / (a - b);
      if (fraction > EDGE_EPSILON && fraction < 1 - EDGE_EPSILON) {
        output.push([
          previous[0] + (current[0] - previous[0]) * fraction,
          previous[1] + (current[1] - previous[1]) * fraction,
        ]);
      }
    }
    if (b >= 0) output.push(current);
  }
  return output;
}

export interface RiverTerrainCorrection {
  /** Coarse cells selected here are refined at the terrain's subcell spacing. */
  refine(east: number, north: number): boolean;
  floor(east: number, north: number, sourceHeight: number): number;
}

/**
 * Conform an already-triangulated river polygon to the terrain raster.
 *
 * Clip each source triangle to the world-aligned grid and its terrain
 * diagonal. Interpolation then uses one local ground plane per face. This
 * preserves the exact extent of the existing OSM outline and holes.
 */
export function buildRiverSurface(
  points: readonly LocalPoint[],
  indices: readonly number[],
  elevation: (east: number, north: number) => number,
  spacing = 8,
  gridOrigin: LocalPoint = [spacing / 2, spacing / 2],
  ownsCell?: (east: number, north: number) => boolean,
  correction?: RiverTerrainCorrection,
): RiverSurface {
  if (!Number.isFinite(spacing) || spacing <= 0) throw new RangeError('River raster spacing must be positive');
  const result: RiverSurface = { points: [], heights: [], indices: [] };
  const vertices = new Map<string, number>();
  const samples = new Map<string, number>();
  const sample = (east: number, north: number) => {
    const key = `${east}/${north}`;
    const previous = samples.get(key);
    if (previous !== undefined) return previous;
    const height = elevation(east, north);
    if (!Number.isFinite(height)) throw new Error(`Missing river terrain sample at ${key}`);
    samples.set(key, height);
    return height;
  };
  const vertex = (point: LocalPoint, height: number) => {
    const key = `${Math.round(point[0] * 1e7)}/${Math.round(point[1] * 1e7)}`;
    const previous = vertices.get(key);
    if (previous !== undefined) return previous;
    const index = result.points.length;
    vertices.set(key, index);
    result.points.push(point);
    result.heights.push(height + SURFACE_CLEARANCE);
    return index;
  };
  const eastBin = (value: number) => Math.floor((value - gridOrigin[0]) / spacing);
  const northBin = (value: number) => Math.floor((value - gridOrigin[1]) / spacing);

  for (let index = 0; index < indices.length; index += 3) {
    const face = [points[indices[index]], points[indices[index + 1]], points[indices[index + 2]]];
    if (face.some(point => !point)) throw new RangeError('River triangle references a missing point');
    for (let col = eastBin(Math.min(...face.map(point => point[0])));
      col <= eastBin(Math.max(...face.map(point => point[0]))); col++) {
      const east = gridOrigin[0] + col * spacing;
      const strip = clip(clip(face, point => point[0] - east), point => east + spacing - point[0]);
      if (strip.length < 3) continue;
      for (let row = northBin(Math.min(...strip.map(point => point[1])));
        row <= northBin(Math.max(...strip.map(point => point[1]))); row++) {
        const north = gridOrigin[1] + row * spacing;
        if (ownsCell && !ownsCell(east + spacing / 2, north + spacing / 2)) continue;
        const cell = clip(clip(strip, point => point[1] - north), point => north + spacing - point[1]);
        if (cell.length < 3) continue;
        const southwest = sample(east, north);
        const northeast = sample(east + spacing, north + spacing);
        const northwest = sample(east, north + spacing);
        const southeast = sample(east + spacing, north);
        const rawHeight = (x: number, n: number) => {
          const u = (x - east) / spacing;
          const v = (n - north) / spacing;
          return v > u ? southwest + (northwest - southwest) * (v - u) + (northeast - southwest) * u
            : southwest + (southeast - southwest) * (u - v) + (northeast - southwest) * v;
        };
        const emit = (polygon: LocalPoint[], triangleVertex: (point: LocalPoint) => number) => {
          if (polygon.length < 3) return;
          const origin = polygon[0];
          for (let i = 1; i < polygon.length - 1; i++) {
            const a = polygon[i];
            const b = polygon[i + 1];
            if (Math.abs((a[0] - origin[0]) * (b[1] - origin[1])
              - (a[1] - origin[1]) * (b[0] - origin[0])) <= EDGE_EPSILON) continue;
            result.indices.push(triangleVertex(origin), triangleVertex(a), triangleVertex(b));
          }
        };
        if (!correction?.refine(east + spacing / 2, north + spacing / 2)) {
          const diagonal = ([x, y]: LocalPoint) => y - north - (x - east);
          const triangleVertex = (point: LocalPoint) => vertex(point, rawHeight(...point));
          emit(clip(cell, diagonal), triangleVertex);
          emit(clip(cell, point => -diagonal(point)), triangleVertex);
          continue;
        }
        const count = Math.max(4, Math.ceil(spacing / 3));
        const step = spacing / count;
        const height = (x: number, n: number) => {
          const base = rawHeight(x, n);
          return Math.max(base, correction.floor(x, n, base));
        };
        for (let x = 0; x < count; x++) {
          const e = east + x * step;
          const subStrip = clip(clip(cell, point => point[0] - e), point => e + step - point[0]);
          if (subStrip.length < 3) continue;
          for (let y = 0; y < count; y++) {
            const n = north + y * step;
            const subcell = clip(clip(subStrip, point => point[1] - n), point => n + step - point[1]);
            if (subcell.length < 3) continue;
            const diagonal = ([p, q]: LocalPoint) => q - n - (p - e);
            const sw = height(e, n);
            const ne = height(e + step, n + step);
            const nw = height(e, n + step);
            const se = height(e + step, n);
            const triangleVertex = (point: LocalPoint) => {
              const u = (point[0] - e) / step;
              const v = (point[1] - n) / step;
              return vertex(point, v > u ? sw + (nw - sw) * (v - u) + (ne - sw) * u
                : sw + (se - sw) * (u - v) + (ne - sw) * v);
            };
            emit(clip(subcell, diagonal), triangleVertex);
            emit(clip(subcell, point => -diagonal(point)), triangleVertex);
          }
        }
      }
    }
  }
  return result;
}
