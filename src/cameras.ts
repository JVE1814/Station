import { Euler, Group, MathUtils, Matrix4, PerspectiveCamera, Quaternion, Spherical, Vector3 } from 'three';

export type View = 'cab' | 'chase' | 'map';

interface ChaseTunnel {
  position: Vector3;
  tangent: Vector3;
  weight: number;
}

export class Cameras {
  readonly camera = new PerspectiveCamera(63, 1, 0.06, 18000);
  view: View = 'cab';
  private readonly destination = new Vector3();
  private readonly previousPosition = new Vector3();
  private readonly previousOrientation = new Quaternion();
  private readonly orientation = new Quaternion();
  private readonly look = new Matrix4();
  private readonly up = new Vector3(0, 1, 0);
  private readonly target = new Vector3();
  private readonly offset = new Vector3();
  private readonly tunnelPosition = new Vector3();
  private readonly rotation = new Euler(0, 0, 0, 'YXZ');
  private mapGround: number | undefined;
  private readonly orbit = new Spherical(24, 1.40, 2.48);
  private readonly mapOffset = new Vector3(0, 530, 0);
  private mapLimit = 14000;
  private cabYaw = 0;
  private cabPitch = -0.095;
  private initialized = false;
  private transition = 0;

  get settled(): boolean {
    return this.transition <= 0;
  }

  select(view: View): void {
    if (this.view === view) return;
    this.view = view;
    this.relocate();
  }

  relocate(): void {
    this.previousPosition.copy(this.camera.position);
    this.previousOrientation.copy(this.camera.quaternion);
    this.transition = 0.72;
  }

  allowMapExtent(height: number): void {
    this.mapLimit = Math.max(this.mapLimit, height);
  }

  fitMap(center: Vector3, source: Vector3, height: number): void {
    this.allowMapExtent(height);
    this.mapOffset.set(center.x - source.x, height, center.z - source.z);
    this.select('map');
    this.relocate();
  }

  get mapHeight(): number {
    return this.mapOffset.y;
  }

  get mapFocus(): Vector3 | undefined {
    return this.view === 'map' && this.mapOffset.y <= 2200 ? this.target : undefined;
  }

  drag(x: number, y: number): void {
    if (this.view === 'cab') {
      this.cabYaw = MathUtils.clamp(this.cabYaw - x * 0.003, -1.05, 1.05);
      this.cabPitch = MathUtils.clamp(this.cabPitch - y * 0.003, -0.7, 0.35);
    } else if (this.view === 'chase') {
      this.orbit.theta -= x * 0.006;
      this.orbit.phi = MathUtils.clamp(this.orbit.phi - y * 0.006, 0.16, 1.52);
    } else {
      this.mapOffset.x -= x * this.mapOffset.y / 500;
      this.mapOffset.z -= y * this.mapOffset.y / 500;
    }
  }

  zoom(delta: number): void {
    if (this.view === 'chase') {
      this.orbit.radius = MathUtils.clamp(this.orbit.radius * Math.exp(delta * 0.001), 11, 105);
    } else if (this.view === 'map') {
      this.mapOffset.y = MathUtils.clamp(this.mapOffset.y * Math.exp(delta * 0.001), 28, this.mapLimit);
    }
  }

  update(cab: Group, eye: Vector3, elapsed: number, groundAt?: (x: number, z: number) => number | undefined,
    tunnel?: ChaseTunnel): void {
    if (this.view === 'cab') {
      this.destination.copy(eye).applyQuaternion(cab.quaternion).add(cab.position);
      this.rotation.set(this.cabPitch, this.cabYaw, 0);
      this.orientation.setFromEuler(this.rotation).premultiply(cab.quaternion);
    } else if (this.view === 'chase') {
      this.target.set(0, 2.0, -4).applyQuaternion(cab.quaternion).add(cab.position);
      this.offset.setFromSpherical(this.orbit).applyQuaternion(cab.quaternion);
      this.destination.copy(this.target).add(this.offset);
      if (tunnel) {
        const lateral = Math.sin(this.orbit.theta) * 1.85;
        const height = 2.3 + Math.cos(this.orbit.phi) * 0.8;
        this.tunnelPosition.set(tunnel.tangent.z * lateral, height, -tunnel.tangent.x * lateral)
          .add(tunnel.position);
        this.destination.lerp(this.tunnelPosition, tunnel.weight);
      }
    } else {
      this.target.copy(cab.position);
      this.target.x += this.mapOffset.x;
      this.target.z += this.mapOffset.z;
      const elevation = groundAt?.(this.target.x, this.target.z) ?? this.target.y;
      this.mapGround ??= this.target.y;
      this.mapGround += (elevation - this.mapGround) * (1 - Math.exp(-elapsed * 8));
      this.target.y = this.mapGround;
      this.destination.copy(this.target);
      this.destination.y += this.mapOffset.y;
      this.destination.z += this.mapOffset.y * 0.22;
    }
    if (this.view !== 'cab') {
      this.look.lookAt(this.destination, this.target, this.up);
      this.orientation.setFromRotationMatrix(this.look);
    }
    this.transition = Math.max(0, this.transition - elapsed);
    const progress = 1 - this.transition / 0.72;
    const blend = this.initialized ? progress * progress * (3 - 2 * progress) : 1;
    const elevation = this.view === 'map' ? this.mapOffset.y : 0;
    const far = Math.max(18000, elevation * 3.4);
    const near = elevation > 6000 ? Math.max(5, elevation / 2600) : 0.06;
    if (this.camera.far !== far || this.camera.near !== near) {
      this.camera.far = far;
      this.camera.near = near;
      this.camera.updateProjectionMatrix();
    }
    this.camera.position.lerpVectors(this.previousPosition, this.destination, blend);
    this.camera.quaternion.slerpQuaternions(this.previousOrientation, this.orientation, blend);
    this.initialized = true;
  }
}
