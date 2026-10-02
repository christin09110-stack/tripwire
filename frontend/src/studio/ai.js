// The Studio Agent Framework wiring: an AgLlmAdapter that talks to Tripwire's own Lambda (which holds the AWS credentials
// and calls Amazon Bedrock Converse), a single analyst agent run by Studio's Direct LLM Runner, and one custom tool that
// builds Tripwire widgets through the same validators the watcher agent uses.
import { createAiHarness, directLlmRunner } from 'ag-studio';
import { postLlm, API } from '../api.js';
import { schemaText } from '../../../shared/datasets.mjs';
import { WIDGET_TYPES } from '../../../shared/widgets.mjs';

const uid = () => Math.random().toString(36).slice(2, 10);

/** AgAiConversationItem[] -> Bedrock Converse messages. Consecutive items of one role are merged, as Converse requires. */
export function toConverse(items) {
  const messages = [];
  const system = [];
  const push = (role, block) => {
    const last = messages[messages.length - 1];
    if (last && last.role === role) last.content.push(block); else messages.push({ role, content: [block] });
  };
  for (const it of items) {
    if (it.type === 'message' && it.kind === 'input') {
      const text = (it.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
      if (!text) continue;
      if (it.role === 'system') system.push(text); else push('user', { text });
    } else if (it.type === 'message') {
      const text = (it.content || []).map((c) => c.text || c.refusal || '').join('');
      if (text) push('assistant', { text });
    } else if (it.type === 'function_call') {
      let input = {}; try { input = JSON.parse(it.arguments || '{}'); } catch { input = {}; }
      push('assistant', { toolUse: { toolUseId: it.callId, name: it.name, input } });
    } else if (it.type === 'function_call_output') {
      push('user', { toolResult: { toolUseId: it.callId, content: [{ text: String(it.output ?? '').slice(0, 12000) || 'ok' }], status: it.status === 'incomplete' ? 'error' : 'success' } });
    }
  }
  while (messages.length && messages[0].role !== 'user') messages.shift();
  return { messages, system };
}

export function toToolConfig(tools, toolChoice) {
  if (!tools?.length || toolChoice === 'none') return undefined;
  const cfg = { tools: tools.map((t) => ({ toolSpec: { name: t.name, description: t.description || t.name, inputSchema: { json: t.parameters } } })) };
  if (toolChoice === 'required') cfg.toolChoice = { any: {} };
  else if (toolChoice && typeof toolChoice === 'object') cfg.toolChoice = { tool: { name: toolChoice.name } };
  return cfg;
}

export function bedrockAdapter({ onMeta } = {}) {
  return {
    executeTurn(request, options = {}) {
      const { messages, system } = toConverse(request.input);
      const sys = [request.instructions, ...system].filter(Boolean).join('\n\n');
      const run = postLlm({ system: sys, messages, toolConfig: toToolConfig(request.tools, request.toolChoice), maxTokens: 2000 }, options.signal)
        .then(async (r) => { const j = await r.json().catch(() => ({})); if (!r.ok) throw Object.assign(new Error(j.message || `The model answered ${r.status}.`), { code: j.error || String(r.status) }); onMeta?.(j.meta); return j; });
      const settled = run.then((j) => ({ ok: true, j }), (e) => ({ ok: false, e }));
      async function* stream() {
        const s = await settled;
        if (!s.ok) return;
        for (const block of s.j.message.content || []) {
          if (block.text) {
            const messageId = `m-${uid()}`;
            yield { type: 'TEXT_MESSAGE_START', messageId, role: 'assistant' };
            const parts = block.text.match(/\S+\s*/g) || [block.text];
            for (let i = 0; i < parts.length; i += 6) yield { type: 'TEXT_MESSAGE_CONTENT', messageId, delta: parts.slice(i, i + 6).join('') };
            yield { type: 'TEXT_MESSAGE_END', messageId };
          } else if (block.toolUse) {
            const { toolUseId, name, input } = block.toolUse;
            yield { type: 'TOOL_CALL_START', toolCallId: toolUseId, toolCallName: name };
            yield { type: 'TOOL_CALL_ARGS', toolCallId: toolUseId, delta: JSON.stringify(input ?? {}) };
            yield { type: 'TOOL_CALL_END', toolCallId: toolUseId };
          }
        }
      }
      const complete = settled.then((s) => {
        const base = { id: `resp-${uid()}`, createdAt: Date.now() };
        if (!s.ok) return { ...base, status: 'failed', output: [], error: { code: s.e.code || 'error', message: s.e.message } };
        const output = [];
        for (const block of s.j.message.content || []) {
          if (block.text) output.push({ id: `o-${uid()}`, kind: 'output', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'text', text: block.text, annotations: [] }] });
          else if (block.toolUse) output.push({ id: `o-${uid()}`, kind: 'output', type: 'function_call', callId: block.toolUse.toolUseId, name: block.toolUse.name, arguments: JSON.stringify(block.toolUse.input ?? {}), status: 'completed' });
        }
        return { ...base, status: s.j.stopReason === 'max_tokens' ? 'incomplete' : 'completed', output, usage: { inputTokens: s.j.usage?.inputTokens || 0, outputTokens: s.j.usage?.outputTokens || 0 }, model: s.j.meta?.model, incompleteDetails: s.j.stopReason === 'max_tokens' ? { reason: 'max_output_tokens' } : undefined };
      });
      return { stream: stream(), complete };
    },
  };
}

