import type { Texture } from 'three';
import {
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DataTexture,
  DoubleSide,
  DynamicDrawUsage,
  ExtrudeGeometry,
  FrontSide,
  Group,
  InstancedMesh,
  LatheGeometry,
  LinearFilter,
  LinearMipmapLinearFilter,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Path,
  PlaneGeometry,
  PointLight,
  ShaderMaterial,
  Shape,
  SphereGeometry,
  SpotLight,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  Vector2,
  Vector3,
} from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const ROLLING_STOCK_SHADOW_LAYER = 1;

export interface TrainVisualState {
  speed: number;
  throttle: number;
  brake: number;
  doorsOpen: boolean;
  night: boolean;
  headlights?: boolean;
  deltaSeconds?: number;
  doorSide?: -1 | 1;
  weather?: 'clear' | 'rain' | 'snow';
}

interface Surface {
  color: number;
  roughness?: number;
  metalness?: number;
}

function surface(color: number, roughness = 0.52, metalness = 0.15) {
  return new MeshStandardMaterial({ color, roughness, metalness });
}

function box(
  group: Group,
  material: MeshStandardMaterial,
  size: readonly [number, number, number],
  position: readonly [number, number, number],
) {
  const mesh = new Mesh(new BoxGeometry(...size), material);
  mesh.position.set(...position);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  return mesh;
}

function cylinder(
  group: Group,
  material: MeshStandardMaterial,
  radius: number,
  length: number,
  position: readonly [number, number, number],
  segments = 18,
) {
  const mesh = new Mesh(new CylinderGeometry(radius, radius, length, segments), material);
  mesh.position.set(...position);
  group.add(mesh);
  return mesh;
}

function roundedBox(
  group: Group,
  material: MeshStandardMaterial,
  size: readonly [number, number, number],
  position: readonly [number, number, number],
  radius: number,
) {
  const mesh = new Mesh(new RoundedBoxGeometry(...size, 3, radius), material);
  mesh.position.set(...position);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  return mesh;
}

function rod(group: Group, material: MeshStandardMaterial, radius: number, start: Vector3, end: Vector3) {
  const position = start.clone().add(end).multiplyScalar(0.5);
  const mesh = cylinder(group, material, radius, start.distanceTo(end), [position.x, position.y, position.z], 10);
  mesh.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), end.clone().sub(start).normalize());
  return mesh;
}

function panel(group: Group, material: MeshStandardMaterial, corners: readonly (readonly number[])[]) {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(corners.flat()), 3));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  geometry.computeVertexNormals();
  const mesh = new Mesh(geometry, material);
  group.add(mesh);
  return mesh;
}

function batchRigidParts(group: Group) {
  const batches = new Map<string, Mesh<BufferGeometry, MeshStandardMaterial>[]>();
  for (const object of group.children) {
    if (!(object instanceof Mesh) || object instanceof InstancedMesh ||
      !(object.material instanceof MeshStandardMaterial)) continue;
    const key = [object.material.id, object.castShadow, object.receiveShadow, object.geometry.index !== null].join('/');
    const batch = batches.get(key) ?? [];
    batch.push(object);
    batches.set(key, batch);
  }
  for (const batch of batches.values()) {
    if (batch.length <= 1) continue;
    const geometries = batch.map((part) => {
      part.updateMatrix();
      const geometry = part.geometry.clone().applyMatrix4(part.matrix);
      if (!part.material.map && !part.material.bumpMap && !part.material.emissiveMap) geometry.deleteAttribute('uv');
      return geometry;
    });
    const geometry = mergeGeometries(geometries);
    for (const copy of geometries) copy.dispose();
    if (!geometry) throw new Error('Incompatible static rolling stock geometry');
    const combined = new Mesh(geometry, batch[0].material);
    combined.castShadow = batch[0].castShadow;
    combined.receiveShadow = batch[0].receiveShadow;
    for (const part of batch) part.geometry.dispose();
    group.remove(...batch);
    group.add(combined);
  }
}

const opaqueShadow = new MeshBasicMaterial();

function batchRigidShadow(group: Group, fixedChildren: readonly Group[] = []) {
  const casters: { mesh: Mesh; transform: Matrix4 }[] = [];
  let draws = 0;
  for (const mount of [group, ...fixedChildren]) {
    if (mount !== group) mount.updateMatrix();
    for (const mesh of mount.children) {
      if (!(mesh instanceof Mesh) || mesh instanceof InstancedMesh || !mesh.visible ||
        !mesh.castShadow || mesh.customDepthMaterial) continue;
      const geometry: BufferGeometry = mesh.geometry;
      const { material } = mesh;
      if (geometry.drawRange.start !== 0 || geometry.drawRange.count !== Infinity) continue;
      const surfaces = Array.isArray(material) ? material : [material];
      if (!surfaces.every(surface => surface instanceof MeshStandardMaterial && surface.visible &&
        surface.side === FrontSide && surface.shadowSide === null && !surface.transparent &&
        !surface.alphaTest && !surface.alphaToCoverage && !surface.alphaMap &&
        !surface.displacementMap && !surface.clippingPlanes?.length)) continue;
      if (Array.isArray(material)) {
        let index = 0;
        const contiguous = geometry.groups.every((part) => {
          if (part.start !== index || !material[part.materialIndex!]) return false;
          index += part.count;
          return true;
        });
        if (!contiguous || index !== (geometry.index?.count ?? geometry.attributes.position.count)) continue;
      }
      mesh.updateMatrix();
      const transform = mesh.matrix.clone();
      if (mount !== group) transform.premultiply(mount.matrix);
      if (transform.determinantAffine() < 0) continue;
      casters.push({ mesh, transform });
      draws += Array.isArray(material) ? geometry.groups.length : 1;
    }
  }
  if (draws < 2) return;
  const geometry = mergeGeometries(casters.map(({ mesh, transform }) => {
    const source = mesh.geometry;
    const positions = source.attributes.position.clone();
    const indices = source.index ?? Array.from({ length: positions.count }, (_, index) => index);
    return new BufferGeometry().setAttribute('position', positions).setIndex(indices).applyMatrix4(transform);
  }));
  if (!geometry) throw new Error('Incompatible rolling stock shadow geometry');

  const proxy = new Mesh(geometry, opaqueShadow);
  proxy.name = 'Rigid rolling stock shadow';
  proxy.layers.set(ROLLING_STOCK_SHADOW_LAYER);
  proxy.castShadow = true;
  for (const { mesh } of casters) mesh.castShadow = false;
  group.add(proxy);
}

function rimProfile(width: number, base: number, shoulder: number, height: number, z: number) {
  return [
    [-width * 0.81, base, z],
    [-width, base + 0.19, z],
    [-width, shoulder, z],
    [-width * 0.93, height - 0.20, z],
    [-width * 0.68, height, z],
    [width * 0.68, height, z],
    [width * 0.93, height - 0.20, z],
    [width, shoulder, z],
    [width, base + 0.19, z],
    [width * 0.81, base, z],
  ];
}

