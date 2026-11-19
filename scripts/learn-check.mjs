// Learn mode in headless Chromium. Usage: VIEWPORT=desktop|phone CHESSCOM=<user> node scripts/learn-check.mjs [baseUrl]
import { mkdirSync } from 'node:fs';
import { chromium, devices } from 'playwright';
const base = process.argv[2] ?? 'http://localhost:4173/';
const vp = process.env.VIEWPORT ?? 'desktop';
const out = new URL(`../shots/${vp}/`, import.meta.url);
mkdirSync(out, { recursive: true });
const shot = (p, n) => p.screenshot({ path: new URL(`${n}.png`, out).pathname, fullPage: true });
const browser = await chromium.launch();
const page = await (await browser.newContext({ ...(vp === 'phone' ? devices['Pixel 7'] : { viewport: { width: 1440, height: 900 } }), colorScheme: 'dark' })).newPage();
const problems = [];
page.on('console', (m) => m.type() === 'error' && !/ERR_SSL_PROTOCOL_ERROR/.test(m.text()) && problems.push(m.text()));
page.on('pageerror', (e) => problems.push(String(e)));
await page.goto(base);
await page.fill('input >> nth=1', process.env.CHESSCOM ?? 'hikaru');
await page.click('button.primary');
await page.waitForSelector('.card-preview img', { timeout: 120_000 });
await page.click('.tabbar button >> nth=1');
await page.click('button:has-text("Learn from the book")');
await page.waitForSelector('.learn-row');
await shot(page, 'l1-learn-list');
await page.click('.learn-row >> nth=0');
async function playLine(slip) {
  await page.waitForFunction(() => window.__book?.target, null, { timeout: 10_000 });
  let erred = !slip;
  for (;;) {
    const b = await page.evaluate(() => window.__book);
    if (b.done) break;
    if ((b.ply % 2 === 0 ? 'w' : 'b') !== b.color) { await page.waitForTimeout(150); continue; }
    const box = await page.$eval('.drill cg-board', (el) => el.getBoundingClientRect().toJSON());
    const xy = (s) => { const f = s.charCodeAt(0) - 97, r = Number(s[1]) - 1; const [cx, cy] = b.color === 'w' ? [f, 7 - r] : [7 - f, r]; return [box.x + ((cx + 0.5) * box.width) / 8, box.y + ((cy + 0.5) * box.height) / 8]; };
    const moves = await page.evaluate(({ target, ply }) => {
      // Recreate the position with the page's own chess.js is not available; compute squares from SAN via a tiny helper in the page.
      return { target, ply };
    }, b);
    const uci = await page.evaluate(async ({ target, ply }) => window.__sanToUci(target.slice(0, ply), target[ply]), moves);
    if (!erred) {
      const wrong = await page.evaluate(async ({ target, ply }) => window.__anyOtherUci(target.slice(0, ply), target[ply]), moves);
      await page.mouse.click(...xy(wrong.slice(0, 2))); await page.mouse.click(...xy(wrong.slice(2, 4)));
      erred = true;
      await page.waitForTimeout(300);
      await shot(page, 'l2-learn-wrong');
    }
    await page.mouse.click(...xy(uci.slice(0, 2))); await page.mouse.click(...xy(uci.slice(2, 4)));
    await page.waitForFunction((p) => window.__book.ply > p, b.ply, { timeout: 5000 });
  }
  await page.waitForSelector('.feedback.done', { timeout: 5000 });
  return page.$eval('.feedback', (e) => e.textContent);
}
console.log('line 1:', await playLine(true));
await shot(page, 'l3-learn-done');
await page.click('button:has-text("Next line")');
console.log('line 2:', await playLine(false));
console.log(problems.length ? `PROBLEMS:\n${problems.join('\n')}` : 'no console errors');
await browser.close();
