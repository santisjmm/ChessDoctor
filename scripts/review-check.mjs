// Full game review in headless Chromium: review a game, train one of the mistakes as a puzzle.
// Usage: VIEWPORT=desktop|phone CHESSCOM=<user> node scripts/review-check.mjs [baseUrl]
import { mkdirSync } from 'node:fs';
import { chromium, devices } from 'playwright';
const base = process.argv[2] ?? 'http://localhost:4173/';
const vp = process.env.VIEWPORT ?? 'desktop';
const out = new URL(`../shots/${vp}/`, import.meta.url);
mkdirSync(out, { recursive: true });
const shot = (p, n) => p.screenshot({ path: new URL(`${n}.png`, out).pathname, fullPage: true });
const browser = await chromium.launch();
const ctx = await browser.newContext({ ...(vp === 'phone' ? devices['Pixel 7'] : { viewport: { width: 1440, height: 900 } }), colorScheme: 'dark' });
const page = await ctx.newPage();
const problems = [];
page.on('console', (m) => m.type() === 'error' && !/ERR_SSL_PROTOCOL_ERROR/.test(m.text()) && problems.push(m.text()));
page.on('pageerror', (e) => problems.push(String(e)));
await page.goto(base);
await page.fill('input >> nth=1', process.env.CHESSCOM ?? 'hikaru');
await page.click('button.primary');
await page.waitForSelector('.card-preview img', { timeout: 120_000 });
await page.click('.tabbar button >> nth=2');
// A game that the user lost (more likely to contain mistakes).
const lost = await page.$('.game-row:has(.res.bad)');
await (lost ?? (await page.$('.game-row'))).click();
await page.click('.seg button:has-text("Whole game")');
await page.click('button:has-text("Review the whole game")');
const t0 = Date.now();
await page.waitForSelector('.players', { timeout: 300_000 });
console.log(`whole-game review in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
await page.waitForTimeout(500);
await shot(page, 'r1-full-review');
const summary = await page.$$eval('.player', (els) => els.map((e) => e.innerText.replace(/\s+/g, ' ').slice(0, 140)));
console.log(summary.join('\n'));
// Variation: click the first move of the best line, if shown.
const pv = await page.$('.verdict .moves .mvbtn');
if (pv) {
  await pv.click();
  await page.waitForTimeout(1500);
  await shot(page, 'r2-variation');
  await page.keyboard.press('Escape');
}
const train = await page.$('button:has-text("Train this mistake")');
if (train) {
  await train.click();
  await page.waitForSelector('.drill');
  await page.waitForTimeout(600);
  await shot(page, 'r3-puzzle');
  const pz = await page.evaluate(() => window.__puzzle);
  const box = await page.$eval('.drill cg-board', (el) => el.getBoundingClientRect().toJSON());
  const xy = (s) => {
    const f = s.charCodeAt(0) - 97, r = Number(s[1]) - 1;
    const [cx, cy] = pz.color === 'w' ? [f, 7 - r] : [7 - f, r];
    return [box.x + ((cx + 0.5) * box.width) / 8, box.y + ((cy + 0.5) * box.height) / 8];
  };
  await page.mouse.click(...xy(pz.best.slice(0, 2)));
  await page.mouse.click(...xy(pz.best.slice(2, 4)));
  await page.waitForSelector('.feedback.ok', { timeout: 20_000 });
  await shot(page, 'r4-puzzle-solved');
  console.log('puzzle solved with the engine move');
} else console.log('no "Train this mistake" on the first key moment (it may be the opponent’s)');
const queued = await page.evaluate(async () => {
  const db = await new Promise((res) => { const r = indexedDB.open('opening-trainer'); r.onsuccess = () => res(r.result); });
  return new Promise((res) => { const all = db.transaction('drills').objectStore('drills').getAll(); all.onsuccess = () => res(all.result.filter((d) => d.kind === 'position').length); });
});
console.log(`position puzzles queued: ${queued}`);
console.log(problems.length ? `PROBLEMS:\n${problems.join('\n')}` : 'no console errors');
await browser.close();
