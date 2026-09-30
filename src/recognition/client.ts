import wasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url';
import type { Change, StrokeStore } from '../core/strokes';
import type { Sym } from '../math/tokens';
import type { LineResult, RecognizeStats } from './pipeline';
import type { FromWorker, StrokeDTO, ToWorker } from './protocol';

export type RecognizerStatus = 'loading' | 'ready' | 'error';

export interface RecognitionUpdate {
  lines: LineResult[];
  stats: RecognizeStats;
  latencyMs: number;
}

export class RecognizerClient {
  private worker: Worker;
  private requestId = 0;
  private sentAt = new Map<number, number>();
  private timer: number | undefined;
  private penDown = false;
  status: RecognizerStatus = 'loading';
  loadMs = 0;
  delayMs = 280;
  onResult: (u: RecognitionUpdate) => void = () => {};
  onStatus: (s: RecognizerStatus, detail?: string) => void = () => {};

  constructor(private store: StrokeStore) {
    this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'calcink-recognizer' });
    this.worker.onmessage = (e: MessageEvent<FromWorker>) => this.receive(e.data);
    this.worker.onerror = (e) => {
      this.status = 'error';
      this.onStatus('error', e.message);
    };
    this.send({ type: 'init', baseUrl: new URL(import.meta.env.BASE_URL, location.href).href, wasmUrl: new URL(wasmUrl, location.href).href });
    this.forward({ added: store.all(), removed: [] });
    store.onChange((c) => {
      this.forward(c);
      this.schedule();
    });
  }

  setPenDown(down: boolean): void {
    this.penDown = down;
    if (down) window.clearTimeout(this.timer);
    else this.schedule();
  }

  override(key: string, label: Sym | null): void {
    this.send({ type: 'override', key, label });
    this.schedule(0);
  }

  schedule(delay = this.delayMs): void {
    window.clearTimeout(this.timer);
    if (this.penDown) return;
    this.timer = window.setTimeout(() => this.request(), delay);
  }

  request(): void {
    const id = ++this.requestId;
    this.sentAt.set(id, performance.now());
    this.send({ type: 'recognize', requestId: id, version: this.store.version });
  }

  dispose(): void {
    window.clearTimeout(this.timer);
    this.worker.terminate();
  }

  private forward(c: Change): void {
    if (c.added.length === 0 && c.removed.length === 0) return;
    const added: StrokeDTO[] = c.added.map((s) => ({ id: s.id, seq: s.seq, pts: s.pts, width: s.width, bbox: s.bbox }));
    this.send({ type: 'sync', added, removed: c.removed.map((s) => s.id) });
  }

  private send(m: ToWorker): void {
    this.worker.postMessage(m);
  }

  private receive(m: FromWorker): void {
    switch (m.type) {
      case 'ready':
        this.status = 'ready';
        this.loadMs = m.loadMs;
        this.onStatus('ready');
        if (this.store.size) this.schedule(0);
        break;
      case 'error':
        this.status = 'error';
        this.onStatus('error', m.message);
        console.error('[recognizer]', m.message);
        break;
      case 'result': {
        const t = this.sentAt.get(m.requestId);
        // worker skips some requests, clean those up too
        for (const k of this.sentAt.keys()) if (k <= m.requestId) this.sentAt.delete(k);
        // old result, page changed since then
        if (m.version !== this.store.version) return;
        this.onResult({ lines: m.lines, stats: m.stats, latencyMs: t === undefined ? 0 : performance.now() - t });
        break;
      }
    }
  }
}
