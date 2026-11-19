// Screenshots of every tab (Review-style layout). Usage: VIEWPORT=desktop|phone CHESSCOM=<user> node scripts/look.mjs [baseUrl]
import { mkdirSync } from 'node:fs';
import { chromium, devices } from 'playwright';
const base = process.argv[2] ?? 'http://localhost:4173/';
const vp = process.env.VIEWPORT ?? 'desktop';
const out = new URL(`../shots/${vp}/`, import.meta.url);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const page = await (await browser.newContext({ ...(vp === 'phone' ? devices['Pixel 7'] : { viewport: { width: 1440, height: 900 } }), colorScheme: process.env.SCHEME ?? 'dark' })).newPage();
const shot = (n) => page.screenshot({ path: new URL(`${n}.png`, out).pathname, fullPage: true });
const problems = [];
page.on('console', (m) => m.type() === 'error' && !/ERR_SSL_PROTOCOL_ERROR/.test(m.text()) && problems.push(m.text()));
page.on('pageerror', (e) => problems.push(String(e)));
const nav = (name) => page.click(vp === 'phone' ? `.mobile-nav a:has-text("${name}")` : `.nav a:has-text("${name}")`);
await page.goto(base);
await page.waitForSelector('main');
await shot('v1-start');
await page.fill('input >> nth=1', process.env.CHESSCOM ?? 'hikaru');
await page.click('button.primary');
await page.waitForSelector('.card-preview img', { timeout: 120_000 });
await page.waitForTimeout(500);
await shot('v2-card');
await nav('Train'); await page.waitForTimeout(800); await shot('v3-train-today');
// Play the first drill of today's session (line drills expose their moves for this run).
if (await page.$('button:has-text("Start training")')) {
  await page.click('button:has-text("Start training")');
  await page.waitForSelector('.drill cg-board');
  await page.waitForTimeout(800);
  const line = await page.evaluate(() => window.__trainTarget);
  if (line) {
    const color = await page.evaluate(() => window.__trainColor);
    const box = await page.$eval('.drill cg-board', (el) => el.getBoundingClientRect().toJSON());
    const xy = (q) => { const f = q.charCodeAt(0) - 97, r = Number(q[1]) - 1; const [cx, cy] = color === 'w' ? [f, 7 - r] : [7 - f, r]; return [box.x + ((cx + 0.5) * box.width) / 8, box.y + ((cy + 0.5) * box.height) / 8]; };
    let slipped = false;
    for (const st of line) {
      if (!st.mine) continue;
      await page.waitForFunction((p) => window.__trainPly === p, st.ply, { timeout: 10_000 });
      if (!slipped && st.wrong) { await page.mouse.click(...xy(st.wrong.slice(0, 2))); await page.mouse.click(...xy(st.wrong.slice(2, 4))); slipped = true; await page.waitForTimeout(300); await shot('v3b-drill-wrong'); }
      await page.mouse.click(...xy(st.uci.slice(0, 2))); await page.mouse.click(...xy(st.uci.slice(2, 4)));
    }
    await page.waitForSelector('.feedback.done', { timeout: 15_000 });
    await shot('v3c-drill-done');
  }
  await page.click('button:has-text("Stop")');
}
await page.click('.tabs a:has-text("Mistakes")'); await page.waitForTimeout(400); await shot('v4-train-mistakes');
await page.click('.tabs a:has-text("Openings")'); await page.waitForTimeout(400); await shot('v5-train-openings');
await page.click('.tabs a:has-text("Learn")'); await page.waitForTimeout(800); await shot('v6-train-learn');
await nav('Games'); await page.waitForTimeout(500); await shot('v7-games');
await page.click('.game-row:has(.result.loss)');
await page.waitForSelector('.review'); await page.waitForTimeout(500); await shot('v8-game-before');
await page.click('button:has-text("Review this game")');
await page.waitForSelector('.summary-grid', { timeout: 300_000 });
await page.waitForTimeout(800); await shot('v9-game-review');
await nav('Stats'); await page.waitForTimeout(800); await shot('v10-stats');
await nav('Settings'); await page.waitForTimeout(400); await shot('v11-settings');
console.log(problems.length ? `PROBLEMS:\n${problems.join('\n')}` : 'no console errors');
await browser.close();
