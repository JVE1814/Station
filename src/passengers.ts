import { CapsuleGeometry, Color, DynamicDrawUsage, Group, InstancedMesh, MeshStandardMaterial, Object3D, Vector3 } from 'three';
import type { Rail } from './rail.ts';
import type { LocalPoint, Station } from './world-data.ts';

export interface PassengerPlatform {
  outline: LocalPoint[];
  levelAt(x: number, z: number): number;
  followsRail: boolean;
  occupied?: { position: Vector3; radius: number }[];
}

const up = new Vector3(0, 1, 0);
const jackets = [0x9a523e, 0x3d615e, 0x333d52, 0xb68749, 0x5d4c61, 0x6d7656, 0x7a483f];
const trousers = [0x3d454c, 0x3d4f66, 0x55524b, 0x414143];
const skinTones = [0xc18b68, 0xd8a37a, 0xa87758, 0x976242, 0xd0a584, 0xae775d];
const hairTones = [0x312823, 0x4e3328, 0x97704d, 0x5c4b40];

function within(x: number, z: number, outline: LocalPoint[]): boolean {
  let contained = false;
  for (let index = 0, previous = outline.length - 1; index < outline.length; previous = index++) {
    const [east, north] = outline[index];
    const [priorEast, priorNorth] = outline[previous];
    if ((north > -z) !== (priorNorth > -z)
      && x < (priorEast - east) * (-z - north) / (priorNorth - north) + east) contained = !contained;
  }
  return contained;
}

function occupied(platform: PassengerPlatform, x: number, z: number) {
  return platform.occupied?.some(({ position, radius }) => (x - position.x) ** 2 + (z - position.z) ** 2 < radius ** 2);
}

export function boardingApproach(platform: PassengerPlatform, start: Vector3, door: Vector3): Vector3 | undefined {
  const length = Math.hypot(door.x - start.x, door.z - start.z);
  if (length > 24 || Math.abs(door.y - start.y) > 1.0) return;
  const steps = Math.max(1, Math.ceil(length / 0.18));
  const edge = start.clone();
  for (let step = 1; step <= steps; step++) {
    const progress = step / steps;
    const x = start.x + (door.x - start.x) * progress;
    const z = start.z + (door.z - start.z) * progress;
    if (!within(x, z, platform.outline)) break;
    if (occupied(platform, x, z)) return;
    edge.set(x, platform.levelAt(x, z), z);
  }
  if (Math.hypot(door.x - edge.x, door.z - edge.z) > 1.2 || Math.abs(door.y - edge.y) > 0.74) return;
  return edge;
}

interface Walker {
  platform: PassengerPlatform;
  standing: Vector3;
  position: Vector3;
  yaw: number;
  size: number;
  seed: number;
  jacket: Color;
  pants: Color;
  skin: Color;
  hair: Color;
  boarded: boolean;
  trip?: {
    start: Vector3;
    edge: Vector3;
    end: Vector3;
    progress: number;
    seconds: number;
    lift: boolean;
  };
}

function waitingPassengers(
  stations: Station[],
  platforms: PassengerPlatform[],
  rail: Rail,
  ownsCell?: (x: number, z: number) => boolean,
) {
  const people: Walker[] = [];
  for (const station of stations) {
    const origin = rail.position(station.stopDistance);
    if (ownsCell && !ownsCell(origin.x, origin.z)) continue;
    const direction = origin.clone().sub(rail.position(station.stopDistance - 5)).setY(0).normalize();
    if (!direction.lengthSq()) direction.copy(rail.position(station.stopDistance + 5)).sub(origin).setY(0).normalize();
    if (!direction.lengthSq()) continue;
    const side = direction.clone().cross(up);
    let state = station.osmId >>> 0;
    const random = () => {
      state = (Math.imul(1664525, state) + 1013904223) >>> 0;
      return state / 0x100000000;
    };
    const choose = (options: number[]) => new Color(options[Math.floor(random() * options.length)]);
    const waiting: Walker[] = [];
    for (let attempt = 0; attempt < 150 && waiting.length < 8; attempt++) {
      const down = 15 - random() * 52;
      const across = (2.65 + random() * 3.4) * (attempt % 2 ? 1 : -1);
      const standing = origin.clone().addScaledVector(direction, down).addScaledVector(side, across);
      if (waiting.some(person => person.standing.distanceToSquared(standing) < 6.25)) continue;
      const platform = platforms.find(platform => platform.followsRail && !occupied(platform, standing.x, standing.z)
        && [0, -0.24, 0.24].every(offset => within(standing.x + offset, standing.z, platform.outline)
          && within(standing.x, standing.z + offset, platform.outline)));
      if (!platform) continue;
      standing.y = platform.levelAt(standing.x, standing.z);
      if (Math.abs(standing.y - origin.y) > 1.6) continue;
      const yaw = Math.atan2(origin.x - standing.x, origin.z - standing.z) + (random() - 0.5) * 0.9;
      waiting.push({
        platform, standing, position: standing.clone(), yaw,
        size: 0.9 + random() * 0.19, seed: random() * 5, jacket: choose(jackets),
        pants: choose(trousers), skin: choose(skinTones), hair: choose(hairTones), boarded: false,
      });
    }
    people.push(...waiting);
  }
  return people;
}

const partsPerPassenger = 16;

