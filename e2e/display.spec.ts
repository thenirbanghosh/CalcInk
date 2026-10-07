import { expect, test } from '@playwright/test';
import { openApp } from './helpers';

test('canvases match devicePixelRatio for crisp ink', async ({ page }) => {
  await openApp(page);
  const r = await page.evaluate(() => {
    const c = document.querySelector<HTMLCanvasElement>('.layer-ink')!;
    return { dpr: devicePixelRatio, w: c.width, cssW: c.getBoundingClientRect().width, h: c.height, cssH: c.getBoundingClientRect().height };
  });
  expect(r.w).toBe(Math.round(r.cssW * r.dpr));
  expect(r.h).toBe(Math.round(r.cssH * r.dpr));
});
