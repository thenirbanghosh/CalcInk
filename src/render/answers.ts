import type { FormattedNumber } from '../math/format';
import type { LineResult } from '../recognition/pipeline';
import type { Rect } from '../core/geometry';
import type { Palette } from './theme';

export const ANSWER_FONT = '"Caveat", "Segoe Print", "Bradley Hand", cursive';

interface Run {
  text: string;
  overline?: boolean;
  scale?: number;
  dy?: number;
  color?: 'answer' | 'good' | 'bad' | 'muted';
}

type Mark = 'check' | 'cross' | null;

interface Layout {
  runs: Run[];
  fraction: { num: string; den: string } | null;
  mark: Mark;
}

export interface AnswerView {
  key: number;
  line: LineResult;
  signature: string;
  layout: Layout;
  born: number;
  dying: number | null;
  rect: Rect;
  lowConfidence: boolean;
  fit?: { version: number; scale: number };
}

export interface AnswerSettings {
  fractions: boolean;
  showConfidence: boolean;
}

const LOW_CONFIDENCE = 0.5;

function numberRuns(f: FormattedNumber, color: Run['color'] = 'answer'): Run[] {
  const runs: Run[] = [];
  if (f.negative) runs.push({ text: '−', color });
  if (f.exponent !== undefined) {
    runs.push({ text: f.intPart + (f.fixed ? '.' + f.fixed : ''), color });
    runs.push({ text: '×10', color, scale: 0.9 });
    runs.push({ text: String(f.exponent).replace('-', '−'), color, scale: 0.6, dy: -0.55 });
    return runs;
  }
  runs.push({ text: f.intPart + (f.fixed || f.repeat ? '.' + f.fixed : ''), color });
  if (f.repeat) runs.push({ text: f.repeat, overline: true, color });
  if (f.rounded) runs.push({ text: '…', color });
  return runs;
}

function layoutFor(line: LineResult, s: AnswerSettings): Layout | null {
  const v = line.verdict;
  switch (v.kind) {
    case 'value': {
      const frac = s.fractions && v.display.fraction && v.display.exponent === undefined ? v.display.fraction : null;
      if (frac) {
        const [num, den] = frac.replace('-', '').split('/') as [string, string];
        return { runs: frac.startsWith('-') ? [{ text: '−', color: 'answer' }] : [], fraction: { num, den }, mark: null };
      }
      return { runs: numberRuns(v.display), fraction: null, mark: null };
    }
    case 'check':
      return v.correct
        ? { runs: [], fraction: null, mark: 'check' }
        : { runs: numberRuns(v.display), fraction: null, mark: 'cross' };
    case 'undefined':
      return { runs: [{ text: 'Undefined', color: 'bad', scale: 0.62 }], fraction: null, mark: null };
    case 'error':
      return { runs: [{ text: '?', color: 'muted', scale: 0.55, dy: -0.12 }], fraction: null, mark: null };
    case 'incomplete':
      return null;
  }
}

const signatureOf = (l: Layout) => JSON.stringify(l);

const easeOut = (t: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);

export class AnswerLayer {
  views = new Map<number, AnswerView>();
  private capRatio = 0.62;
  settings: AnswerSettings = { fractions: false, showConfidence: true };
  onAppear: (v: AnswerView) => void = () => {};
  obstacle: (x: number, top: number, bottom: number) => number | null = () => null;
  version: () => number = () => 0;

  calibrate(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.font = `100px ${ANSWER_FONT}`;
    const m = ctx.measureText('8');
    if (m.actualBoundingBoxAscent > 10) this.capRatio = m.actualBoundingBoxAscent / 100;
    ctx.restore();
  }

  update(lines: LineResult[], now: number): void {
    const seen = new Set<number>();
    for (const line of lines) {
      const layout = line.anchor ? layoutFor(line, this.settings) : null;
      if (!layout || !line.anchor) continue;
      seen.add(line.key);
      const signature = signatureOf(layout);
      const prev = this.views.get(line.key);
      const lowConfidence = line.confidence < LOW_CONFIDENCE;
      if (prev && prev.signature === signature && prev.dying === null) {
        prev.line = line; // same answer, don't animate it again
        prev.lowConfidence = lowConfidence;
        continue;
      }
      const u = line.unit;
      const rect = { minX: line.anchor.x, minY: line.anchor.baseline - 1.15 * u, maxX: line.anchor.x + 0.6 * u * Math.max(1, signature.length / 12), maxY: line.anchor.baseline + 0.35 * u };
      const view: AnswerView = { key: line.key, line, signature, layout, born: now, dying: null, rect, lowConfidence };
      this.views.set(line.key, view);
      this.onAppear(view);
    }
    for (const [k, v] of this.views) if (!seen.has(k) && v.dying === null) v.dying = now;
  }

