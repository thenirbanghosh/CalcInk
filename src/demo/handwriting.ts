import type { Sym } from '../math/tokens';

type Path = (t: number) => [number, number];
interface Glyph {
  paths: { f: Path; n: number }[];
  w: number;
  place: 'digit' | 'mid' | 'base';
  h: number;
}

const TAU = Math.PI * 2;
const lin = (x0: number, y0: number, x1: number, y1: number): Path => (t) => [x0 + (x1 - x0) * t, y0 + (y1 - y0) * t];
const poly = (...p: [number, number][]): Path => {
  const lens = p.slice(1).map((q, i) => Math.hypot(q[0] - p[i]![0], q[1] - p[i]![1]));
  const total = lens.reduce((a, b) => a + b, 0);
  return (t) => {
    let d = t * total;
    for (let i = 0; i < lens.length; i++) {
      if (d <= lens[i]! || i === lens.length - 1) {
        const u = lens[i]! > 0 ? Math.min(1, d / lens[i]!) : 0;
        return [p[i]![0] + (p[i + 1]![0] - p[i]![0]) * u, p[i]![1] + (p[i + 1]![1] - p[i]![1]) * u];
      }
      d -= lens[i]!;
    }
    return p[p.length - 1]!;
  };
};
const dot = (cx: number, cy: number, rx: number, ry: number): Path => (t) => [cx + rx * Math.cos(TAU * t), cy + ry * Math.sin(TAU * t)];
const seq = (parts: [Path, number][]): Path => {
  const total = parts.reduce((a, [, w]) => a + w, 0);
  return (t) => {
    let d = t * total;
    for (let i = 0; i < parts.length; i++) {
      const [f, w] = parts[i]!;
      if (d <= w || i === parts.length - 1) return f(Math.min(1, d / w));
      d -= w;
    }
    return parts[parts.length - 1]![0](1);
  };
};
const arc = (cx: number, cy: number, rx: number, ry: number, a0: number, a1: number): Path => (t) => {
  const a = a0 + (a1 - a0) * t;
  return [cx + rx * Math.cos(a), cy + ry * Math.sin(a)];
};

