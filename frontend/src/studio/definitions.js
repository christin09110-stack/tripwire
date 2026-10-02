// Studio widget definitions for the four Tripwire widget types.
import { createWidgets } from 'ag-studio';
import { TwBrief } from './brief.js';
import { TwTrail } from './trail.js';
import { TwGrid } from './grid.js';
import { TwTrend, TwBreakdown } from './charts.js';

const icon = (d) => ({ url: `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#285B88" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`)}` });
const def = (id, label, comp, ic, size, ai) => ({
  id, label, comp, icon: icon(ic), form: (p) => p.createDefaults({ dataMappingItems: [] }),
  defaultSize: size, minSize: { width: 240, height: 140 }, toolbar: ['delete'], ai: { description: ai },
});

export const TRIPWIRE_TYPES = ['tw-brief', 'tw-grid', 'tw-trend', 'tw-breakdown'];

export function widgetsConfig(config) {
  return createWidgets({
    additionalTypes: [
      def('tw-brief', 'Finding brief', TwBrief, '<path d="M4 5h16M4 10h16M4 15h10"/>', { width: 560, height: 220 }, 'A written finding from the watcher: title, headline number, explanation and next steps.'),
      def('tw-grid', 'Evidence grid', TwGrid, '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M9 4v16"/>', { width: 900, height: 360 }, 'An AG Grid of the rows behind a finding, with grouping, totals, pinned columns and conditional styling.'),
      def('tw-trend', 'Trend with normal range', TwTrend, '<path d="M3 17l5-6 4 3 5-8 4 4"/>', { width: 560, height: 280 }, 'An AG Charts time series with a shaded normal range and the out-of-range points marked.'),
      def('tw-breakdown', 'Breakdown', TwBreakdown, '<path d="M5 20V10M12 20V4M19 20v-7"/>', { width: 560, height: 280 }, 'An AG Charts breakdown of a dataset by one field.'),
      { ...def('tw-trail', 'How this board was built', TwTrail, '<path d="M4 6h16M4 12h16M4 18h10"/>', { width: 900, height: 240 }, 'The watcher agent\'s steps in its last scan.'), toolbar: [] },
    ],
    menu: [{ label: 'Tripwire', widgetIds: TRIPWIRE_TYPES }, ...config.menu],
  });
}
