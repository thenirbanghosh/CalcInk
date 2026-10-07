import { boundsOf, type Rect } from './geometry';

export type InkColor = 'graphite' | 'blue' | 'red';

export interface Stroke {
  readonly id: number;
  // drawing order. pixel eraser pieces keep the parent seq
  readonly seq: number;
  readonly pts: Float32Array;
  readonly width: number;
  readonly color: InkColor;
  readonly pressure: boolean;
  readonly bbox: Rect;
}

export interface StrokeInit {
  pts: Float32Array;
  width: number;
  color: InkColor;
  pressure: boolean;
  seq?: number;
}

export interface Change {
  added: readonly Stroke[];
  removed: readonly Stroke[];
}

export type ChangeListener = (change: Change) => void;

export class StrokeStore {
  private byId = new Map<number, Stroke>();
  private ordered: Stroke[] = [];
  private nextId = 1;
  private listeners = new Set<ChangeListener>();
  version = 0;

  create(init: StrokeInit): Stroke {
    const id = this.nextId++;
    return Object.freeze({
      id,
      seq: init.seq ?? id,
      pts: init.pts,
      width: init.width,
      color: init.color,
      pressure: init.pressure,
      bbox: boundsOf(init.pts),
    });
  }

  get size(): number {
    return this.ordered.length;
  }

  get(id: number): Stroke | undefined {
    return this.byId.get(id);
  }

  has(id: number): boolean {
    return this.byId.has(id);
  }

  all(): readonly Stroke[] {
    return this.ordered;
  }

  apply(change: Change): void {
    if (change.added.length === 0 && change.removed.length === 0) return;
    for (const s of change.removed) this.byId.delete(s.id);
    if (change.removed.length) {
      const gone = new Set(change.removed.map((s) => s.id));
      this.ordered = this.ordered.filter((s) => !gone.has(s.id));
    }
    for (const s of change.added) {
      this.byId.set(s.id, s);
      if (s.id >= this.nextId) this.nextId = s.id + 1;
      insertSorted(this.ordered, s);
    }
    this.version++;
    for (const l of this.listeners) l(change);
  }

  onChange(l: ChangeListener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
}

function insertSorted(arr: Stroke[], s: Stroke): void {
  if (arr.length === 0 || arr[arr.length - 1]!.seq <= s.seq) {
    arr.push(s);
    return;
  }
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid]!.seq <= s.seq) lo = mid + 1;
    else hi = mid;
  }
  arr.splice(lo, 0, s);
}
