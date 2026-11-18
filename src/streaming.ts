import { Group, Mesh, Texture } from 'three';
import type { Vector3 } from 'three';
import type { RouteTile } from './network';
import { readWorldAsset } from './network';
import { Rail } from './rail';
import { createScenery } from './scenery';
import type { SceneryMaps, SceneryPlacement } from './scenery';
import { groundHeight } from './world-data';
import type { TerrainData, TrackSpan, WorldData } from './world-data';
import type { Weather } from './atmosphere';
import type { SignalAspect } from './blocks';

type TileScene = ReturnType<typeof createScenery>;

function dispose(scene: TileScene, shared: Set<Texture>): void {
  const materials = new Set<import('three').Material>();
  const maps = new Set<Texture>();
  const geometries = new Set<import('three').BufferGeometry>();
  scene.group.traverse(object => {
    if (!(object instanceof Mesh)) return;
    geometries.add(object.geometry);
    if (Array.isArray(object.material)) object.material.forEach(material => materials.add(material));
    else materials.add(object.material);
  });
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) {
    for (const property of Object.values(material)) {
      if (property instanceof Texture && !shared.has(property)) maps.add(property);
    }
    material.dispose();
  }
  for (const map of maps) map.dispose();
}

function covers(tile: RouteTile, x: number, z: number, margin = 0): boolean {
  const bounds = tile.bounds;
  return !!bounds && x >= bounds[0] - margin && x <= bounds[2] + margin
    && -z >= bounds[1] - margin && -z <= bounds[3] + margin;
}

function lineDistance(points: Vector3[], x: number, z: number): number {
  let closest = Infinity;
  for (let index = 1; index < points.length; index++) {
    const a = points[index - 1];
    const b = points[index];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const length = dx * dx + dz * dz;
    const portion = length ? Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / length)) : 0;
    closest = Math.min(closest, (x - a.x - dx * portion) ** 2 + (z - a.z - dz * portion) ** 2);
  }
  return closest;
}

export class SceneryStream {
  readonly group = new Group();
  private readonly loaded = new Map<string, TileScene>();
  private readonly terrain = new Map<string, TerrainData>();
  private readonly pending = new Map<string, AbortController>();
  private readonly signalAspects = new Map<number, SignalAspect>();
  private readonly sharedTextures: Set<Texture>;
  private readonly failures = new Set<string>();
  private readonly outlines = new Map<string, Vector3[]>();
  private weather: Weather = 'clear';
  private night = false;

  constructor(
    private readonly tiles: readonly RouteTile[],
    private readonly maps: SceneryMaps,
    private readonly mainRail: Rail,
    private readonly spans: TrackSpan[],
    private readonly onError: (error: unknown) => void,
    private readonly onChange: () => void,
  ) {
    this.group.name = 'Streamed railway corridor';
    this.sharedTextures = new Set(Object.values(maps));
    for (const tile of tiles) {
      const track = [];
      for (let distance = tile.start; distance < tile.end; distance += 65) track.push(mainRail.position(distance));
      track.push(mainRail.position(tile.end));
      this.outlines.set(tile.id, track);
    }
  }

  async ready(distance: number): Promise<void> {
    const tile = this.tiles.find(candidate => distance >= candidate.start && distance <= candidate.end);
    if (!tile) throw new Error('No scenery tile covers the departure marker');
    await this.load(tile);
  }

  setWeather(weather: Weather): void {
    if (this.weather === weather) return;
    this.weather = weather;
    for (const tile of this.loaded.values()) tile.setWeather(weather);
  }

  setNight(night: boolean): void {
    if (this.night === night) return;
    this.night = night;
    for (const tile of this.loaded.values()) tile.setNight(night);
  }

  setSignal(aspect: SignalAspect, id: number): void {
    if (this.signalAspects.get(id) === aspect) return;
    this.signalAspects.set(id, aspect);
    for (const tile of this.loaded.values()) tile.setSignal(aspect, id);
  }

