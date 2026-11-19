// Saves both report card PNGs exactly as exported. Usage: LICHESS=<u> | CHESSCOM=<u> node scripts/card-check.mjs [baseUrl] [prefix]
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
const base = process.argv[2] ?? 'http://localhost:4173/';
const prefix = process.argv[3] ?? 'card';
const out = new URL('../shots/cards/', import.meta.url);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
await page.goto(base);
if (process.env.LICHESS) await page.fill('input >> nth=0', process.env.LICHESS);
if (process.env.CHESSCOM) await page.fill('input >> nth=1', process.env.CHESSCOM);
await page.click('button.primary');
await page.waitForSelector('.card-preview img', { timeout: 180_000 });
const save = async (name, width) => {
  await page.waitForFunction((w) => document.querySelector('.card-preview img')?.naturalWidth === w, width);
  const b64 = await page.$eval('.card-preview img', (img) => {
    const c = document.createElement('canvas');
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    c.getContext('2d').drawImage(img, 0, 0);
    return c.toDataURL('image/png').split(',')[1];
  });
  writeFileSync(new URL(`${prefix}-${name}.png`, out), Buffer.from(b64, 'base64'));
};
await save('portrait', 1080);
await page.click('.segmented button:has-text("Wide")');
await save('wide', 1200);
await page.screenshot({ path: new URL(`${prefix}-page.png`, out).pathname, fullPage: true });
await browser.close();
console.log('saved');
