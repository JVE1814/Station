import { ShapeUtils, Vector2 } from 'three';
import type { LocalPoint } from './world-data.ts';

export interface GabledRoof {
  faces: LocalPoint[][];
  rim: LocalPoint[];
  heightAt(point: LocalPoint): number;
  uvAt(point: LocalPoint): [number, number];
}

export function gabledRoof(outline: LocalPoint[], rise: number, across = false): GabledRoof | undefined {
  if (outline.length < 3 || rise <= 0) return;
  let length = 0;
  let ridge: LocalPoint = [0, 0];
  for (let index = 0; index < outline.length; index++) {
    const a = outline[index];
    const b = outline[(index + 1) % outline.length];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const next = Math.hypot(dx, dy);
    if (next <= length) continue;
    length = next;
    ridge = across ? [-dy / next, dx / next] : [dx / next, dy / next];
  }
  if (length < 1) return;

  const projection = ([x, y]: LocalPoint) => x * -ridge[1] + y * ridge[0];
  const ordinates = outline.map(projection);
  const left = Math.min(...ordinates);
  const right = Math.max(...ordinates);
  const spread = (right - left) * 0.5;
  if (spread < 0.5) return;
  const center = left + spread;
  const distance = (point: LocalPoint) => projection(point) - center;
  const heightAt = (point: LocalPoint) => Math.max(0, rise * (1 - Math.abs(distance(point)) / spread));
  const intersection = (a: LocalPoint, b: LocalPoint) => {
    const t = distance(a) / (distance(a) - distance(b));
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t] as LocalPoint;
  };

  const faces: LocalPoint[][] = [];
  const triangles = ShapeUtils.triangulateShape(outline.map(([x, y]) => new Vector2(x, y)), []);
  for (const face of triangles) {
    const triangle = face.map(index => outline[index]);
    if (triangle.every(point => distance(point) >= 0) || triangle.every(point => distance(point) <= 0)) {
      faces.push(triangle);
      continue;
    }
    for (const side of [-1, 1]) {
      const section: LocalPoint[] = [];
      for (let index = 0; index < triangle.length; index++) {
        const a = triangle[index];
        const b = triangle[(index + 1) % triangle.length];
        if (distance(a) * side >= 0) section.push(a);
        if (distance(a) * distance(b) < 0) section.push(intersection(a, b));
      }
      if (section.length >= 3) faces.push(section);
    }
  }

  const rim: LocalPoint[] = [];
  for (let index = 0; index < outline.length; index++) {
    const a = outline[index];
    const b = outline[(index + 1) % outline.length];
    rim.push(a);
    if (distance(a) * distance(b) < 0) rim.push(intersection(a, b));
  }

  const uvAt = ([x, y]: LocalPoint): [number, number] => [x * ridge[0] + y * ridge[1], projection([x, y])];
  return { faces, rim, heightAt, uvAt };
}
