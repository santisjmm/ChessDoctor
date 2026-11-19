// Runs the report flow with the production Content-Security-Policy from public/_headers applied.
import { readFileSync } from 'node:fs';
import { chromium, devices } from 'playwright';
const csp = /Content-Security-Policy: (.*)/.exec(readFileSync(new URL('../public/_headers', import.meta.url), 'utf8'))[1];
const base = process.argv[2] ?? 'http://localhost:4173/';
const browser = await chromium.launch();
const page = await (await browser.newContext(devices['Pixel 7'])).newPage();
const problems = [];
page.on('console', (m) => (m.type() === 'error' || /Content Security Policy/i.test(m.text())) && problems.push(m.text()));
page.on('pageerror', (e) => problems.push(String(e)));
await page.route(`${base}**`, async (route) => {
  const res = await route.fetch();
  await route.fulfill({ response: res, headers: { ...res.headers(), 'content-security-policy': csp } });
});
await page.goto(base);
await page.fill('input >> nth=1', process.env.CHESSCOM ?? 'hikaru');
await page.click('button.primary');
await page.waitForSelector('.card-preview img', { timeout: 120_000 });
await page.click('.nav a:has-text("Games")');
await page.click('.game-row');
await page.click('button:has-text("Review this game")');
await page.waitForSelector('.summary-grid', { timeout: 300_000 });
console.log(problems.length ? `PROBLEMS:\n${problems.join('\n')}` : 'CSP ok: report, engine and review all ran with no violations');
await browser.close();
