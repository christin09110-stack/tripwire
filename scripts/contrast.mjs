// Computes WCAG contrast ratios from the real hex values in frontend/src/tokens.js. Exit code 1 if any pair fails.
import { TOKENS, PAIRS } from '../frontend/src/tokens.js';
const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const lum = (hex) => { const n = parseInt(hex.slice(1), 16); return 0.2126 * lin(n >> 16) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255); };
export const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
let bad = 0; const rows = [];
for (const mode of ['light', 'dark']) for (const [fg, bg, min, label] of PAIRS) {
  const r = ratio(TOKENS[mode][fg], TOKENS[mode][bg]);
  const ok = r >= min; if (!ok) bad++;
  rows.push({ mode, label, fg: `${fg} ${TOKENS[mode][fg]}`, bg: `${bg} ${TOKENS[mode][bg]}`, ratio: r.toFixed(2), min, ok });
}
if (process.argv.includes('--md')) {
  console.log('| Mode | Pair | Foreground | Background | Ratio | Needs | Result |\n|---|---|---|---|---|---|---|');
  for (const r of rows) console.log(`| ${r.mode} | ${r.label} | ${r.fg} | ${r.bg} | ${r.ratio}:1 | ${r.min}:1 | ${r.ok ? 'pass' : 'FAIL'} |`);
} else for (const r of rows) console.log(`${r.ok ? 'pass' : 'FAIL'}  ${r.mode.padEnd(5)} ${r.ratio.padStart(6)}:1 (needs ${r.min})  ${r.label}  ${r.fg} on ${r.bg}`);
console.log(bad ? `\n${bad} pair(s) below their floor.` : `\nAll ${rows.length} pairs meet their floor.`);
process.exit(bad ? 1 : 0);