function shell(group: Group, materials: MeshStandardMaterial[], leading: boolean, showpiece: boolean) {
  const geometry = new BufferGeometry();
  const rings = leading
    ? [
      rimProfile(0.95, 0.91, 2.06, 2.38, -12.0),
      rimProfile(1.21, 0.85, 2.28, 2.94, -11.75),
      rimProfile(1.43, 0.84, 2.64, 3.57, -11.02),
      rimProfile(1.49, 0.89, 2.89, 3.91, -10.15),
      rimProfile(1.49, 0.89, 2.89, 3.98, -9.45),
    ]
    : [rimProfile(1.47, 0.91, 2.89, 3.9, -11.78), rimProfile(1.49, 0.89, 2.89, 3.98, -11.35)];
  rings.push(rimProfile(1.49, 0.89, 2.89, 3.98, 11.45), rimProfile(1.43, 0.91, 2.89, 3.90, 11.78));
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(rings.flat(2)), 3));
  if (showpiece) {
    const uv = rings.flatMap(ring => ring.flatMap(([, height, z]) => [z / 3.5, height / 2.1]));
    const livery = rings.flatMap(ring => ring.flatMap(([x, height]) => {
      const roof = Math.max(0, (height - 3.48) / 0.50) * Math.min(1, 1.72 - Math.abs(x));
      return [1 - 0.64 * roof, 1 - 0.30 * roof, 1 - 0.17 * roof];
    }));
    geometry.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2));
    geometry.setAttribute('color', new BufferAttribute(new Float32Array(livery), 3));
  }

  const partitions: number[][] = [[], [], []];
  for (let ring = 0; ring < rings.length - 1; ring++) {
    for (let edge = 0; edge < 10; edge++) {
      const start = 10 * ring + edge;
      const next = 10 * ring + (edge + 1) % 10;
      const materialIndex = edge === 0 || edge >= 8 ? 2 : edge >= 2 && edge <= 6 ? 1 : 0;
      partitions[materialIndex].push(start, next + 10, next, start, start + 10, next + 10);
    }
  }
  for (const [ring, flip] of [[0, false], [rings.length - 1, true]] as const) {
    const offset = ring * 10;
    const materialIndex = ring === 0 && leading ? 1 : 2;
    for (let step = 1; step < 9; step++) {
      const a = offset + step;
      const b = a + 1;
      partitions[materialIndex].push(offset, flip ? b : a, flip ? a : b);
    }
  }
  let index = 0;
  for (const [materialIndex, partition] of partitions.entries()) {
    geometry.addGroup(index, partition.length, materialIndex);
    index += partition.length;
  }
  geometry.setIndex(partitions.flat());
  geometry.computeVertexNormals();
  const mesh = new Mesh(geometry, materials);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
}

function buildBogie(body: Group, dark: MeshStandardMaterial, steel: MeshStandardMaterial, z: number) {
  const bogie = new Group();
  bogie.position.z = z;
  for (const axle of [-1.25, 1.25]) {
    cylinder(bogie, dark, 0.12, 2.34, [0, 0.45, axle]).rotation.z = Math.PI / 2;
    for (const side of [-1, 1]) {
      cylinder(bogie, dark, 0.452, 0.16, [side * 0.75, 0.45, axle], 24).rotation.z = Math.PI / 2;
      cylinder(bogie, steel, 0.438, 0.075, [side * 0.814, 0.45, axle], 24).rotation.z = Math.PI / 2;
      cylinder(bogie, dark, 0.15, 0.18, [side * 0.93, 0.45, axle]).rotation.z = Math.PI / 2;
      cylinder(bogie, steel, 0.05, 0.02, [side * 1.025, 0.45, axle]).rotation.z = Math.PI / 2;
    }
  }
  box(bogie, dark, [1.88, 0.23, 0.54], [0, 0.72, 0]);
  for (const side of [-1, 1]) {
    box(bogie, dark, [0.17, 0.23, 3.13], [side * 0.99, 0.62, 0]);
    for (const spring of [-0.55, 0.55]) {
      cylinder(bogie, dark, 0.14, 0.30, [side * 0.99, 0.80, spring]);
      for (let coil = 0; coil < 4; coil++) {
        cylinder(bogie, steel, 0.143, 0.016, [side * 0.99, 0.7 + 0.055 * coil, spring]);
      }
    }
  }
  batchRigidParts(bogie);
  batchRigidShadow(bogie);
  body.add(bogie);
  return bogie;
}

function makeTrainMaterials() {
  const configuration: Record<string, Surface> = {
    siding: { color: 0xb8bec2, roughness: 0.35, metalness: 0.38 },
    paint: { color: 0x9f2527, roughness: 0.28, metalness: 0.27 },
    underframe: { color: 0x1f2427, roughness: 0.64, metalness: 0.22 },
    trim: { color: 0x303b44, roughness: 0.41, metalness: 0.28 },
    metal: { color: 0x788084, roughness: 0.33, metalness: 0.73 },
    glass: { color: 0x222d38, roughness: 0.15, metalness: 0.3 },
    reflector: { color: 0xf2c978, roughness: 0.40 },
    rubber: { color: 0x161d21, roughness: 0.73 },
  };
  return Object.fromEntries(Object.entries(configuration).map(
    ([key, value]) => [key, surface(value.color, value.roughness, value.metalness)],
  ));
}

function slidingDoors(group: Group, materials: ReturnType<typeof makeTrainMaterials>) {
  const sides = [-1, 1] as const;
  const doorways = [-9.34, 9.42];
  const leaves = sides.flatMap(side => doorways.flatMap(doorway =>
    [-1, 1].map(leaf => ({ side, leaf, center: doorway + leaf * 0.393 })),
  ));
  const leafBodies = new InstancedMesh(new BoxGeometry(0.047, 1.84, 0.755), materials.siding.clone(), leaves.length);
  const glazing = new InstancedMesh(new BoxGeometry(0.051, 0.81, 0.639), materials.glass.clone(), leaves.length);
  const buttons = new InstancedMesh(new CylinderGeometry(0.052, 0.052, 0.013, 18),
    materials.reflector.clone(), leaves.length);
  leafBodies.name = 'Passenger door leaves';
  glazing.name = 'Passenger door glazing';
  buttons.name = 'Passenger door buttons';
  leafBodies.castShadow = leafBodies.receiveShadow = true;
  glazing.castShadow = glazing.receiveShadow = true;
  const parts = [leafBodies, glazing, buttons];
  const travel = 0.70;
  const translation = new Matrix4();
  const button = new Matrix4().makeRotationZ(Math.PI / 2);
  let left = 0;
  let right = 0;
  const place = () => {
    leaves.forEach(({ side, leaf, center }, index) => {
      const z = center + leaf * travel * (side === -1 ? left : right);
      const x = side * 1.536;
      leafBodies.setMatrixAt(index, translation.setPosition(x, 2.005, z));
      glazing.setMatrixAt(index, translation.setPosition(x + side * 0.023, 2.335, z));
      buttons.setMatrixAt(index, button.setPosition(x + side * 0.03, 1.775, z - leaf * 0.22));
    });
    for (const part of parts) part.instanceMatrix.needsUpdate = true;
  };
  place();
  for (const part of parts) {
    part.instanceMatrix.setUsage(DynamicDrawUsage);
    part.computeBoundingBox();
    part.computeBoundingSphere();
    // Cover the whole animation without recomputing bounds on each movement.
    part.boundingBox!.min.z -= travel;
    part.boundingBox!.max.z += travel;
    part.boundingSphere!.radius += travel;
  }
  group.add(...parts);
  return (state: TrainVisualState) => {
    leafBodies.material.roughness = materials.siding.roughness;
    const fraction = 1 - Math.exp(-5.65 * (state.deltaSeconds ?? (1 / 60)));
    const leftTarget = Number(state.doorsOpen && state.doorSide !== 1);
    const rightTarget = Number(state.doorsOpen && state.doorSide !== -1);
    const nextLeft = left + (leftTarget - left) * fraction;
    const nextRight = right + (rightTarget - right) * fraction;
    if (nextLeft === left && nextRight === right) return;
    left = nextLeft;
    right = nextRight;
    place();
  };
}

