import { expect, test } from '@playwright/test';
import { lines, openApp, waitForAnswer, write } from './helpers';

test.beforeEach(async ({ page }) => openApp(page));

test('writes the answer next to a handwritten expression', async ({ page }) => {
  await write(page, '18+4×3=', 200, 200);
  await waitForAnswer(page, '18 + 4 × 3 =', '30');
  await expect(page.locator('#empty')).toHaveAttribute('hidden', '');
});

test('decimals, negatives and division by zero', async ({ page }) => {
  await write(page, '2.5×-4=', 200, 160, { seed: 2 });
  await write(page, '7÷0=', 200, 280, { seed: 3 });
  await waitForAnswer(page, '2.5 × −4 =', '-10');
  await expect.poll(async () => (await lines(page)).find((l) => l.text === '7 ÷ 0 =')?.kind).toBe('undefined');
});

test('editing re-evaluates: erase a digit, write another', async ({ page }) => {
  await write(page, '14+3=', 200, 220, { seed: 4 });
  await waitForAnswer(page, '14 + 3 =', '17');
  await page.keyboard.press('e');
  const three = await page.evaluate(() => {
    const l = (window as any).calcink.lines[0];
    const s = l.symbols[3];
    const v = (window as any).calcink.view;
    return { x0: s.bbox.minX * v.zoom + v.panX, x1: s.bbox.maxX * v.zoom + v.panX, y: ((s.bbox.minY + s.bbox.maxY) / 2) * v.zoom + v.panY, minX: s.bbox.minX };
  });
  const cx = (three.x0 + three.x1) / 2;
  await page.mouse.move(cx, three.y - 30);
  await page.mouse.down();
  await page.mouse.move(cx, three.y + 30, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => (await lines(page)).map((l) => l.text)).toEqual(['14 + =']);
  await page.keyboard.press('p');
  await write(page, '9', three.minX, 220, { seed: 9 });
  await waitForAnswer(page, '14 + 9 =', '23');
});

test('undo and redo restore the page and the answer', async ({ page }) => {
  await write(page, '6×7=', 200, 220, { seed: 5 });
  await waitForAnswer(page, '6 × 7 =', '42');
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(async () => (await lines(page)).map((l) => l.text)).toEqual(['6 × 7 −']);
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(async () => (await lines(page)).map((l) => l.text)).toEqual(['6 × 7']);
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await waitForAnswer(page, '6 × 7 =', '42');
});

test('checks a written answer', async ({ page }) => {
  await write(page, '9×8=72', 200, 220, { seed: 6 });
  await expect.poll(async () => (await page.evaluate(() => (window as any).calcink.lines[0]?.verdict))).toMatchObject({ kind: 'check', correct: true });
});

test('scratch-out erases the ink it covers', async ({ page }) => {
  await write(page, '5+5=', 200, 220, { seed: 7 });
  await waitForAnswer(page, '5 + 5 =', '10');
  const before = await page.evaluate(() => (window as any).calcink.store.size);
  await page.mouse.move(195, 214);
  await page.mouse.down();
  for (let k = 0; k < 10; k++) {
    await page.mouse.move(k % 2 ? 195 : 238, 214 + k * 7, { steps: 6 });
  }
  await page.mouse.up();
  await expect.poll(async () => page.evaluate(() => (window as any).calcink.store.size)).toBeLessThan(before);
  await expect.poll(async () => (await lines(page)).map((l) => l.text)).toEqual(['+ 5 =']);
});

test('tap an answer to inspect and correct a symbol', async ({ page }) => {
  await write(page, '3+4=', 200, 220, { seed: 8 });
  await waitForAnswer(page, '3 + 4 =', '7');
  const at = await page.evaluate(() => {
    const c = (window as any).calcink;
    const v = [...c.answers.views.values()][0];
    return c.view.toScreen((v.rect.minX + v.rect.maxX) / 2, (v.rect.minY + v.rect.maxY) / 2);
  });
  await page.mouse.click(at.x, at.y);
  const insp = page.locator('.inspector');
  await expect(insp).toHaveAttribute('data-open', 'true');
  await expect(insp.locator('.insp-expr .chip')).toHaveCount(4);
  await insp.locator('.insp-expr .chip').nth(2).click();
  await page.evaluate(() => {
    const c = (window as any).calcink;
    const key = c.lines[0].symbols[2].key;
    c.recognizer.override(key, '9');
  });
  await waitForAnswer(page, '3 + 9 =', '12');
});
