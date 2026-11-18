import { Box3, Frustum, Group, Matrix4, PlaneGeometry, ShaderMaterial, Vector2, Vector3 } from 'three';
import type { BufferGeometry, Mesh, MeshStandardMaterial, PerspectiveCamera, Scene, WebGLRenderer } from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';

type WaterMesh = Mesh<BufferGeometry, MeshStandardMaterial>;
type WaterQuality = 'low' | 'high' | 'ultra';

export function decorrelateWaterNormals(material: MeshStandardMaterial): void {
  const before = material.onBeforeCompile;
  const cache = material.customProgramCacheKey;
  material.onBeforeCompile = (shader, renderer) => {
    before.call(material, shader, renderer);
    shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>', `
      #if defined(USE_NORMALMAP_TANGENTSPACE)
        vec2 firstWave = texture2D(normalMap, vNormalMapUv).xy * 2.0 - 1.0;
        mat2 rotation = mat2(0.742, -0.670, 0.670, 0.742);
        vec2 secondWave = texture2D(normalMap, rotation * vNormalMapUv * 1.719 + vec2(0.21, 0.48)).xy * 2.0 - 1.0;
        vec2 wave = (firstWave * 0.69 + (transpose(rotation) * secondWave) * 0.47) * normalScale;
        normal = normalize(tbn * vec3(wave, 1.0));
      #else
        #include <normal_fragment_maps>
      #endif
    `);
  };
  material.customProgramCacheKey = () => `${cache.call(material)}:lake-ripples`;
}

interface Surface {
  mesh: WaterMesh;
  level: number;
  bounds: Box3;
}

export class WaterReflection {
  private readonly reflector = new Reflector(new PlaneGeometry(1, 1), {
    clipBias: 0.0015, multisample: 0, textureWidth: 1, textureHeight: 1,
  });
  private readonly uniforms = {
    texture: { value: this.reflector.getRenderTarget().texture },
    projection: { value: new Matrix4() },
    level: { value: 0 },
    intensity: { value: 0 },
  };
  private readonly surfaces = new Set<Surface>();
  private readonly compiled = new WeakSet<MeshStandardMaterial>();
  private readonly frustum = new Frustum();
  private readonly screen = new Vector2();
  private readonly eye = new Vector3();
  private readonly groundEye = new Vector3();
  private readonly oldEye = new Vector3(Infinity, Infinity, Infinity);
  private readonly aim = new Vector3();
  private readonly oldAim = new Vector3();
  private readonly worldToClip = new Matrix4();
  private readonly inverse = new Matrix4();
  private readonly drawGroup = new Group();
  private refreshedAt = -Infinity;

  constructor() {
    this.reflector.rotation.x = -Math.PI / 2;
  }

  invalidate(): void {
    this.refreshedAt = -Infinity;
  }

  register(mesh: WaterMesh, level: number): () => void {
    mesh.geometry.computeBoundingBox();
    mesh.updateWorldMatrix(true, false);
    const bounds = mesh.geometry.boundingBox?.clone().applyMatrix4(mesh.matrixWorld);
    if (!bounds || bounds.isEmpty()) return () => undefined;
    const surface = { mesh, level, bounds };
    this.surfaces.add(surface);
    const material = mesh.material;
    if (!this.compiled.has(material)) {
      this.compiled.add(material);
      this.addMaterial(material);
    }
    return () => { this.surfaces.delete(surface); };
  }

  private addMaterial(material: MeshStandardMaterial): void {
    const before = material.onBeforeCompile;
    const cache = material.customProgramCacheKey;
    const uniforms = this.uniforms;
    material.onBeforeCompile = (shader, renderer) => {
      before.call(material, shader, renderer);
      shader.uniforms.lakeMirror = uniforms.texture;
      shader.uniforms.lakeProjection = uniforms.projection;
      shader.uniforms.lakePlane = uniforms.level;
      shader.uniforms.lakeReflectivity = uniforms.intensity;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `
          #include <common>
          uniform mat4 lakeProjection;
          varying vec4 vLakeReflection;
          varying float vLakeHeight;
        `)
        .replace('#include <worldpos_vertex>', `
          #include <worldpos_vertex>
          vec4 lakeWorld = modelMatrix * vec4(transformed, 1.0);
          vLakeHeight = lakeWorld.y;
          vLakeReflection = lakeProjection * lakeWorld;
        `);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `
          #include <common>
          uniform sampler2D lakeMirror;
          uniform float lakePlane;
          uniform float lakeReflectivity;
          varying vec4 vLakeReflection;
          varying float vLakeHeight;
        `)
        .replace('#include <opaque_fragment>', `
          float planeBlend = 1.0 - smoothstep(0.6, 9.0, abs(vLakeHeight - lakePlane));
          if (lakeReflectivity > 0.0 && planeBlend > 0.0 && vLakeReflection.w > 0.001) {
            vec2 waveOffset = vec2(0.0);
            #if defined(USE_NORMALMAP_TANGENTSPACE)
              vec2 ripples = texture2D(normalMap, vNormalMapUv * vec2(1.13, 3.77) + vec2(0.2, 0.45)).xy * 2.0 - 1.0;
              waveOffset = ripples * vec2(.023, .007);
            #endif
            vec2 planarUv = vLakeReflection.xy / vLakeReflection.w + normal.xy * 0.006 + waveOffset;
            float edge = min(min(planarUv.x, planarUv.y), min(1.0 - planarUv.x, 1.0 - planarUv.y));
            float insideImage = smoothstep(0.015, 0.067, edge);
            float facing = clamp(abs(dot(normal, normalize(vViewPosition))), 0.0, 1.0);
            float fresnel = 0.24 + 0.64 * pow(1.0 - facing, 3.3);
            planarUv = clamp(planarUv, vec2(0.002), vec2(0.998));
            float spread = .00125 + .0013 * facing;
            vec3 reflectedValley = texture2D(lakeMirror, planarUv).rgb * .54
              + (texture2D(lakeMirror, planarUv + vec2(spread,.0008)).rgb
              + texture2D(lakeMirror, planarUv - vec2(spread,.0008)).rgb) * .23;
            reflectedValley *= vec3(.63, .74, .83);
            #ifdef WATER_BANK_FIELD
              fresnel *= mix(.73, 1.0, smoothstep(.04, .62, waterDepth));
            #endif
            outgoingLight = mix(outgoingLight, reflectedValley,
              lakeReflectivity * fresnel * insideImage * planeBlend);
          }
          #include <opaque_fragment>
        `);
    };
    material.customProgramCacheKey = () => `${cache.call(material)}:lake-planar-reflection`;
    material.needsUpdate = true;
  }

  render(renderer: WebGLRenderer, scene: Scene, camera: PerspectiveCamera, quality: WaterQuality): boolean {
    if (quality === 'low' || this.surfaces.size === 0) {
      this.uniforms.intensity.value = 0;
      return false;
    }
    camera.updateMatrixWorld();
    this.eye.setFromMatrixPosition(camera.matrixWorld);
    this.frustum.setFromProjectionMatrix(this.worldToClip.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    let nearest: Surface | undefined;
    let best = Infinity;
    for (const surface of this.surfaces) {
      const height = this.eye.y - surface.level;
      if (height < 0.20 || height > 370 || !surface.mesh.visible || !this.frustum.intersectsBox(surface.bounds)) continue;
      this.groundEye.copy(this.eye).setY(surface.level);
      const horizontal = surface.bounds.distanceToPoint(this.groundEye);
      if (horizontal > 460) continue;
      const score = horizontal + height * 0.64;
      if (score < best) {
        best = score;
        nearest = surface;
      }
    }
    if (!nearest) {
      this.uniforms.intensity.value = 0;
      return false;
    }

    const map = this.reflector.getRenderTarget();
    const scale = quality === 'ultra' ? 0.5 : 0.25;
    renderer.getDrawingBufferSize(this.screen);
    const width = Math.max(128, Math.round(this.screen.x * scale));
    const height = Math.max(72, Math.round(this.screen.y * scale));
    const resized = map.width !== width || map.height !== height;
    const level = nearest.level;
    if (resized) map.setSize(width, height);
    camera.getWorldDirection(this.aim);
    const now = performance.now();
    if (!resized && Math.abs(this.uniforms.level.value - level) < 0.22
      && now - this.refreshedAt < (quality === 'ultra' ? 33 : 76)
      && this.eye.distanceToSquared(this.oldEye) < 3.6 && this.aim.dot(this.oldAim) > 0.982) {
      this.uniforms.intensity.value = 0.95;
      return false;
    }

    this.reflector.position.set(0, level, 0);
    this.reflector.updateMatrixWorld();
    const reflectorMaterial = this.reflector.material;
    if (!(reflectorMaterial instanceof ShaderMaterial)) throw new Error('Water reflector lost its shader');
    const target = renderer.getRenderTarget();
    const xr = renderer.xr.enabled;
    const shadow = renderer.shadowMap.autoUpdate;
    const restore: WaterMesh[] = [];
    for (const { mesh } of this.surfaces) {
      if (mesh.visible) {
        restore.push(mesh);
        mesh.visible = false;
      }
    }
    try {
      this.reflector.onBeforeRender(renderer, scene, camera, this.reflector.geometry, reflectorMaterial, this.drawGroup);
      this.uniforms.projection.value.copy(reflectorMaterial.uniforms.textureMatrix.value)
        .multiply(this.inverse.copy(this.reflector.matrixWorld).invert());
      this.uniforms.level.value = level;
      this.uniforms.intensity.value = 0.95;
      this.oldEye.copy(this.eye);
      this.oldAim.copy(this.aim);
      this.refreshedAt = now;
    } finally {
      for (const mesh of restore) mesh.visible = true;
      renderer.xr.enabled = xr;
      renderer.shadowMap.autoUpdate = shadow;
      if (renderer.getRenderTarget() !== target) renderer.setRenderTarget(target);
    }
    return true;
  }

  dispose(): void {
    this.surfaces.clear();
    this.uniforms.intensity.value = 0;
    this.reflector.geometry.dispose();
    this.reflector.dispose();
  }
}
