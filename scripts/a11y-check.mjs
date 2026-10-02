// Measured accessibility checks against a running build: target sizes, text size floor, 200% zoom reflow, keyboard focus.
import { chromium } from 'playwright-core';
const url = process.argv[2];
const PT = 96 / 72;
const b = await chromium.launch({ executablePath: '/home/rogerkorantenng/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome', args: ['--no-sandbox'] });
const out = [];
const log = (s) => { out.push(s); console.log(s); };
for (const scheme of ['light', 'dark']) {
  const ctx = await b.newContext({ colorScheme: scheme, viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript((s) => { try { localStorage.setItem('tw-theme', s); } catch (e) {} }, scheme);
  const p = await ctx.newPage();
  await p.goto(url, { waitUntil: 'networkidle' }); await p.waitForTimeout(2500);
  await p.locator('button[data-act=open]').nth(1).click(); await p.waitForTimeout(2500);
  log(`\n## ${scheme} theme, 1280x800, first finding page`);
  const r = await p.evaluate((PT) => {
    const vis = (e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
    const small = [], tiny = [];
    for (const e of document.querySelectorAll('.app button, .app a, .app input, .app select, .app [role=button]')) {
      if (!vis(e) || e.closest('.ag-menu, .ag-popup, .ag-header-cell, .ag-status-bar')) continue;
      const r = e.getBoundingClientRect();
      if (r.width < 28 * PT - 0.5 || r.height < 28 * PT - 0.5) small.push(`${e.tagName.toLowerCase()}.${(e.className || '').toString().split(' ')[0]} "${(e.textContent || e.getAttribute('aria-label') || '').trim().slice(0, 30)}" ${Math.round(r.width)}x${Math.round(r.height)}px`);
    }
    const walker = document.createTreeWalker(document.querySelector('.app'), NodeFilter.SHOW_TEXT);
    const seen = new Map();
    while (walker.nextNode()) {
      const n = walker.currentNode; if (!n.textContent.trim()) continue;
      const e = n.parentElement; if (!vis(e) || e.closest('.tw-sr, .btn-label, svg')) continue;
      const fs = parseFloat(getComputedStyle(e).fontSize);
      if (fs < 10 * PT - 0.05) { const k = `${e.tagName.toLowerCase()}.${(e.className || '').toString().split(' ')[0]}`; seen.set(k, Math.min(fs, seen.get(k) ?? 99)); }
    }
    for (const [k, v] of seen) tiny.push(`${k} ${v.toFixed(1)}px`);
    return { small, tiny, body: parseFloat(getComputedStyle(document.body).fontSize) };
  }, PT);
  log(`Body text ${r.body.toFixed(1)}px = ${(r.body / PT).toFixed(1)}pt (target 13pt)`);
  log(`Interactive elements under 28x28pt (37.3px) in the app shell and widgets: ${r.small.length ? '\n  ' + r.small.join('\n  ') : 'none'}`);
  log(`Text under the 10pt (13.3px) floor: ${r.tiny.length ? '\n  ' + r.tiny.join('\n  ') : 'none'}`);
  // 200% text: browser zoom 200% at 1280 is a 640px layout
  await p.setViewportSize({ width: 640, height: 800 });
  await p.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
  await p.waitForTimeout(800);
  const ov = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth }));
  log(`200% text size at a 640px viewport: scrollWidth ${ov.sw} vs viewport ${ov.iw} -> ${ov.sw <= ov.iw + 1 ? 'no horizontal scroll' : 'HORIZONTAL SCROLL'}`);
  await p.setViewportSize({ width: 1280, height: 800 });
  await p.evaluate(() => { document.documentElement.style.fontSize = ''; });
  // keyboard
  await p.goto(url, { waitUntil: 'networkidle' }); await p.waitForTimeout(2000);
  const stops = [];
  for (let i = 0; i < 12; i++) {
    await p.keyboard.press('Tab');
    stops.push(await p.evaluate(() => { const e = document.activeElement; const cs = getComputedStyle(e); const ring = cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) >= 2; return `${e.tagName.toLowerCase()} "${(e.textContent || e.getAttribute('aria-label') || '').trim().slice(0, 28)}" focus ring ${ring ? cs.outlineWidth : cs.boxShadow !== 'none' ? 'box-shadow' : 'MISSING'}`; }));
  }
  log(`Tab order, first 12 stops:\n  ${stops.join('\n  ')}`);
  await ctx.close();
}
await b.close();