const windowVariants = 4;
let passengerInterior: DataTexture | undefined;

function interiorAtlas() {
  if (passengerInterior) return passengerInterior;
  const cell = 64;
  const width = windowVariants * cell;
  const pixels = new Uint8Array(width * cell * 4);
  const exposureLevels = [0.85, 0.96, 0.62, 0.77];
  for (let row = 0; row < cell; row++) {
    const y = row / cell;
    for (let column = 0; column < width; column++) {
      const variant = Math.floor(column / cell);
      const x = (column % cell) / cell;
      const sideWall = Math.min(1, Math.min(x, 1 - x) * 7);
      const seatLeft = Math.abs(x - 0.22 - variant * 0.014) < 0.13 && y < 0.52 + 0.05 * Math.cos(18 * x);
      const seatRight = Math.abs(x - 0.70) < 0.13 && y < 0.42 + 0.06 * Math.sin(19 * x);
      const headlining = y > 0.80;
      const strip = y > 0.86 && y < 0.93 && sideWall > 0.5;
      const seam = Math.abs(x - 0.49) < 0.019;
      const exposure = exposureLevels[variant] * (strip ? 1 : headlining ? 0.65
        : seatLeft || seatRight ? 0.23 : seam ? 0.32 : 0.48) * (0.76 + 0.24 * sideWall);
      const position = (row * width + column) * 4;
      pixels[position] = exposure * 255;
      pixels[position + 1] = exposure * 228;
      pixels[position + 2] = exposure * 196;
      pixels[position + 3] = 255;
    }
  }
  passengerInterior = new DataTexture(pixels, width, cell);
  passengerInterior.colorSpace = SRGBColorSpace;
  passengerInterior.generateMipmaps = true;
  passengerInterior.minFilter = LinearMipmapLinearFilter;
  passengerInterior.magFilter = LinearFilter;
  passengerInterior.needsUpdate = true;
  return passengerInterior;
}

function windowTextureSet(geometry: BufferGeometry, variant: number) {
  const uv = geometry.getAttribute('uv');
  for (let point = 0; point < uv.count; point++) {
    const inset = 0.037 + uv.getX(point) * 0.926;
    uv.setX(point, (inset + variant) / windowVariants);
  }
}

function fitExtDetails(
  body: Group,
  materials: ReturnType<typeof makeTrainMaterials>,
  leading: boolean,
  windows: MeshStandardMaterial,
  showpiece: boolean,
) {
  const { trim, underframe, metal, reflector, rubber } = materials;
  for (const side of [-1, 1]) {
    box(body, trim, [0.03, 0.77, 20.3], [side * 1.494, 2.50, 0.73]);
    box(body, reflector, [0.032, 0.025, 20.3], [side * 1.5, 1.66, 0.73]);
    box(body, trim, [0.026, 0.115, 21.0], [side * 1.488, 1.08, 0.45]);

    for (const [index, z] of [-7.73, -6.03, -4.32, -2.61, -0.90, 0.80, 2.51, 4.22, 5.93, 7.65].entries()) {
      box(body, rubber, [0.045, 0.704, 1.41], [side * 1.504, 2.50, z]);
      const window = box(body, windows, [0.052, 0.626, 1.32], [side * 1.513, 2.51, z]);
      if (showpiece) windowTextureSet(window.geometry, (index * 3 + (side === 1 ? 1 : 0)) % windowVariants);
      box(body, trim, [0.06, 0.62, 0.043], [side * 1.518, 2.51, z + 0.22]);
    }
    if (showpiece) {
      box(body, metal, [0.047, 0.031, 20.3], [side * 1.514, 2.107, 0.73]);
      box(body, underframe, [0.040, 0.049, 21.0], [side * 1.50, 1.239, 0.45]);
      for (const z of [-7.92, -4.53, -1.10, 2.33, 5.73, 7.44]) {
        box(body, trim, [0.015, 0.74, 0.013], [side * 1.496, 1.57, z]);
      }
    }

    for (const doorway of [-9.34, 9.42]) {
      box(body, rubber, [0.060, 1.93, 1.59], [side * 1.498, 2.00, doorway]);
      box(body, metal, [0.09, 0.055, 1.72], [side * 1.53, 1.032, doorway]);
      if (showpiece) {
        box(body, reflector, [0.063, 0.025, 1.55], [side * 1.522, 1.066, doorway]);
        box(body, trim, [0.06, 0.066, 0.63], [side * 1.505, 2.991, doorway]);
      }
    }

    for (const z of [-5.2, 0.1, 4.75]) {
      box(body, underframe, [0.65, 0.245, 1.76], [side * 0.78, 0.78, z]);
      for (let vent = 0; vent < 7; vent++) {
        box(body, metal, [0.025, 0.036, 0.87], [side * 1.11, 0.85 - 0.025 * vent, z]);
      }
    }
  }

  for (const z of [-5.0, 1.25, 6.4]) {
    box(body, trim, [1.6, 0.16, 2.0], [0, 4.00, z]);
    for (let rib = 0; rib < 8; rib++) {
      box(body, underframe, [1.45, 0.023, 0.035], [0, 4.09, z - 0.8 + 0.22 * rib]);
    }
  }
  if (leading) {
    box(body, trim, [1.15, 0.095, 1.9], [0, 4.02, 3.9]);
    for (const side of [-1, 1]) {
      const anchor = new Vector3(side * 0.32, 4.07, 4.6);
      const knuckle = new Vector3(side * 0.23, 4.74, 3.35);
      const head = new Vector3(side * 0.24, 5.38, 4.2);
      rod(body, metal, 0.04, anchor, knuckle);
      rod(body, metal, 0.031, knuckle, head);
    }
    box(body, metal, [1.35, 0.044, 0.10], [0, 5.38, 4.19]);
  }

  box(body, rubber, [1.74, 2.26, 0.19], [0, 2.1, 11.86]);
  for (const x of [-0.85, 0.85]) {
    for (let rib = 0; rib < 4; rib++) {
      box(body, trim, [0.09, 2.23, 0.022], [x, 2.1, 11.79 + rib * 0.049]);
    }
  }
  box(body, underframe, [0.25, 0.18, 0.55], [0, 0.58, 11.87]);

  if (!leading) {
    box(body, rubber, [1.73, 2.26, 0.19], [0, 2.1, -11.86]);
    box(body, underframe, [0.25, 0.18, 0.45], [0, 0.58, -11.87]);
  }
}

