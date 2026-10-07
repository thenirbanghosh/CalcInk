import { expect, test } from '@playwright/test';
import { openApp, waitForAnswer, write } from './helpers';

test('UI thread holds frame rate while recognition runs', async ({ page }) => {
  await openApp(page);
  await page.waitForTimeout(2500);
  await write(page, '1', 40, 600);
  await page.keyboard.press('ControlOrMeta+z');
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    const w = window as any;
    w.__frames = [];
    w.__long = [];
    const t0 = performance.now();
    let last = performance.now();
    const tick = (t: number) => {
      w.__frames.push(t - last);
      last = t;
      if (w.__frames.length < 100000) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    new PerformanceObserver((l) => l.getEntries().forEach((e) => e.startTime >= t0 && w.__long.push(e.duration))).observe({ type: 'longtask' });
  });
  const exprs = ['18+4×3=', '96÷12-3=', '2.5×-4=', '100-250=', '7×8÷4=', '0.1+0.2='];
  for (let i = 0; i < exprs.length; i++) await write(page, exprs[i]!, 120 + (i % 2) * 560, 120 + Math.floor(i / 2) * 150, { seed: i + 1 });
  await waitForAnswer(page, '0.1 + 0.2 =', '0.3');
  const { frames, long, inferMs } = await page.evaluate(() => {
    const w = window as any;
    return { frames: (w.__frames as number[]).slice(5), long: w.__long as number[], inferMs: w.calcink.recognizer.loadMs };
  });
  const sorted = [...frames].sort((a, b) => a - b);
  const p95 = sorted[Math.floor(sorted.length * 0.95)]!;
  const p99 = sorted[Math.floor(sorted.length * 0.99)]!;
  const fps = 1000 / (frames.reduce((a, b) => a + b, 0) / frames.length);
  console.log(JSON.stringify({ frames: frames.length, fps: +fps.toFixed(1), p95: +p95.toFixed(2), p99: +p99.toFixed(2), worst: +Math.max(...frames).toFixed(1), longTasks: long.length, modelLoadMs: Math.round(inferMs) }));
  if (process.env.CI) {
    expect(long.filter((d) => d > 100)).toEqual([]);
    expect(p95).toBeLessThan(34);
  } else {
    expect(long.filter((d) => d > 50)).toEqual([]);
    expect(p95).toBeLessThan(20); // 16.7ms budget + a bit of jitter
  }
});

test('memory stays flat over a long session (no leaks)', async ({ page }) => {
  await openApp(page);
  const cdp = await page.context().newCDPSession(page);
  const heap = async () => {
    await cdp.send('HeapProfiler.collectGarbage');
    return (await page.evaluate(() => (performance as any).memory.usedJSHeapSize)) as number;
  };
  await write(page, '12+34=', 200, 220);
  await waitForAnswer(page, '12 + 34 =', '46');
  await page.evaluate(() => (window as any).calcink.clear());
  const base = await heap();
  for (let round = 0; round < 12; round++) {
    await write(page, '45×67=', 200, 220, { seed: round + 2 });
    await waitForAnswer(page, '45 × 67 =', '3015');
    await page.evaluate(() => {
      const c = (window as any).calcink;
      c.undo();
      c.redo();
      c.clear();
    });
  }
  const after = await heap();
  const state = await page.evaluate(() => {
    const c = (window as any).calcink;
    return { strokes: c.store.size, paths: c.surface.paths.size, answers: c.answers.views.size };
  });
  console.log(JSON.stringify({ baseMB: +(base / 1048576).toFixed(2), afterMB: +(after / 1048576).toFixed(2), state }));
  expect(state.paths).toBe(0);
  expect(after - base).toBeLessThan(4 * 1048576);
});
