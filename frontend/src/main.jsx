import React from 'react';
import { createRoot } from 'react-dom/client';
import { ModuleRegistry, AllCommunityModule } from 'ag-grid-community';
import { LicenseManager, RowGroupingModule, AggregationModule, MasterDetailModule, StatusBarModule, SetFilterModule, CellSelectionModule, ColumnMenuModule, ContextMenuModule } from 'ag-grid-enterprise';
import { ModuleRegistry as ChartsRegistry, AllCommunityModule as ChartsCommunity } from 'ag-charts-community';
import { AgStudioLicenseManager } from 'ag-studio';
import './styles.css';
import { TOKENS } from './tokens.js';
import { setMode } from './theme.js';
import App from './App.jsx';

// Optional licence keys, baked in at build time (see README). With no key the libraries run in trial mode, as before.
const gridKey = import.meta.env.VITE_AG_GRID_LICENSE_KEY;
const studioKey = import.meta.env.VITE_AG_STUDIO_LICENSE_KEY;
if (gridKey) LicenseManager.setLicenseKey(gridKey);
if (studioKey) AgStudioLicenseManager.setLicenseKey(studioKey);

// Community covers pinned rows, the quick filter, value formatters, cell renderers and grid state. The Enterprise
// modules below add row grouping with aggregation, master/detail, the status bar, set filters and range selection.
ModuleRegistry.registerModules([AllCommunityModule, RowGroupingModule, AggregationModule, MasterDetailModule, StatusBarModule, SetFilterModule, CellSelectionModule, ColumnMenuModule, ContextMenuModule]);

ChartsRegistry.registerModules([ChartsCommunity]);

// One source for colour: tokens.js feeds the CSS variables, the Studio theme, the grid theme and the chart theme.
const vars = (t) => Object.entries(t).map(([k, v]) => `--${k}:${v};`).join('');
const style = document.createElement('style');
style.textContent = `:root{${vars(TOKENS.light)}}@media (prefers-color-scheme: dark){:root:not([data-theme='light']){${vars(TOKENS.dark)}}}:root[data-theme='dark']{${vars(TOKENS.dark)}}:root[data-theme='light']{${vars(TOKENS.light)}}`;
document.head.appendChild(style);

let initial = document.documentElement.dataset.theme;
if (!initial) initial = 'light';
setMode(initial);

createRoot(document.getElementById('root')).render(<App initialTheme={initial} />);
