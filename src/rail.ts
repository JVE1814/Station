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

  constructor(points: readonly RailPoint[]) {
    this.points = points;
    if (
      points.length < 2 ||
      points.some((point, index) => index > 0 && point.distance <= points[index - 1].distance)
    ) {
      throw new Error('A rail alignment requires two or more strictly ordered points');
    }
  }

  get length(): number {
    return this.points[this.points.length - 1].distance;
  }

  position(distance: number, target = new Vector3()): Vector3 {
    let low = 0;
    let high = this.points.length - 1;
    while (high - low > 1) {
      const middle = Math.floor((low + high) / 2);
      if (this.points[middle].distance < distance) low = middle;
      else high = middle;
    }

    const start = this.points[low];
    const end = this.points[high];
    const fraction = Math.max(0, Math.min(1, (distance - start.distance) / (end.distance - start.distance)));
    return target.set(
      start.east + (end.east - start.east) * fraction,
      start.height + (end.height - start.height) * fraction,
      -(start.north + (end.north - start.north) * fraction),
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
    const start = this.position(distance - 2);
    const end = this.position(distance + 2);
    const horizontal = Math.hypot(end.x - start.x, end.z - start.z);
    return horizontal === 0 ? 0 : (end.y - start.y) / horizontal;
  }

  pose(distance: number, tangentSpan = 3): RailPose {
    const position = this.position(distance);
    const start = this.position(distance - tangentSpan);
    const end = this.position(distance + tangentSpan);
    const tangent = end.clone().sub(start).normalize();
    const previous = position.clone().sub(start).normalize();
    const next = end.sub(position).normalize();
    const signedTurn = previous.cross(next).y;
    const cant = Math.max(-0.105, Math.min(0.105, signedTurn * 2.5));
    return { position, tangent, cant };
  }
}
