import { StrokeStore, type Stroke } from '../src/core/strokes';

export function toPts(xy: readonly (readonly [number, number])[], pressure = 0.5): Float32Array {
  const out = new Float32Array(xy.length * 3);
  xy.forEach(([x, y], i) => {
    out[i * 3] = x;
    out[i * 3 + 1] = y;
    out[i * 3 + 2] = pressure;
  });
  return out;
}

export function curve(n: number, f: (t: number) => readonly [number, number]): [number, number][] {
  return Array.from({ length: n }, (_, i) => f(i / (n - 1)) as [number, number]);
}

export function line(x0: number, y0: number, x1: number, y1: number, n = 12): [number, number][] {
  return curve(n, (t) => [x0 + (x1 - x0) * t, y0 + (y1 - y0) * t]);
}

export function makeStroke(store: StrokeStore, xy: readonly (readonly [number, number])[], width = 3): Stroke {
  return store.create({ pts: toPts(xy), width, color: 'graphite', pressure: false });
}
