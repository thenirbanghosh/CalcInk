import { History } from '../core/history';
import { StrokeStore, type InkColor, type Stroke } from '../core/strokes';
import { Viewport } from '../core/viewport';
import { rectCenterX, rectCenterY } from '../core/geometry';
import { writeExpression } from '../demo/handwriting';
import { haptic, playAnswer, playSoft, playSwish, primeAudio } from '../feedback/sound';
import { InputController, type Tool } from '../input/controller';
import { displaySymbol } from '../math/tokens';
import { loadNotebook, loadPrefs, saveNotebook, savePrefs } from '../persist/storage';
import { RecognizerClient } from '../recognition/client';
import type { LineResult } from '../recognition/pipeline';
import { AnswerLayer, type AnswerView } from '../render/answers';
import { Surface } from '../render/surface';
import { readPalette } from '../render/theme';
import { Hud } from '../ui/hud';
import { icons } from '../ui/icons';
import { Inspector } from '../ui/inspector';

type Theme = 'auto' | 'light' | 'dark';
type PaperStyle = 'dots' | 'lines' | 'grid' | 'plain';

interface Prefs {
  tool: Tool;
  width: number;
  color: InkColor;
  theme: Theme;
  paper: PaperStyle;
  sound: boolean;
  haptics: boolean;
  fractions: boolean;
  confidence: boolean;
  xray: boolean;
  hud: boolean;
}

const DEFAULTS: Prefs = {
  tool: 'pen',
  width: 3.2,
  color: 'graphite',
  theme: 'auto',
  paper: 'dots',
  sound: true,
  haptics: true,
  fractions: false,
  confidence: true,
  xray: false,
  hud: false,
};

const GRID = 28;
const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

interface Fading {
  stroke: Stroke;
  t0: number;
}

export class App {
  readonly store = new StrokeStore();
  readonly history = new History(this.store);
  readonly view = new Viewport();
  readonly prefs: Prefs = loadPrefs(DEFAULTS);
  readonly surface: Surface;
  readonly answers = new AnswerLayer();
  readonly recognizer: RecognizerClient;
  readonly input: InputController;
  readonly hud: Hud;
  readonly inspector: Inspector;

  lines: LineResult[] = [];
  private fading: Fading[] = [];
  private eraser: { x: number; y: number; r: number } | null = null;
  private quietUntil = 0;
  private saveTimer = 0;
  private toastTimer = 0;
  private offlineReady = false;
  private demoRunning = false;
  private stage = $('#stage');
  private paper = $('#paper');

