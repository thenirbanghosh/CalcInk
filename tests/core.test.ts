import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { Viewport, backingStoreSize, clientToScreen, MAX_ZOOM, MIN_ZOOM } from '../src/core/viewport';
import { StrokeStore } from '../src/core/strokes';
import { History } from '../src/core/history';
import { cutWithCircle, PixelEraseSession, strokeHitByCapsule } from '../src/core/eraser';
import { countCusps, looksLikeScratch, scratchTargets } from '../src/core/gestures';
import { boundsOf, distSqSegmentSegment, segmentsIntersect } from '../src/core/geometry';
import { curve, line, makeStroke, toPts } from './helpers';

describe('coordinate conversion', () => {
  it('world to screen and back gives the same point for any pan/zoom', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -5000, max: 5000, noNaN: true }),
        fc.double({ min: -5000, max: 5000, noNaN: true }),
        fc.double({ min: MIN_ZOOM, max: MAX_ZOOM, noNaN: true }),
        fc.double({ min: -1e4, max: 1e4, noNaN: true }),
        fc.double({ min: -1e4, max: 1e4, noNaN: true }),
        (px, py, zoom, wx, wy) => {
          const v = new Viewport(px, py, zoom);
          const s = v.toScreen(wx, wy);
          const w = v.toWorld(s.x, s.y);
          return Math.abs(w.x - wx) < 1e-6 * Math.max(1, Math.abs(wx)) && Math.abs(w.y - wy) < 1e-6 * Math.max(1, Math.abs(wy));
        },
      ),
    );
  });

  it('zoomAt keeps the point under the cursor fixed', () => {
    const v = new Viewport(40, -25, 1.3);
    const before = v.toWorld(300, 200);
    v.zoomAt(300, 200, 1.75);
    const after = v.toWorld(300, 200);
    expect(after.x).toBeCloseTo(before.x, 9);
    expect(after.y).toBeCloseTo(before.y, 9);
  });

  it('clamps zoom to the supported range', () => {
    const v = new Viewport();
    v.zoomAt(0, 0, 1000);
    expect(v.zoom).toBe(MAX_ZOOM);
    v.zoomAt(0, 0, 1e-6);
    expect(v.zoom).toBe(MIN_ZOOM);
  });

  it('device transform maps world to physical pixels on Retina (dpr 2)', () => {
    const v = new Viewport(10, 20, 1.5);
    const [a, , , d, e, f] = v.deviceTransform(2);
    expect(a * 100 + e).toBeCloseTo(320);
    expect(d * 100 + f).toBeCloseTo(340);
  });

  it.each([
    [800, 600, 1, 800, 600],
    [800, 600, 2, 1600, 1200],
    [333, 211, 1.5, 500, 317],
    [375, 812, 3, 1125, 2436],
    [0, 0, 2, 1, 1],
  ])('backing store for %ix%i @%fx is %ix%i', (w, h, dpr, bw, bh) => {
    expect(backingStoreSize(w, h, dpr)).toEqual({ width: bw, height: bh });
  });

  it('prefers exact device-pixel sizes when the browser provides them', () => {
    expect(backingStoreSize(333.33, 211, 1.5, { inlineSize: 499, blockSize: 316 })).toEqual({ width: 499, height: 316 });
  });
  it('ignores implausible device-pixel sizes (e.g. DPR emulation reporting CSS pixels)', () => {
    expect(backingStoreSize(1280, 800, 2, { inlineSize: 1280, blockSize: 800 })).toEqual({ width: 2560, height: 1600 });
  });

  it('client to canvas coordinates subtracts the canvas origin', () => {
    expect(clientToScreen(120, 90, { left: 20, top: 30 })).toEqual({ x: 100, y: 60 });
  });

  it('visible world rect follows pan and zoom', () => {
    const v = new Viewport(-100, -50, 2);
    expect(v.visibleWorld(800, 600)).toEqual({ minX: 50, minY: 25, maxX: 450, maxY: 325 });
  });
});

describe('geometry', () => {
  it('detects crossing segments', () => {
    expect(segmentsIntersect(0, 0, 10, 10, 0, 10, 10, 0)).toBe(true);
    expect(segmentsIntersect(0, 0, 10, 0, 0, 5, 10, 5)).toBe(false);
    expect(distSqSegmentSegment(0, 0, 10, 0, 0, 5, 10, 5)).toBeCloseTo(25);
  });
});

