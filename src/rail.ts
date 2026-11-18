import { Vector3 } from 'three';

export interface RailPoint {
  distance: number;
  east: number;
  height: number;
  north: number;
}

export interface RailPose {
  position: Vector3;
  tangent: Vector3;
  cant: number;
}

export class Rail {
  private readonly points: readonly RailPoint[];
  private readonly tangent: Float32Array;
  private readonly gradientSegments = [0, 0];
  private readonly poseStart = new Vector3();
  private readonly poseEnd = new Vector3();
  private readonly posePrevious = new Vector3();

  constructor(points: readonly RailPoint[]) {
    this.points = points;
    if (
      points.length < 2 ||
      points.some((point, index) => index > 0 && point.distance <= points[index - 1].distance)
    ) {
      throw new Error('A rail alignment requires two or more strictly ordered points');
    }
    this.tangent = new Float32Array(points.length * 2);
    points.forEach((_, index) => {
      const left = points[Math.max(0, index - 1)];
      const right = points[Math.min(points.length - 1, index + 1)];
      const length = right.distance - left.distance;
      this.tangent[index * 2] = (right.east - left.east) / length;
      this.tangent[index * 2 + 1] = (right.north - left.north) / length;
    });
  }

  get length(): number {
    return this.points[this.points.length - 1].distance;
  }

  private segment(distance: number): number {
    let low = 0;
    let high = this.points.length - 1;
    while (high - low > 1) {
      const middle = Math.floor((low + high) / 2);
      if (this.points[middle].distance < distance) low = middle;
      else high = middle;
    }
    return low;
  }

  position(distance: number, target = new Vector3()): Vector3 {
    const low = this.segment(distance);
    const high = low + 1;
    const start = this.points[low];
    const end = this.points[high];
    const span = end.distance - start.distance;
    const t = Math.max(0, Math.min(1, (distance - start.distance) / span));
    const linearEast = start.east + (end.east - start.east) * t;
    const linearNorth = start.north + (end.north - start.north) * t;
    const enter = span * t * (1 - t) ** 2;
    const leave = -span * t * t * (1 - t);
    const blend = t * t * (3 - 2 * t);
    const easedEast = start.east + (end.east - start.east) * blend
      + enter * this.tangent[low * 2] + leave * this.tangent[high * 2];
    const easedNorth = start.north + (end.north - start.north) * blend
      + enter * this.tangent[low * 2 + 1] + leave * this.tangent[high * 2 + 1];
    const driftEast = easedEast - linearEast;
    const driftNorth = easedNorth - linearNorth;
    const drift = Math.hypot(driftEast, driftNorth);
    const blendLimit = drift > 0.35 ? 0.35 / drift : 1;
    return target.set(
      linearEast + blendLimit * driftEast,
      start.height + (end.height - start.height) * t,
      -(linearNorth + blendLimit * driftNorth),
    );
  }

  window(start: number, end: number): Rail {
    const first = Math.max(this.points[0].distance, start);
    const last = Math.min(this.length, end);
    const endpoint = (distance: number): RailPoint => {
      const pose = this.position(distance);
      return { distance, east: pose.x, height: pose.y, north: -pose.z };
    };
    return new Rail([
      endpoint(first),
      ...this.points.filter(point => point.distance > first && point.distance < last),
      endpoint(last),
    ]);
  }

  gradient(distance: number): number {
    const from = Math.max(this.points[0].distance, distance - 2);
    const to = Math.min(this.length, distance + 2);
    if (from >= to) return 0;
    const height = (chainage: number, edge: number) => {
      let index = this.gradientSegments[edge];
      if (chainage < this.points[index].distance || chainage > this.points[index + 1].distance) {
        index = this.segment(chainage);
        this.gradientSegments[edge] = index;
      }
      const a = this.points[index];
      const b = this.points[index + 1];
      return a.height + (b.height - a.height) * (chainage - a.distance) / (b.distance - a.distance);
    };
    return (height(to, 1) - height(from, 0)) / (to - from);
  }

  pose(distance: number, tangentSpan = 3, target?: RailPose): RailPose {
    const position = this.position(distance, target?.position);
    const start = this.position(distance - tangentSpan, this.poseStart);
    const end = this.position(distance + tangentSpan, this.poseEnd);
    const tangent = (target?.tangent ?? new Vector3()).copy(end).sub(start).normalize();
    const previous = this.posePrevious.copy(position).sub(start).normalize();
    const next = end.sub(position).normalize();
    const signedTurn = previous.cross(next).y;
    const cant = Math.max(-0.105, Math.min(0.105, signedTurn * 2.5));
    if (target) {
      target.cant = cant;
      return target;
    }
    return { position, tangent, cant };
  }
}
