import { distSqSegmentSegment, overlap1D, segmentsIntersect, rectCenterX, rectCenterY, rectHeight, rectWidth, unionRect, type Rect } from '../core/geometry';

export interface SegStroke {
  id: number;
  seq: number;
  pts: Float32Array;
  width: number;
  bbox: Rect;
}

export interface Line {
  strokes: SegStroke[]; // sorted by minX
  bbox: Rect;
  unit: number;
  band: { top: number; bottom: number } | null;
}

export interface Candidate {
  start: number;
  end: number;
  strokes: SegStroke[];
  bbox: Rect;
  logMerge: number;
  dotLike: boolean;
  bars: boolean;
}

const median = (xs: number[]): number => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

export function estimateUnit(strokes: readonly SegStroke[]): number {
  if (strokes.length === 0) return 40;
  const ext = strokes.map((s) => Math.max(rectHeight(s.bbox), 0));
  const hi = [...ext].sort((a, b) => a - b)[Math.floor(ext.length * 0.9)] ?? 0;
  const tall = ext.filter((h) => h >= 0.45 * hi && h > 0);
  const u = median(tall);
  const penFloor = 6 * median(strokes.map((s) => s.width));
  return Math.max(u, penFloor, 8);
}

class UnionFind {
  private p: number[];
  constructor(n: number) {
    this.p = Array.from({ length: n }, (_, i) => i);
  }
  find(i: number): number {
    while (this.p[i] !== i) i = this.p[i] = this.p[this.p[i]!]!;
    return i;
  }
  union(a: number, b: number): void {
    this.p[this.find(a)] = this.find(b);
  }
}

function groupBy<T>(items: readonly T[], uf: UnionFind): T[][] {
  const m = new Map<number, T[]>();
  items.forEach((s, i) => {
    const r = uf.find(i);
    const g = m.get(r);
    if (g) g.push(s);
    else m.set(r, [s]);
  });
  return [...m.values()];
}

const hGapOf = (a: Rect, b: Rect) => Math.max(0, Math.max(a.minX, b.minX) - Math.min(a.maxX, b.maxX));
const vGapOf = (a: Rect, b: Rect) => Math.max(0, Math.max(a.minY, b.minY) - Math.min(a.maxY, b.maxY));