function noseDetails(body: Group, trim: MeshStandardMaterial, showpiece: boolean) {
  const glaze = showpiece ? new MeshPhysicalMaterial({
    color: 0x182b38, roughness: 0.13, metalness: 0.1, clearcoat: 0.82,
    clearcoatRoughness: 0.1, envMapIntensity: 1.35,
  }) : surface(0x182636, 0.16, 0.36);
  glaze.side = DoubleSide;
  const border = surface(0x13191c, 0.55, 0.09);
  border.side = DoubleSide;
  const sill = [0.767, 2.19, -12.026];
  const lower = [0.816, 2.37, -12.026];
  const middle = [1.025, 2.94, -11.776];
  const upper = [1.112, 3.57, -11.046];
  const header = [0.971, 3.73, -10.638];
  const pane = (levels: number[][], material: MeshStandardMaterial) => {
    for (let index = 1; index < levels.length; index++) {
      const [a, b, c] = levels[index - 1];
      const [d, e, f] = levels[index];
      panel(body, material, [[-a, b, c], [a, b, c], [d, e, f], [-d, e, f]]);
    }
  };
  pane([sill, lower, middle, upper, header], border);
  pane([
    [0.718, 2.26, -12.034],
    [0.763, 2.37, -12.034],
    [0.966, 2.94, -11.784],
    [1.039, 3.57, -11.054],
    [0.923, 3.66, -10.841],
  ], glaze);
  for (const side of [-1, 1]) {
    rod(body, trim, 0.016, new Vector3(side * 0.60, 2.26, -12.060), new Vector3(side * 0.28, 2.93, -11.807));
    rod(body, trim, 0.014, new Vector3(side * 0.28, 2.93, -11.807), new Vector3(side * 0.45, 3.40, -11.274));
  }
  const lamp = surface(0xffecd1, 0.24, 0.05);
  const glow = headlampGlow();
  const halos = [];
  lamp.emissive.setHex(0xffd9a5);
  for (const side of [-1, 1]) {
    const halo = new Sprite(glow);
    halo.position.set(side * 0.76, 1.54, -12.11);
    halo.scale.set(1.42, 1.42, 1);
    halo.visible = false;
    halos.push(halo);
    body.add(halo);
    const housing = new Mesh(new SphereGeometry(0.16, 16, 10), trim);
    housing.scale.set(1.28, 0.68, 0.24);
    housing.position.set(side * 0.76, 1.54, -12.01);
    body.add(housing);
    for (const shift of [-0.07, 0.07]) {
      cylinder(body, lamp, 0.056, 0.031, [side * 0.76 + shift, 1.54, -12.048], 16).rotation.x = Math.PI / 2;
    }
  }
  cylinder(body, lamp, 0.058, 0.042, [0, 3.745, -10.61], 16).rotation.x = Math.PI / 2.6;
  box(body, trim, [1.47, 0.28, 0.23], [0, 0.94, -11.974]);
  box(body, trim, [0.76, 0.30, 0.49], [0, 0.72, -11.81]);
  box(body, trim, [0.33, 0.26, 0.43], [0, 0.59, -12]);
  box(body, trim, [0.22, 0.17, 0.35], [0, 0.64, -12.26]);
  if (showpiece) {
    const bracket = surface(0x56616a, 0.35, 0.57);
    for (const side of [-1, 1]) {
      rod(body, bracket, 0.025, new Vector3(side * 0.48, 0.68, -11.95), new Vector3(side * 0.20, 0.64, -12.24));
      cylinder(body, bracket, 0.040, 0.017, [side * 0.29, 1.035, -12.095], 12).rotateX(Math.PI / 2);
      cylinder(body, bracket, 0.051, 0.021, [side * 0.75, 1.27, -12.005], 12).rotateX(Math.PI / 2);
    }
    box(body, bracket, [0.22, 0.042, 0.031], [0, 0.69, -12.40]);
  }
  const headlight = trainHeadlight(body, showpiece);
  return { lamp, headlight, halos };
}

function headlampGlow() {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas 2D is required for the headlamp glow');
  const radial = context.createRadialGradient(32, 32, 0, 32, 32, 32);
  radial.addColorStop(0, 'rgba(255,243,203,1)');
  radial.addColorStop(0.10, 'rgba(255,232,186,0.64)');
  radial.addColorStop(0.34, 'rgba(255,203,140,0.20)');
  radial.addColorStop(1, 'rgba(255,173,101,0)');
  context.fillStyle = radial;
  context.fillRect(0, 0, size, size);
  const map = new CanvasTexture(canvas);
  map.colorSpace = SRGBColorSpace;
  return new SpriteMaterial({ map, blending: AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.74 });
}

function trainHeadlight(body: Group, showpiece = false) {
  const light = showpiece ? new SpotLight(0xffe5c4, 145, 73, 0.245, 0.89, 1.39)
    : new SpotLight(0xffe5c4, 380, 125, 0.21, 0.68, 1.25);
  light.position.set(0, 1.64, -12.15);
  light.target.position.set(0, showpiece ? 0.20 : 0.70, showpiece ? -36.5 : -52);
  light.visible = false;
  const length = showpiece ? 52 : 46;
  const beam = new Mesh(
    new ConeGeometry(Math.tan(0.135) * length, length, 24, 1, true),
    new ShaderMaterial({
      blending: AdditiveBlending,
      depthWrite: false,
      transparent: true,
      uniforms: { beamScattering: { value: showpiece ? 0.016 : 0.045 } },
      vertexShader: `
        varying vec3 viewNormal;
        varying vec3 viewRay;
        varying float distanceAlong;
        void main() {
          vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
          viewNormal = normalMatrix * normal;
          viewRay = -viewPosition.xyz;
          distanceAlong = 1.0 - uv.y;
          gl_Position = projectionMatrix * viewPosition;
        }`,
      fragmentShader: `
        uniform float beamScattering;
        varying vec3 viewNormal;
        varying vec3 viewRay;
        varying float distanceAlong;
        void main() {
          float facing = abs(dot(normalize(viewNormal), normalize(viewRay)));
          float angle = ${showpiece ? 'pow(smoothstep(0.02, 0.82, facing), 1.9)' : 'smoothstep(0.04, 0.50, facing)'};
          float falloff = smoothstep(0.0, 0.09, distanceAlong)
            * (1.0 - smoothstep(0.18, 1.0, distanceAlong));
          gl_FragColor = vec4(1.0, 0.77, 0.49, angle * falloff * beamScattering);
          #include <colorspace_fragment>
        }`,
    }),
  );
  const depression = Math.atan2(light.position.y - light.target.position.y,
    light.position.z - light.target.position.z);
  beam.rotateX(Math.PI / 2 - depression);
  beam.position.set(0, -Math.sin(depression) * length / 2, -Math.cos(depression) * length / 2);
  light.add(beam);
  body.add(light, light.target);
  return (enabled: boolean, weather?: TrainVisualState['weather']) => {
    light.visible = enabled;
    if (showpiece) beam.material.uniforms.beamScattering.value = weather === 'snow' ? .046 : weather === 'rain' ? .029 : .016;
  };
}

function snowOnPaint(material: MeshPhysicalMaterial) {
  const snow = { value: 0 };
  material.onBeforeCompile = shader => {
    shader.uniforms.stockSnow = snow;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float snowShelf;')
      .replace('#include <begin_vertex>', `
        #include <begin_vertex>
        snowShelf = smoothstep(0.45, 0.92, normal.y) * smoothstep(3.40, 3.80, position.y);
      `);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float snowShelf; uniform float stockSnow;')
      .replace('#include <color_fragment>', `
        #include <color_fragment>
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.69, 0.76, 0.81), snowShelf * stockSnow);
      `)
      .replace('#include <roughnessmap_fragment>', `
        #include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.85, snowShelf * stockSnow);
      `);
  };
  return snow;
}

