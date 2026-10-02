import { chromium } from 'playwright-core';
const [url, nav = '4'] = process.argv.slice(2);
const b = await chromium.launch({ executablePath: '/home/rogerkorantenng/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome', args: ['--no-sandbox'] });
const p = await (await b.newContext({ viewport: { width: 1400, height: 1000 } })).newPage();
p.on('console', (m) => { const t = m.text(); if (!/License|licen|unlocked|\*\*\*|vite|React DevTools/i.test(t)) console.log(m.type(), t.slice(0, 500)); });
p.on('pageerror', (e) => console.log('pageerror', e.message.slice(0, 300)));
await p.goto(url, { waitUntil: 'networkidle' }); await p.waitForTimeout(1500);
for (const i of nav.split(',')) { await p.locator('.nav-item').nth(+i).click(); await p.waitForTimeout(2200); }
await b.close();
