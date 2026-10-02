// node scripts/shot-page.mjs <url> <out.png> [navIndex] [width] [height] [scheme] [scrollSelector]
import { chromium } from 'playwright-core';
const [url, out, nav = '1', w = '1280', h = '900', scheme = 'light'] = process.argv.slice(2);
const b = await chromium.launch({ executablePath: '/home/rogerkorantenng/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome', args: ['--no-sandbox'] });
const ctx = await b.newContext({ colorScheme: scheme, viewport: { width: +w, height: +h } });
await ctx.addInitScript((s) => { try { localStorage.setItem('tw-theme', s); } catch (e) {} }, scheme);
const p = await ctx.newPage();
p.on('pageerror', (e) => console.log('pageerror', e.message.slice(0, 300)));
p.on('console', (m) => { if (m.type() === 'error' && !/License|licen|unlocked|\*\*\*|Failed to load/i.test(m.text())) console.log('console.error', m.text().slice(0, 300)); });
await p.goto(url, { waitUntil: 'networkidle' }); await p.waitForTimeout(2000);
if (+nav > 0) { await p.locator('button[data-act=open]').nth(+nav - 1).click(); await p.waitForTimeout(2500); }
await p.screenshot({ path: out });
await b.close();
