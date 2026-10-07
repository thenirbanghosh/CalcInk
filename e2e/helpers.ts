import { expect, type Page } from '@playwright/test';
import { writeExpression } from '../src/demo/handwriting';

export async function openApp(page: Page): Promise<void> {
  await page.goto('/');
  await page.evaluate(async () => {
    localStorage.clear();
    await new Promise<void>((r) => {
      const req = indexedDB.deleteDatabase('calcink');
      req.onsuccess = req.onerror = req.onblocked = () => r();
    });
  });
  await page.reload();
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready');
}

export async function write(page: Page, text: string, x: number, y: number, opts: { size?: number; seed?: number } = {}): Promise<void> {
  for (const s of writeExpression(text, { x, y, size: opts.size ?? 54, seed: opts.seed ?? 1, messiness: 0.55 })) {
    const p = s.pts;
    await page.mouse.move(p[0]!, p[1]!);
    await page.mouse.down();
    for (let i = 3; i < p.length; i += 3) await page.mouse.move(p[i]!, p[i + 1]!);
    await page.mouse.up();
  }
}

export interface LineInfo {
  text: string;
  kind: string;
  answer: string | null;
}

export async function lines(page: Page): Promise<LineInfo[]> {
  return page.evaluate(() =>
    ((window as any).calcink.lines as any[]).map((l) => ({
      text: l.text,
      kind: l.verdict.kind,
      answer: l.verdict.kind === 'value' || l.verdict.kind === 'check' ? l.verdict.display.text : null,
    })),
  );
}

export async function waitForAnswer(page: Page, text: string, answer: string): Promise<void> {
  await expect.poll(async () => (await lines(page)).find((l) => l.text === text)?.answer ?? (await lines(page)).map((l) => l.text).join(' | '), { timeout: 15_000 }).toBe(answer);
}
