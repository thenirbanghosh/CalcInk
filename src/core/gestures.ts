import { intersectionArea, pathLength, rectHeight, rectWidth, type Rect } from './geometry';
import type { Stroke } from './strokes';

export function resample(pts: Float32Array, step: number, stride = 3): number[] {
  const out: number[] = [pts[0]!, pts[1]!];
  let px = pts[0]!;
  let py = pts[1]!;
  let carry = 0;
  for (let i = stride; i < pts.length; i += stride) {
    const x = pts[i]!;
    const y = pts[i + 1]!;
    let seg = Math.hypot(x - px, y - py);
    let sx = px;
    let sy = py;
    while (carry + seg >= step) {
      const t = (step - carry) / seg;
      sx += (x - sx) * t;
      sy += (y - sy) * t;
      out.push(sx, sy);
      seg = Math.hypot(x - sx, y - sy);
      carry = 0;
    }
    carry += seg;
    px = x;
    py = y;
  }
  return out;
}

export function countCusps(pts: Float32Array, stride = 3): number {
  const diag = Math.hypot(...bboxSize(pts, stride));
  if (diag === 0) return 0;
  const r = resample(pts, diag / 48, stride);
  const n = r.length / 2;
  const k = 2; // window, helps with jitter
  let cusps = 0;
  let lastCusp = -Infinity;
  for (let i = k; i < n - k; i++) {
    const ax = r[2 * i]! - r[2 * (i - k)]!;
    const ay = r[2 * i + 1]! - r[2 * (i - k) + 1]!;
    const bx = r[2 * (i + k)]! - r[2 * i]!;
    const by = r[2 * (i + k) + 1]! - r[2 * i + 1]!;
    const cos = (ax * bx + ay * by) / (Math.hypot(ax, ay) * Math.hypot(bx, by) || 1);
    if (cos < -0.42 && i - lastCusp > 2 * k) {
      cusps++;
      lastCusp = i;
    }
  }
  return cusps;
}

function bboxSize(pts: Float32Array, stride: number): [number, number] {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < pts.length; i += stride) {
    minX = Math.min(minX, pts[i]!);
    maxX = Math.max(maxX, pts[i]!);
    minY = Math.min(minY, pts[i + 1]!);
    maxY = Math.max(maxY, pts[i + 1]!);
  }
  return [maxX - minX, maxY - minY];
}

export function looksLikeScratch(stroke: Stroke): boolean {
  const w = rectWidth(stroke.bbox);
  const h = rectHeight(stroke.bbox);
  const size = Math.max(w, h);
  if (size < 12 || stroke.pts.length < 30) return false;
  const len = pathLength(stroke.pts);
  return countCusps(stroke.pts) >= 4 && len > 3.2 * size;
}

export function scratchTargets(scratch: Stroke, candidates: Iterable<Stroke>): Stroke[] {
  if (!looksLikeScratch(scratch)) return [];
  const area: Rect = scratch.bbox;
  const out: Stroke[] = [];
  for (const s of candidates) {
    if (s.id === scratch.id) continue;
    const own = Math.max(1, rectWidth(s.bbox)) * Math.max(1, rectHeight(s.bbox));
    const pad = s.width;
    const box = { minX: s.bbox.minX - pad, minY: s.bbox.minY - pad, maxX: s.bbox.maxX + pad, maxY: s.bbox.maxY + pad };
    if (intersectionArea(area, box) / Math.max(own, (rectWidth(box) * rectHeight(box))) >= 0.45) out.push(s);
  }
  return out;
}
