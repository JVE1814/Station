import {
  BackSide, Color, FogExp2, HalfFloatType, HemisphereLight, Material, Mesh, MeshLambertMaterial,
  MeshPhysicalMaterial, MeshPhongMaterial, MeshStandardMaterial, Matrix4, OrthographicCamera, PerspectiveCamera,
  PlaneGeometry, Scene, ShaderMaterial, Vector2, Vector3, WebGLRenderTarget, WebGLRenderer, DepthTexture,
} from 'three';
import { CSM } from 'three/addons/csm/CSM.js';
import { Sky } from 'three/addons/objects/Sky.js';
import type { Weather } from './atmosphere';
import type { WaterReflection } from './water-reflection';

export type Quality = 'low' | 'high' | 'ultra';
export const qualities: Quality[] = ['low', 'high', 'ultra'];

export function parseQuality(quality: string | null): Quality {
  return qualities.find(value => value === quality) ?? 'high';
}

const sunlight = new Vector3(-.89, .17, .43).normalize();

const gradeVertex = /* glsl */`
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const gradeFragment = /* glsl */`
#include <packing>
varying vec2 vUv;
uniform sampler2D image;
uniform sampler2D depth;
uniform sampler2D bloomImage;
uniform vec2 pixel;
uniform vec2 clipPlanes;
uniform float occlusion;
uniform float bloom;
uniform float cold;
uniform float blueHour;
uniform float shoreline;
uniform float valley;
uniform mat4 worldFromClip;
float linearDepth(vec2 uv) {
  return -perspectiveDepthToViewZ(texture2D(depth, uv).r, clipPlanes.x, clipPlanes.y);
}
void main() {
  vec3 color = texture2D(image, vUv).rgb;
  float z = linearDepth(vUv);
  if (occlusion > 0.0 && z < 260.0) {
    float shade = 0.0;
    vec2 radius = pixel * clamp(43.0 / max(z, .7), 2.0, 13.0);
    for (int i = 0; i < 8; i++) {
      float angle = float(i) * .78539816 + .18;
      vec2 axis = vec2(cos(angle), sin(angle));
      float delta = z - linearDepth(vUv + axis * radius);
      shade += smoothstep(.018 + .001 * z, .24 + .013 * z, delta) *
        (1.0 - smoothstep(.44 + .025 * z, 1.15 + .045 * z, delta));
    }
    color *= 1.0 - shade * .0625 * occlusion;
  }
  if (shoreline > .025 && z > 36.0 && z < 4500.0) {
    float rawDepth = texture2D(depth, vUv).r;
    vec4 world = worldFromClip * vec4(vUv * 2.0 - 1.0, rawDepth * 2.0 - 1.0, 1.0);
    float height = world.y / world.w;
    float bank = exp(-max(0.0, height - valley) * .047);
    float thickness = shoreline * bank * smoothstep(42.0, 640.0, z) * .29;
    vec3 air = mix(vec3(.47,.49,.49), vec3(.11,.17,.27), cold);
    color = mix(color, air, thickness);
  }
  color += texture2D(bloomImage, vUv).rgb * bloom;
  float luma = dot(color, vec3(.2126, .7152, .0722));
  color = mix(vec3(luma), color, mix(1.04, .91, cold));
  color *= mix(vec3(1.04, 1.005, .965), vec3(.94, 1.01, 1.08), cold);
  float shadowLift = 1.0 - smoothstep(.012, .16, luma);
  color = color * (1.0 + .38 * blueHour) + vec3(.005, .009, .018) * shadowLift * blueHour;
  vec2 frame = (vUv - .5) * vec2(1.05, .82);
  color *= 1.0 - dot(frame, frame) * .14;
  gl_FragColor = vec4(max(color, 0.0), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const blurFragment = /* glsl */`
varying vec2 vUv;
uniform sampler2D image;
uniform vec2 increment;
uniform bool brightOnly;

vec3 lightAt(vec2 uv) {
  vec3 light = texture2D(image, uv).rgb;
  if (brightOnly) {
    float luminance = dot(light, vec3(.2126, .7152, .0722));
    light = min(vec3(12.0), light) * smoothstep(.82, 2.0, luminance);
  }
  return light;
}

void main() {
  vec3 light = lightAt(vUv) * .227027;
  light += (lightAt(vUv + increment * 1.384615) + lightAt(vUv - increment * 1.384615)) * .316216;
  light += (lightAt(vUv + increment * 3.230769) + lightAt(vUv - increment * 3.230769)) * .070270;
  gl_FragColor = vec4(light, 1.0);
}`;

export class ShowpieceLight {
  private readonly sky = new Sky();
  private readonly csm: CSM;
  private readonly ambient = new HemisphereLight(0xb2c9e4, 0x655741, 1.1);
  private readonly fog = new FogExp2(0xc7c5b2, .00042);
  private readonly target = new WebGLRenderTarget(1, 1, {type: HalfFloatType, depthTexture: new DepthTexture(1, 1)});
  private readonly bloomX = new WebGLRenderTarget(1, 1, {type: HalfFloatType, depthBuffer: false});
  private readonly bloomY = new WebGLRenderTarget(1, 1, {type: HalfFloatType, depthBuffer: false});
  private readonly postScene = new Scene();
  private readonly blurScene = new Scene();
  private readonly postCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly blur = new ShaderMaterial({
    vertexShader: gradeVertex, fragmentShader: blurFragment, depthTest: false, depthWrite: false,
    uniforms: { image: {value: this.target.texture}, increment: {value: new Vector2()}, brightOnly: {value: true} },
  });
  private readonly materials = new WeakSet<Material>();
  private readonly watched = new WeakSet<object>();
  private readonly dusk = new ShaderMaterial({
    side: BackSide, depthWrite: false,
    vertexShader: `varying vec3 direction; void main() {direction=normalize(position); gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
    fragmentShader: `varying vec3 direction; void main() {
      vec3 d=normalize(direction);
      float altitude=max(0.0,d.y);
      float horizon=exp(-altitude*7.8);
      float twilight=pow(max(0.0,dot(d,normalize(vec3(-.89,.06,.43)))),9.0);
      vec3 sky=mix(vec3(.006,.015,.049), vec3(.041,.075,.134),horizon);
      sky+=vec3(.12,.065,.036)*twilight*horizon;
      gl_FragColor=vec4(sky,1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
  });
  private readonly post = new ShaderMaterial({
    vertexShader: gradeVertex, fragmentShader: gradeFragment, depthTest: false, depthWrite: false,
    uniforms: {
      image: {value: this.target.texture}, depth: {value: this.target.depthTexture}, bloomImage: {value: this.bloomY.texture},
      pixel: {value: new Vector2(1, 1)}, clipPlanes: {value: new Vector2(.06, 18000)},
      occlusion: {value: .7}, bloom: {value: .55}, cold: {value: 0}, blueHour: {value: 0},
      shoreline: {value: 0}, valley: {value: 0}, worldFromClip: {value: new Matrix4()},
    },
  });
  private quality: Quality;
  private cover = 0;
  private direct = 3.25;
  private fill = 1.1;
  private density = .0004;
  private cameraFar = 0;
  private cameraNear = 0;
  private cameraFov = 0;
  private cameraAspect = 0;

  constructor(private readonly scene: Scene, private readonly camera: PerspectiveCamera, shadowLayer: number, quality: Quality) {
    this.quality = quality;
    this.sky.scale.setScalar(11000);
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -1000;
    this.sky.material.depthWrite = false;
    this.atmosphericMaterial.fragmentShader = this.atmosphericMaterial.fragmentShader.replace(
      'gl_FragColor = vec4( texColor, 1.0 );',
      `vec2 azimuth = normalize(direction.xz);
       float horizonGold = smoothstep(.16, .94, dot(azimuth, normalize(vSunDirection.xz)))
         * exp(-max(0.0, direction.y) * 3.8);
       vec3 SeptemberSky = mix(vec3(.72, .82, 1.07), vec3(1.18, .85, .61), horizonGold);
       gl_FragColor = vec4(texColor * SeptemberSky + horizonGold * vec3(.023, .008, .002), 1.0);`,
    );
    const screen = new PlaneGeometry(2, 2);
    const postQuad = new Mesh(screen, this.post);
    const blurQuad = new Mesh(screen, this.blur);
    postQuad.frustumCulled = blurQuad.frustumCulled = false;
    this.postScene.add(postQuad);
    this.blurScene.add(blurQuad);
    scene.add(this.sky, this.ambient);
    scene.fog = this.fog;
    this.csm = new CSM({
      camera, parent: scene, cascades: 3, maxFar: 390, mode: 'custom', shadowMapSize: 1536,
      shadowBias: -.00012, lightDirection: sunlight.clone().negate(), lightIntensity: 3.25,
      lightFar: 1400, lightMargin: 280,
      customSplitsCallback: (_count, _near, _far, breaks) => breaks.push(.075, .29, 1),
    });
    this.csm.fade = true;
    for (const light of this.csm.lights) {
      light.shadow.camera.layers.enable(shadowLayer);
      light.shadow.normalBias = .095;
      light.shadow.radius = 2.4;
    }
    this.setQuality(quality);
    this.set(false, 'clear');
  }

  private get physicalSky(): ShaderMaterial {
    return this.atmosphericMaterial;
  }
  private readonly atmosphericMaterial = this.sky.material;

  addTree(root: import('three').Object3D): void {
    if (this.watched.has(root)) return;
    this.watched.add(root);
    root.traverse(object => {
      if (object instanceof Mesh) {
        for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
          if (!(material instanceof MeshStandardMaterial || material instanceof MeshPhysicalMaterial
            || material instanceof MeshLambertMaterial || material instanceof MeshPhongMaterial) || this.materials.has(material)) continue;
          this.materials.add(material);
          const before = material.onBeforeCompile;
          const key = material.customProgramCacheKey.bind(material);
          const shaderKey = key();
          this.csm.setupMaterial(material);
          const shadows = material.onBeforeCompile;
          material.onBeforeCompile = (shader, renderer) => {
            before.call(material, shader, renderer);
            shadows.call(material, shader, renderer);
          };
          material.customProgramCacheKey = () => shaderKey + '/r40-cascades';
          material.addEventListener('dispose', () => this.csm.shaders.delete(material));
          material.needsUpdate = true;
        }
      }
    });
  }

  setQuality(quality: Quality): void {
    this.quality = quality;
    this.target.samples = quality === 'ultra' ? 2 : 0;
    this.target.dispose();
    this.post.uniforms.occlusion.value = quality === 'low' ? 0 : quality === 'high' ? .65 : 1.0;
    this.post.uniforms.bloom.value = quality === 'low' ? 0 : .43;
    for (const light of this.csm.lights) {
      light.castShadow = true;
      const size = quality === 'ultra' ? 2048 : quality === 'high' ? 1536 : 1024;
      if (light.shadow.mapSize.x !== size) {
        light.shadow.mapSize.set(size, size);
        light.shadow.map?.dispose();
        light.shadow.map = null;
      }
    }
  }

  resize(width: number, height: number, ratio: number): void {
    const x = Math.max(1, Math.round(width * ratio));
    const y = Math.max(1, Math.round(height * ratio));
    this.target.setSize(x, y);
    const quarterX = Math.max(1, Math.round(x / 4));
    const quarterY = Math.max(1, Math.round(y / 4));
    this.bloomX.setSize(quarterX, quarterY);
    this.bloomY.setSize(quarterX, quarterY);
    this.post.uniforms.pixel.value.set(1 / x, 1 / y);
  }

  set(night: boolean, weather: Weather): void {
    const overcast = weather !== 'clear';
    const snow = weather === 'snow';
    const physical = this.physicalSky;
    this.sky.material = night ? this.dusk : physical;
    physical.uniforms.sunPosition.value.copy(sunlight);
    physical.uniforms.rayleigh.value = overcast ? 2.4 : 1.65;
    physical.uniforms.turbidity.value = overcast ? 8.3 : 2.55;
    physical.uniforms.mieCoefficient.value = overcast ? .008 : .0036;
    physical.uniforms.mieDirectionalG.value = .79;
    physical.uniforms.cloudCoverage.value = overcast ? .87 : .29;
    physical.uniforms.cloudDensity.value = overcast ? .76 : .33;
    physical.uniforms.cloudScale.value = .00037;
    physical.uniforms.cloudElevation.value = .64;
    physical.uniforms.showSunDisc.value = overcast ? 0 : 1;
    this.direct = night ? .29 : overcast ? 1.12 : 3.35;
    this.fill = night ? 1.47 : overcast ? 2.05 : 1.57;
    this.ambient.color.setHex(night ? 0x91acdf : overcast ? 0xd3e2f1 : 0xb8cde4);
    this.ambient.groundColor.setHex(night ? 0x545d74 : snow ? 0x9faebe : 0x76654e);
    this.fog.color.set(new Color(night ? 0x435778 : snow ? 0x9aafc6 : weather === 'rain' ? 0x9eacb0 : 0xaebcc5));
    this.density = snow ? .00215 : weather === 'rain' ? .0011 : night ? .00058 : .00048;
    this.post.uniforms.cold.value = night ? 1 : snow ? .78 : 0;
    this.post.uniforms.blueHour.value = Number(night);
    for (const light of this.csm.lights) light.color.setHex(night ? 0xa0b7ff : overcast ? 0xfcf2e1 : 0xffcf8e);
  }

  render(renderer: WebGLRenderer, train: Vector3, seconds: number, covered: boolean, shoreline: number, water?: WaterReflection): void {
    this.camera.updateMatrixWorld();
    this.sky.position.copy(this.camera.position);
    this.sky.updateMatrixWorld();
    this.cover += (Number(covered) - this.cover) * (1 - Math.exp(-seconds * 5.5));
    this.ambient.intensity = this.fill * (1 - this.cover * .95);
    this.fog.density = this.density / (1 + Math.max(0, this.camera.position.y - train.y) / 1700);
    for (const light of this.csm.lights) light.intensity = this.direct * (1 - this.cover * .995);
    if (this.cameraFar !== this.camera.far || this.cameraNear !== this.camera.near ||
      this.cameraFov !== this.camera.fov || this.cameraAspect !== this.camera.aspect) {
      this.cameraFar = this.camera.far;
      this.cameraNear = this.camera.near;
      this.cameraFov = this.camera.fov;
      this.cameraAspect = this.camera.aspect;
      this.csm.updateFrustums();
    }
    this.csm.update();
    for (const light of this.csm.lights) {
      light.updateMatrixWorld();
      light.target.updateMatrixWorld();
    }
    water?.render(renderer, this.scene, this.camera, this.quality);
    if (this.quality === 'low') {
      renderer.render(this.scene, this.camera);
      return;
    }
    this.post.uniforms.clipPlanes.value.set(this.cameraNear, this.cameraFar);
    this.post.uniforms.shoreline.value = covered ? 0 : shoreline;
    this.post.uniforms.valley.value = train.y + 1.5;
    this.post.uniforms.worldFromClip.value.multiplyMatrices(this.camera.matrixWorld, this.camera.projectionMatrixInverse);
    renderer.setRenderTarget(this.target);
    renderer.render(this.scene, this.camera);
    this.blur.uniforms.image.value = this.target.texture;
    this.blur.uniforms.increment.value.set(1 / this.bloomX.width, 0);
    this.blur.uniforms.brightOnly.value = true;
    renderer.setRenderTarget(this.bloomX);
    renderer.render(this.blurScene, this.postCamera);
    this.blur.uniforms.image.value = this.bloomX.texture;
    this.blur.uniforms.increment.value.set(0, 1 / this.bloomY.height);
    this.blur.uniforms.brightOnly.value = false;
    renderer.setRenderTarget(this.bloomY);
    renderer.render(this.blurScene, this.postCamera);
    renderer.setRenderTarget(null);
    renderer.render(this.postScene, this.postCamera);
  }
}