export function findLines(strokes: readonly SegStroke[]): Line[] {
  if (strokes.length === 0) return [];
  const pen = median(strokes.map((s) => s.width));
  const n = strokes.length;
  const h = strokes.map((s) => rectHeight(s.bbox));
  const w = strokes.map((s) => rectWidth(s.bbox));

  const order = [...strokes.keys()].sort((a, b) => strokes[a]!.bbox.minY - strokes[b]!.bbox.minY);
  const localMax = h.slice();
  for (let x = 0; x < n; x++) {
    const i = order[x]!;
    const a = strokes[i]!.bbox;
    for (let y = x + 1; y < n; y++) {
      const j = order[y]!;
      const b = strokes[j]!.bbox;
      if (b.minY > a.maxY) break;
      const reach = 3 * Math.max(h[i]!, h[j]!, 4 * pen);
      if (hGapOf(a, b) > reach) continue;
      localMax[i] = Math.max(localMax[i]!, h[j]!);
      localMax[j] = Math.max(localMax[j]!, h[i]!);
    }
  }
  // anchors = tall upright strokes (digits, the vertical bar of +), compared to what's next to them
  const anchor = strokes.map((_, i) => h[i]! >= 0.5 * w[i]! && h[i]! >= 0.4 * localMax[i]! && h[i]! > 3 * pen);

  const anchors = strokes.filter((_, i) => anchor[i]);
  const ah = anchors.map((s) => rectHeight(s.bbox));
  const aOrder = [...anchors.keys()].sort((a, b) => anchors[a]!.bbox.minY - anchors[b]!.bbox.minY);
  const uf = new UnionFind(anchors.length);
  for (let x = 0; x < aOrder.length; x++) {
    const i = aOrder[x]!;
    const a = anchors[i]!.bbox;
    for (let y = x + 1; y < aOrder.length; y++) {
      const j = aOrder[y]!;
      const b = anchors[j]!.bbox;
      if (b.minY > a.maxY) break;
      const lo = Math.min(ah[i]!, ah[j]!), hi = Math.max(ah[i]!, ah[j]!);
      if (overlap1D(a.minY, a.maxY, b.minY, b.maxY) / Math.max(lo, 1e-6) > 0.4 && hi / Math.max(lo, 1e-6) < 2.6 && hGapOf(a, b) < 2.2 * hi) uf.union(i, j);
    }
  }
  const lines: SegStroke[][] = groupBy(anchors, uf);

  // attach the small strokes (-, = bars, dots, hats) to the closest line, measured in that line's size
  const meta = lines.map((ls) => {
    const hs = ls.map((s) => rectHeight(s.bbox));
    return { u: median(hs), top: median(ls.map((s) => s.bbox.minY)), bottom: median(ls.map((s) => s.bbox.maxY)), box: ls.map((s) => s.bbox).reduce(unionRect) };
  });
  const orphans: SegStroke[] = [];
  strokes.forEach((s, i) => {
    if (anchor[i]) return;
    const cy = rectCenterY(s.bbox);
    const extent = Math.max(w[i]!, h[i]!);
    let best = -1;
    let bestScore = Infinity;
    meta.forEach((m, k) => {
      if (extent > 2.6 * m.u) return;
      if (cy < m.top - 0.45 * m.u || cy > m.bottom + 0.45 * m.u) return;
      const dx = hGapOf(s.bbox, m.box);
      if (dx > 2.2 * m.u) return;
      const score = Math.abs(cy - (m.top + m.bottom) / 2) / m.u + (0.5 * dx) / m.u;
      if (score < bestScore) {
        bestScore = score;
        best = k;
      }
    });
    if (best >= 0) lines[best]!.push(s);
    else orphans.push(s);
  });

  if (orphans.length) {
    const ou = new UnionFind(orphans.length);
    const ext = orphans.map((s) => Math.max(rectWidth(s.bbox), rectHeight(s.bbox), 4 * pen));
    for (let i = 0; i < orphans.length; i++)
      for (let j = i + 1; j < orphans.length; j++) {
        const a = orphans[i]!.bbox, b = orphans[j]!.bbox;
        const e = Math.max(ext[i]!, ext[j]!);
        if (vGapOf(a, b) < 0.8 * e && hGapOf(a, b) < 1.5 * e) ou.union(i, j);
      }
    lines.push(...groupBy(orphans, ou));
  }

  const anchorIds = new Set(anchors.map((s) => s.id));
  return lines
    .map((ls) => {
      const sorted = [...ls].sort((a, b) => a.bbox.minX - b.bbox.minX || a.seq - b.seq);
      const t = sorted.filter((s) => anchorIds.has(s.id));
      const lineUnit = t.length ? median(t.map((s) => rectHeight(s.bbox))) : estimateUnit(sorted);
      const band = t.length >= 2 ? { top: median(t.map((s) => s.bbox.minY)), bottom: median(t.map((s) => s.bbox.maxY)) } : null;
      return { strokes: sorted, bbox: sorted.map((s) => s.bbox).reduce(unionRect), unit: Math.max(lineUnit, 4 * pen), band };
    })
    .sort((a, b) => {
      const dy = rectCenterY(a.bbox) - rectCenterY(b.bbox);
      return Math.abs(dy) > 0.5 * Math.min(a.unit, b.unit) ? dy : a.bbox.minX - b.bbox.minX;
    });
}

export function strokeDistance(a: SegStroke, b: SegStroke, cap: number): number {
  const gx = Math.max(0, Math.max(a.bbox.minX, b.bbox.minX) - Math.min(a.bbox.maxX, b.bbox.maxX));
  const gy = Math.max(0, Math.max(a.bbox.minY, b.bbox.minY) - Math.min(a.bbox.maxY, b.bbox.maxY));
  if (Math.hypot(gx, gy) > cap) return Math.hypot(gx, gy);
  const p = a.pts, q = b.pts;
  let best = Infinity;
  const na = Math.max(1, p.length / 3 - 1), nb = Math.max(1, q.length / 3 - 1);
  for (let i = 0; i < na; i++) {
    const i1 = Math.min(i + 1, p.length / 3 - 1);
    for (let j = 0; j < nb; j++) {
      const j1 = Math.min(j + 1, q.length / 3 - 1);
      const d = distSqSegmentSegment(p[i * 3]!, p[i * 3 + 1]!, p[i1 * 3]!, p[i1 * 3 + 1]!, q[j * 3]!, q[j * 3 + 1]!, q[j1 * 3]!, q[j1 * 3 + 1]!);
      if (d < best) {
        best = d;
        if (best === 0) return 0;
      }
    }
  }
  return Math.sqrt(best);
}