const G: Record<Sym, Glyph> = {
  '0': { w: 0.62, h: 1, place: 'digit', paths: [{ n: 48, f: arc(0.31, 0.5, 0.29, 0.49, -Math.PI / 2 - 0.2, -Math.PI / 2 - TAU - 0.05) }] },
  '1': { w: 0.34, h: 1, place: 'digit', paths: [{ n: 26, f: poly([0.05, 0.22], [0.26, 0.0], [0.24, 1.0]) }] },
  '2': {
    w: 0.62, h: 1, place: 'digit',
    paths: [{ n: 48, f: seq([[arc(0.31, 0.3, 0.28, 0.28, Math.PI * 1.08, Math.PI * 2.15), 2.2], [lin(0.55, 0.45, 0.02, 0.98), 1.6], [lin(0.02, 0.98, 0.62, 0.97), 1]]) }],
  },
  '3': {
    w: 0.58, h: 1, place: 'digit',
    paths: [{ n: 52, f: seq([[arc(0.28, 0.25, 0.27, 0.23, Math.PI * 1.15, Math.PI * 2.5), 1], [arc(0.26, 0.73, 0.3, 0.26, -Math.PI * 0.5, Math.PI * 0.85), 1.2]]) }],
  },
  '4': {
    w: 0.64, h: 1, place: 'digit',
    paths: [
      { n: 30, f: poly([0.42, 0.0], [0.02, 0.66], [0.64, 0.66]) },
      { n: 22, f: lin(0.46, 0.18, 0.47, 1.0) },
    ],
  },
  '5': {
    w: 0.6, h: 1, place: 'digit',
    paths: [
      { n: 44, f: seq([[lin(0.1, 0.02, 0.06, 0.46), 1], [arc(0.28, 0.7, 0.3, 0.28, -Math.PI * 0.75, Math.PI * 0.8), 2.4]]) },
      { n: 14, f: lin(0.1, 0.02, 0.58, 0.0) },
    ],
  },
  '6': {
    w: 0.6, h: 1, place: 'digit',
    paths: [{ n: 50, f: seq([[arc(0.62, 0.62, 0.58, 0.62, -Math.PI * 0.62, -Math.PI * 1.0), 1.2], [arc(0.31, 0.72, 0.28, 0.27, Math.PI, Math.PI * 3.05), 2]]) }],
  },
  '7': { w: 0.6, h: 1, place: 'digit', paths: [{ n: 32, f: poly([0.02, 0.03], [0.6, 0.0], [0.2, 1.0]) }] },
  '8': {
    w: 0.58, h: 1, place: 'digit',
    paths: [{ n: 64, f: (t) => [0.29 + 0.27 * Math.sin(TAU * t * 1.0 * 2) * (t < 0.5 ? 0.85 : 1), 0.5 - 0.5 * Math.cos(TAU * t)] }],
  },
  '9': {
    w: 0.6, h: 1, place: 'digit',
    paths: [{ n: 48, f: seq([[arc(0.3, 0.28, 0.27, 0.27, 0.05, -TAU + 0.05), 2], [lin(0.57, 0.3, 0.5, 1.0), 1]]) }],
  },
  '+': { w: 0.6, h: 0.6, place: 'mid', paths: [{ n: 14, f: lin(0.0, 0.5, 0.6, 0.52) }, { n: 14, f: lin(0.31, 0.0, 0.29, 1.0) }] },
  '-': { w: 0.56, h: 0.1, place: 'mid', paths: [{ n: 14, f: lin(0.0, 0.5, 0.56, 0.48) }] },
  '×': { w: 0.56, h: 0.56, place: 'mid', paths: [{ n: 14, f: lin(0.0, 0.0, 0.56, 1.0) }, { n: 14, f: lin(0.56, 0.0, 0.0, 1.0) }] },
  '÷': {
    w: 0.58, h: 0.62, place: 'mid',
    paths: [{ n: 14, f: lin(0.0, 0.5, 0.58, 0.5) }, { n: 8, f: dot(0.29, 0.08, 0.03, 0.05) }, { n: 8, f: dot(0.29, 0.92, 0.03, 0.05) }],
  },
  '=': { w: 0.58, h: 0.34, place: 'mid', paths: [{ n: 14, f: lin(0.0, 0.0, 0.58, 0.02) }, { n: 14, f: lin(0.02, 1.0, 0.58, 0.98) }] },
  '.': { w: 0.08, h: 0.08, place: 'base', paths: [{ n: 7, f: dot(0.04, 0.5, 0.03, 0.4) }] },
};

export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface SynthStroke {
  pts: Float32Array;
  symbol: number;
}

export interface WriteOptions {
  x?: number;
  y?: number;
  size?: number;
  seed?: number;
  messiness?: number;
}

export function writeExpression(text: readonly Sym[] | string, opts: WriteOptions = {}): SynthStroke[] {
  const syms = [...text] as Sym[];
  const H = opts.size ?? 48;
  const rand = rng(opts.seed ?? 7);
  const mess = opts.messiness ?? 0.5;
  const j = (amp: number) => (rand() * 2 - 1) * amp * mess;
  let cursor = opts.x ?? 0;
  const top = opts.y ?? 0;
  const out: SynthStroke[] = [];

  syms.forEach((s, idx) => {
    const g = G[s];
    if (!g) throw new Error(`no glyph for ${s}`);
    const scale = H * (1 + j(0.08));
    const slant = j(0.12);
    const gw = g.w * scale;
    const gh = g.h * scale;
    const boxTop = g.place === 'digit' ? top + j(0.04) * H : g.place === 'mid' ? top + H / 2 - gh / 2 + j(0.05) * H : top + H - gh;
    const originX = cursor + (s === '.' ? 0.05 * H : 0);
    for (const { f, n } of g.paths) {
      const pts = new Float32Array(n * 3);
      const wob = j(0.015) * H;
      for (let i = 0; i < n; i++) {
        const t = i / (n - 1);
        const [ux, uy] = f(t);
        const y = boxTop + uy * gh;
        const x = originX + ux * scale + slant * (boxTop + gh - y) + wob * Math.sin(t * 7 + idx);
        pts[i * 3] = x + j(0.006) * H;
        pts[i * 3 + 1] = y + j(0.006) * H;
        pts[i * 3 + 2] = 0.45 + 0.2 * Math.sin(Math.PI * t);
      }
      out.push({ pts, symbol: idx });
    }
    cursor = originX + gw + H * (0.2 + j(0.06)) + (s === '.' ? 0.05 * H : 0);
  });
  return out;
}