export function createTrain(leading = true, brushedSteel?: Texture, showpiece = false) {
  const group = new Group();
  const materials = makeTrainMaterials();
  const { siding, underframe, metal, trim } = materials;
  const paintedShell = showpiece ? new MeshPhysicalMaterial({
    color: 0x9f2527, roughness: 0.33, metalness: 0.22, clearcoat: 0.78,
    clearcoatRoughness: 0.21, vertexColors: true,
  }) : materials.paint;
  const roofSnow = paintedShell instanceof MeshPhysicalMaterial ? snowOnPaint(paintedShell) : undefined;
  siding.map = brushedSteel ?? null;
  siding.bumpMap = brushedSteel ?? null;
  siding.bumpScale = 0.0015;
  shell(group, [siding, paintedShell, underframe], leading, showpiece);
  const windowMaterial = showpiece ? surface(0x30414c, 0.11, 0.26) : surface(0x263744, 0.14, 0.2);
  windowMaterial.emissive.setHex(showpiece ? 0xffbb75 : 0xfda655);
  if (showpiece) {
    windowMaterial.emissiveMap = interiorAtlas();
    windowMaterial.envMapIntensity = 1.62;
  }
  fitExtDetails(group, materials, leading, windowMaterial, showpiece);
  const updateDoors = slidingDoors(group, materials);
  const lights = leading ? noseDetails(group, trim, showpiece) : undefined;
  const bogies: [Group, Group] = [
    buildBogie(group, underframe, metal, -8.3),
    buildBogie(group, underframe, metal, 8.3),
  ];
  batchRigidParts(group);
  // The opaque body supplies depth before the backdrop and track underneath the train.
  group.traverse(object => {
    if (!(object instanceof Mesh)) return;
    const surfaces = Array.isArray(object.material) ? object.material : [object.material];
    if (surfaces.every(surface => !surface.transparent)) object.renderOrder = -5;
  });
  batchRigidShadow(group);
  function update(state: TrainVisualState) {
    windowMaterial.emissiveIntensity = state.night ? (showpiece ? 1.85 : 0.75) : showpiece ? .063 : .025;
    if (paintedShell instanceof MeshPhysicalMaterial) {
      paintedShell.roughness = state.weather === 'rain' ? 0.24 : 0.33;
      paintedShell.clearcoatRoughness = state.weather === 'rain' ? 0.09 : 0.21;
      siding.roughness = state.weather === 'rain' ? 0.28 : 0.35;
    }
    if (roofSnow) roofSnow.value = state.weather === 'snow' ? 0.92 : 0;
    if (lights) {
      const head = state.headlights !== false;
      lights.lamp.emissive.setHex(head ? 0xffd9a5 : 0xef382b);
      lights.lamp.emissiveIntensity = state.night ? (showpiece ? 4.8 : 3.8) : 0.62;
      lights.headlight(state.night && head, state.weather);
      for (const halo of lights.halos) {
        halo.material.color.setHex(head ? 0xffffff : 0xec422f);
        halo.visible = state.night;
      }
    }
    updateDoors(state);
  }

  return { group, bogies, update };
}

interface GaugeSpec {
  max: number;
  step: number;
  label: string;
  scale: number;
}

const DIAL_FIRST = Math.PI * 0.77;
const DIAL_SWEEP = Math.PI * 1.46;

