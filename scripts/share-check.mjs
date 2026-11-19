// Opens a share link on a fresh "phone": intro -> card, and checks nothing is saved as the viewer's own.
import { mkdirSync } from 'node:fs';
import { chromium, devices } from 'playwright';
const base = (process.argv[2] ?? 'http://localhost:4173').replace(/\/$/, '');
const path = process.argv[3] ?? '/r/c/hikaru';
const out = new URL('../shots/', import.meta.url);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const page = await (await browser.newContext(devices['Pixel 7'])).newPage();
const problems = [];
page.on('console', (m) => m.type() === 'error' && problems.push(m.text()));
page.on('pageerror', (e) => problems.push(String(e)));
await page.goto(base + path);
await page.waitForSelector('text=opening report card');
await page.screenshot({ path: new URL('s1-shared-intro.png', out).pathname, fullPage: true });
await page.click('button.primary');
await page.waitForSelector('.card-preview img', { timeout: 120_000 });
await page.waitForTimeout(500);
await page.screenshot({ path: new URL('s2-shared-card.png', out).pathname, fullPage: true });
const state = await page.evaluate(async () => {
  const open = () => new Promise((res, rej) => { const r = indexedDB.open('opening-trainer'); r.onsuccess = () => res(r.result); r.onerror = rej; });
  const db = await open();
  const count = (store) => new Promise((res) => { const t = db.transaction(store).objectStore(store).count(); t.onsuccess = () => res(t.result); });
  return { savedAccounts: localStorage.getItem('accounts'), drills: await count('drills'), tabbar: !!document.querySelector('.tabbar'), ctaOwn: !!document.querySelector('.cta button') };
});
console.log(JSON.stringify(state));
await page.click('.cta button'); // Get my own report card
await page.waitForSelector('main.start', { timeout: 10_000 });
console.log('after "Get my own":', new URL(page.url()).pathname);
console.log(problems.length ? `PROBLEMS:\n${problems.join('\n')}` : 'no console errors');
await browser.close();