  heightAt(x: number, z: number): number | undefined {
    for (const tile of this.tiles) {
      if (!covers(tile, x, z)) continue;
      const grid = this.terrain.get(tile.id);
      if (grid) return groundHeight(grid, x, -z);
    }
    return undefined;
  }

  coversMapFocus(focus: Vector3): boolean {
    return this.tiles.some(tile => covers(tile, focus.x, focus.z));
  }

  update(seconds: number, camera: Vector3, distance?: number, focus?: Vector3): void {
    const train = distance === undefined ? undefined : this.mainRail.position(distance);
    const nearest = this.tiles.filter(tile => (distance !== undefined && tile.start <= distance + 3000
      && tile.end >= distance - 2200) || (train && covers(tile, train.x, train.z, 400))
      || (focus && covers(tile, focus.x, focus.z, 250)));
    const requested = new Set(nearest.map(tile => tile.id));
    for (const tile of nearest) {
      if (!this.loaded.has(tile.id) && !this.pending.has(tile.id) && !this.failures.has(tile.id)) {
        void this.load(tile).catch((error: unknown) => {
          this.failures.add(tile.id);
          this.onError(error);
        });
      }
    }
    for (const [id, transfer] of this.pending) {
      if (!requested.has(id)) transfer.abort();
    }
    for (const [id, tile] of this.loaded) {
      if (requested.has(id)) tile.update(seconds, camera);
      else {
        tile.group.removeFromParent();
        dispose(tile, this.sharedTextures);
        this.loaded.delete(id);
        this.terrain.delete(id);
      }
    }
  }

  private placement(tile: RouteTile): SceneryPlacement {
    const bounds = tile.bounds;
    const overlapping = bounds ? this.tiles.filter(candidate => {
      const other = candidate.bounds;
      return candidate.id !== tile.id && !!other && other[0] <= bounds[2] && other[2] >= bounds[0]
        && other[1] <= bounds[3] && other[3] >= bounds[1];
    }) : [];
    const outline = this.outlines.get(tile.id)!;
    const start = Math.max(0, tile.start - 85);
    const end = Math.min(this.mainRail.length, tile.end + 85);
    return {
      gradeRail: this.mainRail.window(start, end),
      gradeSpans: this.spans.filter(span => span.end > start && span.start < end)
        .map(span => ({ ...span, start: Math.max(start, span.start), end: Math.min(end, span.end) })),
      ownsCell: (x, z) => {
        const ownDistance = lineDistance(outline, x, z);
        return overlapping.every(other => {
          if (!covers(other, x, z)) return true;
          const theirDistance = lineDistance(this.outlines.get(other.id)!, x, z);
          return ownDistance < theirDistance - 1e-6
            || (Math.abs(ownDistance - theirDistance) <= 1e-6 && tile.id < other.id);
        });
      },
    };
  }

  private async load(tile: RouteTile): Promise<void> {
    const transfer = new AbortController();
    this.pending.set(tile.id, transfer);
    try {
      const url = tile.url.startsWith('data/') ? tile.url : `data/${tile.url}`;
      const world = await readWorldAsset<WorldData>(url, transfer.signal);
      if (transfer.signal.aborted) return;
      const placement = this.placement(tile);
      world.features = world.features.filter(feature => {
        if (!['building', 'signal'].includes(feature.type) || !feature.points.length) return true;
        const [x, z] = feature.points[0];
        return placement.ownsCell(x, -z);
      });
      const scenery = createScenery(world, new Rail(world.rail), this.maps, placement);
      scenery.setWeather(this.weather);
      scenery.setNight(this.night);
      for (const [id, aspect] of this.signalAspects) scenery.setSignal(aspect, id);
      this.loaded.set(tile.id, scenery);
      this.terrain.set(tile.id, world.terrain);
      this.group.add(scenery.group);
      this.onChange();
    } catch (error) {
      if (!transfer.signal.aborted) throw error;
    } finally {
      this.pending.delete(tile.id);
    }
  }
}
