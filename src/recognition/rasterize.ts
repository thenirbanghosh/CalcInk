import { CROP_MARGIN, INPUT_SIZE, RASTER_STROKE_WIDTH } from './model';

export interface InkLike {
  pts: Float32Array;
}

export interface RasterOptions {
  size?: number;
  strokeWidth?: number;
  margin?: number;
  centerOfMass?: boolean;
}

export function rasterizeSymbol(
  strokes: readonly InkLike[],
  out: Float32Array,
  opts: RasterOptions = {},
): { scale: number; offsetX: number; offsetY: number } {
  const size = opts.size ?? INPUT_SIZE;
  const lw = opts.strokeWidth ?? RASTER_STROKE_WIDTH;
  const margin = opts.margin ?? CROP_MARGIN;
  out.fill(0, 0, size * size);

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const s of strokes) {
    const p = s.pts;
    for (let i = 0; i < p.length; i += 3) {
      if (p[i]! < minX) minX = p[i]!;
      if (p[i]! > maxX) maxX = p[i]!;
      if (p[i + 1]! < minY) minY = p[i + 1]!;
      if (p[i + 1]! > maxY) maxY = p[i + 1]!;
    }
  }
  if (!Number.isFinite(minX)) return { scale: 1, offsetX: 0, offsetY: 0 };

  // same as the training code: crop to the ink and pad to a square with a 15% margin
  const span = size / (1 + 2 * margin);
  const extent = Math.max(maxX - minX, maxY - minY);
  const scale = extent > 1e-6 ? Math.max(0, span - lw) / extent : 0;
  let offsetX = size / 2 - ((minX + maxX) / 2) * scale;
  let offsetY = size / 2 - ((minY + maxY) / 2) * scale;
  // MNIST digits are centered by center of mass, not by bounding box
  if (opts.centerOfMass) {
    drawAll(strokes, out, size, scale, offsetX, offsetY, lw / 2);
    let m = 0, mx = 0, my = 0;
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const v = out[y * size + x]!;
        m += v;
        mx += v * (x + 0.5);
        my += v * (y + 0.5);
      }
    if (m > 0) {
      offsetX += size / 2 - mx / m;
      offsetY += size / 2 - my / m;
    }
    out.fill(0, 0, size * size);
  }
  drawAll(strokes, out, size, scale, offsetX, offsetY, lw / 2);
  return { scale, offsetX, offsetY };
}

function drawAll(strokes: readonly InkLike[], out: Float32Array, size: number, scale: number, offsetX: number, offsetY: number, r: number): void {
  for (const s of strokes) {
    const p = s.pts;
    const n = p.length / 3;
    if (n === 1) {
      drawCapsule(out, size, p[0]! * scale + offsetX, p[1]! * scale + offsetY, p[0]! * scale + offsetX, p[1]! * scale + offsetY, r);
      continue;
    }
    for (let i = 1; i < n; i++) {
      drawCapsule(
        out, size,
        p[(i - 1) * 3]! * scale + offsetX, p[(i - 1) * 3 + 1]! * scale + offsetY,
        p[i * 3]! * scale + offsetX, p[i * 3 + 1]! * scale + offsetY,
        r,
      );
    }
  }
}

function drawCapsule(img: Float32Array, size: number, ax: number, ay: number, bx: number, by: number, r: number): void {
  const x0 = Math.max(0, Math.floor(Math.min(ax, bx) - r - 1));
  const x1 = Math.min(size - 1, Math.ceil(Math.max(ax, bx) + r + 1));
  const y0 = Math.max(0, Math.floor(Math.min(ay, by) - r - 1));
  const y1 = Math.min(size - 1, Math.ceil(Math.max(ay, by) + r + 1));
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  for (let y = y0; y <= y1; y++) {
    const py = y + 0.5;
    for (let x = x0; x <= x1; x++) {
      const px = x + 0.5;
      let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const ex = ax + t * dx - px;
      const ey = ay + t * dy - py;
      const d = Math.sqrt(ex * ex + ey * ey);
      const v = r + 0.5 - d;
      if (v <= 0) continue;
      const c = v >= 1 ? 1 : v;
      const idx = y * size + x;
      if (c > img[idx]!) img[idx] = c;
    }
  }
}
