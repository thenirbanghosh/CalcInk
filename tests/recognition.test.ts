import { beforeAll, describe, expect, it } from 'vitest';
import { writeExpression } from '../src/demo/handwriting';
import { boundsOf } from '../src/core/geometry';
import { RecognitionPipeline, combineDigitExpert, type ClassifyBatch, type DigitBatch } from '../src/recognition/pipeline';
import { parallelBars, sameSymbolProb, type SegStroke } from '../src/recognition/segment';
import { rasterizeSymbol } from '../src/recognition/rasterize';
import { labelDistribution, layoutPrior } from '../src/recognition/decode';
import { MODEL_LABELS } from '../src/recognition/model';
import { nodeClassifier, nodeDigitExpert } from '../scripts/eval/ort-node';

let classify: ClassifyBatch;
let digits: DigitBatch;
beforeAll(async () => {
  classify = (await nodeClassifier()).classify;
  digits = await nodeDigitExpert();
});

let nextId = 1;
function ink(text: string, x = 0, y = 0, size = 50, seed = 1, messiness = 0.6): SegStroke[] {
  return writeExpression(text, { x, y, size, seed, messiness }).map((s) => {
    const id = nextId++;
    return { id, seq: id, pts: s.pts, width: 3, bbox: boundsOf(s.pts) };
  });
}

async function read(strokes: SegStroke[]) {
  const p = new RecognitionPipeline(classify, { digits });
  p.add(strokes);
  return (await p.recognize()).lines;
}

describe('rasterizer (strokes to tensor)', () => {
  it('centers the symbol and keeps the 15% margin of the training data', () => {
    const img = new Float32Array(64 * 64);
    rasterizeSymbol([{ pts: new Float32Array([0, 0, 0.5, 0, 100, 0.5]) }], img);
    const rows = [...Array(64).keys()].filter((y) => [...Array(64).keys()].some((x) => img[y * 64 + x]! > 0.5));
    const cols = [...Array(64).keys()].filter((x) => rows.some((y) => img[y * 64 + x]! > 0.5));
    expect(rows[rows.length - 1]! - rows[0]! + 1).toBeGreaterThanOrEqual(47);
    expect(rows[rows.length - 1]! - rows[0]! + 1).toBeLessThanOrEqual(51);
    expect(Math.abs((rows[0]! + rows[rows.length - 1]!) / 2 - 31.5)).toBeLessThan(1);
    expect(Math.abs((cols[0]! + cols[cols.length - 1]!) / 2 - 31.5)).toBeLessThan(1);
  });
  it('is invariant to position, scale and pen width of the input', () => {
    const a = new Float32Array(4096), b = new Float32Array(4096);
    const s1 = ink('7', 0, 0, 40, 5)[0]!;
    const moved = new Float32Array(s1.pts);
    for (let i = 0; i < moved.length; i += 3) {
      moved[i] = moved[i]! * 3 + 1000;
      moved[i + 1] = moved[i + 1]! * 3 - 500;
    }
    rasterizeSymbol([s1], a);
    rasterizeSymbol([{ pts: moved }], b);
    let diff = 0;
    for (let i = 0; i < 4096; i++) diff = Math.max(diff, Math.abs(a[i]! - b[i]!));
    expect(diff).toBeLessThan(1e-3);
  });
  it('MNIST mode centers by mass in 28×28', () => {
    const img = new Float32Array(28 * 28);
    rasterizeSymbol(ink('7', 0, 0, 40, 2), img, { size: 28, margin: 0.2, strokeWidth: 1.6, centerOfMass: true });
    let m = 0, mx = 0, my = 0;
    for (let y = 0; y < 28; y++) for (let x = 0; x < 28; x++) { const v = img[y * 28 + x]!; m += v; mx += v * (x + 0.5); my += v * (y + 0.5); }
    expect(Math.abs(mx / m - 14)).toBeLessThan(0.6);
    expect(Math.abs(my / m - 14)).toBeLessThan(0.6);
  });
});