  relayout(now: number): void {
    const lines = [...this.views.values()].filter((v) => v.dying === null).map((v) => v.line);
    this.update(lines, now);
  }

  hitTest(wx: number, wy: number): AnswerView | null {
    for (const v of this.views.values()) {
      if (v.dying !== null) continue;
      const r = v.rect;
      const pad = 0.2 * v.line.unit;
      if (wx >= r.minX - pad && wx <= r.maxX + pad && wy >= r.minY - pad && wy <= r.maxY + pad) return v;
    }
    return null;
  }

  draw(ctx: CanvasRenderingContext2D, now: number, pal: Palette): boolean {
    let animating = false;
    for (const [k, v] of this.views) {
      const fade = v.dying === null ? 1 : 1 - (now - v.dying) / 180;
      if (fade <= 0) {
        this.views.delete(k);
        continue;
      }
      const chars = v.layout.runs.reduce((a, r) => a + r.text.length, 0) + (v.layout.fraction ? 4 : 0) + (v.layout.mark ? 2 : 0);
      const duration = 260 + 45 * Math.min(chars, 14);
      const progress = easeOut((now - v.born) / duration);
      if (progress < 1 || v.dying !== null) animating = true;
      ctx.save();
      const quiet = v.line.verdict.kind === 'error' ? 0.6 : v.lowConfidence && this.settings.showConfidence ? 0.72 : 1;
      ctx.globalAlpha = fade * quiet;
      this.drawView(ctx, v, progress, pal);
      ctx.restore();
    }
    return animating;
  }

  // shrink long answers so they don't run into the next thing on the row
  private fitScale(ctx: CanvasRenderingContext2D, v: AnswerView): number {
    const version = this.version();
    if (v.fit && v.fit.version === version) return v.fit.scale;
    const { anchor, unit } = v.line;
    let scale = 1;
    if (anchor) {
      const wall = this.obstacle(anchor.x, anchor.baseline - unit * 1.1, anchor.baseline + unit * 0.3);
      if (wall !== null) {
        const room = wall - anchor.x - unit * 0.45;
        const natural = naturalWidth(ctx, v, unit / this.capRatio, unit) * 1.1;
        if (natural > room) scale = Math.max(0.45, room / natural);
      }
    }
    v.fit = { version, scale };
    return scale;
  }