const ANALYST = (ctx) => `You are the analyst inside Tripwire, a board that watches a PayPal sandbox stream. A separate watcher agent has already written the findings on this board. You help the person dig further and change the board.

What is on the board now:
${Object.values(ctx.board.findings).map((f) => `- ${f.id}: ${f.title} (${f.severity}, ${f.status}). ${f.headline}`).join('\n') || '- No findings yet.'}

Data you can query with execute_query (these are Studio data sources): ${Object.keys(ctx.data || {}).filter((k) => Array.isArray(ctx.data[k])).join(', ')}.
Schema summary:
${schemaText()}

To add a Tripwire widget to a finding's page, call add_tripwire_widget. Widget types: ${WIDGET_TYPES.filter((t) => t !== 'tw-brief').join(', ')}. Specs are validated and you will get exact errors back. Use plain sentences, no marketing words, and never state a number you did not read from a tool.`;

export function createAi(ctx, { onBoardChange }) {
  const adapter = bedrockAdapter();
  return ({ api }) => createAiHarness(api, ({ tools: { studio } }) => ({
    agents: [directLlmRunner({
      id: 'analyst',
      description: 'Answers questions about the stream and adds widgets to the board.',
      adapter,
      instructions: () => ANALYST(ctx),
      tools: () => {
        const findingIds = Object.keys(ctx.board.findings);
        const list = api.defineAiTool({
          name: 'list_findings', description: 'List the findings on the board with their numbers and status.',
          params: (s) => s.object({}),
          execute: async (_a, c) => c.success(`${findingIds.length} finding(s).`, { findings: Object.values(ctx.board.findings).map((f) => ({ id: f.id, title: f.title, severity: f.severity, status: f.status, headline: f.headline, evidence: f.evidenceIds?.length })) }),
        });
        const tools = [list, studio.viewSchema(), studio.executeQuery()];
        if (findingIds.length) {
          tools.push(api.defineAiTool({
            name: 'add_tripwire_widget',
            description: `Add a Tripwire widget to a finding's page and save it to the board. tw-grid spec: {dataset, title, where?, columns:[{field, header?, width?, pinned?, agg?, renderer?}], groupBy?:[field], sort?:{field,dir}, totals?, detail?:"none"|"related" (not with groupBy), rules?:[{field,op,value,tone}], sinceDays?}. tw-trend spec: {metric, title, bucket?, buckets?, chartType?:"line"|"area"|"column", where?, flag?}. tw-breakdown spec: {dataset, by, agg?, field?, where?, limit?, chartType?:"bar"|"column"|"donut", highlight?, sinceDays?, title}.`,
            params: (s) => s.object({
              findingId: s.enum(findingIds), type: s.enum(WIDGET_TYPES.filter((t) => t !== 'tw-brief')),
              spec: s.string({ description: 'The widget spec as a JSON string.' }),
              width: s.number({ description: 'Grid tracks wide, 6 to 24.' }).optional(), height: s.number({ description: 'Grid tracks tall, 8 to 44.' }).optional(),
            }),
            execute: async (args, c) => {
              let spec; try { spec = JSON.parse(args.spec); } catch { return c.error('spec is not valid JSON.'); }
              try {
                const r = await fetch(`${API}/api/widgets`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ findingId: args.findingId, type: args.type, spec, width: args.width, height: args.height }), signal: c.signal });
                const j = await r.json();
                if (!r.ok) return c.error(j.message || 'The widget was refused.');
                await onBoardChange(j.pageId);
                return c.success(`Added ${args.type} to the page for ${args.findingId}. It is open on the board.`, { widgetId: j.widgetId });
              } catch (e) { return c.error(`Could not save the widget: ${e.message}`); }
            },
          }));
        }
        return tools;
      },
    })],
    primary: 'analyst',
    promptStarters: [
      { label: 'What is on the board?', prompt: 'List the findings on the board and say which one needs attention first.' },
      { label: 'Group refunds by reason', prompt: 'Add a grid of refunds from the last day grouped by reason with a total row, to the refund finding.' },
      { label: 'Which payees fail most?', prompt: 'Which payout recipients have the most undelivered items in the last 30 days?' },
    ],
  }));
}
