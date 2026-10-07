import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';

const svg = readFileSync('public/favicon.svg', 'utf8');
const maskable = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#23262d"/><g transform="translate(6.4 6.4) scale(0.8)">${svg.replace(/<svg[^>]*>|<\/svg>/g, '').replace(/<rect[^>]*\/>/, '')}</g></svg>`;
const browser = await chromium.launch();
const page = await browser.newPage();
for (const [name, src, size] of [
  ['icon-192.png', svg, 192],
  ['icon-512.png', svg, 512],
  ['apple-touch-icon.png', svg, 180],
  ['icon-maskable-512.png', maskable, 512],
]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${src.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
  await page.locator('svg').screenshot({ path: `public/icons/${name}`, omitBackground: true });
}
await browser.close();
console.log('icons written');
