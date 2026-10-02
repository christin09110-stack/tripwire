// Themes for Studio, the AG Grid instances inside custom widgets, and AG Charts, all drawn from the same tokens.
import { themeQuartz, iconSetQuartzLight } from 'ag-grid-community';
import { studioTheme } from 'ag-studio';
import { TOKENS } from './tokens.js';

const FONT = '"Schibsted Grotesk Variable", "Schibsted Grotesk", system-ui, sans-serif';
export const MONO = '"JetBrains Mono Variable", "JetBrains Mono", ui-monospace, monospace';

const gridParams = (t, dark) => ({
  accentColor: t.steel, backgroundColor: t.surface, foregroundColor: t.ink, borderColor: t.line,
  headerBackgroundColor: t.sunken, headerTextColor: t.muted, headerFontWeight: 650, headerFontSize: 13.5,
  oddRowBackgroundColor: dark ? '#0F1B26' : '#F8FAFC', rowHoverColor: t.steelTint, selectedRowBackgroundColor: t.steelTint,
  fontFamily: FONT, fontSize: 14, spacing: 7, rowHeight: 38, headerHeight: 40, wrapperBorderRadius: 0, borderRadius: 4,
  cellHorizontalPadding: 12, browserColorScheme: dark ? 'dark' : 'light', chromeBackgroundColor: t.sunken,
  inputBorder: { color: t.lineStrong }, inputFocusBorder: { color: t.steel }, focusShadow: { spread: 2, color: t.steel },
  subtleTextColor: t.muted, menuBackgroundColor: t.surface, menuTextColor: t.ink, tooltipBackgroundColor: t.ink, tooltipTextColor: t.surface,
  iconSize: 16,
});

export const gridTheme = themeQuartz.withPart(iconSetQuartzLight)
  .withParams(gridParams(TOKENS.light, false), 'light')
  .withParams(gridParams(TOKENS.dark, true), 'dark');

const studioParams = (t, dark) => ({
  backgroundColor: t.bg, foregroundColor: t.ink, textColor: t.ink, subtleTextColor: t.muted, accentColor: t.steel, borderColor: t.line,
  fontFamily: FONT, fontSize: 15, spacing: 8, borderRadius: 6, studioMinWidth: 0, studioMinHeight: 0, browserColorScheme: dark ? 'dark' : 'light',
  menuBackgroundColor: t.surface, menuTextColor: t.ink, tooltipBackgroundColor: t.ink, tooltipTextColor: t.surface,
  focusShadow: { spread: 2, color: t.steel }, inputBorder: { color: t.lineStrong }, inputBackgroundColor: t.surface, inputTextColor: t.ink,
  studioPanelContainerBackgroundColor: t.surface, studioPanelContainerBorder: { color: t.line }, iconSize: 18, listItemHeight: 38,
  pickerFieldHeight: 40, inputHeight: 38, studioFormLabelColor: t.muted, studioFormLabelFontSize: 14,
  tabSelectedTextColor: t.steelStrong, tabSelectedBackgroundColor: t.steelTint, tabTextColor: t.muted, tabBarBackgroundColor: t.surface,
});

export const studioThemeTripwire = studioTheme
  .withParams(studioParams(TOKENS.light, false), 'light')
  .withParams(studioParams(TOKENS.dark, true), 'dark');

export function setMode(mode) {
  document.documentElement.dataset.theme = mode;
  document.body.dataset.agThemeMode = mode;
}

/** AG Charts theme for a mode. Series colours are steel blues; the one warm colour marks what is out of range. */
export function chartTheme(mode) {
  const t = TOKENS[mode];
  return {
    baseTheme: mode === 'dark' ? 'ag-default-dark' : 'ag-default',
    palette: { fills: [t.steel, t.series2, t.series3, t.steelStrong, t.signalFill], strokes: [t.steel, t.series2, t.series3, t.steelStrong, t.signalFill] },
    params: {
      backgroundColor: 'transparent', foregroundColor: t.ink, textColor: t.ink, subtleTextColor: t.muted, fontFamily: FONT, fontSize: 13.5,
      gridLineColor: t.grid, axisLineColor: t.lineStrong, borderColor: t.line, accentColor: t.steel,
      tooltipBackgroundColor: t.surface, tooltipTextColor: t.ink,
    },
  };
}
export const tok = (mode) => TOKENS[mode];