function makeDialTexture({ max, step, label }: GaugeSpec) {
  const canvas = document.createElement('canvas');
  canvas.width = 384;
  canvas.height = 384;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D is required to draw the cab instruments');
  const center = canvas.width * 0.5;
  const falloff = ctx.createRadialGradient(center - 30, center - 35, 36, center, center, center);
  falloff.addColorStop(0, '#263039');
  falloff.addColorStop(1, '#0b1117');
  ctx.fillStyle = falloff;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.translate(center, center);

  ctx.strokeStyle = '#6e7a83';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(0, 0, 172, 0, 2 * Math.PI);
  ctx.stroke();
  ctx.font = '600 24px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const divisions = max / step;
  for (let index = 0; index <= divisions * 4; index++) {
    const angle = DIAL_FIRST + index * DIAL_SWEEP / (divisions * 4);
    const x = Math.cos(angle);
    const y = Math.sin(angle);
    const major = index % 4 === 0;
    const inside = major ? 131 : 151;
    ctx.strokeStyle = major ? '#ece4cd' : '#a6a99f';
    ctx.lineWidth = major ? 4 : 2;
    ctx.beginPath();
    ctx.moveTo(inside * x, inside * y);
    ctx.lineTo(162 * x, 162 * y);
    ctx.stroke();
    if (major) {
      ctx.fillStyle = '#f3eddb';
      ctx.fillText(String(index * step / 4), 104 * x, 104 * y);
    }
  }
  ctx.fillStyle = '#c3bdab';
  ctx.font = '600 21px system-ui, sans-serif';
  ctx.fillText(label, 0, 68);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

function dial(
  desk: Group,
  bezel: MeshStandardMaterial,
  needleMaterial: MeshStandardMaterial,
  x: number,
  y: number,
  scale: GaugeSpec,
  showpiece: boolean,
) {
  const group = new Group();
  group.position.set(x, y, 0.016);
  desk.add(group);
  if (showpiece) {
    const profile = [[1, -0.025], [1, 0.006], [0.992, 0.022], [0.95, 0.033], [0.907, 0.026], [0.897, 0.013]]
      .map(([radius, height]) => new Vector2(radius * scale.scale, height));
    const ring = new Mesh(new LatheGeometry(profile, 40), bezel);
    ring.rotation.x = Math.PI * 0.5;
    group.add(ring);
  } else {
    cylinder(group, bezel, scale.scale, 0.051, [0, 0, 0], 40).rotation.x = Math.PI * 0.5;
  }
  const canvas = makeDialTexture(scale);
  const face = surface(0xffffff, 0.46, 0.06);
  face.map = canvas;
  face.emissive.setHex(0xffffff);
  face.emissiveMap = canvas;

  const faceGeometry = new CircleGeometry(scale.scale * 0.895, 40);
  const dialFace = new Mesh(faceGeometry, face);
  dialFace.position.z = 0.027;
  group.add(dialFace);
  const pointer = new Group();
  pointer.position.z = 0.031;
  box(pointer, needleMaterial, [scale.scale * 0.86, 0.011, 0.004], [scale.scale * 0.28, 0, 0]);
  cylinder(pointer, bezel, 0.018, 0.010, [0, 0, 0.005]).rotation.x = Math.PI * 0.5;
  group.add(pointer);
  return (value: number, night: boolean) => {
    pointer.rotation.z = -(DIAL_FIRST + Math.max(0, Math.min(1, value / scale.max)) * DIAL_SWEEP);
    face.emissiveIntensity = night ? 0.7 : 0.33;
  };
}

interface CabLabel {
  label: string;
  x: number;
  z: number;
  width: number;
}

function cabLabels(group: Group, labels: readonly CabLabel[]) {
  const canvas = document.createElement('canvas');
  canvas.width = 384;
  canvas.height = 80 * labels.length;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D is required to draw cab labels');
  ctx.fillStyle = '#22292f';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#dddacf';
  ctx.font = '600 48px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  labels.forEach(({ label }, index) => ctx.fillText(label, 192, 40 + index * 80));
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  const material = surface(0xffffff, 0.8, 0);
  material.map = texture;
  material.emissive.setHex(0xffffff);
  material.emissiveMap = texture;
  material.emissiveIntensity = 0.15;
  for (const [row, { x, z, width }] of labels.entries()) {
    const geometry = new PlaneGeometry(width, width / 4.8);
    if (labels.length > 1) {
      const uv = geometry.getAttribute('uv');
      for (let vertex = 0; vertex < uv.count; vertex++) {
        const v = 0.025 + uv.getY(vertex) * 0.95;
        uv.setY(vertex, (labels.length - row - 1 + v) / labels.length);
      }
    }
    const mesh = new Mesh(geometry, material);
    mesh.position.set(x, 0.043, z);
    mesh.rotation.x = -Math.PI * 0.5;
    group.add(mesh);
  }
}

function deskLever(group: Group, metal: MeshStandardMaterial, black: MeshStandardMaterial, x: number, z: number) {
  box(group, black, [0.18, 0.025, 0.265], [x, 0.027, z]);
  box(group, metal, [0.027, 0.003, 0.204], [x, 0.041, z]);
  const assembly = new Group();
  assembly.position.set(x, 0.056, z);
  rod(assembly, metal, 0.017, new Vector3(), new Vector3(0, 0.135, 0));
  const handle = new Mesh(new SphereGeometry(0.048, 16, 10), black);
  handle.position.y = 0.138;
  handle.scale.set(1.35, 0.72, 0.86);
  assembly.add(handle);
  group.add(assembly);
  return assembly;
}

function deskOutline(path: Path, x: number, z: number, width: number, depth: number, radius: number): Path {
  const left = x - width / 2;
  const right = x + width / 2;
  const bottom = -z - depth / 2;
  const top = -z + depth / 2;
  path.moveTo(left + radius, bottom);
  path.lineTo(right - radius, bottom);
  path.quadraticCurveTo(right, bottom, right, bottom + radius);
  path.lineTo(right, top - radius);
  path.quadraticCurveTo(right, top, right - radius, top);
  path.lineTo(left + radius, top);
  path.quadraticCurveTo(left, top, left, top - radius);
  path.lineTo(left, bottom + radius);
  path.quadraticCurveTo(left, bottom, left + radius, bottom);
  path.closePath();
  return path;
}

function recessedController(desk: Group, x: number, metal: MeshStandardMaterial, well: MeshStandardMaterial,
  trim: MeshStandardMaterial, grip: MeshStandardMaterial, gripInsert: MeshStandardMaterial, brake: boolean): Group {
  const z = 0.025;
  roundedBox(desk, well, [0.169, 0.010, 0.248], [x, 0.013, z], 0.005);
  for (const side of [-1, 1]) {
    roundedBox(desk, metal, [0.011, 0.011, 0.205], [x + side * 0.035, 0.023, z], 0.005);
    for (let index = 0; index < 6; index++) {
      const width = index % 5 === 0 ? 0.021 : 0.014;
      box(desk, index === 0 && brake ? gripInsert : metal, [width, 0.002, 0.0037],
        [x + side * 0.061, 0.0195, z + 0.09 - 0.035 * index]);
    }
    cylinder(desk, trim, 0.010, 0.003, [x, 0.019, z + side * 0.108], 12);
  }

  const lever = new Group();
  lever.name = brake ? 'Cab brake lever' : 'Cab power lever';
  lever.position.set(x, 0.023, z);
  roundedBox(lever, trim, [0.063, 0.037, 0.072], [0, 0.018, 0], 0.017);
  rod(lever, metal, 0.013, new Vector3(0, 0.025, 0), new Vector3(0, 0.166, 0));
  cylinder(lever, trim, 0.021, 0.018, [0, 0.141, 0], 18);
  roundedBox(lever, grip, [brake ? 0.128 : 0.146, 0.052, 0.067], [0, 0.173, 0], 0.023);
  roundedBox(lever, gripInsert, [brake ? 0.088 : 0.102, 0.010, 0.047], [0, 0.198, 0], 0.005);
  for (let index = -2; index <= 2; index++) {
    roundedBox(lever, trim, [0.009, 0.003, 0.028], [0.017 * index, 0.204, 0], 0.0015);
  }
  batchRigidParts(lever);
  desk.add(lever);
  return lever;
}

function detailedDesk(group: Group, charcoal: MeshStandardMaterial, trim: MeshStandardMaterial,
  amber: MeshStandardMaterial, green: MeshStandardMaterial, grain?: Texture) {
  const composite = surface(0x3e4341, 0.66, 0.06);
  composite.name = 'Molded cab console polymer';
  composite.bumpMap = grain ?? null;
  composite.bumpScale = 0.0017;
  const edge = surface(0x42494b, 0.35, 0.61);
  edge.name = 'Cab console anodized control trim';
  const recess = surface(0x131a1b, 0.94, 0.02);
  recess.name = 'Cab console recessed mechanism';
  const bakelite = surface(0x323b3b, 0.39, 0.05);
  bakelite.name = 'Cab console control cap';
  const tractionGrip = surface(0x424749, 0.63, 0.03);
  const brakeGrip = surface(0x725047, 0.64, 0.02);
  const xs = [-1.07, -0.90, -0.73, -0.56, -0.39];

  roundedBox(group, charcoal, [2.71, 0.125, 0.61], [-0.15, -0.061, 0], 0.042);
  const outline = new Shape();
  deskOutline(outline, -0.15, 0, 2.668, 0.575, 0.044);
  outline.holes.push(deskOutline(new Path(), -0.73, -0.105, 0.885, 0.138, 0.021));
  for (const x of [0.26, 0.76]) {
    outline.holes.push(deskOutline(new Path(), x, 0.025, 0.188, 0.270, 0.020));
  }
  const consoleGeometry = new ExtrudeGeometry(outline, {
    depth: 0.026, bevelThickness: 0.006, bevelSize: 0.006, bevelSegments: 3, curveSegments: 5,
  });
  consoleGeometry.rotateX(-Math.PI / 2);
  consoleGeometry.translate(0, 0.005, 0);
  // Both face groups share the molded material so the console stays a single draw.
  consoleGeometry.clearGroups();
  const console = new Mesh(consoleGeometry, composite);
  console.name = 'Cab console with recessed controls';
  console.receiveShadow = true;
  group.add(console);
  roundedBox(group, trim, [2.63, 0.044, 0.065], [-0.15, 0.004, 0.294], 0.021);

  roundedBox(group, recess, [0.867, 0.017, 0.121], [-0.73, 0.011, -0.105], 0.008);
  for (const x of [-1.137, -0.323]) {
    cylinder(group, edge, 0.009, 0.005, [x, 0.020, -0.105], 12);
    box(group, recess, [0.010, 0.001, 0.0015], [x, 0.023, -0.105]).rotation.y = 0.8;
  }
  for (const [index, x] of xs.entries()) {
    roundedBox(group, edge, [0.111, 0.010, 0.095], [x, 0.024, -0.105], 0.005);
    const cap = roundedBox(group, bakelite, [0.088, 0.023, 0.073], [x, 0.036, -0.105], 0.010);
    cap.rotation.x = index % 2 === 0 ? -0.21 : 0.21;
    const lens = index === 1 ? green : index === 2 ? amber : recess;
    roundedBox(group, lens, [0.036, 0.006, 0.018], [x, 0.049, -0.12], 0.003);
    cylinder(group, edge, 0.032, 0.007, [x, 0.039, 0.121], 24);
    cylinder(group, bakelite, 0.023, 0.018, [x, 0.052, 0.121], 24);
    box(group, edge, [0.015, 0.0015, 0.002], [x, 0.062, 0.114]).rotation.y = 0.6;
  }
  const throttle = recessedController(group, 0.26, edge, recess, trim, bakelite, tractionGrip, false);
  const brake = recessedController(group, 0.76, edge, recess, trim, bakelite, brakeGrip, true);
  return { throttle, brake };
}

let windscreenMarks: DataTexture | undefined;

function windscreenTexture() {
  if (windscreenMarks) return windscreenMarks;
  const width = 512;
  const height = 256;
  const pixels = new Uint8Array(width * height * 4);
  let seed = 19_580_603;
  const random = () => {
    seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
    return seed / 4_294_967_296;
  };
  for (let row = 0; row < height; row++) {
    const y = row / height;
    for (let column = 0; column < width; column++) {
      const x = column / width;
      const edge = Math.max(Math.abs(2 * x - 1) ** 7, 0.81 * (1 - y) ** 11);
      const frost = edge * (0.25 + 0.75 * random()) * (0.29 + 0.71 * Math.abs(Math.sin(x * 29 + y * 39)));
      const index = (row * width + column) * 4;
      pixels[index + 1] = 0.68 * 255 * frost;
      pixels[index + 3] = 255;
    }
  }
  for (let drop = 0; drop < 480; drop++) {
    const x = Math.floor(random() * width);
    const y = Math.floor(random() * height);
    const radius = random() * 1.6 + 0.7;
    const length = radius * (1.2 + random() * 4.5);
    for (let dy = -Math.ceil(length); dy <= 2; dy++) {
      const row = (y + dy + height) % height;
      const tapered = radius * Math.max(0.25, 1 + Math.min(0, dy) / length);
      for (let dx = -Math.ceil(tapered); dx <= Math.ceil(tapered); dx++) {
        const column = (x + dx + width) % width;
        const index = (row * width + column) * 4;
        const shape = Math.max(0, 1 - (dx / (tapered + 0.5)) ** 2) * Math.max(0, 1 - Math.abs(dy) / length);
        pixels[index] = Math.max(pixels[index], 167 * shape);
        pixels[index + 2] = Math.max(pixels[index + 2], 255 * shape * Number(dy >= -1 && dx <= 0));
      }
    }
  }
  windscreenMarks = new DataTexture(pixels, width, height);
  windscreenMarks.minFilter = LinearFilter;
  windscreenMarks.magFilter = LinearFilter;
  windscreenMarks.needsUpdate = true;
  return windscreenMarks;
}

function cabWipers(group: Group, trim: MeshStandardMaterial, moving: boolean) {
  const wipers = [];
  for (const side of [-1, 1]) {
    const position = new Vector3(side * 1.07, 2.22, -11.15);
    const armEnd = new Vector3(side * 0.52, 2.63, -11.02);
    const bladeStart = new Vector3(side * 0.40, 2.56, -11.047);
    const bladeEnd = new Vector3(side * 0.79, 2.76, -10.974);
    if (!moving) {
      rod(group, trim, 0.009, position, armEnd);
      rod(group, trim, 0.011, bladeStart, bladeEnd);
      continue;
    }
    const pivot = new Group();
    pivot.name = 'Cab windscreen wiper';
    pivot.position.copy(position);
    rod(pivot, trim, 0.009, new Vector3(), armEnd.sub(position));
    rod(pivot, trim, 0.011, bladeStart.sub(position), bladeEnd.sub(position));
    batchRigidParts(pivot);
    group.add(pivot);
    wipers.push({ side, pivot });
  }
  return wipers;
}

function wetWindscreen(group: Group, trim: MeshStandardMaterial) {
  const wipers = cabWipers(group, trim, true);
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array([
    -1.25, 2.20, -11.19, 1.25, 2.20, -11.19, 1.19, 3.52, -10.81, -1.19, 3.52, -10.81,
  ]), 3));
  geometry.setAttribute('uv', new BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), 2));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  geometry.computeVertexNormals();
  const glazing = new MeshPhysicalMaterial({
    color: 0xa5bcc7, metalness: .12, roughness: .13, clearcoat: .92, clearcoatRoughness: .11,
    envMapIntensity: 1.12, transparent: true, opacity: .037, depthWrite: false,
  });
  glazing.onBeforeCompile = shader => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <lights_fragment_end>', `
      #include <lights_fragment_end>
      reflectedLight.directSpecular *= .06;
      #ifdef USE_CLEARCOAT
        clearcoatSpecularDirect *= .05;
      #endif
    `);
  };
  const glass = new Mesh(geometry, glazing);
  glass.name = 'Cab windscreen glazing';
  glass.renderOrder = 11;
  group.add(glass);
  const material = new ShaderMaterial({
    name: 'Windscreen rain and frost',
    uniforms: {
      marks: { value: windscreenTexture() },
      time: { value: 0 },
      rain: { value: 0 },
      night: { value: 0 },
    },
    transparent: true,
    depthWrite: false,
    vertexShader: `
      varying vec2 paneUv;
      void main() {
        paneUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      varying vec2 paneUv;
      uniform sampler2D marks;
      uniform float time;
      uniform float rain;
      uniform float night;
      void main() {
        vec2 slide = vec2(paneUv.x + rain * sin(paneUv.y * 16.0 + time * 1.9) * 0.002,
          fract(paneUv.y + rain * time * 0.20));
        vec3 pattern = texture2D(marks, slide).rgb;
        float opacity = mix(pattern.g, pattern.r * 0.47 + pattern.b * 0.33, rain);
        vec2 inset = min(paneUv, 1.0 - paneUv);
        opacity *= smoothstep(.013, .074, min(inset.x, inset.y));
        if (opacity < 0.011) discard;
        vec3 frost = vec3(0.67, 0.82, 0.93);
        vec3 drop = mix(vec3(0.22, 0.32, 0.42), vec3(0.68, 0.79, 0.85), pattern.b);
        gl_FragColor = vec4(mix(frost, drop, rain) * mix(1.0, 0.56, night), opacity);
        #include <colorspace_fragment>
      }`,
  });
  const pane = new Mesh(geometry, material);
  pane.name = 'Cab windscreen weather';
  pane.visible = false;
  pane.renderOrder = 12;
  group.add(pane);
  const normal = new Vector3(0, -0.38, 1.32).normalize();
  let time = 0;
  return (state: TrainVisualState) => {
    const wet = state.weather === 'rain';
    const snow = state.weather === 'snow';
    pane.visible = wet || snow;
    glazing.opacity = state.night ? .026 : wet || snow ? .051 : .037;
    time += state.deltaSeconds ?? 1 / 60;
    material.uniforms.time.value = time % 300;
    material.uniforms.rain.value = Number(wet);
    material.uniforms.night.value = Number(state.night);
    const phase = wet || snow ? Math.min(1, (time % (wet ? 1.6 : 3.4)) / 1.18) : 0;
    const sweep = 0.62 * Math.sin(Math.PI * phase) ** 2;
    for (const { side, pivot } of wipers) pivot.quaternion.setFromAxisAngle(normal, -side * sweep);
  };
}

function makeCabGeometry(group: Group, grain?: Texture, showpiece = false) {
  const deskGrain = showpiece ? grain?.clone() : grain;
  if (showpiece) deskGrain?.repeat.set(3.2, 2.9);
  const charcoal = surface(showpiece && grain ? 0xbec3bd : 0x2a3338, 0.88, 0.1);
  const dashboard = showpiece ? surface(grain ? 0xf1e9dc : 0x4b4d4a, 0.61, 0.09) : surface(0x485156, 0.76, 0.09);
  for (const material of [charcoal, dashboard]) {
    material.bumpMap = deskGrain ?? null;
    material.bumpScale = showpiece ? 0.0045 : 0.018;
    if (showpiece) material.map = deskGrain ?? null;
  }
  const trim = surface(0x10191d, 0.79, 0.12);
  const rubber = surface(0x171e22, 0.92, 0);
  const brushed = surface(0x647076, 0.42, 0.51);
  const accent = surface(0x912f22, 0.39, 0.14);
  accent.emissive.setHex(0xf95726);
  accent.emissiveIntensity = 0.55;

  box(group, rubber, [2.91, 0.16, 2.4], [0, 1.15, -10.08]);
  box(group, charcoal, [2.89, 0.96, 0.17], [0, 1.74, -11.27]);
  box(group, charcoal, [2.88, 0.20, 1.88], [0, 3.63, -10.24]);
  roundedBox(group, dashboard, [2.84, 0.085, 0.43], [0, 2.16, -11.07], 0.028).rotation.x = -0.08;
  roundedBox(group, trim, [2.83, 0.086, 0.15], [0, 2.18, -11.20], 0.021);
  for (const side of [-1, 1]) {
    const pillar = box(group, charcoal, [0.17, 1.75, 0.24], [side * 1.33, 2.87, -10.97]);
    pillar.rotation.z = side * 0.11;
    pillar.rotation.x = 0.26;
    box(group, dashboard, [0.092, 0.76, 1.90], [side * 1.42, 1.74, -10.03]).rotation.z = -side * 0.06;
    box(group, trim, [0.086, 0.11, 1.82], [side * 1.41, 2.21, -10.02]);
    box(group, charcoal, [0.42, 0.29, 0.55], [side * 1.22, 1.99, -10.94]);
    box(group, charcoal, [0.16, 0.18, 1.81], [side * 1.31, 3.49, -10.12]).rotation.z = side * 0.18;
    if (showpiece) {
      const gasket = roundedBox(group, rubber, [0.043, 1.39, 0.065], [side * 1.22, 2.87, -10.96], 0.016);
      gasket.rotation.x = 0.27;
      gasket.rotation.z = side * 0.035;
      box(group, trim, [0.32, 0.043, 0.118], [side * 1.11, 2.213, -11.045]);
      for (let slat = 0; slat < 6; slat++) {
        box(group, dashboard, [0.011, 0.006, 0.082], [side * (1.00 + 0.042 * slat), 2.238, -11.045]);
      }
    }
  }
  const updateGlass = showpiece ? wetWindscreen(group, trim) : undefined;
  if (!showpiece) cabWipers(group, trim, false);

  const dash = new Group();
  dash.name = 'Cab instruments';
  dash.position.set(0.15, 2.22, -10.76);
  dash.rotation.x = -0.35;
  group.add(dash);
  roundedBox(dash, rubber, [1.99, 0.405, 0.107], [0.03, 0.00, -0.04], 0.043);
  roundedBox(dash, dashboard, [1.92, 0.362, 0.049], [0.03, 0, -0.005], 0.021);
  const speed = dial(dash, trim, accent, 0.25, 0, { max: 200, step: 25, label: 'km/h', scale: 0.169 }, showpiece);
  const pressure = dial(dash, trim, accent, 0.66, -0.024, { max: 10, step: 2, label: 'bar', scale: 0.12 }, showpiece);
  const power = dial(dash, trim, accent, -0.12, -0.018, { max: 100, step: 20, label: '%  traction', scale: 0.117 }, showpiece);
  const reservoir = dial(dash, trim, accent, -0.45, -0.019, { max: 10, step: 2, label: 'bar', scale: 0.116 }, showpiece);
  for (const x of [-0.9, 0.96]) {
    for (const y of [-0.15, 0.15]) {
      cylinder(dash, brushed, 0.017, 0.019, [x, y, 0.027], 6).rotation.x = Math.PI / 2;
    }
  }
  if (showpiece) {
    for (const x of [-0.69, 0.84]) {
      roundedBox(dash, rubber, [0.093, 0.163, 0.012], [x, 0.012, 0.022], 0.006);
      for (let slot = 0; slot < 7; slot++) {
        const louvre = box(dash, brushed, [0.073, 0.005, 0.005], [x, 0.078 - 0.022 * slot, 0.029]);
        louvre.rotation.x = 0.38;
      }
    }
  }

  const controls = new Group();
  controls.position.set(0.15, 1.96, -10.42);
  controls.rotation.x = 0.17;
  group.add(controls);
  const amber = showpiece
    ? new MeshPhysicalMaterial({ color: 0xb36726, roughness: 0.28, clearcoat: 0.79, clearcoatRoughness: 0.15 })
    : surface(0x9d601f, 0.44, 0.12);
  amber.emissive.setHex(0xff8b1b);
  const green = showpiece
    ? new MeshPhysicalMaterial({ color: 0x3a6151, roughness: 0.3, clearcoat: 0.76, clearcoatRoughness: 0.18 })
    : surface(0x395846, 0.44, 0.12);
  green.emissive.setHex(0x4ada80);
  let throttle: Group;
  let brake: Group;
  if (showpiece) {
    ({ throttle, brake } = detailedDesk(controls, charcoal, trim, amber, green, deskGrain));
  } else {
    roundedBox(controls, charcoal, [2.71, 0.139, 0.61], [-0.15, -0.035, 0], 0.044);
    roundedBox(controls, dashboard, [2.69, 0.058, 0.59], [-0.15, 0.003, 0], 0.022);
    roundedBox(controls, trim, [2.68, 0.058, 0.091], [-0.15, -0.006, 0.30], 0.022);
    throttle = deskLever(controls, brushed, trim, 0.26, 0.03);
    brake = deskLever(controls, brushed, trim, 0.76, 0.03);
    for (const [index, x] of [-1.07, -0.90, -0.73, -0.56, -0.39].entries()) {
      box(controls, trim, [0.12, 0.016, 0.10], [x, 0.046, -0.11]);
      box(controls, index === 1 ? green : index === 2 ? amber : dashboard, [0.087, 0.019, 0.075], [x, 0.058, -0.11]);
      const knob = cylinder(controls, brushed, 0.033, 0.022, [x, 0.045, 0.118]);
      knob.castShadow = true;
    }
  }
  const labels = [
    { label: 'PÅDRAG', x: 0.26, z: 0.237, width: 0.143 },
    { label: 'BREMS', x: 0.76, z: 0.237, width: 0.135 },
    { label: 'DØRER', x: -0.90, z: 0, width: 0.12 },
    { label: 'LYS', x: -0.73, z: 0, width: 0.10 },
    { label: 'HORN', x: -0.56, z: 0, width: 0.12 },
  ];
  if (showpiece) cabLabels(controls, labels);
  else labels.forEach(label => cabLabels(controls, [label]));

  const fill = new PointLight(new Color(0xffdbac), 1.2, 2.9, 2);
  if (showpiece) fill.position.set(-0.15, 2.86, -9.93);
  else fill.position.set(0.38, 2.64, -9.90);
  group.add(fill);
  batchRigidParts(dash);
  batchRigidParts(controls);
  batchRigidParts(group);
  batchRigidShadow(group, [dash, controls]);
  return { speed, pressure, power, reservoir, throttle, brake, amber, green, fill, updateGlass };
}

export function createCab(grain?: Texture, showpiece = false) {
  const group = new Group();
  const eye = new Vector3(0.38, 2.70, -9.33);
  const instruments = makeCabGeometry(group, grain, showpiece);
  const headlight = trainHeadlight(group, showpiece);
  // Opaque cockpit depth prevents shading scenery hidden by the desk and window frames.
  group.traverse(object => {
    if (object instanceof Mesh && !Array.isArray(object.material) && !object.material.transparent) {
      object.renderOrder = -10;
    }
  });
  function update(state: TrainVisualState) {
    instruments.updateGlass?.(state);
    instruments.speed(state.speed * 3.6, state.night);
    instruments.pressure(5 - 3.65 * state.brake, state.night);
    instruments.reservoir(8.1 - 0.18 * state.brake, state.night);
    instruments.power(state.throttle * 100, state.night);
    instruments.throttle.rotation.x = 0.46 - state.throttle * 1.05;
    instruments.brake.rotation.x = -0.51 + state.brake * 1.05;
    instruments.amber.emissiveIntensity = state.doorsOpen ? 1.4 : 0.1;
    instruments.green.emissiveIntensity = state.doorsOpen ? 0.08 : 0.8;
    instruments.fill.intensity = showpiece && !state.night ? 2.55 : 1.95;
    instruments.fill.visible = showpiece || state.night;
    headlight(state.night, state.weather);
  }
  return { group, eye, update };
}