function chord(s: SegStroke): { dx: number; dy: number; len: number; mx: number; my: number; straight: number } {
  const p = s.pts;
  const n = p.length / 3;
  const dx = p[(n - 1) * 3]! - p[0]!;
  const dy = p[(n - 1) * 3 + 1]! - p[1]!;
  const len = Math.hypot(dx, dy);
  let path = 0;
  for (let i = 1; i < n; i++) path += Math.hypot(p[i * 3]! - p[(i - 1) * 3]!, p[i * 3 + 1]! - p[(i - 1) * 3 + 1]!);
  return { dx, dy, len, mx: (p[0]! + p[(n - 1) * 3]!) / 2, my: (p[1]! + p[(n - 1) * 3 + 1]!) / 2, straight: path > 0 ? len / path : 0 };
}

// two short parallel bars = an "=", even when tilted (the CNN only saw level ones)
export function parallelBars(a: SegStroke, b: SegStroke, unit: number): boolean {
  const ca = chord(a), cb = chord(b);
  if (ca.straight < 0.9 || cb.straight < 0.9) return false;
  const mean = (ca.len + cb.len) / 2;
  if (mean < 0.12 * unit || Math.max(ca.len, cb.len) > 0.95 * unit) return false;
  if (Math.min(ca.len, cb.len) / Math.max(ca.len, cb.len) < 0.45) return false;
  const ua = ca.dx < 0 ? [-ca.dx / ca.len, -ca.dy / ca.len] : [ca.dx / ca.len, ca.dy / ca.len];
  const ub = cb.dx < 0 ? [-cb.dx / cb.len, -cb.dy / cb.len] : [cb.dx / cb.len, cb.dy / cb.len];
  const cos = ua[0]! * ub[0]! + ua[1]! * ub[1]!;
  if (cos < Math.cos((25 * Math.PI) / 180)) return false;
  const dir = [(ua[0]! + ub[0]!) / 2, (ua[1]! + ub[1]!) / 2];
  const dl = Math.hypot(dir[0]!, dir[1]!);
  const ux = dir[0]! / dl, uy = dir[1]! / dl;
  if (Math.abs(uy) > Math.sin((55 * Math.PI) / 180)) return false; // closer to vertical: "11", "//"
  const ox = cb.mx - ca.mx, oy = cb.my - ca.my;
  const along = Math.abs(ox * ux + oy * uy);
  const across = Math.abs(-ox * uy + oy * ux);
  return across > 0.2 * mean && across < 1.1 * mean && along < 0.6 * mean;
}

export function strokesCross(a: SegStroke, b: SegStroke): boolean {
  if (!(a.bbox.minX <= b.bbox.maxX && b.bbox.minX <= a.bbox.maxX && a.bbox.minY <= b.bbox.maxY && b.bbox.minY <= a.bbox.maxY)) return false;
  const p = a.pts, q = b.pts;
  for (let i = 3; i < p.length; i += 3)
    for (let j = 3; j < q.length; j += 3)
      if (segmentsIntersect(p[i - 3]!, p[i - 2]!, p[i]!, p[i + 1]!, q[j - 3]!, q[j - 2]!, q[j]!, q[j + 1]!)) return true;
  return false;
}

const isDotLike = (b: Rect, unit: number, pen: number) => Math.max(rectWidth(b), rectHeight(b)) + pen < 0.3 * unit;
const isFlat = (b: Rect, unit: number) => rectHeight(b) < 0.4 * Math.max(rectWidth(b), 1e-6) && rectWidth(b) > 0.2 * unit;

export function sameSymbolProb(a: SegStroke, b: SegStroke, unit: number, band: Line['band'] = null): number {
  // strokes of one symbol are usually written one after the other
  const dt = Math.abs(Math.round(a.seq) - Math.round(b.seq));
  const recency = dt <= 1 ? 1 : dt === 2 ? 0.7 : 0.35;
  return Math.min(0.98, geometricSameProb(a, b, unit, band, dt <= 1) * recency);
}

