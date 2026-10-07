import { backingStoreSize, type Viewport } from '../core/viewport';
import { rectsIntersect, type Rect } from '../core/geometry';
import type { Stroke, StrokeStore } from '../core/strokes';
import { PathCache, strokePath } from './ink';
import type { Palette } from './theme';

export interface LiveStroke {
  pts: number[];
  predicted: number[];
  width: number;
  color: string;
  pressure: boolean;
}

export type OverlayPainter = (ctx: CanvasRenderingContext2D, now: number) => boolean;

export class Surface {
  readonly ink: HTMLCanvasElement;
  readonly live: HTMLCanvasElement;
  readonly overlay: HTMLCanvasElement;
  private inkCtx: CanvasRenderingContext2D;
  private liveCtx: CanvasRenderingContext2D;
  private overlayCtx: CanvasRenderingContext2D;
  readonly paths = new PathCache();

  cssWidth = 1;
  cssHeight = 1;
  dpr = 1;
  palette!: Palette;

  private inkFull = true;
  private inkAdds: Stroke[] = [];
  private liveDirty = false;
  private overlayDirty = true;
  private overlayAnimating = false;
  private scheduled = false;
  private liveStroke: LiveStroke | null = null;
  private hiddenIds = new Set<number>();
  painter: OverlayPainter = () => false;
  onFrame: (t: number, workMs: number) => void = () => {};

  constructor(
    private host: HTMLElement,
    private store: StrokeStore,
    private view: Viewport,
  ) {
    const make = (cls: string) => {
      const c = document.createElement('canvas');
      c.className = `layer ${cls}`;
      host.appendChild(c);
      return c;
    };
    this.ink = make('layer-ink');
    this.live = make('layer-live');
    this.overlay = make('layer-overlay');
    this.inkCtx = this.ink.getContext('2d', { alpha: true })!;
    // desynchronized = lower latency for the pen layer where supported
    this.liveCtx = (this.live.getContext('2d', { alpha: true, desynchronized: true }) ?? this.live.getContext('2d'))!;
    this.overlayCtx = this.overlay.getContext('2d', { alpha: true })!;

    store.onChange(({ added, removed }) => {
      for (const s of removed) this.paths.delete(s.id);
      if (removed.length) this.inkFull = true;
      else this.inkAdds.push(...added);
      this.request();
    });

    const ro = new ResizeObserver((entries) => {
      const e = entries[0]!;
      const box = e.contentBoxSize?.[0];
      const dev = (e as ResizeObserverEntry & { devicePixelContentBoxSize?: ResizeObserverSize[] }).devicePixelContentBoxSize?.[0];
      this.resize(box ? box.inlineSize : host.clientWidth, box ? box.blockSize : host.clientHeight, dev);
    });
    try {
      ro.observe(host, { box: 'device-pixel-content-box' });
    } catch {
      ro.observe(host);
    }
    this.watchDpr();
    // first draw on a canvas is slow (allocation, shaders), so do it while idle
    const warm = () => {
      const sample = strokePath([2, 2, 0.5, 9, 6, 0.6, 16, 3, 0.5], 2, false, true);
      for (const ctx of [this.inkCtx, this.liveCtx, this.overlayCtx]) {
        ctx.fillStyle = 'rgba(0,0,0,0.01)';
        ctx.fillRect(0, 0, 1, 1);
        ctx.fill(sample);
        ctx.font = '20px Caveat, cursive';
        ctx.fillText('0', 2, 18);
        ctx.clearRect(0, 0, 24, 24);
      }
    };
    if ('requestIdleCallback' in window) requestIdleCallback(warm, { timeout: 2000 });
    else setTimeout(warm, 500);
  }

  private watchDpr(): void {
    const mq = matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    const onChange = () => {
      this.resize(this.host.clientWidth, this.host.clientHeight);
      this.watchDpr();
    };
    mq.addEventListener('change', onChange, { once: true });
  }

  resize(cssWidth: number, cssHeight: number, exactDevice?: { inlineSize: number; blockSize: number }): void {
    this.dpr = window.devicePixelRatio || 1;
    this.cssWidth = Math.max(1, cssWidth);
    this.cssHeight = Math.max(1, cssHeight);
    const { width, height } = backingStoreSize(this.cssWidth, this.cssHeight, this.dpr, exactDevice);
    for (const c of [this.ink, this.live, this.overlay]) {
      if (c.width !== width || c.height !== height) {
        c.width = width;
        c.height = height;
      }
      c.style.width = `${this.cssWidth}px`;
      c.style.height = `${this.cssHeight}px`;
    }
    this.invalidateAll();
  }

  invalidateAll(): void {
    this.inkFull = true;
    this.liveDirty = true;
    this.overlayDirty = true;
    this.request();
  }

  invalidateInk(): void {
    this.inkFull = true;
    this.request();
  }

  invalidateOverlay(): void {
    this.overlayDirty = true;
    this.request();
  }

  setHidden(ids: Iterable<number>): void {
    this.hiddenIds = new Set(ids);
    this.invalidateInk();
  }

  setLive(stroke: LiveStroke | null): void {
    this.liveStroke = stroke;
    this.liveDirty = true;
    this.request();
  }

  request(): void {
    if (this.scheduled) return;
    this.scheduled = true;
    requestAnimationFrame((t) => this.frame(t));
  }

  fillStroke(ctx: CanvasRenderingContext2D, s: Stroke): void {
    ctx.fillStyle = this.palette.ink[s.color];
    ctx.fill(this.store.has(s.id) ? this.paths.get(s) : this.paths.transient(s));
  }

  worldTransform(ctx: CanvasRenderingContext2D): void {
    ctx.setTransform(...this.view.deviceTransform(this.dpr));
  }

  visibleWorld(): Rect {
    return this.view.visibleWorld(this.cssWidth, this.cssHeight);
  }

  private frame(t: number): void {
    this.scheduled = false;
    const start = performance.now();

    if (this.inkFull) {
      const ctx = this.inkCtx;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, this.ink.width, this.ink.height);
      this.worldTransform(ctx);
      const vis = this.visibleWorld();
      for (const s of this.store.all()) {
        if (this.hiddenIds.has(s.id)) continue;
        const pad = s.width;
        if (!rectsIntersect(vis, { minX: s.bbox.minX - pad, minY: s.bbox.minY - pad, maxX: s.bbox.maxX + pad, maxY: s.bbox.maxY + pad })) continue;
        this.fillStroke(ctx, s);
      }
      this.inkFull = false;
      this.inkAdds.length = 0;
    } else if (this.inkAdds.length) {
      const ctx = this.inkCtx;
      this.worldTransform(ctx);
      for (const s of this.inkAdds) if (this.store.has(s.id)) this.fillStroke(ctx, s);
      this.inkAdds.length = 0;
    }

    if (this.liveDirty) {
      const ctx = this.liveCtx;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, this.live.width, this.live.height);
      const l = this.liveStroke;
      if (l && l.pts.length) {
        this.worldTransform(ctx);
        ctx.fillStyle = l.color;
        ctx.fill(strokePath(l.pts, l.width, l.pressure, false, l.predicted));
      }
      this.liveDirty = false;
    }

    if (this.overlayDirty || this.overlayAnimating) {
      const ctx = this.overlayCtx;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, this.overlay.width, this.overlay.height);
      this.overlayAnimating = this.painter(ctx, t);
      this.overlayDirty = false;
      if (this.overlayAnimating) this.request();
    }

    this.onFrame(t, performance.now() - start);
  }
}
