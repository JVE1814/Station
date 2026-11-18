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
  DoubleSide,
  Group,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  PointLight,
  ShaderMaterial,
  SphereGeometry,
  SpotLight,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  Vector3,
} from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export interface TrainVisualState {
  speed: number;
  throttle: number;
  brake: number;
  doorsOpen: boolean;
  night: boolean;
  headlights?: boolean;
  deltaSeconds?: number;
  doorSide?: -1 | 1;
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
    if (!(object instanceof Mesh) || !(object.material instanceof MeshStandardMaterial)) continue;
    const key = [object.material.id, object.castShadow, object.receiveShadow].join('/');
    const batch = batches.get(key) ?? [];
    batch.push(object);
    batches.set(key, batch);
  }
  for (const batch of batches.values()) {
    if (batch.length <= 1) continue;
    const geometries = batch.map((part) => {
      part.updateMatrix();
      const geometry = part.geometry.clone().applyMatrix4(part.matrix);
      if (!part.material.map) geometry.deleteAttribute('uv');
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

function shell(group: Group, materials: MeshStandardMaterial[], leading: boolean) {
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

function fitExtDetails(
  body: Group,
  materials: ReturnType<typeof makeTrainMaterials>,
  leading: boolean,
  windows: MeshStandardMaterial,
) {
  const { siding, trim, underframe, metal, reflector, rubber, glass } = materials;
  const doors: { mesh: Group; travel: number; center: number; side: -1 | 1 }[] = [];
  for (const side of [-1, 1] as const) {
    box(body, trim, [0.03, 0.77, 20.3], [side * 1.494, 2.50, 0.73]);
    box(body, reflector, [0.032, 0.025, 20.3], [side * 1.5, 1.66, 0.73]);
    box(body, trim, [0.026, 0.115, 21.0], [side * 1.488, 1.08, 0.45]);

    for (const z of [-7.73, -6.03, -4.32, -2.61, -0.90, 0.80, 2.51, 4.22, 5.93, 7.65]) {
      box(body, rubber, [0.045, 0.704, 1.41], [side * 1.504, 2.50, z]);
      box(body, windows, [0.052, 0.626, 1.32], [side * 1.513, 2.51, z]);
      box(body, trim, [0.06, 0.62, 0.043], [side * 1.518, 2.51, z + 0.22]);
    }

    for (const doorway of [-9.34, 9.42]) {
      box(body, rubber, [0.060, 1.93, 1.59], [side * 1.498, 2.00, doorway]);
      box(body, metal, [0.09, 0.055, 1.72], [side * 1.53, 1.032, doorway]);
      for (const leaf of [-1, 1]) {
        const hinge = new Group();
        hinge.position.set(side * 1.536, 2.005, doorway + leaf * 0.393);
        box(hinge, siding, [0.047, 1.84, 0.755], [0, 0, 0]);
        box(hinge, glass, [0.051, 0.81, 0.639], [side * 0.023, 0.33, 0]);
        cylinder(hinge, reflector, 0.052, 0.013, [side * 0.03, -0.23, -leaf * 0.22]).rotation.z = Math.PI / 2;
        batchRigidParts(hinge);
        doors.push({ mesh: hinge, travel: leaf * 0.70, center: hinge.position.z, side });
        body.add(hinge);
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
  return doors;
}

function noseDetails(body: Group, trim: MeshStandardMaterial) {
  const glaze = surface(0x182636, 0.16, 0.36);
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
  const light = trainHeadlight(body);
  return { lamp, light, halos };
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

function trainHeadlight(body: Group) {
  const light = new SpotLight(0xffe5c4, 380, 125, 0.21, 0.68, 1.25);
  light.position.set(0, 1.64, -12.15);
  light.target.position.set(0, 0.70, -52);
  light.visible = false;
  const length = 46;
  const beam = new Mesh(
    new ConeGeometry(Math.tan(0.135) * length, length, 24, 1, true),
    new ShaderMaterial({
      blending: AdditiveBlending,
      depthWrite: false,
      transparent: true,
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
        varying vec3 viewNormal;
        varying vec3 viewRay;
        varying float distanceAlong;
        void main() {
          float facing = abs(dot(normalize(viewNormal), normalize(viewRay)));
          float angle = smoothstep(0.04, 0.50, facing);
          float falloff = smoothstep(0.0, 0.09, distanceAlong)
            * (1.0 - smoothstep(0.18, 1.0, distanceAlong));
          gl_FragColor = vec4(1.0, 0.77, 0.49, angle * falloff * 0.045);
          #include <colorspace_fragment>
        }`,
    }),
  );
  const depression = Math.atan2(0.94, 39.85);
  beam.rotateX(Math.PI / 2 - depression);
  beam.position.set(0, -Math.sin(depression) * length / 2, -Math.cos(depression) * length / 2);
  light.add(beam);
  body.add(light, light.target);
  return light;
}

export function createTrain(leading = true, brushedSteel?: Texture) {
  const group = new Group();
  const materials = makeTrainMaterials();
  const { siding, paint, underframe, metal, trim } = materials;
  siding.map = brushedSteel ?? null;
  siding.bumpMap = brushedSteel ?? null;
  siding.bumpScale = 0.0015;
  shell(group, [siding, paint, underframe], leading);
  const windowMaterial = surface(0x263744, 0.14, 0.2);
  windowMaterial.emissive.setHex(0xfda655);
  const doors = fitExtDetails(group, materials, leading, windowMaterial);
  const lights = leading ? noseDetails(group, trim) : undefined;
  const bogies: [Group, Group] = [
    buildBogie(group, underframe, metal, -8.3),
    buildBogie(group, underframe, metal, 8.3),
  ];
  batchRigidParts(group);
  function update(state: TrainVisualState) {
    windowMaterial.emissiveIntensity = state.night ? 0.75 : 0.025;
    if (lights) {
      const head = state.headlights !== false;
      lights.lamp.emissive.setHex(head ? 0xffd9a5 : 0xef382b);
      lights.lamp.emissiveIntensity = state.night ? 3.8 : 0.62;
      lights.light.visible = state.night && head;
      for (const halo of lights.halos) {
        halo.material.color.setHex(head ? 0xffffff : 0xec422f);
        halo.visible = state.night;
      }
    }
    const fraction = 1 - Math.exp(-5.65 * (state.deltaSeconds ?? (1 / 60)));
    for (const door of doors) {
      const open = state.doorsOpen && (!state.doorSide || state.doorSide === door.side);
      const target = door.center + (open ? door.travel : 0);
      door.mesh.position.z += (target - door.mesh.position.z) * fraction;
    }
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
) {
  const group = new Group();
  group.position.set(x, y, 0.016);
  desk.add(group);
  cylinder(group, bezel, scale.scale, 0.051, [0, 0, 0], 40).rotation.x = Math.PI * 0.5;
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

function cabLabel(group: Group, label: string, x: number, z: number, width: number) {
  const canvas = document.createElement('canvas');
  canvas.width = 384;
  canvas.height = 80;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D is required to draw cab labels');
  ctx.fillStyle = '#22292f';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#dddacf';
  ctx.font = '600 48px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, 192, 40);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  const material = surface(0xffffff, 0.8, 0);
  material.map = texture;
  material.emissive.setHex(0xffffff);
  material.emissiveMap = texture;
  material.emissiveIntensity = 0.15;
  const mesh = new Mesh(new PlaneGeometry(width, width / 4.8), material);
  mesh.position.set(x, 0.043, z);
  mesh.rotation.x = -Math.PI * 0.5;
  group.add(mesh);
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

function makeCabGeometry(group: Group, grain?: Texture) {
  const charcoal = surface(0x2a3338, 0.88, 0.1);
  const dashboard = surface(0x485156, 0.76, 0.09);
  for (const material of [charcoal, dashboard]) {
    material.bumpMap = grain ?? null;
    material.bumpScale = 0.018;
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
  }
  for (const side of [-1, 1]) {
    rod(group, trim, 0.009, new Vector3(side * 1.07, 2.22, -11.15), new Vector3(side * 0.52, 2.63, -11.02));
    rod(group, trim, 0.011, new Vector3(side * 0.40, 2.56, -11.047), new Vector3(side * 0.79, 2.76, -10.974));
  }

  const dash = new Group();
  dash.position.set(0.15, 2.22, -10.76);
  dash.rotation.x = -0.35;
  group.add(dash);
  roundedBox(dash, rubber, [1.99, 0.405, 0.107], [0.03, 0.00, -0.04], 0.043);
  roundedBox(dash, dashboard, [1.92, 0.362, 0.049], [0.03, 0, -0.005], 0.021);
  const speed = dial(dash, trim, accent, 0.25, 0, { max: 200, step: 25, label: 'km/h', scale: 0.169 });
  const pressure = dial(dash, trim, accent, 0.66, -0.024, { max: 10, step: 2, label: 'bar', scale: 0.12 });
  const power = dial(dash, trim, accent, -0.12, -0.018, { max: 100, step: 20, label: '%  traction', scale: 0.117 });
  const reservoir = dial(dash, trim, accent, -0.45, -0.019, { max: 10, step: 2, label: 'bar', scale: 0.116 });
  for (const x of [-0.9, 0.96]) {
    for (const y of [-0.15, 0.15]) {
      cylinder(dash, brushed, 0.017, 0.019, [x, y, 0.027], 6).rotation.x = Math.PI / 2;
    }
  }

  const controls = new Group();
  controls.position.set(0.15, 1.96, -10.42);
  controls.rotation.x = 0.17;
  group.add(controls);
  roundedBox(controls, charcoal, [2.71, 0.139, 0.61], [-0.15, -0.035, 0], 0.044);
  roundedBox(controls, dashboard, [2.69, 0.058, 0.59], [-0.15, 0.003, 0], 0.022);
  roundedBox(controls, trim, [2.68, 0.058, 0.091], [-0.15, -0.006, 0.30], 0.022);

  const throttle = deskLever(controls, brushed, trim, 0.26, 0.03);
  const brake = deskLever(controls, brushed, trim, 0.76, 0.03);
  cabLabel(controls, 'PÅDRAG', 0.26, 0.237, 0.143);
  cabLabel(controls, 'BREMS', 0.76, 0.237, 0.135);

  const amber = surface(0x9d601f, 0.44, 0.12);
  amber.emissive.setHex(0xff8b1b);
  const green = surface(0x395846, 0.44, 0.12);
  green.emissive.setHex(0x4ada80);
  for (const [index, x] of [-1.07, -0.90, -0.73, -0.56, -0.39].entries()) {
    box(controls, trim, [0.12, 0.016, 0.10], [x, 0.046, -0.11]);
    box(controls, index === 1 ? green : index === 2 ? amber : dashboard, [0.087, 0.019, 0.075], [x, 0.058, -0.11]);
    const knob = cylinder(controls, brushed, 0.033, 0.022, [x, 0.045, 0.118]);
    knob.castShadow = true;
  }
  cabLabel(controls, 'DØRER', -0.90, 0, 0.12);
  cabLabel(controls, 'LYS', -0.73, 0, 0.10);
  cabLabel(controls, 'HORN', -0.56, 0, 0.12);

  const fill = new PointLight(new Color(0xffdbac), 1.2, 2.9, 2);
  fill.position.set(0.38, 2.64, -9.90);
  group.add(fill);
  return { speed, pressure, power, reservoir, throttle, brake, amber, green, fill };
}

export function createCab(grain?: Texture) {
  const group = new Group();
  const eye = new Vector3(0.38, 2.70, -9.33);
  const instruments = makeCabGeometry(group, grain);
  const headlight = trainHeadlight(group);
  function update(state: TrainVisualState) {
    instruments.speed(state.speed * 3.6, state.night);
    instruments.pressure(5 - 3.65 * state.brake, state.night);
    instruments.reservoir(8.1 - 0.18 * state.brake, state.night);
    instruments.power(state.throttle * 100, state.night);
    instruments.throttle.rotation.x = 0.46 - state.throttle * 1.05;
    instruments.brake.rotation.x = -0.51 + state.brake * 1.05;
    instruments.amber.emissiveIntensity = state.doorsOpen ? 1.4 : 0.1;
    instruments.green.emissiveIntensity = state.doorsOpen ? 0.08 : 0.8;
    instruments.fill.intensity = state.night ? 1.95 : 0.25;
    headlight.visible = state.night;
  }
  return { group, eye, update };
}