function geometricSameProb(a: SegStroke, b: SegStroke, unit: number, band: Line['band'], consecutive: boolean): number {
  const pen = Math.max(a.width, b.width);
  const touch = strokeDistance(a, b, 0.3 * unit) <= Math.max(1.2 * pen, 0.07 * unit);
  const wa = Math.max(rectWidth(a.bbox), 0.12 * unit);
  const wb = Math.max(rectWidth(b.bbox), 0.12 * unit);
  const xo = overlap1D(a.bbox.minX, a.bbox.minX + wa, b.bbox.minX, b.bbox.minX + wb) / Math.min(wa, wb);
  const vGap = Math.max(0, Math.max(a.bbox.minY, b.bbox.minY) - Math.min(a.bbox.maxY, b.bbox.maxY));
  const hGap = Math.max(0, Math.max(a.bbox.minX, b.bbox.minX) - Math.min(a.bbox.maxX, b.bbox.maxX));

  if (touch) {
    // crossing strokes are nearly always one symbol (+, x, 4, 7 with a bar)
    if (xo <= 0.25) return 0.35;
    return strokesCross(a, b) ? 0.99 : 0.92;
  }
  const aDot = isDotLike(a.bbox, unit, pen), bDot = isDotLike(b.bbox, unit, pen);
  const aFlat = isFlat(a.bbox, unit), bFlat = isFlat(b.bbox, unit);
  if (aFlat && bFlat && xo > 0.45 && vGap < 0.7 * unit) return 0.85;
  if (consecutive && parallelBars(a, b, unit)) return 0.8;
  // = written fast, bars a bit offset
  if (consecutive && aFlat && bFlat) {
    const ratio = rectWidth(a.bbox) / Math.max(rectWidth(b.bbox), 1e-6);
    if (ratio > 0.5 && ratio < 2 && vGap > 0.06 * unit && vGap < 0.5 * unit && hGap < 0.15 * unit) return 0.6;
  }
  // dot above/below a dash -> ÷
  if ((aDot && bFlat) || (bDot && aFlat)) {
    const dot = aDot ? a : b, dash = aDot ? b : a;
    const cx = rectCenterX(dot.bbox);
    const w = rectWidth(dash.bbox);
    const inside = cx > dash.bbox.minX - 0.15 * w && cx < dash.bbox.maxX + 0.15 * w;
    if (inside && vGap < 0.7 * unit) return 0.8;
  }
  if (aDot && bDot) {
    if (overlap1D(a.bbox.minX - 0.1 * unit, a.bbox.maxX + 0.1 * unit, b.bbox.minX, b.bbox.maxX) > 0 && vGap < 0.9 * unit) return 0.6;
    return 0;
  }
  // hat of a 5 drawn as a separate stroke (sits near the top of the line)
  if (band && consecutive && aFlat !== bFlat) {
    const dash = aFlat ? a : b, other = aFlat ? b : a;
    const rc = (rectCenterY(dash.bbox) - band.top) / Math.max(band.bottom - band.top, 1e-6);
    if (dash.seq > other.seq && rc < 0.22 && rectHeight(other.bbox) > 0.5 * unit && hGap < 0.35 * unit) return 0.6;
  }
  if (xo > 0.6 && vGap < 0.3 * unit) return 0.45;
  if (xo > 0.3 && vGap < 0.3 * unit) return 0.25;
  return 0;
}

const MAX_GROUP = 4;
const MIN_LINK = 0.2;

export function candidates(line: Line): { list: Candidate[]; pair: (i: number, j: number) => number } {
  const s = line.strokes;
  const unit = line.unit;
  const cache = new Map<number, number>();
  const pair = (i: number, j: number): number => {
    if (i > j) [i, j] = [j, i];
    const k = i * 100003 + j;
    let v = cache.get(k);
    if (v === undefined) {
      v = sameSymbolProb(s[i]!, s[j]!, unit, line.band);
      cache.set(k, v);
    }
    return v;
  };

  const list: Candidate[] = [];
  for (let start = 0; start < s.length; start++) {
    let bbox = s[start]!.bbox;
    let logMerge = 0;
    for (let end = start + 1; end <= Math.min(s.length, start + MAX_GROUP); end++) {
      if (end > start + 1) {
        const k = end - 1;
        let best = 0;
        for (let i = start; i < k; i++) best = Math.max(best, pair(i, k));
        if (best < MIN_LINK) break;
        logMerge += Math.log(best);
        bbox = unionRect(bbox, s[k]!.bbox);
        if (rectWidth(bbox) > 2.6 * unit) break;
      }
      const group = s.slice(start, end);
      const pen = Math.max(...group.map((g) => g.width));
      const bars = group.length === 2 && parallelBars(group[0]!, group[1]!, unit);
      list.push({ start, end, strokes: group, bbox, logMerge, dotLike: isDotLike(bbox, unit, pen), bars });
    }
  }
  return { list, pair };
}
