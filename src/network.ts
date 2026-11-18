import type { Timetable, WorldData } from './world-data';

export type ServiceData = Pick<WorldData, 'service' | 'timetable' | 'rail' | 'spans' | 'stations' | 'features'>;

export interface RouteTile {
  id: string;
  url: string;
  start: number;
  end: number;
  bounds?: [west: number, south: number, east: number, north: number];
}

export interface NetworkRoute extends Omit<ServiceData, 'service'> {
  ref: string;
  projection: string;
  length: number;
  tiles: RouteTile[];
  traffic?: Timetable[];
}

export interface NetworkIndex {
  services: NetworkRoute[];
}

export async function readWorldAsset<T>(path: string, signal?: AbortSignal): Promise<T> {
  const url = `${import.meta.env.BASE_URL}${path}`;
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`Railway data unavailable at ${path} (${response.status})`);
  if (!path.endsWith('.gz')) return response.json();
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) return JSON.parse(new TextDecoder().decode(bytes));
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).json();
}

interface PublishedTimetable {
  line: string;
  selected: Timetable;
  journeys: (Timetable & { direction: -1 | 1 })[];
}

export async function loadNetworkRoute(ref: string): Promise<{ line: NetworkRoute; routes: NetworkRoute[] }> {
  const network = await readWorldAsset<NetworkIndex>('data/network.json');
  const line = network.services.find(route => route.ref === ref);
  if (!line || !Array.isArray(line.tiles) || line.tiles.length === 0) {
    throw new Error(`The ${ref} service is unavailable in this build.`);
  }
  const table = await readWorldAsset<PublishedTimetable[]>('data/timetables.json');
  const record = table.find(candidate => candidate.line === ref);
  if (!record) throw new Error(`The dated timetable for ${ref} is missing.`);
  return {
    line: { ...line, timetable: record.selected, traffic: record.journeys.filter(trip => trip.direction === 1) },
    routes: network.services,
  };
}
