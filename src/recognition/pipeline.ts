import { rectHeight, type Rect } from '../core/geometry';
import { evaluateLine } from '../math/evaluate';
import { formatRational, type FormattedNumber } from '../math/format';
import { formatExpression, isDigit, type Sym } from '../math/tokens';
import { decodeLine, groupKey, labelDistribution, type DecodedSymbol } from './decode';
import { CALIBRATION_TEMPERATURE, DIGIT_ENSEMBLE_ALPHA, DIGIT_TTA_SHEARS, DIGITS_MODEL, INPUT_SIZE, MODEL_LABELS } from './model';
import { rasterizeSymbol, type RasterOptions } from './rasterize';
import { candidates, findLines, type SegStroke } from './segment';

export type ClassifyBatch = (input: Float32Array, count: number) => Promise<Float32Array>;
export type DigitBatch = (input: Float32Array, count: number) => Promise<Float32Array>;

// symbol model decides digit vs operator, mnist helps decide which digit
export function combineDigitExpert(sym15: Float32Array, logits10: ArrayLike<number>, alpha: number): Float32Array {
  const out = Float32Array.from(sym15);
  let digitMass = 0;
  for (let d = 0; d < 10; d++) digitMass += sym15[d]!;
  if (digitMass <= 0) return out;
  let maxL = -Infinity;
  for (let d = 0; d < 10; d++) maxL = Math.max(maxL, logits10[d]!);
  let zM = 0;
  const pm = new Float64Array(10);
  for (let d = 0; d < 10; d++) zM += pm[d] = Math.exp(logits10[d]! - maxL);
  const mix = new Float64Array(10);
  let z = 0;
  for (let d = 0; d < 10; d++) {
    z += mix[d] = Math.pow(sym15[d]! / digitMass + 1e-6, alpha) * Math.pow(pm[d]! / zM + 1e-6, 1 - alpha);
  }
  for (let d = 0; d < 10; d++) out[d] = (digitMass * mix[d]!) / z;
  return out;
}

export type Verdict =
  | { kind: 'incomplete' }
  | { kind: 'value'; display: FormattedNumber }
  | { kind: 'check'; display: FormattedNumber; claimed: FormattedNumber; correct: boolean }
  | { kind: 'undefined' }
  | { kind: 'error'; message: string; at: number };

export interface LineResult {
  key: number;
  bbox: Rect;
  unit: number;
  symbols: DecodedSymbol[];
  text: string;
  verdict: Verdict;
  confidence: number;
  anchor: { x: number; baseline: number } | null;
}

export interface RecognizeStats {
  totalMs: number;
  inferMs: number;
  rasterMs: number;
  classified: number;
  cached: number;
  lines: number;
  strokes: number;
}