describe('stroke store', () => {
  it('keeps strokes in writing order, even when fragments are re-inserted', () => {
    const store = new StrokeStore();
    const a = makeStroke(store, line(0, 0, 10, 0));
    const b = makeStroke(store, line(0, 10, 10, 10));
    store.apply({ added: [a, b], removed: [] });
    const frag = store.create({ pts: toPts(line(0, 0, 5, 0)), width: 3, color: 'graphite', pressure: false, seq: a.seq + 1e-6 });
    store.apply({ added: [frag], removed: [a] });
    expect(store.all().map((s) => s.id)).toEqual([frag.id, b.id]);
  });
});

describe('undo / redo', () => {
  it('restores exactly the previous document', () => {
    const store = new StrokeStore();
    const h = new History(store);
    const a = makeStroke(store, line(0, 0, 10, 0));
    const b = makeStroke(store, line(0, 10, 10, 10));
    h.commit('draw', { added: [a], removed: [] });
    h.commit('draw', { added: [b], removed: [] });
    h.commit('clear', { added: [], removed: [a, b] });
    expect(store.size).toBe(0);
    h.undo();
    expect(store.all().map((s) => s.id)).toEqual([a.id, b.id]);
    h.undo();
    expect(store.all().map((s) => s.id)).toEqual([a.id]);
    h.redo();
    h.redo();
    expect(store.size).toBe(0);
    expect(h.canRedo).toBe(false);
  });

  it('a new edit clears the redo stack', () => {
    const store = new StrokeStore();
    const h = new History(store);
    h.commit('draw', { added: [makeStroke(store, line(0, 0, 1, 1))], removed: [] });
    h.undo();
    expect(h.canRedo).toBe(true);
    h.commit('draw', { added: [makeStroke(store, line(0, 0, 2, 2))], removed: [] });
    expect(h.canRedo).toBe(false);
  });

  it('is bounded: old entries fall off instead of growing forever', () => {
    const store = new StrokeStore();
    const h = new History(store, 50);
    for (let i = 0; i < 500; i++) h.commit('draw', { added: [makeStroke(store, line(i, 0, i + 1, 1))], removed: [] });
    expect(h.depth.undo).toBe(50);
  });

  it('random edit/undo/redo sequences always stay consistent', () => {
    fc.assert(
      fc.property(fc.array(fc.constantFrom('draw', 'erase', 'undo', 'redo'), { maxLength: 80 }), (ops) => {
        const store = new StrokeStore();
        const h = new History(store);
        const snapshots: number[][] = [[]];
        let cursor = 0;
        for (const op of ops) {
          if (op === 'draw') {
            h.commit('draw', { added: [makeStroke(store, line(0, 0, 5, 5))], removed: [] });
          } else if (op === 'erase' && store.size > 0) {
            h.commit('erase', { added: [], removed: [store.all()[0]!] });
          } else if (op === 'undo' && h.canUndo) {
            h.undo();
            cursor--;
            if (JSON.stringify(store.all().map((s) => s.id)) !== JSON.stringify(snapshots[cursor])) return false;
            continue;
          } else if (op === 'redo' && h.canRedo) {
            h.redo();
            cursor++;
            if (JSON.stringify(store.all().map((s) => s.id)) !== JSON.stringify(snapshots[cursor])) return false;
            continue;
          } else continue;
          cursor++;
          snapshots.length = cursor;
          snapshots.push(store.all().map((s) => s.id));
        }
        return true;
      }),
      { numRuns: 300 },
    );
  });
});

describe('stroke eraser', () => {
  it('hits strokes within radius + half the pen width', () => {
    const store = new StrokeStore();
    const s = makeStroke(store, line(0, 0, 100, 0), 4);
    expect(strokeHitByCapsule(s, 50, 7, 50, 7, 5)).toBe(true); // 7 <= 5 + 2
    expect(strokeHitByCapsule(s, 50, 8, 50, 8, 5)).toBe(false);
  });
  it('catches fast swipes that jump over a stroke between events', () => {
    const store = new StrokeStore();
    const s = makeStroke(store, line(50, -100, 50, 100), 2);
    expect(strokeHitByCapsule(s, 0, 0, 100, 0, 1)).toBe(true);
  });
});

