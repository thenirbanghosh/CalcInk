import type { Point, Rect } from './geometry';

export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 4;

// screen = world * zoom + pan, device px = screen * dpr
export class Viewport {
  constructor(
    public panX = 0,
    public panY = 0,
    public zoom = 1,
  ) {}

  toWorld(sx: number, sy: number): Point {
    return { x: (sx - this.panX) / this.zoom, y: (sy - this.panY) / this.zoom };
  }

  toScreen(wx: number, wy: number): Point {
    return { x: wx * this.zoom + this.panX, y: wy * this.zoom + this.panY };
  }

  panBy(dx: number, dy: number): void {
    this.panX += dx;
    this.panY += dy;
  }

  zoomAt(sx: number, sy: number, factor: number): void {
    const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, this.zoom * factor));
    const w = this.toWorld(sx, sy);
    this.zoom = next;
    this.panX = sx - w.x * next;
    this.panY = sy - w.y * next;
  }

  visibleWorld(cssWidth: number, cssHeight: number): Rect {
    const a = this.toWorld(0, 0);
    const b = this.toWorld(cssWidth, cssHeight);
    return { minX: a.x, minY: a.y, maxX: b.x, maxY: b.y };
  }

  deviceTransform(dpr: number): [number, number, number, number, number, number] {
    const s = this.zoom * dpr;
    return [s, 0, 0, s, this.panX * dpr, this.panY * dpr];
  }

  reset(): void {
    this.panX = 0;
    this.panY = 0;
    this.zoom = 1;
  }
}

export function backingStoreSize(
  cssWidth: number,
  cssHeight: number,
  dpr: number,
  exactDevice?: { inlineSize: number; blockSize: number },
): { width: number; height: number } {
  const width = Math.max(1, Math.round(cssWidth * dpr));
  const height = Math.max(1, Math.round(cssHeight * dpr));
  // devicePixelContentBoxSize is wrong under DPR emulation, only trust it if it matches
  if (exactDevice && Math.abs(exactDevice.inlineSize - width) <= 2 && Math.abs(exactDevice.blockSize - height) <= 2) {
    return { width: exactDevice.inlineSize, height: exactDevice.blockSize };
  }
  return { width, height };
}

export function clientToScreen(clientX: number, clientY: number, canvasRect: { left: number; top: number }): Point {
  return { x: clientX - canvasRect.left, y: clientY - canvasRect.top };
}