  constructor() {
    this.applyTheme();
    this.surface = new Surface(this.stage, this.store, this.view);
    this.surface.palette = readPalette();
    this.answers.settings = { fractions: this.prefs.fractions, showConfidence: this.prefs.confidence };
    this.answers.onAppear = (v) => this.announce(v);
    this.answers.version = () => this.store.version;
    this.answers.obstacle = (x, top, bottom) => {
      let wall: number | null = null;
      for (const s of this.store.all()) {
        const b = s.bbox;
        if (b.minX > x && b.maxY > top && b.minY < bottom && (wall === null || b.minX < wall)) wall = b.minX;
      }
      return wall;
    };
    this.surface.painter = (ctx, now) => this.paintOverlay(ctx, now);

    this.recognizer = new RecognizerClient(this.store);
    this.recognizer.onStatus = () => this.updateStatus();
    this.recognizer.onResult = (u) => {
      this.lines = u.lines;
      this.answers.update(u.lines, performance.now());
      this.inspector.refresh(this.inspector.current ? this.answers.views.get(this.inspector.current.key) : undefined);
      this.surface.invalidateOverlay();
      this.hud.noteRecognition({ latencyMs: u.latencyMs, workerMs: u.stats.totalMs, inferMs: u.stats.inferMs, classified: u.stats.classified, cached: u.stats.cached });
    };

    this.input = new InputController(this.stage, this.store, this.history, this.view, this.surface, {
      penState: (down) => this.recognizer.setPenDown(down),
      viewChanged: () => this.onViewChanged(),
      tap: (wx, wy) => this.onTap(wx, wy),
      eraserCursor: (c) => {
        this.eraser = c;
        this.surface.invalidateOverlay();
      },
      committed: (kind, strokes) => this.onCommitted(kind, strokes),
    });
    Object.assign(this.input.settings, { tool: this.prefs.tool, width: this.prefs.width, color: this.prefs.color });

    this.hud = new Hud($('#hud'), {
      strokes: () => this.store.size,
      pathCache: () => this.surface.paths.size,
      history: () => this.history.depth,
      modelLoadMs: () => this.recognizer.loadMs,
    });
    this.surface.onFrame = (_, work) => this.hud.noteRender(work);

    this.inspector = new Inspector($('#app'), {
      correct: (key, label) => this.recognizer.override(key, label),
      setFractions: (on) => this.setPref('fractions', on),
      fractions: () => this.prefs.fractions,
      toast: (m) => this.toast(m),
      closed: () => this.surface.invalidateOverlay(),
    });

    this.buildToolbar();
    this.bindKeys();
    this.store.onChange(() => {
      this.scheduleSave();
      this.updateEmpty();
    });
    this.history.onChange(() => this.syncToolbar());
    $('#zoom').addEventListener('click', () => this.resetView());
    $('#demo').addEventListener('click', () => void this.demo());
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => this.applyTheme());
    primeAudio();

    void document.fonts.load(`48px Caveat`).then(() => {
      const probe = document.createElement('canvas').getContext('2d')!;
      this.answers.calibrate(probe);
      this.surface.invalidateOverlay();
    });

