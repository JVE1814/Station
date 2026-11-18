import {
  BackSide,
  BufferAttribute,
  BufferGeometry,
  Color,
  DataTexture,
  DirectionalLight,
  EquirectangularReflectionMapping,
  FogExp2,
  HemisphereLight,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  Points,
  PointsMaterial,
  Scene,
  SphereGeometry,
  SRGBColorSpace,
  Vector3,
} from 'three';

export type Weather = 'clear' | 'rain' | 'snow';

type Sky = 'day' | 'night' | 'rain' | 'snow';
const skyPalette = {
  day: { horizon: [174, 202, 221], zenith: [67, 129, 191], ground: [90, 101, 81] },
  night: { horizon: [19, 29, 49], zenith: [3, 9, 23], ground: [17, 18, 26] },
  rain: { horizon: [124, 149, 163], zenith: [83, 114, 137], ground: [77, 91, 87] },
  snow: { horizon: [183, 201, 211], zenith: [142, 173, 197], ground: [138, 151, 152] },
};

function skyTexture(sky: Sky, width: number, height: number): DataTexture {
  const data = new Uint8Array(width * height * 4);
  const colors = skyPalette[sky];
  const sun = new Vector3(-0.75, 0.43, 0.52).normalize();
  for (let row = 0; row < height; row++) {
    const latitude = ((row + 0.5) / height - 0.5) * Math.PI;
    const elevation = Math.sin(latitude);
    const radius = Math.cos(latitude);
    const blend = Math.abs(elevation) ** 0.57;
    const pole = elevation >= 0 ? colors.zenith : colors.ground;
    for (let column = 0; column < width; column++) {
      const offset = (row * width + column) * 4;
      const longitude = (column + 0.5) / width * Math.PI * 2;
      const x = -radius * Math.cos(longitude);
      const z = radius * Math.sin(longitude);
      const glare = Math.max(0, x * sun.x + elevation * sun.y + z * sun.z);
      const glow = sky === 'night' ? 0 : glare ** 64 * 19 + glare ** 2400 * 110;
      const cloudX = x / (Math.max(0, elevation) + 0.34);
      const cloudZ = z / (Math.max(0, elevation) + 0.34);
      const sheet = Math.sin(8 * cloudX + 3 * Math.sin(4 * cloudZ))
        * Math.cos(7 * cloudZ + 2 * Math.sin(3 * cloudX))
        + Math.sin(18 * cloudX + 9 * cloudZ) * 0.19;
      const cloud = sky === 'night' || elevation < 0 ? 0
        : Math.max(0, sheet - 0.57) * Math.min(1, elevation * 15) * (sky === 'day' ? 100 : 28);
      const star = sky === 'night' && elevation > 0.15 && ((column * 73856093) ^ (row * 19349663)) % 173 === 0
        ? 100 + (column % 40) : 0;
      for (let channel = 0; channel < 3; channel++) {
        const base = colors.horizon[channel] + (pole[channel] - colors.horizon[channel]) * blend;
        data[offset + channel] = Math.min(255, base + glow + cloud + star);
      }
      data[offset + 3] = 255;
    }
  }
  const texture = new DataTexture(data, width, height);
  texture.colorSpace = SRGBColorSpace;
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

export function skyReflection(night: boolean): DataTexture {
  const texture = skyTexture(night ? 'night' : 'day', 128, 64);
  texture.mapping = EquirectangularReflectionMapping;
  return texture;
}

export class Atmosphere {
  private readonly sun = new DirectionalLight(0xffe0af, 2.7);
  private readonly fill = new HemisphereLight(0xc3e0ff, 0x76684e, 2.2);
  private readonly fog = new FogExp2(0xb4c9d5, 0.00017);
  private readonly shadowCenter = new Vector3(Infinity, 0, 0);
  private readonly sunOffset = new Vector3(-135, 78, 94);
  private readonly cloudTextures = new Map<Sky, DataTexture>();
  private readonly dome = new Mesh(
    new SphereGeometry(1, 28, 20),
    new MeshBasicMaterial({ side: BackSide, depthTest: false, depthWrite: false, fog: false }),
  );
  private readonly particles: Points<BufferGeometry, PointsMaterial>;
  private readonly positions: Float32Array;
  private weather: Weather = 'clear';
  private density = 0.00013;
  private sunLevel = 2.7;
  private fillLevel = 1.58;
  private shelter = 0;

  constructor(private readonly scene: Scene) {
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1024, 1024);
    this.sun.shadow.autoUpdate = false;
    this.sun.shadow.camera.left = -95;
    this.sun.shadow.camera.right = 95;
    this.sun.shadow.camera.top = 95;
    this.sun.shadow.camera.bottom = -95;
    this.sun.shadow.camera.far = 360;
    this.sun.shadow.normalBias = 0.06;
    this.sun.shadow.bias = -0.00018;
    this.scene.add(this.sun, this.sun.target, this.fill);
    this.scene.fog = this.fog;
    this.dome.scale.setScalar(11000);
    this.dome.renderOrder = -1000;
    this.dome.frustumCulled = false;
    this.scene.add(this.dome);

    this.positions = new Float32Array(1600 * 3);
    for (let index = 0; index < this.positions.length; index += 3) {
      this.positions[index] = (Math.random() - 0.5) * 68;
      this.positions[index + 1] = Math.random() * 33;
      this.positions[index + 2] = (Math.random() - 0.5) * 68;
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(this.positions, 3));
    const material = new PointsMaterial({ color: 0xf5f8ff, size: 0.10, transparent: true, opacity: 0.8, depthWrite: false });
    this.particles = new Points(geometry, material);
    this.particles.frustumCulled = false;
    this.scene.add(this.particles);
    this.set(false, 'clear');
  }

  set(night: boolean, weather: Weather): void {
    this.weather = weather;
    const sky = night ? 'night' : weather === 'clear' ? 'day' : weather;
    const [red, green, blue] = skyPalette[sky].horizon;
    const color = new Color().setRGB(red / 255, green / 255, blue / 255, SRGBColorSpace);
    this.scene.background = color;
    let skyMap = this.cloudTextures.get(sky);
    if (!skyMap) {
      skyMap = skyTexture(sky, 768, 384);
      this.cloudTextures.set(sky, skyMap);
    }
    if (!this.dome.material.map) this.dome.material.needsUpdate = true;
    this.dome.material.map = skyMap;
    this.fog.color.copy(color);
    this.density = weather === 'clear' ? 0.00013 : weather === 'snow' ? 0.0034 : 0.0021;
    this.sunLevel = night ? 0.32 : weather === 'clear' ? 2.7 : 0.75;
    this.sun.color.setHex(night ? 0x9aaeff : 0xffe0af);
    this.fillLevel = night ? 0.88 : weather === 'clear' ? 1.58 : 2.25;
    this.fill.color.setHex(night ? 0xa6bbf1 : 0xc3e0ff);
    this.sun.shadow.needsUpdate = true;
    this.particles.material.size = weather === 'snow' ? 0.12 : 0.05;
    this.particles.visible = weather !== 'clear';
  }

  update(position: Vector3, cameraPosition: Vector3, elapsed: number, underCover = false): void {
    this.shelter += (Number(underCover) - this.shelter) * (1 - Math.exp(-elapsed * 4));
    this.sun.intensity = this.sunLevel * (1 - this.shelter * 0.995);
    this.fill.intensity = this.fillLevel * (1 - this.shelter * 0.93);
    this.dome.position.copy(cameraPosition);
    this.dome.updateMatrixWorld();
    this.fog.density = this.density / (1 + Math.max(0, cameraPosition.y - position.y) / 500);
    if (this.shadowCenter.distanceToSquared(position) >= 0.85 ** 2) {
      this.shadowCenter.copy(position);
      this.sun.target.position.copy(position);
      this.sun.position.copy(position).add(this.sunOffset);
      this.sun.target.updateMatrixWorld();
      this.sun.updateMatrixWorld();
      this.sun.shadow.needsUpdate = true;
    }
    this.particles.visible = this.weather !== 'clear' && !underCover;
    if (!this.particles.visible) return;
    this.particles.position.copy(position);
    this.particles.position.y -= 3;
    this.particles.updateMatrixWorld();
    const fall = this.weather === 'snow' ? 2.1 : 15;
    for (let index = 1; index < this.positions.length; index += 3) {
      this.positions[index] -= elapsed * fall;
      if (this.positions[index] < 0) this.positions[index] += 33;
    }
    this.particles.geometry.attributes.position.needsUpdate = true;
  }
}