export interface PipelineOptions {
  raster?: RasterOptions;
  temperature?: number;
  cacheSize?: number;
  digits?: DigitBatch;
  digitAlpha?: number;
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export class RecognitionPipeline {
  private strokes = new Map<number, SegStroke>();
  private cache = new Map<string, Float32Array>();
  private overrides = new Map<string, Sym>();
  private readonly cacheSize: number;

  constructor(
    private classify: ClassifyBatch,
    private opts: PipelineOptions = {},
  ) {
    this.cacheSize = opts.cacheSize ?? 4096;
  }

  add(strokes: Iterable<SegStroke>): void {
    for (const s of strokes) this.strokes.set(s.id, s);
  }

  remove(ids: Iterable<number>): void {
    for (const id of ids) this.strokes.delete(id);
  }

  clear(): void {
    this.strokes.clear();
    this.overrides.clear();
  }

  get strokeCount(): number {
    return this.strokes.size;
  }

  setOverride(key: string, label: Sym | null): void {
    if (label === null) this.overrides.delete(key);
    else this.overrides.set(key, label);
  }

  async recognize(): Promise<{ lines: LineResult[]; stats: RecognizeStats }> {
    const t0 = now();
    const lines = findLines([...this.strokes.values()]);
    const perLine = lines.map((line) => ({ line, ...candidates(line) }));

    // results are cached by stroke ids so an edit only re-runs the groups that changed
    const todo = new Map<string, SegStroke[]>();
    let cached = 0;
    for (const { list } of perLine)
      for (const c of list) {
        const k = groupKey(c);
        if (this.cache.has(k)) {
          cached++;
          const v = this.cache.get(k)!; // move to the end (LRU)
          this.cache.delete(k);
          this.cache.set(k, v);
        } else if (!todo.has(k)) todo.set(k, c.strokes);
      }

    let inferMs = 0;
    let rasterMs = 0;
    if (todo.size) {
      const px = INPUT_SIZE * INPUT_SIZE;
      const batch = new Float32Array(todo.size * px);
      const tr = now();
      let i = 0;
      for (const strokes of todo.values()) rasterizeSymbol(strokes, batch.subarray(i++ * px, i * px), this.opts.raster);
      let digitBatch: Float32Array | null = null;
      // digit model sees 3 sheared copies, results get averaged
      const V = DIGIT_TTA_SHEARS.length;
      if (this.opts.digits) {
        const dpx = DIGITS_MODEL.size * DIGITS_MODEL.size;
        digitBatch = new Float32Array(todo.size * V * dpx);
        let j = 0;
        for (const strokes of todo.values()) {
          for (const k of DIGIT_TTA_SHEARS) {
            rasterizeSymbol(k === 0 ? strokes : shear(strokes, k), digitBatch.subarray(j * dpx, (j + 1) * dpx), {
              size: DIGITS_MODEL.size,
              margin: DIGITS_MODEL.margin,
              strokeWidth: DIGITS_MODEL.strokeWidth,
              centerOfMass: true,
            });
            j++;
          }
        }
      }
      rasterMs = now() - tr;
      const ti = now();
      const [probs, logits] = await Promise.all([
        this.classify(batch, todo.size),
        digitBatch && this.opts.digits ? this.opts.digits(digitBatch, todo.size * V) : Promise.resolve(null),
      ]);
      inferMs = now() - ti;
      const L = MODEL_LABELS.length;
      const alpha = this.opts.digitAlpha ?? DIGIT_ENSEMBLE_ALPHA;
      i = 0;
      for (const k of todo.keys()) {
        const p = probs.slice(i * L, (i + 1) * L);
        this.cache.set(k, logits ? combineDigitExpert(p, averageLogSoftmax(logits, i * V, V), alpha) : p);
        i++;
      }
      while (this.cache.size > this.cacheSize) this.cache.delete(this.cache.keys().next().value!);
    }

    const results: LineResult[] = perLine.map(({ line, list, pair }) => {
      const dists = list.map((c) => {
        const forced = this.overrides.get(groupKey(c));
        if (forced) return [{ label: forced, p: 1 }];
        const layout = line.band
          ? { hr: rectHeight(c.bbox) / line.unit, rc: ((c.bbox.minY + c.bbox.maxY) / 2 - line.band.top) / Math.max(line.band.bottom - line.band.top, 1e-6) }
          : undefined;
        return labelDistribution(this.cache.get(groupKey(c))!, MODEL_LABELS, c.dotLike, this.opts.temperature ?? CALIBRATION_TEMPERATURE, layout, c.bars);
      });
      const symbols = decodeLine({ line, cands: list, dists, pair });
      return buildLineResult(line.strokes.map((s) => s.id), line.bbox, line.unit, symbols);
    });

    return {
      lines: results,
      stats: {
        totalMs: now() - t0,
        inferMs,
        rasterMs,
        classified: todo.size,
        cached,
        lines: results.length,
        strokes: this.strokes.size,
      },
    };
  }
}

function shear(strokes: readonly SegStroke[], k: number): { pts: Float32Array }[] {
  return strokes.map((s) => {
    const p = new Float32Array(s.pts);
    for (let i = 0; i < p.length; i += 3) p[i] = p[i]! + k * p[i + 1]!;
    return { pts: p };
  });
}

export function averageLogSoftmax(logits: Float32Array, first: number, count: number): Float32Array {
  const out = new Float32Array(10);
  for (let r = first; r < first + count; r++) {
    const row = logits.subarray(r * 10, r * 10 + 10);
    let m = -Infinity;
    for (let d = 0; d < 10; d++) m = Math.max(m, row[d]!);
    let z = 0;
    for (let d = 0; d < 10; d++) z += Math.exp(row[d]! - m);
    const lz = m + Math.log(z);
    for (let d = 0; d < 10; d++) out[d] = out[d]! + (row[d]! - lz) / count;
  }
  return out;
}

export function buildLineResult(strokeIds: number[], bbox: Rect, unit: number, symbols: DecodedSymbol[]): LineResult {
  const labels = symbols.map((s) => s.label);
  const v = evaluateLine(labels);
  let verdict: Verdict;
  switch (v.kind) {
    case 'incomplete':
      verdict = v;
      break;
    case 'value':
      verdict = { kind: 'value', display: formatRational(v.value) };
      break;
    case 'check':
      verdict = { kind: 'check', display: formatRational(v.value), claimed: formatRational(v.claimed), correct: v.correct };
      break;
    case 'undefined':
      verdict = { kind: 'undefined' };
      break;
    case 'error':
      verdict = { kind: 'error', message: v.message, at: v.at };
      break;
  }

  let anchor: LineResult['anchor'] = null;
  const eqIndex = labels.indexOf('=');
  if (eqIndex >= 0) {
    const bottoms = symbols.filter((s) => isDigit(s.label)).map((s) => s.bbox.maxY).sort((a, b) => a - b);
    const baseline = bottoms.length ? bottoms[bottoms.length >> 1]! : bbox.maxY;
    const after = verdict.kind === 'check' ? symbols[symbols.length - 1]! : symbols[eqIndex]!;
    anchor = { x: after.bbox.maxX + 0.35 * unit, baseline };
  }

  return {
    key: Math.min(...strokeIds),
    bbox,
    unit,
    symbols,
    text: formatExpression(labels),
    verdict,
    confidence: symbols.length ? Math.min(...symbols.map((s) => s.confidence)) : 0,
    anchor,
  };
}
