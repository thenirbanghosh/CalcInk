export interface HudSources {
  strokes(): number;
  pathCache(): number;
  history(): { undo: number; redo: number };
  modelLoadMs(): number;
}

export interface RecognitionSample {
  latencyMs: number;
  workerMs: number;
  inferMs: number;
  classified: number;
  cached: number;
}

export class Hud {
  private frames: number[] = [];
  private last = 0;
  private raf = 0;
  private dropped = 0;
  private totalFrames = 0;
  private longTasks = 0;
  private longTaskMs = 0;
  private renderWork: number[] = [];
  private rec: RecognitionSample | null = null;
  private recCount = 0;
  private timer = 0;
  private graph!: HTMLCanvasElement;
  private body!: HTMLElement;
  private refresh = 16.7;

  constructor(
    private el: HTMLElement,
    private src: HudSources,
  ) {
    try {
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          this.longTasks++;
          this.longTaskMs += e.duration;
        }
      }).observe({ type: 'longtask', buffered: false });
    } catch {
    }
    el.innerHTML = `<div class="hud-title"><span>Performance</span><span id="hud-hz"></span></div><canvas width="400" height="76"></canvas><div class="hud-body"></div>`;
    this.graph = el.querySelector('canvas')!;
    this.body = el.querySelector('.hud-body')!;
  }

  get visible(): boolean {
    return !this.el.hidden;
  }

  setVisible(v: boolean): void {
    this.el.hidden = !v;
    cancelAnimationFrame(this.raf);
    clearInterval(this.timer);
    if (!v) return;
    this.frames = [];
    this.dropped = 0;
    this.totalFrames = 0;
    this.longTasks = 0;
    this.longTaskMs = 0;
    this.last = 0;
    const tick = (t: number) => {
      if (this.last) {
        const dt = t - this.last;
        this.frames.push(dt);
        if (this.frames.length > 240) this.frames.shift();
        this.totalFrames++;
        if (dt > this.refresh * 1.7) this.dropped += Math.round(dt / this.refresh) - 1;
      }
      this.last = t;
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
    this.timer = window.setInterval(() => this.render(), 250);
  }

  noteRender(ms: number): void {
    this.renderWork.push(ms);
    if (this.renderWork.length > 240) this.renderWork.shift();
  }

  noteRecognition(r: RecognitionSample): void {
    this.rec = r;
    this.recCount++;
  }

  private render(): void {
    const f = this.frames.slice(-120);
    if (!f.length) return;
    this.refresh = [...this.frames].sort((a, b) => a - b)[Math.floor(this.frames.length * 0.25)] ?? 16.7;
    const avg = f.reduce((a, b) => a + b, 0) / f.length;
    const fps = 1000 / avg;
    const p95 = [...f].sort((a, b) => a - b)[Math.floor(f.length * 0.95)] ?? 0;
    const worst = Math.max(...f);
    const work = this.renderWork.length ? Math.max(...this.renderWork.slice(-120)) : 0;
    const mem = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
    const hz = Math.round(1000 / this.refresh);
    this.el.querySelector('#hud-hz')!.textContent = `${hz} Hz display`;
    const r = this.rec;
    const good = (ok: boolean) => (ok ? 'good' : 'warn');
    const rows: [string, string, string?][] = [
      ['Frame rate', `${fps.toFixed(0)} fps`, good(fps > hz * 0.9)],
      ['Frame p95 / worst', `${p95.toFixed(1)} / ${worst.toFixed(1)} ms`, good(p95 < this.refresh * 1.5)],
      ['Dropped frames', `${this.dropped} / ${this.totalFrames}`, good(this.dropped <= this.totalFrames * 0.01)],
      ['Long tasks since open', `${this.longTasks}${this.longTasks ? ` (${this.longTaskMs.toFixed(0)} ms)` : ''}`, good(this.longTasks === 0)],
      ['UI render work max', `${work.toFixed(2)} ms`],
      ['Recognition (worker)', r ? `${r.workerMs.toFixed(1)} ms` : '-'],
      ['  model inference', r ? `${r.inferMs.toFixed(1)} ms, ${r.classified} new` : '-'],
      ['  pen up to answer', r ? `${r.latencyMs.toFixed(0)} ms` : '-'],
      ['Model load', `${this.src.modelLoadMs().toFixed(0)} ms`],
      ['Strokes / paths', `${this.src.strokes()} / ${this.src.pathCache()}`],
      ['Undo / redo depth', `${this.src.history().undo} / ${this.src.history().redo}`],
    ];
    if (mem) rows.push(['JS heap', `${(mem.usedJSHeapSize / 1048576).toFixed(1)} MB`]);
    this.body.innerHTML = rows.map(([k, v, c]) => `<div class="hud-row"><span>${k}</span><b class="${c ?? ''}">${v}</b></div>`).join('');
    this.drawGraph(f);
  }

  private drawGraph(f: number[]): void {
    const c = this.graph;
    const ctx = c.getContext('2d')!;
    const w = c.width, h = c.height;
    ctx.clearRect(0, 0, w, h);
    const max = Math.max(50, ...f);
    const y = (ms: number) => h - (ms / max) * h;
    const cs = getComputedStyle(this.el);
    ctx.strokeStyle = cs.getPropertyValue('--muted');
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(0, y(this.refresh));
    ctx.lineTo(w, y(this.refresh));
    ctx.stroke();
    ctx.setLineDash([]);
    const bw = w / 120;
    f.forEach((ms, i) => {
      ctx.fillStyle = ms > this.refresh * 1.7 ? cs.getPropertyValue('--answer-bad') : cs.getPropertyValue('--answer');
      ctx.fillRect(i * bw, y(ms), Math.max(1, bw - 1), h - y(ms));
    });
  }
}