export function createPassengers(
  stations: Station[],
  platforms: PassengerPlatform[],
  rail: Rail,
  ownsCell?: (x: number, z: number) => boolean,
) {
  const group = new Group();
  group.name = 'Animated platform passengers';
  const people = waitingPassengers(stations, platforms, rail, ownsCell);
  let doorsOpen = false;
  let elapsed = 0;
  const colors = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.82 });
  const figures = new InstancedMesh(new CapsuleGeometry(1, 1, 3, 8), colors, people.length * partsPerPassenger);
  figures.instanceMatrix.setUsage(DynamicDrawUsage);
  figures.frustumCulled = false;
  figures.castShadow = true;
  figures.receiveShadow = true;
  if (people.length) group.add(figures);
  const pose = new Object3D();
  const sole = new Color(0x28292b);
  const bag = new Color(0x444644);

  function draw(camera?: Vector3) {
    let shown = 0;
    for (const passenger of people) {
      if (passenger.boarded || camera && camera.distanceToSquared(passenger.position) > 195 ** 2) continue;
      const { position, size, seed, yaw, jacket, pants, skin, hair } = passenger;
      const sin = Math.sin(yaw);
      const cos = Math.cos(yaw);
      const walking = passenger.trip && passenger.trip.progress > 0;
      const pace = Math.sin(elapsed * 8.2 + seed) * Number(Boolean(walking));
      const idle = Math.sin(elapsed * 1.3 + seed) * 0.042;
      const part = (x: number, height: number, z: number, width: number, scaleY: number, depth: number, rotation: number, color: Color) => {
        pose.position.set(position.x + (x * cos + z * sin) * size,
          position.y + height * size, position.z + (z * cos - x * sin) * size);
        pose.rotation.set(rotation, yaw, 0, 'YXZ');
        pose.scale.set(width * size, scaleY * size, depth * size);
        pose.updateMatrix();
        figures.setMatrixAt(shown, pose.matrix);
        figures.setColorAt(shown, color);
        shown++;
      };

      part(0, 1.09, 0, 0.164, 0.21, 0.136, idle, jacket);
      part(0, 1.34, 0.01, 0.188, 0.12, 0.115, idle, jacket);
      part(0, 1.51, 0.023, 0.052, 0.037, 0.058, idle, skin);
      part(0, 1.65, 0.026, 0.104, 0.077, 0.104, idle, skin);
      part(0, 1.733, 0.007, 0.108, 0.036, 0.106, idle, hair);
      part(0.025, 1.17, -0.138, 0.144, 0.146, 0.084, idle, bag);
      for (const side of [-1, 1]) {
        const swing = side * pace;
        part(side * 0.097, 0.52, swing * 0.16, 0.072, 0.15, 0.075, swing * -0.45, pants);
        part(side * 0.098, 0.23 + Math.max(0, swing) * 0.045, swing * 0.31, 0.062, 0.134, 0.069, swing * -0.36, pants);
        part(side * 0.098, 0.066 + Math.max(0, swing) * 0.064, 0.047 + swing * 0.36, 0.066, 0.036, 0.128, 0, sole);
        part(side * 0.208, 1.15, -swing * 0.11, 0.06, 0.141, 0.062, swing * 0.43, jacket);
        part(side * 0.209, 0.936, -swing * 0.16, 0.044, 0.037, 0.043, swing * 0.43, skin);
      }
    }
    figures.count = shown;
    figures.visible = shown > 0;
    figures.instanceMatrix.needsUpdate = true;
    if (figures.instanceColor) figures.instanceColor.needsUpdate = true;
  }
  draw();

  const setDoors = (doorways: readonly Vector3[]) => {
    const opening = doorways.length > 0;
    if (doorsOpen === opening) return;
    doorsOpen = opening;
    for (const passenger of people) {
      if (passenger.boarded) continue;
      if (!opening) {
        if (!passenger.trip) continue;
        const distance = passenger.position.distanceTo(passenger.standing);
        passenger.trip = {
          start: passenger.position.clone(), edge: passenger.standing, end: passenger.standing,
          progress: 0, seconds: Math.max(0.3, distance / 1.2), lift: false,
        };
        continue;
      }
      let nearest = Infinity;
      for (const door of doorways) {
        const distance = passenger.position.distanceToSquared(door);
        if (distance >= nearest) continue;
        const edge = boardingApproach(passenger.platform, passenger.position, door);
        if (!edge) continue;
        nearest = distance;
        passenger.trip = {
          start: passenger.position.clone(), edge, end: door.clone(), progress: -0.6 - passenger.seed * 0.19,
          seconds: Math.max(0.2, passenger.position.distanceTo(edge) / 1.27), lift: true,
        };
      }
    }
  };

  return {
    group,
    setDoors,
    dispose() {
      group.removeFromParent();
      figures.dispose();
      figures.geometry.dispose();
      colors.dispose();
    },
    update(seconds: number, camera: Vector3) {
      if (!people.length) return;
      elapsed += seconds;
      for (const passenger of people) {
        const trip = passenger.trip;
        if (!trip) continue;
        trip.progress += seconds;
        if (trip.progress <= 0) continue;
        const lift = trip.lift && trip.progress > trip.seconds;
        const target = lift ? trip.end : trip.edge;
        const start = lift ? trip.edge : trip.start;
        const progress = lift ? Math.min(1, (trip.progress - trip.seconds) / 0.52)
          : Math.min(1, trip.progress / trip.seconds);
        passenger.position.lerpVectors(start, target, progress);
        if (!lift) passenger.position.y = passenger.platform.levelAt(passenger.position.x, passenger.position.z);
        const yaw = Math.atan2(target.x - start.x, target.z - start.z);
        const rotation = Math.atan2(Math.sin(yaw - passenger.yaw), Math.cos(yaw - passenger.yaw));
        passenger.yaw += rotation * Math.min(1, seconds * 8);
        if (progress === 1 && (lift || !trip.lift)) {
          passenger.boarded = lift;
          passenger.trip = undefined;
        }
      }
      draw(camera);
    },
  };
}
