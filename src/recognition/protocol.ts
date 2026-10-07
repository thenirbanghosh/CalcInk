import type { Rect } from '../core/geometry';
import type { Sym } from '../math/tokens';
import type { LineResult, RecognizeStats } from './pipeline';

export interface StrokeDTO {
  id: number;
  seq: number;
  pts: Float32Array;
  width: number;
  bbox: Rect;
}

export type ToWorker =
  | { type: 'init'; baseUrl: string; wasmUrl: string }
  | { type: 'sync'; added: StrokeDTO[]; removed: number[] }
  | { type: 'recognize'; requestId: number; version: number }
  | { type: 'override'; key: string; label: Sym | null }
  | { type: 'reset' };

export type FromWorker =
  | { type: 'ready'; loadMs: number; backend: string }
  | { type: 'error'; message: string }
  | { type: 'result'; requestId: number; version: number; lines: LineResult[]; stats: RecognizeStats };