  private drawView(ctx: CanvasRenderingContext2D, v: AnswerView, progress: number, pal: Palette): void {
    const anchor = v.line.anchor!;
    const unit = v.line.unit;
    const size = (unit / this.capRatio) * this.fitScale(ctx, v);
    const colors = { answer: pal.answer, good: pal.good, bad: pal.bad, muted: pal.muted };
    let x = anchor.x;
    const base = anchor.baseline;
    const lineW = Math.max(unit * 0.06, 1.2);

    const parts: { run: Run; x: number; w: number; font: string }[] = [];
    let cursor = x;
    if (v.layout.mark) {
      parts.push({ run: { text: '' }, x: cursor, w: unit * 0.8, font: '' });
      cursor += unit * 1.0;
    }
    for (const run of v.layout.runs) {
      const font = `${size * (run.scale ?? 1)}px ${ANSWER_FONT}`;
      ctx.font = font;
      const w = ctx.measureText(run.text).width;
      parts.push({ run, x: cursor, w, font });
      cursor += w;
    }
    let fracW = 0;
    const fracX = cursor;
    if (v.layout.fraction) {
      const f = v.layout.fraction;
      ctx.font = `${size * 0.62}px ${ANSWER_FONT}`;
      fracW = Math.max(ctx.measureText(f.num).width, ctx.measureText(f.den).width) + unit * 0.2;
      cursor += fracW;
    }
    const total = cursor - x;
    v.rect = { minX: x, minY: base - unit * 1.15, maxX: x + total, maxY: base + unit * 0.35 };

    ctx.save();
    if (progress < 1) {
      ctx.beginPath();
      ctx.rect(x - unit, base - unit * 2, unit + (total + unit * 0.4) * progress, unit * 3);
      ctx.clip();
    }
    ctx.textBaseline = 'alphabetic';

    if (v.layout.mark === 'check') drawCheck(ctx, x, base, unit, lineW * 1.3, colors.good);
    if (v.layout.mark === 'cross') drawCross(ctx, x, base, unit, lineW * 1.3, colors.bad);

    for (const p of parts) {
      if (!p.run.text) continue;
      ctx.font = p.font;
      ctx.fillStyle = colors[p.run.color ?? 'answer'];
      const y = base + (p.run.dy ?? 0) * size;
      ctx.fillText(p.run.text, p.x, y);
      if (p.run.overline) {
        ctx.strokeStyle = ctx.fillStyle;
        ctx.lineWidth = lineW;
        ctx.lineCap = 'round';
        ctx.beginPath();
        const oy = base - unit * 1.12;
        ctx.moveTo(p.x + unit * 0.05, oy);
        ctx.lineTo(p.x + p.w - unit * 0.05, oy - unit * 0.02);
        ctx.stroke();
      }
    }

    if (v.layout.fraction) {
      const f = v.layout.fraction;
      const fx = fracX;
      ctx.fillStyle = colors.answer;
      const mid = base - unit * 0.5;
      ctx.font = `${size * 0.62}px ${ANSWER_FONT}`;
      ctx.textAlign = 'center';
      const cx = fx + fracW / 2;
      ctx.fillText(f.num, cx, mid - unit * 0.12);
      ctx.fillText(f.den, cx, mid + unit * 0.62);
      ctx.strokeStyle = colors.answer;
      ctx.lineWidth = lineW;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(fx + unit * 0.04, mid);
      ctx.lineTo(fx + fracW - unit * 0.04, mid);
      ctx.stroke();
      ctx.textAlign = 'start';
    }
    ctx.restore();

    if (progress < 1) {
      ctx.fillStyle = colors.answer;
      ctx.globalAlpha *= 1 - progress;
      ctx.beginPath();
      ctx.arc(x + total * progress, base - unit * 0.35, Math.max(unit * 0.07, 1.5), 0, Math.PI * 2);
      ctx.fill();
    }

    if (v.lowConfidence && this.settings.showConfidence && progress >= 1 && v.line.verdict.kind !== 'error') {
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = colors.muted;
      ctx.font = `${size * 0.45}px ${ANSWER_FONT}`;
      ctx.fillText('?', x + total + unit * 0.12, base - unit * 0.7);
    }
  }
}

function naturalWidth(ctx: CanvasRenderingContext2D, v: AnswerView, size: number, unit: number): number {
  let w = v.layout.mark ? unit : 0;
  for (const run of v.layout.runs) {
    ctx.font = `${size * (run.scale ?? 1)}px ${ANSWER_FONT}`;
    w += ctx.measureText(run.text).width;
  }
  if (v.layout.fraction) {
    ctx.font = `${size * 0.62}px ${ANSWER_FONT}`;
    w += Math.max(ctx.measureText(v.layout.fraction.num).width, ctx.measureText(v.layout.fraction.den).width) + unit * 0.2;
  }
  return w;
}

function drawCheck(ctx: CanvasRenderingContext2D, x: number, base: number, u: number, w: number, color: string): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = w;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(x + u * 0.05, base - u * 0.45);
  ctx.quadraticCurveTo(x + u * 0.2, base - u * 0.2, x + u * 0.3, base - u * 0.02);
  ctx.quadraticCurveTo(x + u * 0.5, base - u * 0.65, x + u * 0.85, base - u * 1.0);
  ctx.stroke();
}

function drawCross(ctx: CanvasRenderingContext2D, x: number, base: number, u: number, w: number, color: string): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = w;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x + u * 0.08, base - u * 0.8);
  ctx.quadraticCurveTo(x + u * 0.35, base - u * 0.42, x + u * 0.66, base - u * 0.08);
  ctx.moveTo(x + u * 0.66, base - u * 0.82);
  ctx.quadraticCurveTo(x + u * 0.4, base - u * 0.45, x + u * 0.1, base - u * 0.06);
  ctx.stroke();
}
