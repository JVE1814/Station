import { Group, Mesh, Texture } from 'three';
import type { Vector3 } from 'three';
import type { RouteTile } from './network';
import { readWorldAsset } from './network';
import { Rail } from './rail';
import { createScenery } from './scenery';
import type { SceneryMaps } from './scenery';
import type { WorldData } from './world-data';
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

export class SceneryStream {
  readonly group = new Group();
  private readonly loaded = new Map<string, TileScene>();
  private readonly pending = new Map<string, AbortController>();
  private readonly signalAspects = new Map<number, SignalAspect>();
  private readonly sharedTextures: Set<Texture>;
  private readonly failures = new Set<string>();
  private weather: Weather = 'clear';
  private night = false;

  constructor(
    private readonly tiles: readonly RouteTile[],
    private readonly maps: SceneryMaps,
    private readonly onError: (error: unknown) => void,
  ) {
    this.group.name = 'Streamed railway corridor';
    this.sharedTextures = new Set(Object.values(maps));
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

  update(seconds: number, camera: Vector3, distance: number): void {
    const nearest = this.tiles.filter(tile => tile.start <= distance + 3000 && tile.end >= distance - 2200);
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
      }
    }
  }

  private async load(tile: RouteTile): Promise<void> {
    const transfer = new AbortController();
    this.pending.set(tile.id, transfer);
    try {
      const url = tile.url.startsWith('data/') ? tile.url : `data/${tile.url}`;
      const world = await readWorldAsset<WorldData>(url, transfer.signal);
      if (transfer.signal.aborted) return;
      const scenery = createScenery(world, new Rail(world.rail), this.maps);
      scenery.setWeather(this.weather);
      scenery.setNight(this.night);
      for (const [id, aspect] of this.signalAspects) scenery.setSignal(aspect, id);
      this.loaded.set(tile.id, scenery);
      this.group.add(scenery.group);
    } catch (error) {
      if (!transfer.signal.aborted) throw error;
    } finally {
      this.pending.delete(tile.id);
    }
  }
}