    this.hud.setVisible(this.prefs.hud);
    this.onViewChanged();
    this.updateStatus();
    void this.restore();
  }

  private async restore(): Promise<void> {
    const saved = await loadNotebook();
    if (saved && saved.strokes.length) {
      const strokes = saved.strokes.map((s) => this.store.create({ pts: s.pts, width: s.width, color: s.color, pressure: s.pressure, seq: s.seq }));
      this.quietUntil = performance.now() + 2500;
      this.store.apply({ added: strokes, removed: [] });
      Object.assign(this.view, saved.view);
      this.onViewChanged();
    }
    this.updateEmpty();
  }

  private scheduleSave(): void {
    window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      void saveNotebook(this.store.all(), { panX: this.view.panX, panY: this.view.panY, zoom: this.view.zoom });
    }, 600);
  }

  setOfflineReady(ready: boolean): void {
    this.offlineReady = ready;
    this.updateStatus();
  }

  private updateStatus(): void {
    const el = $('#status');
    const label = el.querySelector('.status-label')!;
    const s = this.recognizer?.status ?? 'loading';
    el.dataset.state = s;
    if (s === 'loading') label.textContent = 'Loading model...';
    else if (s === 'error') label.textContent = 'Recognizer failed to load';
    else label.textContent = this.offlineReady ? 'Ready, works offline' : 'Ready';
    el.title =
      s === 'ready'
        ? `Models loaded in ${this.recognizer.loadMs.toFixed(0)} ms. Recognition runs in the browser, nothing is sent anywhere.${this.offlineReady ? ' Cached for offline use.' : ''}`
        : 'Recognition runs on this device';
  }

  private onCommitted(kind: 'draw' | 'erase' | 'scratch', strokes: readonly Stroke[]): void {
    if (kind === 'scratch') {
      const now = performance.now();
      this.fading.push(...strokes.map((stroke) => ({ stroke, t0: now })));
      if (this.prefs.sound) playSwish();
      if (this.prefs.haptics) haptic([6, 30, 6]);
      this.surface.invalidateOverlay();
    }
  }

  private announce(v: AnswerView): void {
    if (performance.now() < this.quietUntil) return;
    const k = v.line.verdict.kind;
    const bad = k === 'undefined' || (k === 'check' && !v.line.verdict.correct);
    if (this.prefs.sound && k !== 'error') (bad ? playSoft : playAnswer)();
    if (this.prefs.haptics && k !== 'error') haptic(bad ? [10, 40, 10] : 10);
  }

  private onTap(wx: number, wy: number): boolean {
    const hit = this.answers.hitTest(wx, wy);
    if (!hit) return false;
    const r = hit.rect;
    const s = this.view.toScreen(rectCenterX(r), r.maxY);
    this.inspector.open(hit, { x: s.x, y: s.y });
    this.surface.invalidateOverlay();
    return true;
  }

  private onViewChanged(): void {
    const z = this.view.zoom;
    const g = GRID * z;
    this.paper.style.setProperty('--g', `${g}px`);
    this.paper.style.setProperty('--ox', `${this.view.panX % g}px`);
    this.paper.style.setProperty('--oy', `${this.view.panY % (this.prefs.paper === 'lines' ? g * 2 : g)}px`);
    this.paper.style.setProperty('--dot', `${Math.min(1.6, Math.max(0.7, 1.1 * Math.sqrt(z)))}px`);
    $('#zoom').textContent = `${Math.round(z * 100)}%`;
    this.inspector.close();
    this.surface.invalidateAll();
    this.scheduleSave();
  }

  private resetView(): void {
    this.view.reset();
    this.onViewChanged();
  }

  private paintOverlay(ctx: CanvasRenderingContext2D, now: number): boolean {
    const pal = this.surface.palette;
    this.surface.worldTransform(ctx);
    const z = this.view.zoom;
    let animating = false;

    const insp = this.inspector.current;
    if (insp) {
      const b = insp.line.bbox;
      const pad = insp.line.unit * 0.25;
      ctx.fillStyle = pal.answer;
      ctx.globalAlpha = 0.07;
      roundRect(ctx, b.minX - pad, b.minY - pad, insp.rect.maxX - b.minX + 2 * pad, b.maxY - b.minY + 2 * pad, pad);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    animating = this.answers.draw(ctx, now, pal) || animating;

    if (this.prefs.xray) this.paintXray(ctx);

    if (this.fading.length) {
      this.fading = this.fading.filter((f) => now - f.t0 < 280);
      for (const f of this.fading) {
        const t = (now - f.t0) / 280;
        const cx = rectCenterX(f.stroke.bbox);
        const cy = rectCenterY(f.stroke.bbox);
        ctx.save();
        ctx.globalAlpha = (1 - t) * 0.9;
        ctx.translate(cx, cy);
        ctx.scale(1 - 0.35 * t, 1 - 0.35 * t);
        ctx.translate(-cx, -cy);
        this.surface.fillStroke(ctx, f.stroke);
        ctx.restore();
      }
      animating = animating || this.fading.length > 0;
    }

    if (this.eraser) {
      ctx.strokeStyle = pal.muted;
      ctx.lineWidth = 1.2 / z;
      ctx.beginPath();
      ctx.arc(this.eraser.x, this.eraser.y, this.eraser.r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 0.08;
      ctx.fillStyle = pal.muted;
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    return animating;
  }

  private paintXray(ctx: CanvasRenderingContext2D): void {
    const pal = this.surface.palette;
    const z = this.view.zoom;
    const px = (n: number) => n / z;
    ctx.save();
    for (const line of this.lines) {
      const b = line.bbox;
      ctx.setLineDash([px(5), px(4)]);
      ctx.strokeStyle = pal.xray;
      ctx.globalAlpha = 0.45;
      ctx.lineWidth = px(1);
      roundRect(ctx, b.minX - px(10), b.minY - px(22), b.maxX - b.minX + px(20), b.maxY - b.minY + px(32), px(8));
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      ctx.font = `600 ${px(11)}px ${getComputedStyle(document.body).fontFamily}`;
      ctx.fillStyle = pal.xray;
      ctx.fillText(line.text || '...', b.minX - px(8), b.maxY + px(24));
      for (const s of line.symbols) {
        const r = s.bbox;
        const pad = px(3);
        ctx.strokeStyle = pal.xray;
        ctx.lineWidth = px(1.25);
        ctx.globalAlpha = 0.35 + 0.65 * s.confidence;
        roundRect(ctx, r.minX - pad, r.minY - pad, r.maxX - r.minX + 2 * pad, r.maxY - r.minY + 2 * pad, px(4));
        ctx.stroke();
        const label = `${displaySymbol(s.label)} ${Math.round(s.confidence * 100)}`;
        ctx.font = `600 ${px(10)}px ${getComputedStyle(document.body).fontFamily}`;
        const w = ctx.measureText(label).width + px(8);
        ctx.fillStyle = pal.xray;
        roundRect(ctx, r.minX - pad, r.minY - pad - px(15), w, px(14), px(4));
        ctx.fill();
        ctx.fillStyle = pal.xrayText;
        ctx.globalAlpha = 1;
        ctx.fillText(label, r.minX - pad + px(4), r.minY - pad - px(4.5));
      }
    }
    ctx.restore();
  }

  private buildToolbar(): void {
    const tb = $('#toolbar');
    const btn = (id: string, icon: string, tip: string, extra = '') =>
      `<button class="tb-btn" id="${id}" type="button" data-tip="${tip}" aria-label="${tip.replace(/ \(.*/, '')}" ${extra}>${icon}</button>`;
    tb.innerHTML = [
      btn('t-pen', icons.pen, 'Pen (P)', 'aria-pressed="false"'),
      btn('t-erase', icons.strokeEraser, 'Stroke eraser (E)', 'aria-pressed="false"'),
      btn('t-pixel', icons.pixelEraser, 'Pixel eraser (Shift+E)', 'aria-pressed="false"'),
      `<button class="tb-btn swatch-btn" id="t-style" type="button" data-tip="Ink & width" aria-label="Ink colour and width"><span class="swatch"><i></i></span></button>`,
      '<span class="tb-sep"></span>',
      btn('t-undo', icons.undo, 'Undo (Ctrl/Cmd+Z)'),
      btn('t-redo', icons.redo, 'Redo (Shift+Ctrl/Cmd+Z)'),
      btn('t-clear', icons.trash, 'Clear page'),
      '<span class="tb-sep"></span>',
      btn('t-xray', icons.xray, 'Recognition X-ray (X)', 'aria-pressed="false"'),
      btn('t-hud', icons.gauge, 'Performance (H)', 'aria-pressed="false"'),
      btn('t-settings', icons.sliders, 'Settings'),
      btn('t-help', icons.help, 'Help (?)'),
    ].join('');

    $('#t-pen').onclick = () => this.setTool('pen');
    $('#t-erase').onclick = () => this.setTool('stroke-eraser');
    $('#t-pixel').onclick = () => this.setTool('pixel-eraser');
    $('#t-undo').onclick = () => this.undo();
    $('#t-redo').onclick = () => this.redo();
    $('#t-clear').onclick = () => this.clear();
    $('#t-xray').onclick = () => this.setPref('xray', !this.prefs.xray);
    $('#t-hud').onclick = () => this.setPref('hud', !this.prefs.hud);
    $('#t-help').onclick = () => this.openHelp();

    const stylePop = this.popover($('#t-style'), () => this.renderStylePop());
    $('#t-style').onclick = () => stylePop.toggle();
    const settingsPop = this.popover($('#t-settings'), () => this.renderSettingsPop());
    $('#t-settings').onclick = () => settingsPop.toggle();
    this.syncToolbar();
  }

  private popover(anchor: HTMLElement, render: () => HTMLElement) {
    const el = document.createElement('div');
    el.className = 'pop';
    $('#app').appendChild(el);
    const place = () => {
      const r = anchor.getBoundingClientRect();
      const w = el.offsetWidth;
      const below = r.bottom + 10 + el.offsetHeight < innerHeight;
      el.style.left = `${Math.min(Math.max(8, r.left + r.width / 2 - w / 2), innerWidth - w - 8)}px`;
      el.style.top = below ? `${r.bottom + 10}px` : `${r.top - el.offsetHeight - 10}px`;
    };
    const close = () => (el.dataset.open = 'false');
    document.addEventListener('pointerdown', (e) => {
      if (el.dataset.open === 'true' && !el.contains(e.target as Node) && !anchor.contains(e.target as Node)) close();
    }, true);
    return {
      toggle: () => {
        if (el.dataset.open === 'true') return close();
        el.replaceChildren(render());
        el.dataset.open = 'true';
        place();
      },
      rerender: () => {
        if (el.dataset.open === 'true') el.replaceChildren(render());
      },
    };
  }

  private renderStylePop(): HTMLElement {
    const root = document.createElement('div');
    const colors: InkColor[] = ['graphite', 'blue', 'red'];
    root.innerHTML = `
      <h3>Ink</h3>
      <div class="pop-row"><div class="swatches">${colors
        .map((c) => `<button data-c="${c}" aria-label="${c}" aria-pressed="${this.prefs.color === c}" style="--sw:var(--ink-${c})"></button>`)
        .join('')}</div></div>
      <div class="pop-row"><div class="range"><input type="range" min="1.4" max="9" step="0.2" value="${this.prefs.width}" aria-label="Pen width"><div class="width-preview"><i></i></div></div></div>`;
    const preview = root.querySelector<HTMLElement>('.width-preview i')!;
    const sync = () => {
      preview.style.width = preview.style.height = `${this.prefs.width * 1.6}px`;
      preview.style.background = `var(--ink-${this.prefs.color})`;
    };
    sync();
    root.querySelectorAll<HTMLButtonElement>('[data-c]').forEach((b) =>
      b.addEventListener('click', () => {
        this.setPref('color', b.dataset.c as InkColor);
        root.querySelectorAll('[data-c]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
        sync();
      }),
    );
    root.querySelector<HTMLInputElement>('input')!.addEventListener('input', (e) => {
      this.setPref('width', Number((e.target as HTMLInputElement).value));
      sync();
    });
    return root;
  }

  private renderSettingsPop(): HTMLElement {
    const root = document.createElement('div');
    root.style.width = '270px';
    const seg = (key: keyof Prefs, opts: [string, string][]) =>
      `<div class="seg" data-key="${key}">${opts.map(([v, l]) => `<button data-v="${v}" aria-pressed="${String(this.prefs[key]) === v}">${l}</button>`).join('')}</div>`;
    const sw = (key: keyof Prefs, label: string) =>
      `<div class="pop-row"><label>${label}</label><button class="switch" role="switch" data-key="${key}" aria-checked="${this.prefs[key]}" aria-label="${label}"></button></div>`;
    root.innerHTML = `
      <h3>Page</h3>
      <div class="pop-row"><label>Theme</label>${seg('theme', [['auto', 'Auto'], ['light', 'Paper'], ['dark', 'Slate']])}</div>
      <div class="pop-row"><label>Paper</label>${seg('paper', [['dots', 'Dots'], ['lines', 'Lines'], ['grid', 'Grid'], ['plain', 'Plain']])}</div>
      <h3 style="margin-top:14px">Answers</h3>
      <div class="pop-row"><label>Show as</label>${seg('fractions', [['false', '0.75'], ['true', '¾']])}</div>
      ${sw('confidence', 'Flag unsure readings')}
      ${sw('sound', 'Sound')}
      ${sw('haptics', 'Haptics')}`;
    root.querySelectorAll<HTMLElement>('.seg').forEach((s) =>
      s.querySelectorAll<HTMLButtonElement>('button').forEach((b) =>
        b.addEventListener('click', () => {
          const key = s.dataset.key as keyof Prefs;
          const raw = b.dataset.v!;
          const val = raw === 'true' ? true : raw === 'false' ? false : raw;
          this.setPref(key, val as never);
          s.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
        }),
      ),
    );
    root.querySelectorAll<HTMLButtonElement>('.switch').forEach((b) =>
      b.addEventListener('click', () => {
        const key = b.dataset.key as keyof Prefs;
        this.setPref(key, !this.prefs[key] as never);
        b.setAttribute('aria-checked', String(this.prefs[key]));
      }),
    );
    return root;
  }

  private syncToolbar(): void {
    const t = this.prefs.tool;
    $('#t-pen').setAttribute('aria-pressed', String(t === 'pen'));
    $('#t-erase').setAttribute('aria-pressed', String(t === 'stroke-eraser'));
    $('#t-pixel').setAttribute('aria-pressed', String(t === 'pixel-eraser'));
    $('#t-xray').setAttribute('aria-pressed', String(this.prefs.xray));
    $('#t-hud').setAttribute('aria-pressed', String(this.prefs.hud));
    $<HTMLButtonElement>('#t-undo').disabled = !this.history.canUndo;
    $<HTMLButtonElement>('#t-redo').disabled = !this.history.canRedo;
    const sw = $('#t-style').querySelector<HTMLElement>('.swatch')!;
    sw.style.setProperty('--sw', `var(--ink-${this.prefs.color})`);
    const dot = sw.querySelector('i')!;
    dot.style.width = dot.style.height = `${Math.max(3, Math.min(10, this.prefs.width))}px`;
    this.stage.dataset.tool = t;
  }

  setTool(tool: Tool): void {
    this.setPref('tool', tool);
    if (tool === 'pen') {
      this.eraser = null;
      this.surface.invalidateOverlay();
    }
  }

  private setPref<K extends keyof Prefs>(key: K, value: Prefs[K]): void {
    this.prefs[key] = value;
    savePrefs(this.prefs);
    switch (key) {
      case 'tool':
        this.input.settings.tool = value as Tool;
        break;
      case 'width':
        this.input.settings.width = value as number;
        break;
      case 'color':
        this.input.settings.color = value as InkColor;
        break;
      case 'theme':
        this.applyTheme();
        break;
      case 'paper':
        this.paper.dataset.style = value as string;
        this.onViewChanged();
        break;
      case 'fractions':
      case 'confidence':
        this.answers.settings = { fractions: this.prefs.fractions, showConfidence: this.prefs.confidence };
        this.answers.relayout(performance.now());
        this.inspector.refresh(this.inspector.current ? this.answers.views.get(this.inspector.current.key) : undefined);
        this.surface.invalidateOverlay();
        break;
      case 'xray':
        this.surface.invalidateOverlay();
        break;
      case 'hud':
        this.hud.setVisible(value as boolean);
        break;
    }
    this.syncToolbar();
  }

  private applyTheme(): void {
    const t = this.prefs.theme;
    const dark = t === 'dark' || (t === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    this.paper.dataset.style = this.prefs.paper;
    if (this.surface) {
      this.surface.palette = readPalette();
      this.surface.invalidateAll();
    }
  }

  undo(): void {
    const e = this.history.undo();
    if (e) this.toast(`Undid ${e.label}`, 1200);
  }

  redo(): void {
    const e = this.history.redo();
    if (e) this.toast(`Redid ${e.label}`, 1200);
  }

  clear(): void {
    if (!this.store.size) return;
    const all = [...this.store.all()];
    const now = performance.now();
    this.fading.push(...all.map((stroke) => ({ stroke, t0: now })));
    this.history.commit('clear', { added: [], removed: all });
    this.toast('Page cleared', 4000, { label: 'Undo', run: () => this.history.undo() });
  }

  private toast(msg: string, ms = 1800, action?: { label: string; run: () => void }): void {
    const el = $('#toast');
    el.replaceChildren(document.createTextNode(msg));
    if (action) {
      const b = document.createElement('button');
      b.textContent = action.label;
      b.onclick = () => {
        action.run();
        el.dataset.open = 'false';
      };
      el.appendChild(b);
    } else el.style.paddingRight = '16px';
    el.dataset.open = 'true';
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => {
      el.dataset.open = 'false';
      el.style.paddingRight = '';
    }, ms);
  }

  private updateEmpty(): void {
    $('#empty').hidden = this.store.size > 0 || this.demoRunning;
  }

  async demo(text = '18+4×3='): Promise<void> {
    if (this.demoRunning) return;
    this.demoRunning = true;
    this.updateEmpty();
    const size = 58 / this.view.zoom;
    const glyphs = writeExpression(text, { size, seed: Math.floor(Math.random() * 1e6), messiness: 0.45 });
    const width = Math.max(...glyphs.map((g) => Math.max(...Array.from(g.pts).filter((_, i) => i % 3 === 0))));
    const center = this.view.toWorld(this.surface.cssWidth / 2, this.surface.cssHeight * 0.45);
    const ox = center.x - (width + size * 2.2) / 2;
    let oy = center.y - size / 2;
    const box = { minX: ox - size, minY: oy - size, maxX: ox + width + 3.2 * size, maxY: oy + 2 * size };
    // if the middle is taken, write it below the existing ink
    const blocking = this.store.all().filter((s) => s.bbox.maxX > box.minX && s.bbox.minX < box.maxX && s.bbox.maxY > box.minY && s.bbox.minY < box.maxY);
    if (blocking.length) {
      oy = Math.max(...this.store.all().map((s) => s.bbox.maxY)) + size * 0.9;
      const target = this.view.toScreen(0, oy + size);
      if (target.y > this.surface.cssHeight * 0.8) {
        this.view.panBy(0, this.surface.cssHeight * 0.6 - target.y);
        this.onViewChanged();
      }
    }
    const speed = 900 / this.view.zoom; // world units per second
    this.recognizer.setPenDown(true);
    for (const g of glyphs) {
      const pts = Array.from(g.pts);
      for (let i = 0; i < pts.length; i += 3) {
        pts[i] += ox;
        pts[i + 1] += oy;
      }
      let len = 0;
      for (let i = 3; i < pts.length; i += 3) len += Math.hypot(pts[i]! - pts[i - 3]!, pts[i + 1]! - pts[i - 2]!);
      const dur = Math.max(90, (len / speed) * 1000);
      const t0 = performance.now();
      await new Promise<void>((resolve) => {
        const step = () => {
          const t = Math.min(1, (performance.now() - t0) / dur);
          const n = Math.max(1, Math.round((pts.length / 3) * t));
          this.surface.setLive({ pts: pts.slice(0, n * 3), predicted: [], width: this.prefs.width / this.view.zoom, color: this.surface.palette.ink[this.prefs.color], pressure: false });
          if (t < 1) requestAnimationFrame(step);
          else resolve();
        };
        requestAnimationFrame(step);
      });
      this.surface.setLive(null);
      const stroke = this.store.create({ pts: Float32Array.from(pts), width: this.prefs.width / this.view.zoom, color: this.prefs.color, pressure: false });
      this.history.commit('draw', { added: [stroke], removed: [] });
      await new Promise((r) => setTimeout(r, 70));
    }
    this.recognizer.setPenDown(false);
    this.demoRunning = false;
    this.updateEmpty();
  }

  private openHelp(): void {
    let dlg = document.querySelector<HTMLDialogElement>('#help');
    if (!dlg) {
      dlg = document.createElement('dialog');
      dlg.id = 'help';
      dlg.className = 'sheet';
      dlg.innerHTML = `
        <div class="sheet-body">
          <h2>CalcInk</h2>
          <p class="lead">Write a sum by hand and end it with <b>=</b>. The answer shows up next to it and updates when you edit. Everything, including recognition, runs on your device and works offline.</p>
          <h4>Writing</h4>
          <div class="kv">
            <kbd>0-9 + - × ÷ . =</kbd><span>The symbols it can read. Negative numbers and decimals work, e.g. <i>5 × -2.5 =</i></span>
            <kbd>6 × 7 = 42</kbd><span>Write your own answer after = and it gets checked</span>
            <kbd>Tap an answer</kbd><span>See what was read and how sure it is, fix a symbol, copy the result</span>
            <kbd>Scribble over ink</kbd><span>Erases whatever it covers</span>
          </div>
          <h4>Keys</h4>
          <div class="kv">
            <kbd>P</kbd><span>Pen</span>
            <kbd>E</kbd><span>Stroke eraser (<kbd>Shift+E</kbd> for pixel eraser)</span>
            <kbd>Ctrl/Cmd+Z</kbd><span>Undo (add Shift to redo)</span>
            <kbd>[ ]</kbd><span>Thinner / thicker pen</span>
            <kbd>X</kbd><span>Show what was recognized (boxes, labels, confidence)</span>
            <kbd>H</kbd><span>Performance stats (fps, frame times, recognition time)</span>
            <kbd>F</kbd><span>Switch between decimals and fractions</span>
            <kbd>Space</kbd><span>Hold and drag to pan. Pinch or Ctrl/Cmd+scroll to zoom, <kbd>0</kbd> resets</span>
          </div>
          <h4>Touch and stylus</h4>
          <div class="kv">
            <kbd>Two fingers</kbd><span>Pan and pinch-zoom</span>
            <kbd>Stylus</kbd><span>After you use a stylus, fingers pan instead of drawing (palm rejection). The eraser end of a stylus erases.</span>
          </div>
        </div>
        <div class="sheet-foot"><span>Models: symbol CNN (MIT) and MNIST-12 (MIT), run with ONNX Runtime Web</span><button class="btn btn-primary" value="close">Got it</button></div>`;
      $('#app').appendChild(dlg);
      dlg.querySelector('button')!.addEventListener('click', () => dlg!.close());
      dlg.addEventListener('click', (e) => {
        if (e.target === dlg) dlg!.close();
      });
    }
    dlg.showModal();
  }

  private bindKeys(): void {
    window.addEventListener('keydown', (e) => {
      const t = e.target as HTMLElement;
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') return;
      const mod = e.metaKey || e.ctrlKey;
      const k = e.key.toLowerCase();
      if (mod && k === 'z') {
        e.preventDefault();
        if (e.shiftKey) this.redo();
        else this.undo();
      } else if (mod && k === 'y') {
        e.preventDefault();
        this.redo();
      } else if (mod) {
        return;
      } else if (k === 'p') this.setTool('pen');
      else if (k === 'e') this.setTool(e.shiftKey ? 'pixel-eraser' : 'stroke-eraser');
      else if (k === 'x') this.setPref('xray', !this.prefs.xray);
      else if (k === 'h') this.setPref('hud', !this.prefs.hud);
      else if (k === 'f') this.setPref('fractions', !this.prefs.fractions);
      else if (k === '0') this.resetView();
      else if (k === '[') this.setPref('width', Math.max(1.4, +(this.prefs.width - 0.4).toFixed(1)));
      else if (k === ']') this.setPref('width', Math.min(9, +(this.prefs.width + 0.4).toFixed(1)));
      else if (e.key === '?') this.openHelp();
    });
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, Math.min(r, w / 2, h / 2));
}