describe('end-to-end reading of handwritten expressions', () => {
  const cases: [string, string][] = [
    ['18+4×3=', '30'],
    ['2.5×-4=', '-10'],
    ['7÷0=', 'Undefined'],
    ['1÷3=', '0.(3)'],
    ['0.1+0.2=', '0.3'],
    ['96÷12-3=', '5'],
    ['100-250=', '-150'],
    ['9×9÷3=', '27'],
  ];
  it.each(cases)('%s gives %s (6 handwriting seeds)', async (text, answer) => {
    for (let seed = 1; seed <= 6; seed++) {
      const lines = await read(ink(text, 0, 0, 50, seed));
      expect(lines).toHaveLength(1);
      expect(lines[0]!.symbols.map((s) => s.label).join('')).toBe(text);
      const v = lines[0]!.verdict;
      expect(v.kind === 'value' ? v.display.text : v.kind === 'undefined' ? 'Undefined' : v.kind).toBe(answer);
    }
  });

  it('checks an answer written by the user', async () => {
    const right = await read(ink('6×7=42'));
    const wrong = await read(ink('6×7=48'));
    expect(right[0]!.verdict).toMatchObject({ kind: 'check', correct: true });
    expect(wrong[0]!.verdict).toMatchObject({ kind: 'check', correct: false });
  });

  it('places the answer right of "=" on the baseline', async () => {
    const [line] = await read(ink('12+30=', 0, 0, 50, 3));
    const eq = line!.symbols.find((s) => s.label === '=')!;
    expect(line!.anchor!.x).toBeGreaterThan(eq.bbox.maxX);
    expect(line!.anchor!.x - eq.bbox.maxX).toBeLessThan(line!.unit);
    expect(Math.abs(line!.anchor!.baseline - 50)).toBeLessThan(6);
  });

  it('is independent of writing size', async () => {
    for (const size of [18, 40, 120, 400]) {
      const lines = await read(ink('45+55=', 0, 0, size, 4));
      expect(lines[0]!.verdict).toMatchObject({ kind: 'value', display: { text: '100' } });
    }
  });
});

describe('page layout', () => {
  it('separates lines written close together (1.4× line height)', async () => {
    const lines = await read([...ink('12+7=', 0, 0, 50, 1), ...ink('7÷0=', 0, 70, 50, 2), ...ink('3×3=', 0, 140, 50, 3)]);
    expect(lines.map((l) => l.symbols.map((s) => s.label).join(''))).toEqual(['12+7=', '7÷0=', '3×3=']);
  });
  it('keeps small writing directly under big writing as its own line', async () => {
    const lines = await read([...ink('5×7=', 0, 0, 150, 1), ...ink('18+4×3=', 20, 170, 40, 2)]);
    expect(lines.map((l) => l.symbols.map((s) => s.label).join(''))).toEqual(['5×7=', '18+4×3=']);
  });
  it('keeps two equations side by side on the same row apart', async () => {
    const lines = await read([...ink('5+5=', 0, 0, 50, 1), ...ink('8-2=', 600, 0, 50, 2)]);
    expect(lines.map((l) => l.text)).toEqual(['5 + 5 =', '8 − 2 =']);
  });
  it('an edit re-reads only the changed group (cache)', async () => {
    const p = new RecognitionPipeline(classify, { digits });
    const strokes = ink('14+3=', 0, 0, 50, 8);
    p.add(strokes);
    const first = await p.recognize();
    expect(first.lines[0]!.text).toBe('14 + 3 =');
    const three = first.lines[0]!.symbols[3]!;
    p.remove(three.strokeIds);
    const nine = ink('9', three.bbox.minX, 0, 50, 9);
    p.add(nine);
    const second = await p.recognize();
    expect(second.lines[0]!.text).toBe('14 + 9 =');
    expect(second.stats.classified).toBeLessThanOrEqual(3);
    expect(second.lines[0]!.verdict).toMatchObject({ kind: 'value', display: { text: '23' } });
  });
});

