import type { Change, StrokeStore } from './strokes';

export interface HistoryEntry extends Change {
  label: string;
}

const invert = (c: Change): Change => ({ added: c.removed, removed: c.added });

export class History {
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];
  private listeners = new Set<() => void>();

  constructor(
    private store: StrokeStore,
    readonly limit = 300,
  ) {}

  commit(label: string, change: Change): void {
    if (change.added.length === 0 && change.removed.length === 0) return;
    this.store.apply(change);
    this.undoStack.push({ label, ...change });
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack.length = 0;
    this.emit();
  }

  record(label: string, change: Change): void {
    if (change.added.length === 0 && change.removed.length === 0) return;
    this.undoStack.push({ label, ...change });
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack.length = 0;
    this.emit();
  }

  undo(): HistoryEntry | undefined {
    const e = this.undoStack.pop();
    if (!e) return undefined;
    this.store.apply(invert(e));
    this.redoStack.push(e);
    this.emit();
    return e;
  }

  redo(): HistoryEntry | undefined {
    const e = this.redoStack.pop();
    if (!e) return undefined;
    this.store.apply(e);
    this.undoStack.push(e);
    this.emit();
    return e;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  get depth(): { undo: number; redo: number } {
    return { undo: this.undoStack.length, redo: this.redoStack.length };
  }

  clear(): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.emit();
  }

  onChange(l: () => void): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  private emit(): void {
    for (const l of this.listeners) l();
  }
}
