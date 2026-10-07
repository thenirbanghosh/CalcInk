import { expect, test } from '@playwright/test';
import { openApp, waitForAnswer, write } from './helpers';

test('100% on-device: no request ever leaves the origin', async ({ page, baseURL }) => {
  const foreign: string[] = [];
  page.on('request', (r) => {
    if (!r.url().startsWith(baseURL!) && !r.url().startsWith('data:') && !r.url().startsWith('blob:')) foreign.push(r.url());
  });
  await openApp(page);
  await write(page, '12×12=', 200, 220);
  await waitForAnswer(page, '12 × 12 =', '144');
  expect(foreign).toEqual([]);
});

test('works in airplane mode after the first visit', async ({ page, context }) => {
  await openApp(page);
  await page.evaluate(async () => (await navigator.serviceWorker.ready).active?.state);
  await expect(page.locator('#status .status-label')).toHaveText(/offline/);
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);

  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready');
  await write(page, '45+55=', 200, 220, { seed: 3 });
  await waitForAnswer(page, '45 + 55 =', '100');
  await context.setOffline(false);
});
