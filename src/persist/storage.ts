import type { InkColor, Stroke } from '../core/strokes';

export interface SavedStroke {
  id: number;
  seq: number;
  pts: Float32Array;
  width: number;
  color: InkColor;
  pressure: boolean;
}

export interface SavedNotebook {
  v: 1;
  strokes: SavedStroke[];
  view: { panX: number; panY: number; zoom: number };
}

const DB = 'calcink';
const STORE = 'notebooks';
const KEY = 'default';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function loadNotebook(): Promise<SavedNotebook | null> {
  try {
    const db = await open();
    return await new Promise((resolve) => {
      const req = db.transaction(STORE).objectStore(STORE).get(KEY);
      req.onsuccess = () => resolve((req.result as SavedNotebook | undefined)?.v === 1 ? (req.result as SavedNotebook) : null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

export async function saveNotebook(strokes: readonly Stroke[], view: SavedNotebook['view']): Promise<void> {
  try {
    const db = await open();
    const data: SavedNotebook = {
      v: 1,
      strokes: strokes.map(({ id, seq, pts, width, color, pressure }) => ({ id, seq, pts, width, color, pressure })),
      view,
    };
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(data, KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
  }
}

export function loadPrefs<T extends object>(defaults: T): T {
  try {
    return { ...defaults, ...(JSON.parse(localStorage.getItem('calcink.settings') ?? '{}') as Partial<T>) };
  } catch {
    return { ...defaults };
  }
}

export function savePrefs<T extends object>(prefs: T): void {
  try {
    localStorage.setItem('calcink.settings', JSON.stringify(prefs));
  } catch {
  }
}
