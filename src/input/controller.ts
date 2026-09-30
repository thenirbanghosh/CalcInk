import { PixelEraseSession, strokesHitByCapsule } from '../core/eraser';
import { scratchTargets } from '../core/gestures';
import type { History } from '../core/history';
import type { InkColor, Stroke, StrokeStore } from '../core/strokes';
import { clientToScreen, type Viewport } from '../core/viewport';
import type { Surface } from '../render/surface';

export type Tool = 'pen' | 'stroke-eraser' | 'pixel-eraser';

export interface InputCallbacks {
  penState(down: boolean): void;
  viewChanged(): void;
  tap(wx: number, wy: number, sx: number, sy: number): boolean;
  eraserCursor(pos: { x: number; y: number; r: number } | null): void;
  committed(kind: 'draw' | 'erase' | 'scratch', strokes: readonly Stroke[]): void;
}

interface Settings {
  tool: Tool;
  width: number; // CSS px
  color: InkColor;
  eraserRadius: number; // CSS px
}

type Mode =
  | { kind: 'idle' }
  | { kind: 'draw'; id: number; pts: number[]; pressure: boolean; start: number; downAt: { x: number; y: number } }
  | { kind: 'erase-stroke'; id: number; last: { x: number; y: number }; removed: Stroke[] }
  | { kind: 'erase-pixel'; id: number; last: { x: number; y: number }; session: PixelEraseSession }
  | { kind: 'pan'; id: number; last: { x: number; y: number } }
  | { kind: 'pinch' };

const TAP_SLOP = 5; // CSS px
const TAP_MS = 300;

export class InputController {
  settings: Settings = { tool: 'pen', width: 3.2, color: 'graphite', eraserRadius: 14 };
  private mode: Mode = { kind: 'idle' };
  private touches = new Map<number, { x: number; y: number }>();
  private pinchPrev: { d: number; cx: number; cy: number } | null = null;
  private penSeen = false;
  private spaceHeld = false;
  private rect: DOMRect;

