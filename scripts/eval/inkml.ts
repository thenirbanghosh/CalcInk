import { readFileSync } from 'node:fs';
import { boundsOf } from '../../src/core/geometry';
import type { SegStroke } from '../../src/recognition/segment';
import type { Sym } from '../../src/math/tokens';

export interface Ink {
  id: string;
  label: string;
  strokes: SegStroke[];
}

export const MW_PEN_WIDTH = 3;

export function readInk(path: string, id = path): Ink {
  const xml = readFileSync(path, 'utf8');
  const ann = (type: string) => new RegExp(`<annotation type="${type}">([^<]*)</annotation>`).exec(xml)?.[1];
  const label = decodeEntities(ann('normalizedLabel') ?? ann('label') ?? '');
  const strokes: SegStroke[] = [];
  const re = /<trace[^>]*>([^<]*)<\/trace>/g;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(xml))) {
    const samples = m[1]!.trim().split(',').map((p) => p.trim().split(/\s+/).map(Number));
    const pts = new Float32Array(samples.length * 3);
    samples.forEach(([x, y], i) => {
      pts[i * 3] = x!;
      pts[i * 3 + 1] = y!;
      pts[i * 3 + 2] = 0.5;
    });
    k++;
    strokes.push({ id: k, seq: k, pts, width: MW_PEN_WIDTH, bbox: boundsOf(pts) });
  }
  return { id, label, strokes };
}

function decodeEntities(s: string): string {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

export function labelToSymbols(label: string): Sym[] | null {
  const out: Sym[] = [];
  let s = label.replace(/\s+/g, '');
  while (s.length) {
    if (s.startsWith('\\times')) {
      out.push('×');
      s = s.slice(6);
    } else if (s.startsWith('\\div')) {
      out.push('÷');
      s = s.slice(4);
    } else if (/^[0-9+\-=.]/.test(s)) {
      out.push(s[0] as Sym);
      s = s.slice(1);
    } else return null;
  }
  return out.length ? out : null;
}
