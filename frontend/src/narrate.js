// Turns the agent's raw tool calls into sentences a person can read in the status line and the trail.
import { sentence } from './format.js';
const ds = (d) => (d || 'the stream').replaceAll('_', ' ');
export function narrate(step) {
  if (!step) return 'Starting the watcher.';
  if (step.kind === 'note' || step.kind === 'fallback' || step.kind === 'retry' || step.kind === 'error') return step.detail;
  if (step.kind === 'model') return String(step.detail || '').split('\n').find(Boolean)?.slice(0, 160) || 'Thinking.';
  const i = step.input || {};
  switch (step.tool) {
    case 'list_candidates': return 'Reading the detector\'s candidates.';
    case 'query_stream': return i.group_by ? `Grouping ${ds(i.dataset)} by ${i.group_by.replaceAll('_', ' ')}.` : `Looking at ${ds(i.dataset)}${i.where ? ' with a filter' : ''}.`;
    case 'compute_rate': return `Computing ${sentence(i.metric).toLowerCase()} by ${i.bucket || 'day'}.`;
    case 'compare_baseline': return `Comparing ${sentence(i.metric).toLowerCase()} with its last 30 days.`;
    case 'record_finding': return `Recording a finding: ${i.title || ''}`;
    case 'build_widget': return `Building a ${({ 'tw-grid': 'grid', 'tw-trend': 'trend chart', 'tw-breakdown': 'breakdown chart' })[i.type] || 'widget'}${i.spec?.title ? `: ${i.spec.title}` : ''}.`;
    case 'dismiss_candidate': return `Dismissing a candidate: ${i.reason || ''}`;
    default: return step.tool;
  }
}
