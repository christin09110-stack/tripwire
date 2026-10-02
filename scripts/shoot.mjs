// Usage: node scripts/shoot.mjs <url> <outDir> [--quick] [--pages=overview,first] ; writes screenshots at 360/768/1280/1920, light + dark.
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
const [url, out] = [process.argv[2], process.argv[3]];
const quick = process.argv.includes('--quick');
mkdirSync(out, { recursive: true });
const b = await chromium.launch({ executablePath: '/home/rogerkorantenng/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome', args: ['--no-sandbox'] });
const sizes = quick ? [[1280, 800]] : [[360, 780], [768, 1000], [1280, 800], [1920, 1080]];
const errors = [];
for (const scheme of ['light', 'dark']) {
  const ctx = await b.newContext({ colorScheme: scheme, viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript((s) => { try { localStorage.setItem('tw-theme', s); } catch (e) {} }, scheme);
  const p = await ctx.newPage();
  p.on('console', (m) => { if (m.type() === 'error' && !/License|licen|Failed to load resource/i.test(m.text())) errors.push(`${scheme}: ${m.text().slice(0, 200)}`); });
  p.on('pageerror', (e) => errors.push(`${scheme} pageerror: ${e.message.slice(0, 200)}`));
  for (const [w, h] of sizes) {
    await p.setViewportSize({ width: w, height: h });
    await p.goto(url, { waitUntil: 'networkidle' }).catch(() => {});
    await p.waitForTimeout(2500);
    await p.screenshot({ path: `${out}/overview-${w}-${scheme}.png`, fullPage: w < 900 });
    // first finding page
    const nav = p.locator('.nav-item').nth(1);
    if (await nav.count()) { await nav.click(); await p.waitForTimeout(2200); await p.screenshot({ path: `${out}/finding1-${w}-${scheme}.png`, fullPage: w < 900 }); }
  }
  await ctx.close();
}
await b.close();
console.log(errors.length ? 'Console errors:\n' + [...new Set(errors)].join('\n') : 'No console errors beyond licence notices.');
