import type { FormattedNumber } from '../math/format';
import { displaySymbol, type Sym } from '../math/tokens';
import type { AnswerView } from '../render/answers';
import { icons } from './icons';

export interface InspectorCallbacks {
  correct(key: string, label: Sym | null): void;
  setFractions(on: boolean): void;
  fractions(): boolean;
  toast(msg: string): void;
  closed(): void;
}

const confColor = (p: number) => (p >= 0.8 ? 'var(--answer-good)' : p >= 0.5 ? '#e8a13a' : 'var(--answer-bad)');
const OVERLINE = '̅';

export function plainNumber(f: FormattedNumber): string {
  const sign = f.negative ? '−' : '';
  if (f.exponent !== undefined) return `${sign}${f.intPart}${f.fixed ? '.' + f.fixed : ''} × 10^${f.exponent}`;
  const rep = [...f.repeat].map((d) => d + OVERLINE).join('');
  return `${sign}${f.intPart}${f.fixed || f.repeat ? '.' : ''}${f.fixed}${rep}${f.rounded ? '…' : ''}`;
}

function copyText(f: FormattedNumber): string {
  if (f.exponent !== undefined) return `${f.negative ? '-' : ''}${f.intPart}${f.fixed ? '.' + f.fixed : ''}e${f.exponent}`;
  if (!f.repeat) return f.text.replace('…', '');
  const reps = f.repeat.repeat(Math.ceil(12 / f.repeat.length));
  return `${f.negative ? '-' : ''}${f.intPart}.${f.fixed}${reps}`;
}

export class Inspector {
  readonly el: HTMLElement;
  private view: AnswerView | null = null;
  private openChip = -1;

  constructor(
    host: HTMLElement,
    private cb: InspectorCallbacks,
  ) {
    this.el = document.createElement('div');
    this.el.className = 'pop inspector';
    this.el.setAttribute('role', 'dialog');
    this.el.setAttribute('aria-label', 'Answer details');
    host.appendChild(this.el);
    document.addEventListener('pointerdown', (e) => {
      if (this.view && !this.el.contains(e.target as Node)) this.close();
    }, true);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.view) this.close();
    });
  }

  get current(): AnswerView | null {
    return this.view;
  }

  open(view: AnswerView, at: { x: number; y: number }): void {
    this.view = view;
    this.openChip = -1;
    this.render();
    const w = this.el.offsetWidth || 320;
    const h = this.el.offsetHeight || 220;
    const x = Math.min(Math.max(12, at.x - w / 2), innerWidth - w - 12);
    const y = at.y + h + 20 > innerHeight ? Math.max(12, at.y - h - 70) : at.y + 14;
    this.el.style.left = `${x}px`;
    this.el.style.top = `${y}px`;
    this.el.dataset.open = 'true';
  }

  refresh(view: AnswerView | undefined): void {
    if (!this.view) return;
    if (!view) {
      this.close();
      return;
    }
    this.view = view;
    this.render();
  }

  close(): void {
    if (!this.view) return;
    this.view = null;
    this.el.dataset.open = 'false';
    this.cb.closed();
  }

  private render(): void {
    const v = this.view!;
    const line = v.line;
    const syms = line.symbols;
    const chips = syms
      .map((s, i) => `<button class="chip" data-i="${i}" data-open="${i === this.openChip}" style="--conf-color:${confColor(s.confidence)}" title="${Math.round(s.confidence * 100)}% sure">${displaySymbol(s.label)}</button>`)
      .join('');

    let alts = '';
    if (this.openChip >= 0 && syms[this.openChip]) {
      const s = syms[this.openChip]!;
      const options = s.alternatives.filter((a) => a.label !== s.label).slice(0, 3);
      alts = `<div class="alts"><span>Did you mean</span>${options
        .map((a) => `<button class="chip" data-fix="${a.label}">${displaySymbol(a.label)}<small>${Math.max(1, Math.round(a.p * 100))}%</small></button>`)
        .join('')}${s.alternatives.length === 1 ? `<button class="btn" data-fix="__reset">Undo fix</button>` : ''}</div>`;
    }

    let result = '';
    const verdict = line.verdict;
    if (verdict.kind === 'value') {
      const frac = verdict.display.fraction;
      result = `${plainNumber(verdict.display)}${frac ? `<small>= ${frac.replace('-', '−')}</small>` : ''}`;
    } else if (verdict.kind === 'check') {
      result = verdict.correct ? `✓ <small>Your answer is right</small>` : `${plainNumber(verdict.display)}<small>not ${plainNumber(verdict.claimed)}</small>`;
    } else if (verdict.kind === 'undefined') {
      result = `Undefined <small>division by zero</small>`;
    } else if (verdict.kind === 'error') {
      result = `? <small>${verdict.message}</small>`;
    }

    const conf = Math.round(line.confidence * 100);
    const canCopy = verdict.kind === 'value' || (verdict.kind === 'check' && !verdict.correct);
    const hasFraction = verdict.kind === 'value' && verdict.display.fraction !== null && verdict.display.exponent === undefined;
    this.el.innerHTML = `
      <h3>Read as</h3>
      <div class="insp-expr">${chips}</div>
      ${alts}
      <div class="insp-result">${result}</div>
      <div class="insp-meta">
        <div class="conf" title="Lowest per-symbol confidence in this line"><div class="conf-bar" style="--conf-color:${confColor(line.confidence)}"><i style="width:${conf}%"></i></div>${conf}% sure</div>
        <div style="display:flex;gap:6px">
          ${hasFraction ? `<button class="btn" data-act="frac">${this.cb.fractions() ? '0.5' : '½'}</button>` : ''}
          ${canCopy ? `<button class="btn" data-act="copy">${icons.copy}Copy</button>` : ''}
        </div>
      </div>`;

    this.el.querySelectorAll<HTMLButtonElement>('.insp-expr .chip').forEach((b) =>
      b.addEventListener('click', () => {
        const i = Number(b.dataset.i);
        this.openChip = this.openChip === i ? -1 : i;
        this.render();
      }),
    );
    this.el.querySelectorAll<HTMLButtonElement>('[data-fix]').forEach((b) =>
      b.addEventListener('click', () => {
        const s = syms[this.openChip];
        if (!s) return;
        const label = b.dataset.fix === '__reset' ? null : (b.dataset.fix as Sym);
        this.cb.correct(s.key, label);
        this.openChip = -1;
      }),
    );
    this.el.querySelector('[data-act="copy"]')?.addEventListener('click', async () => {
      const d = verdict.kind === 'value' || verdict.kind === 'check' ? verdict.display : null;
      if (!d) return;
      try {
        await navigator.clipboard.writeText(copyText(d));
        this.cb.toast('Copied to clipboard');
      } catch {
        this.cb.toast('Clipboard unavailable');
      }
    });
    this.el.querySelector('[data-act="frac"]')?.addEventListener('click', () => this.cb.setFractions(!this.cb.fractions()));
  }
}
