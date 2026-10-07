import { ALL_SYMBOLS, type Sym } from '../math/tokens';
import { finalCost, G, next, STATE_COUNT, transitionCost } from './grammar';
import type { Candidate, Line } from './segment';
import type { Rect } from '../core/geometry';

export interface LabelProb {
  label: Sym;
  p: number;
}

export interface DecodedSymbol {
  label: Sym;
  confidence: number;
  alternatives: LabelProb[];
  strokeIds: number[];
  bbox: Rect;
  key: string;
}

export const groupKey = (c: Candidate) => c.strokes.map((s) => s.id).sort((a, b) => a - b).join(',');

const FLOOR = 1e-5;
const TOP_K = 5;

export function labelDistribution(
  modelProbs: ArrayLike<number>,
  modelLabels: readonly Sym[],
  dotLike: boolean,
  temperature = 1,
  layout?: Layout,
  bars = false,
): LabelProb[] {
  const raw = new Map<Sym, number>();
  let sum = 0;
  for (let i = 0; i < modelLabels.length; i++) {
    const v = Math.pow(Math.max(modelProbs[i]!, 1e-12), 1 / temperature);
    raw.set(modelLabels[i]!, v);
    sum += v;
  }
  // decimal point comes from size, the CNN can't see that a dot is small after resizing
  const dotP = dotLike ? (layout && layout.rc < 0.55 ? 0.6 : 0.97) : 1e-4;
  const out: LabelProb[] = ALL_SYMBOLS.map((label) => ({
    label,
    p: label === '.' ? dotP : ((raw.get(label) ?? 0) / sum) * (1 - dotP) * (layout ? layoutPrior(label, layout) : 1),
  }));
  let z = out.reduce((a, b) => a + b.p, 0);
  for (const o of out) o.p /= z;
  if (bars) {
    for (const o of out) o.p = 0.25 * o.p + (o.label === '=' ? 0.75 : 0);
    z = out.reduce((a, b) => a + b.p, 0);
    for (const o of out) o.p /= z;
  }
  return out.sort((a, b) => b.p - a.p);
}

export interface Layout {
  hr: number;
  rc: number;
}

const soft = (excess: number, sigma: number) => (excess <= 0 ? 1 : Math.exp(-((excess / sigma) ** 2)));

// digits should be about full height, operators sit around the middle of the line
export function layoutPrior(label: Sym, { hr, rc }: Layout): number {
  if (label >= '0' && label <= '9') return soft(0.62 - hr, 0.08);
  if (label === '.') return 1;
  const off = Math.abs(rc - 0.5);
  return (label === '-' ? soft(off - 0.28, 0.1) : soft(off - 0.36, 0.14)) * (label === '-' || label === '=' ? 1 : soft(hr - 1.05, 0.2));
}

export interface DecodeInput {
  line: Line;
  cands: Candidate[];
  dists: LabelProb[][];
  pair: (i: number, j: number) => number;
}

// viterbi over (strokes used so far, grammar state). picks grouping + labels together
export function decodeLine({ line, cands, dists, pair }: DecodeInput): DecodedSymbol[] {
  const n = line.strokes.length;
  if (n === 0) return [];
  const S = STATE_COUNT;
  const best = new Float64Array((n + 1) * S).fill(-Infinity);
  const back: Array<{ prevState: number; cand: number; label: number } | undefined> = new Array((n + 1) * S);
  best[0 * S + G.Start] = 0;

  const byStart: number[][] = Array.from({ length: n }, () => []);
  cands.forEach((c, k) => byStart[c.start]!.push(k));

  const boundary = cands.map((c) => {
    let cost = 0;
    for (let a = Math.max(0, c.start - 3); a < c.start; a++)
      for (let b = c.start; b < c.end; b++) {
        const p = pair(a, b);
        if (p > 0) cost += Math.log(1 - Math.min(p, 0.98));
      }
    return cost;
  });

  for (let i = 0; i < n; i++) {
    for (let st = 0; st < S; st++) {
      const base = best[i * S + st]!;
      if (base === -Infinity) continue;
      for (const k of byStart[i]!) {
        const c = cands[k]!;
        const dist = dists[k]!;
        const pre = base + c.logMerge + boundary[k]!;
        for (let li = 0; li < Math.min(TOP_K, dist.length); li++) {
          const { label, p } = dist[li]!;
          const ns = next(st as G, label);
          const g = transitionCost(st as G, label, ns);
          const score = pre + Math.log(Math.max(p, FLOOR)) + g;
          const idx = c.end * S + ns;
          if (score > best[idx]!) {
            best[idx] = score;
            back[idx] = { prevState: st, cand: k, label: li };
          }
        }
      }
    }
  }

  let endState = -1;
  let endScore = -Infinity;
  for (let st = 0; st < S; st++) {
    const v = best[n * S + st]! + finalCost(st as G);
    if (v > endScore) {
      endScore = v;
      endState = st;
    }
  }
  if (endState < 0) return [];

  const out: DecodedSymbol[] = [];
  let pos = n;
  let st = endState;
  while (pos > 0) {
    const b = back[pos * S + st];
    if (!b) break;
    const c = cands[b.cand]!;
    const dist = dists[b.cand]!;
    const chosen = dist[b.label]!;
    out.push({
      label: chosen.label,
      confidence: chosen.p,
      alternatives: dist.slice(0, 4),
      strokeIds: c.strokes.map((s) => s.id),
      bbox: c.bbox,
      key: groupKey(c),
    });
    pos = c.start;
    st = b.prevState;
  }
  return out.reverse();
}
