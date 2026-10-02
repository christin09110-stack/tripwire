// One palette, used by the page CSS, the Studio theme, the AG Grid theme and the AG Charts theme.
// scripts/contrast.mjs reads this file to compute every text/background pair and fails the build if one drops below its floor.
export const TOKENS = {
  light: {
    bg: '#E9EFF5', surface: '#FFFFFF', sunken: '#F2F6FA', line: '#C3D0DC', lineStrong: '#71879B',
    ink: '#11202D', muted: '#43566A', steel: '#285B88', steelStrong: '#1A4469', steelTint: '#D8E5F1', onSteel: '#FFFFFF',
    signal: '#A83A06', signalFill: '#B8410A', onSignal: '#FFFFFF', signalSoft: '#FBE5D4', onSignalSoft: '#6E2A04',
    band: '#C9DAEA', series2: '#6C93B8', series3: '#5B7287', grid: '#DCE5EE',
  },
  dark: {
    bg: '#0A121A', surface: '#121E2A', sunken: '#0E1822', line: '#2A3D50', lineStrong: '#5B7389',
    ink: '#E6EEF6', muted: '#9FB3C6', steel: '#88BBE8', steelStrong: '#B4D6F3', steelTint: '#1E3850', onSteel: '#0A121A',
    signal: '#FF9D5F', signalFill: '#FF9D5F', onSignal: '#1B0C02', signalSoft: '#3A2010', onSignalSoft: '#FFC299',
    band: '#24425E', series2: '#5F8DB6', series3: '#8BA0B4', grid: '#223445',
  },
};

// Pairs checked by the contrast script: [foreground, background, minimum ratio, label]
// 4.5 for text up to 17pt, 3 for 18pt or bold, 3 for graphical objects and focus rings.
export const PAIRS = [
  ['ink', 'surface', 4.5, 'Body text on panels'],
  ['ink', 'bg', 4.5, 'Body text on page'],
  ['ink', 'sunken', 4.5, 'Body text on sunken areas'],
  ['muted', 'surface', 4.5, 'Secondary text on panels'],
  ['muted', 'bg', 4.5, 'Secondary text on page'],
  ['muted', 'sunken', 4.5, 'Secondary text on sunken areas'],
  ['steel', 'surface', 4.5, 'Links and accent text on panels'],
  ['steel', 'bg', 4.5, 'Accent text on page'],
  ['steelStrong', 'steelTint', 4.5, 'Selected item text'],
  ['onSteel', 'steel', 4.5, 'Primary button label'],
  ['signal', 'surface', 4.5, 'Alert text on panels'],
  ['signal', 'bg', 4.5, 'Alert text on page'],
  ['onSignalSoft', 'signalSoft', 4.5, 'Alert chip text'],
  ['onSignal', 'signalFill', 4.5, 'Signal button label'],
  ['steel', 'surface', 3, 'Focus ring on panels (non-text)'],
  ['lineStrong', 'surface', 3, 'Input and control borders (non-text)'],
  ['series2', 'surface', 3, 'Chart series 2 (non-text)'],
  ['steel', 'surface', 3, 'Chart series 1 (non-text)'],
  ['signalFill', 'surface', 3, 'Flagged marker (non-text)'],
  ['series3', 'surface', 3, 'Chart series 3 (non-text)'],
];
