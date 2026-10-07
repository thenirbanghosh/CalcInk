import { getStroke, type StrokeOptions } from 'perfect-freehand';
import type { Stroke } from '../core/strokes';

export function inkOptions(width: number, realPressure: boolean, complete: boolean): StrokeOptions {
  return {
    size: width,
    thinning: realPressure ? 0.62 : 0.5,
    smoothing: 0.52,
    streamline: 0.38,
    simulatePressure: !realPressure,
    last: complete,
    start: { taper: 0, cap: true },
    end: { taper: complete ? width * 1.2 : 0, cap: true },
  };
}

export function toInputPoints(pts: Float32Array | readonly number[], extra?: readonly number[]): number[][] {
  const out: number[][] = [];
  for (let i = 0; i < pts.length; i += 3) out.push([pts[i]!, pts[i + 1]!, pts[i + 2]!]);
  if (extra) for (let i = 0; i < extra.length; i += 3) out.push([extra[i]!, extra[i + 1]!, extra[i + 2]!]);
  return out;
}

export function outlinePath(outline: number[][]): Path2D {
  const path = new Path2D();
  const n = outline.length;
  if (n === 0) return path;
  if (n < 3) {
    const [x, y] = outline[0]!;
    path.arc(x!, y!, 0.5, 0, Math.PI * 2);
    return path;
  }
  const [x0, y0] = outline[0]!;
  const [x1, y1] = outline[1]!;
  path.moveTo((x0! + x1!) / 2, (y0! + y1!) / 2);
  for (let i = 1; i < n; i++) {
    const [ax, ay] = outline[i]!;
    const [bx, by] = outline[(i + 1) % n]!;
    path.quadraticCurveTo(ax!, ay!, (ax! + bx!) / 2, (ay! + by!) / 2);
  }
  path.closePath();
  return path;
}

export function strokePath(pts: Float32Array | readonly number[], width: number, realPressure: boolean, complete: boolean, extra?: readonly number[]): Path2D {
  return outlinePath(getStroke(toInputPoints(pts, extra), inkOptions(width, realPressure, complete)));
}

export class PathCache {
  private paths = new Map<number, Path2D>();

  get(s: Stroke): Path2D {
    let p = this.paths.get(s.id);
    if (!p) {
      p = strokePath(s.pts, s.width, s.pressure, true);
      this.paths.set(s.id, p);
    }
    return p;
  }

  transient(s: Stroke): Path2D {
    return this.paths.get(s.id) ?? strokePath(s.pts, s.width, s.pressure, true);
  }

  delete(id: number): void {
    this.paths.delete(id);
  }

  clear(): void {
    this.paths.clear();
  }

  get size(): number {
    return this.paths.size;
  }
}
