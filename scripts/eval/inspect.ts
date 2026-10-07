import { readInk } from './inkml';
import { nodeClassifier } from './ort-node';
import { findLines, candidates } from '../../src/recognition/segment';
import { rasterizeSymbol } from '../../src/recognition/rasterize';
import { labelDistribution, groupKey } from '../../src/recognition/decode';
import { MODEL_LABELS } from '../../src/recognition/model';
import { RecognitionPipeline } from '../../src/recognition/pipeline';

const ink = readInk(process.argv[2]!);
const { classify } = await nodeClassifier('public/models/symbols-cnn.onnx');
console.log('label', ink.label);
for (const line of findLines(ink.strokes)) {
  console.log(`line unit=${line.unit.toFixed(1)} bbox=${JSON.stringify(line.bbox, (_, v) => (typeof v === 'number' ? Math.round(v) : v))}`);
  line.strokes.forEach((s, i) => console.log(`  s${i} id=${s.id} x ${s.bbox.minX.toFixed(0)}-${s.bbox.maxX.toFixed(0)} y ${s.bbox.minY.toFixed(0)}-${s.bbox.maxY.toFixed(0)} n=${s.pts.length / 3}`));
  const { list, pair } = candidates(line);
  for (const c of list) {
    const img = new Float32Array(4096);
    rasterizeSymbol(c.strokes, img);
    const p = await classify(img, 1);
    const d = labelDistribution(p, MODEL_LABELS, c.dotLike);
    console.log(`  cand [${c.start},${c.end}) ${groupKey(c)} merge=${c.logMerge.toFixed(2)} dot=${c.dotLike} -> ${d.slice(0, 3).map((x) => `${x.label}:${x.p.toFixed(2)}`).join(' ')}`);
  }
  for (let i = 0; i + 1 < line.strokes.length; i++) console.log(`  pair(${i},${i + 1})=${pair(i, i + 1).toFixed(2)}`);
}
const p = new RecognitionPipeline(classify);
p.add(ink.strokes);
const { lines } = await p.recognize();
console.log('read:', lines.map((l) => l.text).join(' | '));
