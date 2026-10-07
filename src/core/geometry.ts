export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export const emptyRect = (): Rect => ({ minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });

export const rectWidth = (r: Rect) => r.maxX - r.minX;
export const rectHeight = (r: Rect) => r.maxY - r.minY;
export const rectCenterX = (r: Rect) => (r.minX + r.maxX) / 2;
export const rectCenterY = (r: Rect) => (r.minY + r.maxY) / 2;

export function unionRect(a: Rect, b: Rect): Rect {
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
}

export function inflateRect(r: Rect, by: number): Rect {
  return { minX: r.minX - by, minY: r.minY - by, maxX: r.maxX + by, maxY: r.maxY + by };
}

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.minX <= b.maxX && b.minX <= a.maxX && a.minY <= b.maxY && b.minY <= a.maxY;
}

export function intersectionArea(a: Rect, b: Rect): number {
  const w = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX);
  const h = Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY);
  return w > 0 && h > 0 ? w * h : 0;
}

export function overlap1D(a0: number, a1: number, b0: number, b1: number): number {
  return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
}

export function boundsOf(pts: Float32Array, stride = 3): Rect {
  const r = emptyRect();
  for (let i = 0; i < pts.length; i += stride) {
    const x = pts[i]!;
    const y = pts[i + 1]!;
    if (x < r.minX) r.minX = x;
    if (x > r.maxX) r.maxX = x;
    if (y < r.minY) r.minY = y;
    if (y > r.maxY) r.maxY = y;
  }
  return r;
}

export function distSqPointSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const cx = ax + t * dx - px;
  const cy = ay + t * dy - py;
  return cx * cx + cy * cy;
}

function orient(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number {
  return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}

export function segmentsIntersect(
  ax: number, ay: number, bx: number, by: number,
  cx: number, cy: number, dx: number, dy: number,
): boolean {
  const d1 = orient(cx, cy, dx, dy, ax, ay);
  const d2 = orient(cx, cy, dx, dy, bx, by);
  const d3 = orient(ax, ay, bx, by, cx, cy);
  const d4 = orient(ax, ay, bx, by, dx, dy);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

export function distSqSegmentSegment(
  ax: number, ay: number, bx: number, by: number,
  cx: number, cy: number, dx: number, dy: number,
): number {
  if (segmentsIntersect(ax, ay, bx, by, cx, cy, dx, dy)) return 0;
  return Math.min(
    distSqPointSegment(ax, ay, cx, cy, dx, dy),
    distSqPointSegment(bx, by, cx, cy, dx, dy),
    distSqPointSegment(cx, cy, ax, ay, bx, by),
    distSqPointSegment(dx, dy, ax, ay, bx, by),
  );
}

export function pathLength(pts: Float32Array, stride = 3): number {
  let len = 0;
  for (let i = stride; i < pts.length; i += stride) {
    len += Math.hypot(pts[i]! - pts[i - stride]!, pts[i + 1]! - pts[i + 1 - stride]!);
  }
  return len;
}
