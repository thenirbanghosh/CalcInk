import { distSqPointSegment, distSqSegmentSegment, inflateRect, rectsIntersect, type Rect } from './geometry';
import type { Change, Stroke, StrokeStore } from './strokes';

const STRIDE = 3;

export function strokeHitByCapsule(s: Stroke, ax: number, ay: number, bx: number, by: number, r: number): boolean {
  const reach = r + s.width / 2;
  const box: Rect = inflateRect(
    { minX: Math.min(ax, bx), minY: Math.min(ay, by), maxX: Math.max(ax, bx), maxY: Math.max(ay, by) },
    reach,
  );
  if (!rectsIntersect(box, s.bbox)) return false;
  const reach2 = reach * reach;
  const p = s.pts;
  if (p.length === STRIDE) return distSqPointSegment(p[0]!, p[1]!, ax, ay, bx, by) <= reach2;
  for (let i = STRIDE; i < p.length; i += STRIDE) {
    if (distSqSegmentSegment(p[i - STRIDE]!, p[i - STRIDE + 1]!, p[i]!, p[i + 1]!, ax, ay, bx, by) <= reach2) return true;
  }
  return false;
}

export function strokesHitByCapsule(strokes: Iterable<Stroke>, ax: number, ay: number, bx: number, by: number, r: number): Stroke[] {
  const out: Stroke[] = [];
  for (const s of strokes) if (strokeHitByCapsule(s, ax, ay, bx, by, r)) out.push(s);
  return out;
}

function circleCrossings(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, r: number): number[] {
  const dx = bx - ax;
  const dy = by - ay;
  const fx = ax - cx;
  const fy = ay - cy;
  const a = dx * dx + dy * dy;
  if (a === 0) return [];
  const b = 2 * (fx * dx + fy * dy);
  const c = fx * fx + fy * fy - r * r;
  const disc = b * b - 4 * a * c;
  if (disc <= 0) return [];
  const sq = Math.sqrt(disc);
  const out: number[] = [];
  const t1 = (-b - sq) / (2 * a);
  const t2 = (-b + sq) / (2 * a);
  if (t1 > 0 && t1 < 1) out.push(t1);
  if (t2 > 0 && t2 < 1) out.push(t2);
  return out;
}

export function cutWithCircle(pts: Float32Array, cx: number, cy: number, r: number): Float32Array[] | null {
  const r2 = r * r;
  const n = pts.length / STRIDE;
  const inside = (i: number) => {
    const dx = pts[i * STRIDE]! - cx;
    const dy = pts[i * STRIDE + 1]! - cy;
    return dx * dx + dy * dy < r2;
  };

  if (n === 1) return inside(0) ? [] : null;

  let touched = false;
  const pieces: number[][] = [];
  let cur: number[] | null = inside(0) ? null : [pts[0]!, pts[1]!, pts[2]!];
  if (!cur) touched = true;

  for (let i = 1; i < n; i++) {
    const a = (i - 1) * STRIDE;
    const b = i * STRIDE;
    const ax = pts[a]!, ay = pts[a + 1]!, ap = pts[a + 2]!;
    const bx = pts[b]!, by = pts[b + 1]!, bp = pts[b + 2]!;
    const lerp = (t: number) => [ax + (bx - ax) * t, ay + (by - ay) * t, ap + (bp - ap) * t];
    const crossings = circleCrossings(ax, ay, bx, by, cx, cy, r);
    let isIn = cur === null;
    for (const t of crossings) {
      touched = true;
      const q = lerp(t);
      if (isIn) {
        cur = [...q]; // leaving the circle
      } else {
        cur!.push(...q); // entering the circle
        pieces.push(cur!);
        cur = null;
      }
      isIn = !isIn;
    }
    if (inside(i)) {
      touched = true;
      if (cur) {
        pieces.push(cur);
        cur = null;
      }
    } else {
      if (!cur) cur = [];
      cur.push(bx, by, bp);
    }
  }
  if (cur) pieces.push(cur);
  if (!touched) return null;
  return pieces.filter((p) => p.length >= 2 * STRIDE).map((p) => Float32Array.from(p));
}

// one drag of the pixel eraser = one undo step
export class PixelEraseSession {
  private originals = new Map<number, Stroke>();
  private live = new Map<number, Stroke>();

  constructor(private store: StrokeStore) {}

  eraseAt(cx: number, cy: number, radius: number): boolean {
    const removed: Stroke[] = [];
    const added: Stroke[] = [];
    for (const s of this.store.all()) {
      const r = radius + s.width / 2;
      if (!rectsIntersect(inflateRect(s.bbox, r), { minX: cx, minY: cy, maxX: cx, maxY: cy })) continue;
      const pieces = cutWithCircle(s.pts, cx, cy, r);
      if (pieces === null) continue;
      removed.push(s);
      pieces.forEach((pts, k) => {
        added.push(this.store.create({ pts, width: s.width, color: s.color, pressure: s.pressure, seq: s.seq + (k + 1) * 1e-6 }));
      });
    }
    if (removed.length === 0) return false;
    for (const s of removed) {
      if (this.live.has(s.id)) this.live.delete(s.id); // piece created earlier in this same drag
      else this.originals.set(s.id, s);
    }
    for (const s of added) this.live.set(s.id, s);
    this.store.apply({ added, removed });
    return true;
  }

  result(): Change {
    return { removed: [...this.originals.values()], added: [...this.live.values()] };
  }
}
