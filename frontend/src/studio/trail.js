import { TwWidget } from './base.js';
import { esc, int, dt } from '../format.js';
import { narrate } from '../narrate.js';

const LABEL = { tool: 'Tool', model: 'Agent', note: 'Note', fallback: 'Fallback', retry: 'Retry', error: 'Error' };

/** "How this board was built": the last scan's steps, narrated, so the agent's work is visible where the space is. */
export class TwTrail extends TwWidget {
  kind = 'tw-trail-w';
  build() {}
  update() {
    const run = this.ctx.latestRun;
    if (!run) { this.root.innerHTML = '<p class="tw-empty">No scan has run yet. Press Scan the stream.</p>'; return; }
    const steps = (run.steps || []).filter((s) => s.kind !== 'model' || s.detail);
    const tools = steps.filter((s) => s.kind === 'tool');
    const built = tools.filter((s) => s.tool === 'build_widget' && s.ok !== false).length;
    const failed = tools.filter((s) => s.ok === false).length;
    const u = run.usage || {};
    const facts = [`${int(u.calls || 0)} model requests`, `${tools.length} tool calls`, `${built} widgets built`, failed ? `${failed} rejected and fixed` : null, run.fallback ? 'rules fallback used' : null].filter(Boolean).join(' · ');
    this.root.innerHTML = `<header class="tw-wh"><h3 class="tw-wt">How this board was built</h3><span class="tw-meta">${esc(dt(run.startedAt))}</span></header>
      <p class="tw-caption">${esc(facts)}</p>
      <ol class="tw-trail-list" tabindex="0" aria-label="Steps of the last scan">${steps.map((s) => `<li><span class="k ${s.kind === 'error' ? 'err' : ''}">${LABEL[s.kind] || s.kind}</span><span>${esc(String(narrate(s)).slice(0, 160))}${s.ok === false ? ' (rejected, the agent fixed it)' : ''}</span></li>`).join('')}</ol>`;
  }
}
