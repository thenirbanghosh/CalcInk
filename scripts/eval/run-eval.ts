import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { labelToSymbols, readInk, type Ink } from './inkml';
import { nodeClassifier, nodeDigitExpert } from './ort-node';
import { averageLogSoftmax, combineDigitExpert, RecognitionPipeline, type ClassifyBatch, type DigitBatch } from '../../src/recognition/pipeline';
import { evaluateLine } from '../../src/math/evaluate';
import { rasterizeSymbol } from '../../src/recognition/rasterize';
import { DIGIT_ENSEMBLE_ALPHA, DIGIT_TTA_SHEARS, DIGITS_MODEL, INPUT_SIZE, MODEL_LABELS } from '../../src/recognition/model';
import { boundsOf, rectHeight, rectWidth } from '../../src/core/geometry';
import { ALL_SYMBOLS, type Sym } from '../../src/math/tokens';
import { rng } from '../../src/demo/handwriting';
import type { SegStroke } from '../../src/recognition/segment';

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i]!.replace(/^--/, ''), process.argv[i + 1] ?? '');
const DATA = args.get('data');
if (!DATA) {
  console.error('usage: npm run eval -- --data /path/to/mathwriting-2024 [--out docs/eval] [--split heldout]');
  process.exit(1);
}
const OUT = args.get('out') ?? 'docs/eval';
const SPLIT = (args.get('split') ?? 'heldout') as 'dev' | 'heldout' | 'all';
const MODEL = args.get('model') ?? 'public/models/symbols-cnn.onnx';
const TEMPERATURE = args.has('temperature') ? Number(args.get('temperature')) : undefined;
const STROKE_W = args.has('stroke') ? Number(args.get('stroke')) : undefined;
const USE_DIGITS = args.get('digits') !== 'off';

const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
const inSplit = (split: string, id: string) => {
  if (SPLIT === 'all') return true;
  const dev = split === 'valid' || ((split === 'train' || split === 'symbols') && hash(id) % 2 === 0);
  return SPLIT === 'dev' ? dev : !dev;
};

function levenshtein(a: readonly string[], b: readonly string[]): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0]![j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length]![b.length]!;
}

function sameAnswer(pred: Sym[], truth: Sym[]): boolean {
  const a = evaluateLine(pred);
  const b = evaluateLine(truth);
  if (a.kind !== b.kind) return false;
  if (a.kind === 'value' && b.kind === 'value') return a.value.equals(b.value);
  if (a.kind === 'check' && b.kind === 'check') return a.value.equals(b.value) && a.correct === b.correct;
  return true;
}

const pct = (x: number, n: number) => (n ? ((100 * x) / n).toFixed(1) : '-');
const quantile = (xs: number[], q: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))]! : 0;
};

interface ExprStats {
  n: number;
  exact: number;
  answer: number;
  edits: number;
  symbols: number;
  latency: number[];
  calc: { n: number; exact: number; answer: number };
  failures: { id: string; truth: string; read: string }[];
}

const isCalculation = (truth: Sym[]) => {
  const v = evaluateLine(truth);
  return v.kind === 'value' || v.kind === 'check' || v.kind === 'undefined';
};

async function runExpressions(name: string, inks: { ink: Ink; truth: Sym[] }[], classify: ClassifyBatch, digits?: DigitBatch): Promise<ExprStats> {
  const st: ExprStats = { n: 0, exact: 0, answer: 0, edits: 0, symbols: 0, latency: [], calc: { n: 0, exact: 0, answer: 0 }, failures: [] };
  for (const { ink, truth } of inks) {
    const p = new RecognitionPipeline(classify, { temperature: TEMPERATURE, raster: STROKE_W ? { strokeWidth: STROKE_W } : undefined, digits });
    p.add(ink.strokes);
    const t = performance.now();
    const { lines } = await p.recognize();
    st.latency.push(performance.now() - t);
    const read = lines.flatMap((l) => l.symbols.map((s) => s.label));
    st.n++;
    st.symbols += truth.length;
    st.edits += levenshtein(read, truth);
    if (read.join('') === truth.join('')) st.exact++;
    else st.failures.push({ id: ink.id, truth: truth.join(''), read: read.join('') + (lines.length > 1 ? `  (${lines.length} lines)` : '') });
    const ok = sameAnswer(read, truth);
    if (ok) st.answer++;
    if (isCalculation(truth)) {
      st.calc.n++;
      if (read.join('') === truth.join('')) st.calc.exact++;
      if (ok) st.calc.answer++;
    }
  }
  console.log(
    `${name.padEnd(9)} n=${st.n}  exact=${pct(st.exact, st.n)}%  answer=${pct(st.answer, st.n)}%  symbolAcc=${pct(st.symbols - st.edits, st.symbols)}%  p50=${quantile(st.latency, 0.5).toFixed(1)}ms p95=${quantile(st.latency, 0.95).toFixed(1)}ms`,
  );
  console.log(`${''.padEnd(9)} well-formed calculations n=${st.calc.n}  exact=${pct(st.calc.exact, st.calc.n)}%  correct answer=${pct(st.calc.answer, st.calc.n)}%`);
  return st;
}

