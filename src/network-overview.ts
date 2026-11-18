import {
  BufferGeometry, CanvasTexture, Color, Float32BufferAttribute, Group, Points,
  PointsMaterial, Sprite, SpriteMaterial, SRGBColorSpace, Vector3,
} from 'three';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import type { NetworkRoute } from './network';

const routeColors: Record<string, number> = { F4: 0xdf9c67, F5: 0x72b1bf, F6: 0x8db575 };

interface StationLabel {
  sprite: Sprite;
  terminal: boolean;
  aspect: number;
}

function label(name: string): { sprite: Sprite; aspect: number } {
  const canvas = document.createElement('canvas');
  canvas.width = 288;
  canvas.height = 68;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas 2D is required for the network labels');
  context.font = '600 29px sans-serif';
  const width = Math.min(284, Math.ceil(context.measureText(name).width) + 28);
  canvas.width = width;
  context.font = '600 29px sans-serif';
  context.fillStyle = 'rgba(12, 23, 29, 0.92)';
  context.fillRect(0, 0, width, canvas.height);
  context.fillStyle = '#F7F2E8';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(name, width / 2, canvas.height / 2, width - 16);
  const map = new CanvasTexture(canvas);
  map.colorSpace = SRGBColorSpace;
  const material = new SpriteMaterial({ map, depthTest: false, depthWrite: false, transparent: true });
  return { sprite: new Sprite(material), aspect: width / canvas.height };
}

export class NetworkOverview {
  readonly group = new Group();
  readonly center = new Vector3();
  readonly fitHeight: number;
  private readonly stations: StationLabel[] = [];
  private readonly lines: LineMaterial[] = [];
  private readonly dots: PointsMaterial;

  constructor(routes: readonly NetworkRoute[]) {
    this.group.name = 'Mapped intercity rail network';
    const minimum = new Vector3(Infinity, 0, Infinity);
    const maximum = new Vector3(-Infinity, 0, -Infinity);
    const labels = new Map<number, StationLabel>();
    const markers: number[] = [];
    for (const route of routes) {
      const positions: number[] = [];
      route.rail.forEach((point, index) => {
        if (index % 5 && index !== route.rail.length - 1) return;
        positions.push(point.east, 20, -point.north);
        minimum.x = Math.min(minimum.x, point.east);
        minimum.z = Math.min(minimum.z, -point.north);
        maximum.x = Math.max(maximum.x, point.east);
        maximum.z = Math.max(maximum.z, -point.north);
      });
      const geometry = new LineGeometry();
      geometry.setPositions(positions);
      const material = new LineMaterial({
        color: routeColors[route.ref] ?? 0xf5cf90,
        linewidth: 2.4,
        depthTest: false,
        depthWrite: false,
        transparent: true,
      });
      this.lines.push(material);
      const line = new Line2(geometry, material);
      line.renderOrder = 28;
      line.frustumCulled = false;
      this.group.add(line);

      route.stations.forEach((station, index) => {
        const terminal = index === 0 || index === route.stations.length - 1;
        const existing = labels.get(station.osmId);
        if (existing) {
          existing.terminal ||= terminal;
          return;
        }
        const [east, north] = station.position;
        markers.push(east, 20, -north);
        const item = { ...label(station.name), terminal };
        item.sprite.position.set(east, 20, -north);
        item.sprite.center.set(0.5, -0.25);
        item.sprite.renderOrder = 33;
        labels.set(station.osmId, item);
        this.group.add(item.sprite);
      });
    }

    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(markers, 3));
    this.dots = new PointsMaterial({
      color: new Color(0xfbf3d7),
      size: 4,
      sizeAttenuation: false,
      depthWrite: false,
      depthTest: false,
      transparent: true,
    });
    const points = new Points(geometry, this.dots);
    points.renderOrder = 31;
    this.group.add(points);
    this.stations = [...labels.values()];
    this.center.copy(minimum).lerp(maximum, 0.5);
    this.fitHeight = Math.max((maximum.z - minimum.z) * 1.12, (maximum.x - minimum.x) * 0.75);
    this.group.visible = false;
  }

  update(map: boolean, height: number, camera: Vector3): void {
    const opacity = map ? Math.max(0, Math.min(1, (height - 1800) / 2100)) : 0;
    this.group.visible = opacity > 0;
    if (!this.group.visible) return;
    this.dots.opacity = opacity;
    for (const line of this.lines) line.opacity = opacity;
    for (const item of this.stations) {
      const scale = height * 0.027;
      item.sprite.scale.set(scale * item.aspect, scale, 1);
      item.sprite.material.opacity = opacity;
      item.sprite.visible = item.terminal
        || (height < 44_000 && camera.distanceToSquared(item.sprite.position) < (height * 1.8) ** 2);
    }
  }
}
