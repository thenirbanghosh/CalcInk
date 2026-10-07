import { chromium } from '@playwright/test';
import { register } from 'tsx/esm/api';
register();
const { writeExpression } = await import('../src/demo/handwriting.ts');

const browser = await chromium.launch();
async function page(theme) {
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 760 }, deviceScaleFactor: 2, colorScheme: theme });
  const p = await ctx.newPage();
  await p.goto('http://localhost:4173/');
  await p.evaluate(() => localStorage.clear());
  await p.reload();
  await p.waitForSelector('#status[data-state="ready"]');
  await p.waitForTimeout(1200);
  return p;
}
async function write(p, text, x, y, size, seed) {
  for (const s of writeExpression(text, { x, y, size, seed, messiness: 0.5 })) {
    const pts = s.pts;
    await p.mouse.move(pts[0], pts[1]);
    await p.mouse.down();
    for (let i = 3; i < pts.length; i += 3) await p.mouse.move(pts[i], pts[i + 1]);
    await p.mouse.up();
  }
}
async function scene(p) {
  await write(p, '18+4×3=', 150, 150, 58, 11);
  await write(p, '1÷7=', 150, 270, 58, 12);
  await write(p, '2.5×-4=', 150, 390, 58, 13);
  await write(p, '7÷0=', 700, 150, 58, 14);
  await write(p, '6×7=42', 700, 270, 58, 15);
  await write(p, '0.1+0.2=', 700, 390, 58, 16);
  await p.mouse.move(1150, 700);
  await p.waitForTimeout(3500);
}

const light = await page('light');
await scene(light);
await light.screenshot({ path: 'docs/media/hero.png' });
const at = await light.evaluate(() => {
  const c = window.calcink;
  const v = [...c.answers.views.values()].find((v) => v.line.text.startsWith('18'));
  return c.view.toScreen((v.rect.minX + v.rect.maxX) / 2, (v.rect.minY + v.rect.maxY) / 2);
});
await light.mouse.click(at.x, at.y);
await light.waitForTimeout(500);
await light.locator('.insp-expr .chip').nth(1).click();
await light.waitForTimeout(400);
await light.screenshot({ path: 'docs/media/inspector.png' });
await light.keyboard.press('Escape');
await light.keyboard.press('x');
await light.keyboard.press('h');
await light.waitForTimeout(1500);
await light.screenshot({ path: 'docs/media/xray-hud.png' });

const dark = await page('dark');
await scene(dark);
await dark.screenshot({ path: 'docs/media/dark.png' });
await browser.close();
console.log('screenshots written');