describe('pixel eraser', () => {
  it('cuts a line in two with exact edges', () => {
    const pts = toPts(line(0, 0, 100, 0, 11));
    const pieces = cutWithCircle(pts, 50, 0, 10)!;
    expect(pieces).toHaveLength(2);
    const left = boundsOf(pieces[0]!);
    const right = boundsOf(pieces[1]!);
    expect(left.minX).toBeCloseTo(0);
    expect(left.maxX).toBeCloseTo(40);
    expect(right.minX).toBeCloseTo(60);
    expect(right.maxX).toBeCloseTo(100);
  });
  it('cuts sparse segments that pass through the circle without samples inside', () => {
    const pieces = cutWithCircle(toPts([[0, 0], [100, 0]]), 50, 0, 10)!;
    expect(pieces).toHaveLength(2);
  });
  it('returns null for untouched strokes and [] for fully erased ones', () => {
    expect(cutWithCircle(toPts(line(0, 0, 10, 0)), 50, 50, 5)).toBeNull();
    expect(cutWithCircle(toPts(line(0, 0, 10, 0)), 5, 0, 50)).toEqual([]);
  });
  it('a whole gesture undoes as one step', () => {
    const store = new StrokeStore();
    const h = new History(store);
    const s = makeStroke(store, line(0, 0, 200, 0, 41), 2);
    h.commit('draw', { added: [s], removed: [] });
    const session = new PixelEraseSession(store);
    for (let x = 40; x <= 60; x += 2) session.eraseAt(x, 0, 4); // keeps cutting its own pieces
    session.eraseAt(150, 0, 4);
    h.record('erase', session.result());
    expect(store.size).toBe(3);
    const r = session.result();
    expect(r.removed.map((x) => x.id)).toEqual([s.id]);
    expect(r.added).toHaveLength(3);
    h.undo();
    expect(store.all().map((x) => x.id)).toEqual([s.id]);
    h.redo();
    expect(store.size).toBe(3);
  });
});

describe('scratch-out gesture', () => {
  const zigzag = (x0: number, x1: number, y0: number, y1: number, passes: number) =>
    curve(passes * 12, (t) => {
      const phase = (t * passes) % 2;
      const tri = phase < 1 ? phase : 2 - phase;
      return [x0 + (x1 - x0) * tri, y0 + (y1 - y0) * t];
    });

  it('recognizes a back-and-forth scribble', () => {
    const store = new StrokeStore();
    const s = makeStroke(store, zigzag(0, 60, 0, 30, 7));
    expect(countCusps(s.pts)).toBeGreaterThanOrEqual(5);
    expect(looksLikeScratch(s)).toBe(true);
  });

  it.each([
    ['zero', curve(60, (t) => [20 + 15 * Math.cos(2 * Math.PI * t), 30 + 25 * Math.sin(2 * Math.PI * t)] as const)],
    ['eight', curve(80, (t) => [20 + 12 * Math.sin(4 * Math.PI * t), 30 - 25 * Math.cos(2 * Math.PI * t)] as const)],
    ['two', [...curve(20, (t) => [10 + 20 * Math.sin(Math.PI * t), 10 + 20 * (1 - Math.cos(Math.PI * t)) / 2] as const), ...line(30, 20, 5, 50), ...line(5, 50, 35, 50)]],
    ['three', [...curve(20, (t) => [10 + 15 * Math.sin(Math.PI * t), 25 - 15 * Math.cos(Math.PI * t)] as const), ...curve(20, (t) => [10 + 15 * Math.sin(Math.PI * t), 55 - 15 * Math.cos(Math.PI * t)] as const)]],
  ])('does not mistake a handwritten %s for a scratch', (_, xy) => {
    const store = new StrokeStore();
    expect(looksLikeScratch(makeStroke(store, xy))).toBe(false);
  });

  it('erases only the ink it covers', () => {
    const store = new StrokeStore();
    const covered = makeStroke(store, line(10, 10, 50, 20));
    const far = makeStroke(store, line(300, 10, 340, 20));
    const scratch = makeStroke(store, zigzag(0, 60, 0, 30, 7));
    expect(scratchTargets(scratch, [covered, far]).map((s) => s.id)).toEqual([covered.id]);
  });

  it('a scribble on empty paper erases nothing', () => {
    const store = new StrokeStore();
    const scratch = makeStroke(store, zigzag(0, 60, 0, 30, 7));
    expect(scratchTargets(scratch, [])).toEqual([]);
  });
});
