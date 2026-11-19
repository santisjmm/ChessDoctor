// Drives the built app in headless Chromium at phone size and saves screenshots to shots/.
// Usage: node scripts/screenshots.mjs [baseUrl]   env: LICHESS=<user> CHESSCOM=<user>
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium, devices } from 'playwright';

const base = process.argv[2] ?? 'http://localhost:4173/';
const out = new URL('../shots/', import.meta.url);
mkdirSync(out, { recursive: true });
const shot = (page, name) => page.screenshot({ path: new URL(`${name}.png`, out).pathname, fullPage: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices['Pixel 7'], colorScheme: 'dark' });
const page = await ctx.newPage();
const logs = [];
page.on('console', (m) => m.type() === 'error' && logs.push(m.text()));
page.on('pageerror', (e) => logs.push(String(e)));

await page.goto(base);
await page.waitForSelector('h1');
await shot(page, '1-start');
if (process.env.LICHESS) await page.fill('input >> nth=0', process.env.LICHESS);
if (process.env.CHESSCOM) await page.fill('input >> nth=1', process.env.CHESSCOM);
const t0 = Date.now();
await page.click('button.primary');
await page.waitForSelector('.bar', { timeout: 30_000 });
await page.waitForTimeout(1500);
await shot(page, '2-working');
await page.waitForSelector('.card-preview img', { timeout: 180_000 });
console.log(`report ready in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
await shot(page, '3-report');

// Save the card PNGs exactly as the app exports them.
const savePng = async (name) => {
  const b64 = await page.$eval('.card-preview img', async (img) => {
    const blob = await (await fetch(img.src)).blob();
    const buf = new Uint8Array(await blob.arrayBuffer());
    let s = '';
    for (const x of buf) s += String.fromCharCode(x);
    return btoa(s);
  });
  writeFileSync(new URL(`${name}.png`, out), Buffer.from(b64, 'base64'));
};
await savePng('card-portrait');
await page.click('.seg button >> nth=1');
await page.waitForFunction(() => document.querySelector('.card-preview img')?.naturalWidth === 1200);
await savePng('card-wide');
await page.click('.seg button >> nth=0');
await page.waitForFunction(() => document.querySelector('.card-preview img')?.naturalWidth === 1080);

// Plays the current drill by clicking squares; one deliberate slip on the first user move if asked.
async function playDrill(slip, shotName) {
  await page.waitForSelector('.board cg-board');
  await page.waitForTimeout(700);
  const line = await page.evaluate(() => window.__trainTarget);
  const color = await page.evaluate(() => window.__trainColor);
  const box = await page.$eval('.drill cg-board', (el) => el.getBoundingClientRect().toJSON());
  const sqXY = (s) => {
    const f = s.charCodeAt(0) - 97, r = Number(s[1]) - 1;
    const [cx, cy] = color === 'w' ? [f, 7 - r] : [7 - f, r];
    return [box.x + ((cx + 0.5) * box.width) / 8, box.y + ((cy + 0.5) * box.height) / 8];
  };
  const play = async (uci) => {
    await page.mouse.click(...sqXY(uci.slice(0, 2)));
    await page.mouse.click(...sqXY(uci.slice(2, 4)));
  };
  let erred = !slip;
  for (const step of line) {
    if (!step.mine) continue;
    await page.waitForFunction((p) => window.__trainPly === p, step.ply, { timeout: 10_000 });
    if (!erred && step.wrong) {
      await play(step.wrong);
      erred = true;
      await page.waitForTimeout(400);
      if (shotName) await shot(page, shotName);
    }
    await play(step.uci);
  }
  await page.waitForSelector('.feedback.done', { timeout: 15_000 });
}

if (await page.$('.cta button')) {
  await page.click('.cta button');
  await page.waitForSelector('.drill');
  await shot(page, '4-drill-start');
  await playDrill(true, '5-drill-wrong');
  await page.waitForTimeout(300);
  await shot(page, '6-drill-done');
  await page.click('main.train button.primary'); // Finish
  await page.waitForSelector('.drill-end');
  await page.click('.drill-end button.primary'); // Back home
}

// Today, after the engine has had a moment.
await page.waitForSelector('main.home');
await page.waitForFunction(() => !document.querySelector('.home .bar'), null, { timeout: 120_000 }).catch(() => undefined);
await page.waitForTimeout(500);
await shot(page, '8-home');

// Openings explorer: follow the biggest red move a few levels down, if any.
await page.click('.tabbar button >> nth=1');
await page.waitForSelector('main.openings');
await page.waitForTimeout(500);
await shot(page, '9-openings');
// Go to the most-played move the engine flagged.
await page.evaluate(() => {
  const m = window.__report.verdicts.filter((p) => p.v.drop >= 5).sort((a, b) => b.node.tally.n - a.node.tally.n)[0];
  if (m) window.__openLine(m.node.color, m.node.line);
});
await page.waitForTimeout(300);
for (let depth = 0; depth < 12; depth++) {
  if (await page.$('.mistake-panel')) break;
  const red = await page.$('.move-row:has(.tag.red)');
  const next = red ?? (await page.$('.move-row'));
  if (!next) break;
  await next.click();
  await page.waitForTimeout(150);
}
await page.waitForTimeout(300);
await shot(page, '10-openings-mistake');

// Reload: a returning user lands on Today, built from the device (no import).
await page.goto(base);
await page.waitForSelector('main.home', { timeout: 30_000 });
await page.waitForTimeout(1500);
await shot(page, '11-home-reload');

// A full training session from Today.
if (await page.$('.today button.primary')) {
  await page.click('.today button.primary');
  for (let k = 0; k < 10; k++) {
    await playDrill(k === 0, null);
    await page.click('main.train button.primary');
    if (await page.waitForSelector('.drill-end', { timeout: 1500 }).catch(() => null)) break;
  }
  await shot(page, '12-session-end');
  await page.click('.drill-end button.primary');
  await page.waitForSelector('main.home');
  await page.waitForTimeout(500);
  await shot(page, '13-home-after');
}

await page.goto(base + '#/about');
await page.waitForTimeout(300);
await shot(page, '7-about');

// App icons from the SVG.
const iconCtx = await browser.newContext({ deviceScaleFactor: 1 });
for (const size of [192, 512]) {
  const p = await iconCtx.newPage();
  await p.setViewportSize({ width: size, height: size });
  await p.goto(base + 'icon.svg');
  await p.screenshot({ path: new URL(`../public/icon-${size}.png`, import.meta.url).pathname, omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
  await p.close();
}
console.log(logs.length ? `console errors:\n${logs.join('\n')}` : 'no console errors');
await browser.close();