describe('geometry priors', () => {
  const S = (pts: number[], id: number, seq = id): SegStroke => {
    const p = new Float32Array(pts.flatMap((v, i) => (i % 2 ? [v, 0.5] : [v])));
    return { id, seq, pts: p, width: 3, bbox: boundsOf(p) };
  };
  it('crossing strokes (+) are one symbol', () => {
    expect(sameSymbolProb(S([0, 25, 50, 25], 1), S([25, 0, 25, 50], 2), 50)).toBeGreaterThan(0.9);
  });
  it('stacked bars (=) are one symbol, side-by-side dashes are not', () => {
    expect(sameSymbolProb(S([0, 20, 40, 20], 1), S([0, 35, 40, 35], 2), 50)).toBeGreaterThan(0.8);
    expect(sameSymbolProb(S([0, 25, 30, 25], 1), S([60, 25, 90, 25], 2), 50)).toBe(0);
  });
  it('tilted "=" bars are detected structurally; "11" and "//" are not "="', () => {
    expect(parallelBars(S([0, 30, 30, 5], 1), S([12, 44, 40, 20], 2), 150)).toBe(true); // tilted ~40 deg
    expect(parallelBars(S([0, 20, 40, 20], 1), S([0, 35, 40, 35], 2), 50)).toBe(true); // level
    expect(parallelBars(S([0, 0, 0, 50], 1), S([15, 0, 15, 50], 2), 50)).toBe(false); // "11"
    expect(parallelBars(S([0, 50, 20, 0], 1), S([15, 50, 35, 0], 2), 50)).toBe(false); // "//"
  });
  it('strokes with other ink written between them rarely belong together', () => {
    const a = sameSymbolProb(S([0, 25, 50, 25], 1, 1), S([25, 0, 25, 50], 2, 2), 50);
    const b = sameSymbolProb(S([0, 25, 50, 25], 1, 1), S([25, 0, 25, 50], 2, 9), 50);
    expect(b).toBeLessThan(a * 0.5);
  });
  it('layout prior: half-height glyphs are unlikely digits; operators belong mid-line', () => {
    expect(layoutPrior('1', { hr: 0.5, rc: 0.5 })).toBeLessThan(0.2);
    expect(layoutPrior('1', { hr: 1.0, rc: 0.5 })).toBe(1);
    expect(layoutPrior('-', { hr: 0.05, rc: 0.05 })).toBeLessThan(0.1);
    expect(layoutPrior('+', { hr: 0.6, rc: 0.5 })).toBe(1);
  });
  it('decimal points come from geometry, not the CNN', () => {
    const flat = new Float32Array(15).fill(1 / 15);
    expect(labelDistribution(flat, MODEL_LABELS, true)[0]!.label).toBe('.');
    expect(labelDistribution(flat, MODEL_LABELS, false).find((d) => d.label === '.')!.p).toBeLessThan(1e-3);
  });
  it('digit ensemble only redistributes probability among digits', () => {
    const sym = new Float32Array(15);
    sym[1] = 0.5; sym[7] = 0.3; sym[10] = 0.2; // "1" vs "7" vs "+"
    const logits = new Float32Array(10);
    logits[7] = 5; // MNIST is sure it is a 7
    const out = combineDigitExpert(sym, logits, 0.6);
    expect(out[10]).toBeCloseTo(0.2); // operator mass untouched
    expect(out[7]!).toBeGreaterThan(out[1]!);
    expect(out.reduce((a, b) => a + b, 0)).toBeCloseTo(1);
  });
});

describe('robustness', () => {
  it('never throws on random scribbles', async () => {
    let seed = 1;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let k = 0; k < 20; k++) {
      const strokes: SegStroke[] = [];
      for (let s = 0; s < 1 + Math.floor(rand() * 12); s++) {
        const n = 1 + Math.floor(rand() * 30);
        const pts = new Float32Array(n * 3);
        let x = rand() * 500, y = rand() * 300;
        for (let i = 0; i < n; i++) {
          x += (rand() - 0.5) * 30; y += (rand() - 0.5) * 30;
          pts[i * 3] = x; pts[i * 3 + 1] = y; pts[i * 3 + 2] = 0.5;
        }
        const id = nextId++;
        strokes.push({ id, seq: id, pts, width: 3, bbox: boundsOf(pts) });
      }
      const lines = await read(strokes);
      for (const l of lines) expect(['incomplete', 'value', 'check', 'undefined', 'error']).toContain(l.verdict.kind);
    }
  });
});
