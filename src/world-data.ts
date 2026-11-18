import type { RailPoint } from './rail';

export type LocalPoint = [east: number, north: number];

export interface TerrainData {
  width: number;
  height: number;
  east: number;
  north: number;
  spacing: number;
  samples: number[];
}

export interface TrackSpan {
  start: number;
  end: number;
  osmWay: number;
  direction?: 'forward' | 'backward';
  electrified: boolean;
  tunnel: boolean;
  bridge: boolean;
  speedLimit: number | null;
}

export interface Station {
  name: string;
  osmId: number;
  position: LocalPoint;
  stopDistance: number;
  reversal?: boolean;
}

export interface WorldFeature {
  osmId: number;
  type: 'building' | 'platform' | 'forest' | 'water' | 'signal' | 'track';
  points: LocalPoint[];
  holes?: LocalPoint[][];
  chainage?: number;
  facesService?: boolean;
  heading?: LocalPoint;
  tags: Record<string, string>;
}

export interface TimedCall {
  stationOsmId: number;
  arrival: string;
  departure: string;
}

export interface Timetable {
  trip: string;
  headsign: string;
  departure: string;
  arrival: string;
  calls?: TimedCall[];
}

export function timetableSeconds(hhmmss: string): number {
  return hhmmss.split(':').map(Number).reduce((seconds, component) => seconds * 60 + component, 0);
}

export interface WorldData {
  service: string;
  timetable?: Timetable;
  rail: RailPoint[];
  spans: TrackSpan[];
  terrain: TerrainData;
  stations: Station[];
  features: WorldFeature[];
}

export function groundHeight(terrain: TerrainData, east: number, north: number): number {
  const { width, height, spacing, samples } = terrain;
  const column = Math.max(0, Math.min(width - 1, (east - terrain.east) / spacing));
  const row = Math.max(0, Math.min(height - 1, (terrain.north - north) / spacing));
  const x = Math.min(Math.floor(column), width - 2);
  const y = Math.min(Math.floor(row), height - 2);
  const u = column - x;
  const v = row - y;
  const index = y * width + x;
  const a = samples[index] * (1 - u) + samples[index + 1] * u;
  const b = samples[index + width] * (1 - u) + samples[index + width + 1] * u;
  return a * (1 - v) + b * v;
}
