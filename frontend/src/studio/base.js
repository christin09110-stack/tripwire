import { esc } from '../format.js';

/** Common shell of every Tripwire widget: a labelled region with a heading, an author badge and a caption. */
export class TwWidget {
  init(params) {
    this.params = params;
    this.ctx = params.context;
    this.root = document.createElement('section');
    this.root.className = `tw-widget ${this.kind || ''}`;
    this.unsub = this.ctx.subscribe(() => this.update());
    this.build();
    this.update();
  }
  getGui() { return this.root; }
  refresh(params) { this.params = params; this.update(); return true; }
  destroy() { this.unsub?.(); this.dispose?.(); }
  get record() { return this.ctx.widget(this.params.widgetId); }
  headerHtml(title, record, extra = '') {
    const author = record?.author === 'rules'
      ? '<span class="tw-badge tw-badge-rules" title="Bedrock was rate limited, so a fixed template built this widget from the detector\'s numbers.">Built by rules</span>'
      : record?.author === 'bedrock' ? '<span class="tw-badge tw-badge-ai" title="Configured by the watcher agent running on Amazon Bedrock.">Built by the agent</span>' : record?.author === 'chat' ? '<span class="tw-badge tw-badge-ai" title="Added from the chat panel through Studio\'s agent tools.">Built in chat</span>' : '';
    return `<header class="tw-wh"><h3 class="tw-wt">${esc(title)}</h3>${author}${extra}</header>`;
  }
}
