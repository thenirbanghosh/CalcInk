import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import * as ort from 'onnxruntime-node';
import { readInk } from './inkml';
import { nodeClassifier } from './ort-node';
import { rasterizeSymbol, type InkLike } from '../../src/recognition/rasterize';
import { MODEL_LABELS } from '../../src/recognition/model';

const DATA = process.argv[2]!;
const HALF = Number(process.argv[3] ?? 0);
const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
const glyphs: { d: number; strokes: InkLike[] }[] = [];
for (const f of readdirSync(join(DATA, 'symbols'))) {
  if (hash(f) % 2 !== HALF) continue;
  const ink = readInk(join(DATA, 'symbols', f), f);
  if (/^\d$/.test(ink.label)) glyphs.push({ d: Number(ink.label), strokes: ink.strokes });
}
console.log('digits', glyphs.length);
const mn = await ort.InferenceSession.create('public/models/digits-mnist.onnx');
const softmax = (x: Float32Array) => { const m = Math.max(...x); const e = x.map((v) => Math.exp(v - m)); const s = e.reduce((a, b) => a + b, 0); return e.map((v) => v / s); };
async function mnistProbs(w: number, com: boolean, scale255: boolean) {
  const out: Float32Array[] = [];
  for (const g of glyphs) {
    const img = new Float32Array(784);
    rasterizeSymbol(g.strokes, img, { size: 28, margin: 0.2, strokeWidth: w, centerOfMass: com });
    if (scale255) for (let i = 0; i < 784; i++) img[i] *= 255;
    const r = await mn.run({ image: new ort.Tensor('float32', img, [1, 1, 28, 28]) });
    out.push(softmax(r['logits']!.data as Float32Array));
  }
  return out;
}
const acc = (ps: ArrayLike<number>[]) => (100 * glyphs.filter((g, i) => { const p = ps[i]!; let b = 0; for (let k = 1; k < 10; k++) if (p[k]! > p[b]!) b = k; return b === g.d; }).length / glyphs.length).toFixed(1);
let best: Float32Array[] = [];
let bestAcc = 0;
for (const s255 of [false, true]) for (const com of [false, true]) for (const w of [1.6, 2.2, 2.8, 3.4]) {
  const p = await mnistProbs(w, com, s255);
  const a = Number(acc(p));
  console.log(`mnist w=${w} com=${com} x255=${s255}: ${a}`);
  if (a > bestAcc) { bestAcc = a; best = p; }
}
const { classify } = await nodeClassifier('public/models/symbols-cnn.onnx');
const batch = new Float32Array(glyphs.length * 4096);
glyphs.forEach((g, i) => rasterizeSymbol(g.strokes, batch.subarray(i * 4096, (i + 1) * 4096)));
const pr = await classify(batch, glyphs.length);
const sym = glyphs.map((_, i) => { const p = pr.slice(i * 15, i * 15 + 10); const s = p.reduce((a, b) => a + b, 0); return p.map((v) => v / s); });
console.log('symbol-cnn digits-only', acc(sym));
for (const a of [0.3, 0.4, 0.5, 0.6, 0.7]) {
  const ens = glyphs.map((_, i) => { const e = sym[i]!.map((v, k) => Math.pow(v + 1e-6, a) * Math.pow(best[i]![k]! + 1e-6, 1 - a)); const s = e.reduce((x, y) => x + y, 0); return e.map((v) => v / s); });
  console.log(`ensemble α=${a}`, acc(ens));
}
void MODEL_LABELS;