  constructor(
    private el: HTMLElement,
    private store: StrokeStore,
    private history: History,
    private view: Viewport,
    private surface: Surface,
    private cb: InputCallbacks,
  ) {
    this.rect = el.getBoundingClientRect();
    new ResizeObserver(() => (this.rect = el.getBoundingClientRect())).observe(el);
    window.addEventListener('scroll', () => (this.rect = el.getBoundingClientRect()), { passive: true });

    el.addEventListener('pointerdown', (e) => this.down(e));
    el.addEventListener('pointermove', (e) => this.move(e));
    el.addEventListener('pointerup', (e) => this.up(e, false));
    el.addEventListener('pointercancel', (e) => this.up(e, true));
    el.addEventListener('pointerleave', (e) => {
      if (e.pointerType === 'mouse' && this.mode.kind === 'idle') this.cb.eraserCursor(null);
    });
    el.addEventListener('wheel', (e) => this.wheel(e), { passive: false });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space' && !isTyping(e)) {
        this.spaceHeld = true;
        el.style.cursor = 'grab';
      }
    });
    window.addEventListener('keyup', (e) => {
      if (e.code === 'Space') {
        this.spaceHeld = false;
        el.style.cursor = '';
      }
    });
  }

  get penDetected(): boolean {
    return this.penSeen;
  }

  private screen(e: PointerEvent | WheelEvent): { x: number; y: number } {
    return clientToScreen(e.clientX, e.clientY, this.rect);
  }

  private down(e: PointerEvent): void {
    if (e.pointerType === 'pen') this.penSeen = true;
    const p = this.screen(e);

    if (e.pointerType === 'touch') {
      this.touches.set(e.pointerId, p);
      if (this.touches.size === 2) {
        this.abandonForGesture();
        this.mode = { kind: 'pinch' };
        this.pinchPrev = this.pinchState();
        return;
      }
      if (this.touches.size > 2 || this.mode.kind !== 'idle') return;
      // palm rejection: once a pen was used, fingers pan instead of drawing
      if (this.penSeen) {
        this.startPan(e, p);
        return;
      }
    } else if (this.mode.kind !== 'idle') return;

    if (e.pointerType === 'mouse' && (e.button === 1 || (e.button === 0 && this.spaceHeld))) {
      this.startPan(e, p);
      return;
    }
    if (e.pointerType === 'mouse' && e.button !== 0) return;

    capture(this.el, e.pointerId);
    const w = this.view.toWorld(p.x, p.y);
    const eraserEnd = e.pointerType === 'pen' && (e.button === 5 || (e.buttons & 32) !== 0);
    const tool = eraserEnd ? 'stroke-eraser' : this.settings.tool;

    if (tool === 'pen') {
      this.mode = { kind: 'draw', id: e.pointerId, pts: [], pressure: e.pointerType === 'pen', start: performance.now(), downAt: p };
      this.addSample(w.x, w.y, e);
      this.cb.penState(true);
      this.pushLive([]);
    } else if (tool === 'stroke-eraser') {
      this.mode = { kind: 'erase-stroke', id: e.pointerId, last: w, removed: [] };
      this.eraseStrokesAlong(w, w);
      this.cb.penState(true);
    } else {
      const session = new PixelEraseSession(this.store);
      this.mode = { kind: 'erase-pixel', id: e.pointerId, last: w, session };
      session.eraseAt(w.x, w.y, this.worldEraser());
      this.cb.penState(true);
    }
  }

  private move(e: PointerEvent): void {
    const p = this.screen(e);
    if (e.pointerType === 'touch' && this.touches.has(e.pointerId)) this.touches.set(e.pointerId, p);

    const m = this.mode;
    if (m.kind === 'pinch') {
      const s = this.pinchState();
      if (s && this.pinchPrev) {
        this.view.zoomAt(s.cx, s.cy, s.d / this.pinchPrev.d);
        this.view.panBy(s.cx - this.pinchPrev.cx, s.cy - this.pinchPrev.cy);
        this.cb.viewChanged();
      }
      this.pinchPrev = s;
      return;
    }

    const tool = this.settings.tool;
    if (m.kind === 'idle') {
      if (e.pointerType !== 'touch' && tool !== 'pen') {
        const w = this.view.toWorld(p.x, p.y);
        this.cb.eraserCursor({ x: w.x, y: w.y, r: this.worldEraser() });
      }
      return;
    }
    if (!('id' in m) || m.id !== e.pointerId) return;

    if (m.kind === 'pan') {
      this.view.panBy(p.x - m.last.x, p.y - m.last.y);
      m.last = p;
      this.cb.viewChanged();
      return;
    }

    const events = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
    const samples = events.length ? events : [e];

    if (m.kind === 'draw') {
      for (const ev of samples) {
        const q = this.screen(ev);
        const w = this.view.toWorld(q.x, q.y);
        this.addSample(w.x, w.y, ev);
      }
      const predicted: number[] = [];
      if (typeof e.getPredictedEvents === 'function') {
        for (const ev of e.getPredictedEvents()) {
          const q = this.screen(ev);
          const w = this.view.toWorld(q.x, q.y);
          predicted.push(w.x, w.y, m.pressure ? ev.pressure : 0.5);
        }
      }
      this.pushLive(predicted);
      return;
    }

    for (const ev of samples) {
      const q = this.screen(ev);
      const w = this.view.toWorld(q.x, q.y);
      if (m.kind === 'erase-stroke') this.eraseStrokesAlong(m.last, w);
      else {
        const r = this.worldEraser();
        const dist = Math.hypot(w.x - m.last.x, w.y - m.last.y);
        // sub-step so fast swipes erase a continuous band
        const steps = Math.max(1, Math.ceil(dist / (r * 0.5)));
        for (let i = 1; i <= steps; i++) {
          const t = i / steps;
          m.session.eraseAt(m.last.x + (w.x - m.last.x) * t, m.last.y + (w.y - m.last.y) * t, r);
        }
      }
      m.last = w;
    }
    this.cb.eraserCursor({ x: m.last.x, y: m.last.y, r: this.worldEraser() });
  }

  private up(e: PointerEvent, cancelled: boolean): void {
    if (e.pointerType === 'touch') {
      this.touches.delete(e.pointerId);
      if (this.mode.kind === 'pinch') {
        if (this.touches.size < 2) {
          this.mode = { kind: 'idle' };
          this.pinchPrev = null;
        }
        return;
      }
    }
    const m = this.mode;
    if (!('id' in m) || m.id !== e.pointerId) return;
    this.mode = { kind: 'idle' };
    if (this.el.hasPointerCapture(e.pointerId)) this.el.releasePointerCapture(e.pointerId);

    switch (m.kind) {
      case 'pan':
        return;
      case 'erase-stroke':
        this.history.record('erase', { added: [], removed: m.removed });
        if (m.removed.length) this.cb.committed('erase', m.removed);
        this.cb.penState(false);
        if (e.pointerType !== 'mouse') this.cb.eraserCursor(null);
        return;
      case 'erase-pixel': {
        const r = m.session.result();
        this.history.record('erase', r);
        if (r.removed.length) this.cb.committed('erase', r.removed);
        this.cb.penState(false);
        if (e.pointerType !== 'mouse') this.cb.eraserCursor(null);
        return;
      }
      case 'draw': {
        this.surface.setLive(null);
        // tap = pointer barely moved. checking start/end distance alone breaks on a fast "0"
        let travel = 0;
        for (let i = 3; i < m.pts.length; i += 3) travel += Math.hypot(m.pts[i]! - m.pts[i - 3]!, m.pts[i + 1]! - m.pts[i - 2]!);
        const p = this.screen(e);
        const isTap = travel * this.view.zoom < TAP_SLOP && performance.now() - m.start < TAP_MS;
        if (!cancelled && isTap) {
          const w = this.view.toWorld(p.x, p.y);
          if (this.cb.tap(w.x, w.y, p.x, p.y)) {
            this.cb.penState(false);
            return;
          }
        }
        if (!cancelled && m.pts.length >= 3) this.commitStroke(m.pts, m.pressure);
        this.cb.penState(false);
        return;
      }
    }
  }

  private commitStroke(pts: number[], pressure: boolean): void {
    const stroke = this.store.create({
      pts: Float32Array.from(pts),
      width: this.settings.width / this.view.zoom,
      color: this.settings.color,
      pressure,
    });
    const targets = scratchTargets(stroke, this.nearby(stroke));
    if (targets.length) {
      this.history.commit('scratch-out', { added: [], removed: targets });
      this.cb.committed('scratch', targets);
      return;
    }
    this.history.commit('draw', { added: [stroke], removed: [] });
    this.cb.committed('draw', [stroke]);
  }

  private nearby(s: Stroke): Stroke[] {
    const b = s.bbox;
    return this.store.all().filter((o) => o.bbox.maxX >= b.minX && o.bbox.minX <= b.maxX && o.bbox.maxY >= b.minY && o.bbox.minY <= b.maxY);
  }

  private addSample(x: number, y: number, e: PointerEvent): void {
    const m = this.mode;
    if (m.kind !== 'draw') return;
    const n = m.pts.length;
    if (n >= 3) {
      const dx = x - m.pts[n - 3]!;
      const dy = y - m.pts[n - 2]!;
      if (dx * dx + dy * dy < (0.5 / this.view.zoom) ** 2) return;
    }
    m.pts.push(x, y, m.pressure ? Math.max(0.05, e.pressure || 0.5) : 0.5);
  }

  private pushLive(predicted: number[]): void {
    const m = this.mode;
    if (m.kind !== 'draw') return;
    this.surface.setLive({
      pts: m.pts,
      predicted,
      width: this.settings.width / this.view.zoom,
      color: this.surface.palette.ink[this.settings.color],
      pressure: m.pressure,
    });
  }

  private eraseStrokesAlong(a: { x: number; y: number }, b: { x: number; y: number }): void {
    const m = this.mode;
    if (m.kind !== 'erase-stroke') return;
    const hits = strokesHitByCapsule(this.store.all(), a.x, a.y, b.x, b.y, this.worldEraser());
    if (!hits.length) return;
    m.removed.push(...hits);
    this.store.apply({ added: [], removed: hits });
  }

  private worldEraser(): number {
    return this.settings.eraserRadius / this.view.zoom;
  }

  private startPan(e: PointerEvent, p: { x: number; y: number }): void {
    capture(this.el, e.pointerId);
    this.mode = { kind: 'pan', id: e.pointerId, last: p };
  }

  private abandonForGesture(): void {
    const m = this.mode;
    if (m.kind === 'draw') {
      this.surface.setLive(null);
      this.cb.penState(false);
    }
    this.mode = { kind: 'idle' };
  }

  private pinchState(): { d: number; cx: number; cy: number } | null {
    const t = [...this.touches.values()];
    if (t.length < 2) return null;
    const [a, b] = t as [{ x: number; y: number }, { x: number; y: number }];
    return { d: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
  }

  private wheel(e: WheelEvent): void {
    e.preventDefault();
    const p = this.screen(e);
    const scale = e.deltaMode === 1 ? 16 : 1;
    if (e.ctrlKey || e.metaKey) this.view.zoomAt(p.x, p.y, Math.exp(-e.deltaY * scale * 0.01));
    else this.view.panBy(-e.deltaX * scale, -e.deltaY * scale);
    this.cb.viewChanged();
  }
}

function capture(el: HTMLElement, id: number): void {
  try {
    el.setPointerCapture(id);
  } catch {
  }
}

function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
}