const TEX: Record<string, Sym> = { '\\times': '×', '\\div': '÷' };

async function main() {
  const { classify } = await nodeClassifier(MODEL);
  const digits = USE_DIGITS ? await nodeDigitExpert() : undefined;
  const report: Record<string, unknown> = { split: SPLIT, model: MODEL, digitExpert: USE_DIGITS, temperature: TEMPERATURE, strokeWidth: STROKE_W ?? 'default', date: new Date().toISOString() };

  const glyphs: { sym: Sym; strokes: SegStroke[]; id: string }[] = [];
  for (const f of readdirSync(join(DATA!, 'symbols'))) {
    const ink = readInk(join(DATA!, 'symbols', f), f);
    const sym = (TEX[ink.label] ?? ink.label) as Sym;
    if (ALL_SYMBOLS.includes(sym) && inSplit('symbols', f)) glyphs.push({ sym, strokes: ink.strokes, id: f });
  }
  const cnnGlyphs = glyphs.filter((g) => g.sym !== '.');
  const px = INPUT_SIZE * INPUT_SIZE;
  const batch = new Float32Array(cnnGlyphs.length * px);
  cnnGlyphs.forEach((g, i) => rasterizeSymbol(g.strokes, batch.subarray(i * px, (i + 1) * px), STROKE_W ? { strokeWidth: STROKE_W } : undefined));
  const t0 = performance.now();
  let probs = await classify(batch, cnnGlyphs.length);
  if (digits) {
    const dpx = DIGITS_MODEL.size ** 2;
    const V = DIGIT_TTA_SHEARS.length;
    const db = new Float32Array(cnnGlyphs.length * V * dpx);
    cnnGlyphs.forEach((g, i) =>
      DIGIT_TTA_SHEARS.forEach((k, v) => {
        const sheared = g.strokes.map((s) => {
          const p = new Float32Array(s.pts);
          for (let j = 0; j < p.length; j += 3) p[j] = p[j]! + k * p[j + 1]!;
          return { pts: p };
        });
        rasterizeSymbol(sheared, db.subarray((i * V + v) * dpx, (i * V + v + 1) * dpx), { size: DIGITS_MODEL.size, margin: DIGITS_MODEL.margin, strokeWidth: DIGITS_MODEL.strokeWidth, centerOfMass: true });
      }),
    );
    const logits = await digits(db, cnnGlyphs.length * V);
    const combined = new Float32Array(probs.length);
    for (let i = 0; i < cnnGlyphs.length; i++) combined.set(combineDigitExpert(probs.slice(i * 15, (i + 1) * 15), averageLogSoftmax(logits, i * V, V), DIGIT_ENSEMBLE_ALPHA), i * 15);
    probs = combined;
  }
  const perGlyphMs = (performance.now() - t0) / cnnGlyphs.length;
  const confusion: Record<string, Record<string, number>> = {};
  let correct = 0;
  cnnGlyphs.forEach((g, i) => {
    const p = probs.subarray(i * 15, (i + 1) * 15);
    let bi = 0;
    for (let k = 1; k < 15; k++) if (p[k]! > p[bi]!) bi = k;
    const got = MODEL_LABELS[bi]!;
    (confusion[g.sym] ??= {})[got] = (confusion[g.sym]![got] ?? 0) + 1;
    if (got === g.sym) correct++;
  });
  const perClass = Object.fromEntries(Object.entries(confusion).map(([k, v]) => [k, { n: Object.values(v).reduce((a, b) => a + b, 0), correct: v[k] ?? 0 }]));
  console.log(`isolated  n=${cnnGlyphs.length}  top1=${pct(correct, cnnGlyphs.length)}%  (${perGlyphMs.toFixed(2)} ms/glyph, batched)`);
  report.isolated = { n: cnnGlyphs.length, top1: correct / cnnGlyphs.length, perClass, confusion, msPerGlyph: perGlyphMs };

  const real: { ink: Ink; truth: Sym[] }[] = [];
  for (const split of ['train', 'valid', 'test']) {
    const list = readFileSync(join(DATA!, `../arith_${split}.txt`), 'utf8').split('\n').filter(Boolean);
    for (const rel of list) {
      const id = rel.split('/').pop()!;
      if (!inSplit(split, id)) continue;
      const ink = readInk(join(DATA!, rel.includes('/') ? rel : join(split, rel)), `${split}/${id}`);
      const truth = labelToSymbols(ink.label);
      if (truth) real.push({ ink, truth });
    }
  }
  const realStats = await runExpressions('real', real, classify, digits);
  report.real = { ...realStats, latency: { p50: quantile(realStats.latency, 0.5), p95: quantile(realStats.latency, 0.95) } };

  const bySym = new Map<Sym, SegStroke[][]>();
  for (const g of glyphs) (bySym.get(g.sym) ?? bySym.set(g.sym, []).get(g.sym)!).push(g.strokes);
  const rand = rng(SPLIT === 'dev' ? 1234 : 98765);
  const pick = <T>(xs: T[]) => xs[Math.floor(rand() * xs.length)]!;
  const num = () => {
    const int = String(Math.floor(rand() ** 2 * (rand() < 0.3 ? 1000 : 100)));
    return rand() < 0.25 ? `${int}.${Math.floor(rand() * 100)}` : int;
  };
  const stitched: { ink: Ink; truth: Sym[] }[] = [];
  for (let e = 0; e < 1000; e++) {
    const terms = 2 + Math.floor(rand() * 3);
    let text = (rand() < 0.1 ? '-' : '') + num();
    for (let t = 1; t < terms; t++) text += pick(['+', '-', '×', '÷'] as const) + (rand() < 0.08 ? '-' : '') + num();
    text += '=';
    const truth = [...text] as Sym[];
    const H = 40 + rand() * 60;
    let x = 0;
    const strokes: SegStroke[] = [];
    let id = 1;
    for (const s of truth) {
      const src = pick(bySym.get(s)!);
      const b = src.map((k) => k.bbox).reduce((a, c) => ({ minX: Math.min(a.minX, c.minX), minY: Math.min(a.minY, c.minY), maxX: Math.max(a.maxX, c.maxX), maxY: Math.max(a.maxY, c.maxY) }));
      const w = Math.max(rectWidth(b), 1e-3), h = Math.max(rectHeight(b), 1e-3);
      const target = s === '.' ? 0.1 * H : /\d/.test(s) ? H * (0.9 + 0.2 * rand()) : H * (0.45 + 0.25 * rand());
      const k = s === '-' ? (0.55 * H) / w : s === '=' || s === '÷' ? (0.6 * H) / Math.max(w, h) : target / Math.max(h, s === '.' ? w : 0.3 * w);
      const top = s === '.' ? H - k * h : /\d/.test(s) ? (rand() - 0.5) * 0.08 * H : H / 2 - (k * h) / 2 + (rand() - 0.5) * 0.1 * H;
      for (const src1 of src) {
        const pts = new Float32Array(src1.pts.length);
        for (let i = 0; i < pts.length; i += 3) {
          pts[i] = x + (src1.pts[i]! - b.minX) * k;
          pts[i + 1] = top + (src1.pts[i + 1]! - b.minY) * k;
          pts[i + 2] = 0.5;
        }
        strokes.push({ id, seq: id, pts, width: 3, bbox: boundsOf(pts) });
        id++;
      }
      x += w * k + H * (0.12 + 0.25 * rand());
    }
    stitched.push({ ink: { id: `stitched-${e}`, label: text, strokes }, truth });
  }
  const stStats = await runExpressions('stitched', stitched, classify, digits);
  report.stitched = { ...stStats, latency: { p50: quantile(stStats.latency, 0.5), p95: quantile(stStats.latency, 0.95) } };

  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, `results-${SPLIT}.json`), JSON.stringify(report, (k, v) => (k === 'latency' && Array.isArray(v) ? undefined : v), 2));
  console.log(`wrote ${join(OUT, `results-${SPLIT}.json`)}`);
}

await main();
process.exit(0);
