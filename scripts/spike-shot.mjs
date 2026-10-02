import { chromium } from 'playwright-core';
const b = await chromium.launch({ executablePath: '/home/rogerkorantenng/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome', args: ['--no-sandbox'] });
const p = await b.newPage({ viewport: { width: 1400, height: 800 } });
p.on('console', m => console.log('console:', m.type(), m.text().slice(0, 300)));
p.on('pageerror', e => console.log('pageerror:', e.message.slice(0, 400)));
await p.goto(process.argv[2] || 'http://localhost:5190/'); await p.waitForTimeout(4000);
await p.screenshot({ path: process.argv[3] || '/tmp/claude-1000/spike.png' });
await b.close();
