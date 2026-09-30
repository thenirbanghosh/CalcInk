import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { readInk } from './inkml';
import { nodeClassifier } from './ort-node';
import { rasterizeSymbol, type InkLike } from '../../src/recognition/rasterize';
import { MODEL_LABELS } from '../../src/recognition/model';
import { ALL_SYMBOLS, type Sym } from '../../src/math/tokens';

const DATA = process.argv[2]!;
const TEX: Record<string, Sym> = { '\\times': '×', '\\div': '÷' };
const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
const glyphs: { sym: Sym; strokes: InkLike[] }[] = [];
for (const f of readdirSync(join(DATA, 'symbols'))) {
  if (hash(f) % 2 !== 0) continue; // dev half only
  const ink = readInk(join(DATA, 'symbols', f), f);
  const sym = (TEX[ink.label] ?? ink.label) as Sym;
  if (ALL_SYMBOLS.includes(sym) && sym !== '.') glyphs.push({ sym, strokes: ink.strokes });
}
const { classify } = await nodeClassifier('public/models/symbols-cnn.onnx');
const px = 4096;
function transform(strokes: InkLike[], rot: number, shear: number): InkLike[] {
  const c = Math.cos(rot), s = Math.sin(rot);
  return strokes.map((k) => {
    const p = new Float32Array(k.pts);
    for (let i = 0; i < p.length; i += 3) {
      const x = p[i]!, y = p[i + 1]!;
      p[i] = c * x - s * y + shear * y;
      p[i + 1] = s * x + c * y;
    }
    return { pts: p };
  });
}
async function probsFor(variant: { w: number; rot?: number; shear?: number }): Promise<Float32Array> {
  const batch = new Float32Array(glyphs.length * px);
  glyphs.forEach((g, i) => rasterizeSymbol(transform(g.strokes, variant.rot ?? 0, variant.shear ?? 0), batch.subarray(i * px, (i + 1) * px), { strokeWidth: variant.w }));
  return classify(batch, glyphs.length);
}
const acc = (p: Float32Array) => {
  let ok = 0;
  glyphs.forEach((g, i) => {
    let bi = 0;
    for (let k = 1; k < 15; k++) if (p[i * 15 + k]! > p[i * 15 + bi]!) bi = k;
    if (MODEL_LABELS[bi] === g.sym) ok++;
  });
  return ((100 * ok) / glyphs.length).toFixed(1);
};
console.log('n', glyphs.length);
const cache = new Map<string, Float32Array>();
for (const w of [3, 3.5, 4, 4.6, 5.2, 6, 7]) {
  const p = await probsFor({ w });
  cache.set(`w${w}`, p);
  console.log('width', w, acc(p));
}
const avg = (ps: Float32Array[], geo = false) => {
  const o = new Float32Array(ps[0]!.length);
  for (const p of ps) for (let i = 0; i < o.length; i++) o[i] += geo ? Math.log(Math.max(p[i]!, 1e-9)) : p[i]!;
  return o;
};
console.log('tta widths 4/5.2/6', acc(avg([cache.get('w4')!, cache.get('w5.2')!, cache.get('w6')!])));
const rots = [];
for (const r of [-0.12, 0, 0.12]) for (const sh of [-0.15, 0, 0.15]) rots.push(await probsFor({ w: 5.2, rot: r, shear: sh }));
console.log('tta rot×shear @5.2', acc(avg(rots)));
