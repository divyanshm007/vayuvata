import { createTheme, alpha } from '@mui/material/styles';

/**
 * Brand tokens: environmental green. AQI severity colours live in utils/aqi.ts and are deliberately NOT part of the brand palette,
 * so air-quality conditions are never misrepresented by the UI theme.
 */
export const tokens = {
  forest: '#166534',       // primary brand, selected states, headings accents
  action: '#15803D',       // buttons, links, active tabs
  emerald: '#10B981',      // accents, focus rings, positive status
  mint: '#ECFDF5',         // pale highlight surfaces
  sage: '#F5F8F5',         // table headers, subtle surfaces
  bg: '#F7F9F7',           // workspace background
  text: '#172B24',         // primary text
  muted: '#64748B',        // secondary text
  border: '#D4E9DA',       // card and divider borders (soft green)
  cardBorder: '#C6E3CF',   // slightly stronger green for card outlines
  cardBg: 'linear-gradient(145deg, #EDF8F1 0%, #F8FDF9 55%, #FFFFFF 125%)', // light green surface instead of flat white
  surface: '#FFFFFF',
  sidebar: '#0B2A1B',      // deep forest behind the sidebar photo
  // legacy aliases used by older components
  navy: '#0B2A1B', teal: '#15803D', tealLight: '#10B981', sky: '#10B981', skyLight: '#34D399',
  gradient: 'linear-gradient(135deg,#15803D 0%,#10B981 100%)',
};

/** One refined family for the whole app; numerals are tabular so figures line up in cards and tables. */
const FONT = '"Plus Jakarta Sans","Inter","Segoe UI",system-ui,sans-serif';

export const theme = createTheme({
  palette: {
    mode: 'light',
    primary: { main: tokens.action, dark: tokens.forest, light: tokens.emerald, contrastText: '#fff' },
    secondary: { main: tokens.emerald },
    background: { default: tokens.bg, paper: tokens.surface },
    text: { primary: tokens.text, secondary: tokens.muted },
    divider: tokens.border,
    success: { main: '#16a34a' }, warning: { main: '#d97706' }, error: { main: '#dc2626' }, info: { main: '#0284c7' },
  },
  shape: { borderRadius: 12 },
  typography: {
    fontFamily: FONT,
    htmlFontSize: 16,
    fontSize: 14,
    h1: { fontWeight: 800, fontSize: '2rem', letterSpacing: '-0.02em', lineHeight: 1.15 },
    h2: { fontWeight: 800, fontSize: '1.75rem', letterSpacing: '-0.02em', lineHeight: 1.15 },
    h3: { fontWeight: 700, fontSize: '1.5rem', letterSpacing: '-0.015em', lineHeight: 1.2 },
    h4: { fontWeight: 700, fontSize: '1.3125rem', letterSpacing: '-0.015em', lineHeight: 1.25 },
    h5: { fontWeight: 700, fontSize: '1.125rem', letterSpacing: '-0.01em', lineHeight: 1.3 },
    h6: { fontWeight: 700, fontSize: '0.9375rem', letterSpacing: '-0.005em', lineHeight: 1.35 },
    subtitle1: { fontWeight: 600, fontSize: '0.875rem' },
    subtitle2: { fontWeight: 600, fontSize: '0.8125rem' },
    body1: { fontSize: '0.8125rem', lineHeight: 1.55 },
    body2: { fontSize: '0.78125rem', lineHeight: 1.5 },
    caption: { fontSize: '0.71875rem', lineHeight: 1.4 },
    button: { textTransform: 'none', fontWeight: 600, fontSize: '0.8125rem', letterSpacing: '0.005em' },
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: { backgroundColor: tokens.bg, color: tokens.text, fontFeatureSettings: '"tnum" 1, "kern" 1', WebkitFontSmoothing: 'antialiased', MozOsxFontSmoothing: 'grayscale', textRendering: 'optimizeLegibility' },
        '*:focus-visible': { outline: `3px solid ${alpha(tokens.emerald, 0.5)}`, outlineOffset: 2 },
        '@media (prefers-reduced-motion: reduce)': { '*': { animation: 'none !important', transition: 'none !important' } },
      },
    },
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: { root: { borderRadius: 10, transition: 'background-color .15s, box-shadow .15s, transform .15s' } },
    },
    MuiCard: {
      defaultProps: { elevation: 0 },
      styleOverrides: { root: { border: `1px solid ${tokens.cardBorder}`, background: tokens.cardBg, boxShadow: '0 1px 2px rgba(22,101,52,.05), 0 6px 18px rgba(22,101,52,.06)' } },
    },
    MuiPaper: { styleOverrides: { root: { backgroundImage: 'none' } } },
    MuiTableCell: {
      styleOverrides: {
        head: { fontWeight: 700, color: tokens.muted, fontSize: 11, textTransform: 'uppercase', letterSpacing: '.06em', background: tokens.sage, whiteSpace: 'nowrap' },
        body: { fontSize: 12.5 },
        root: { borderBottomColor: tokens.border },
      },
    },
    MuiTableRow: { styleOverrides: { root: { '&.MuiTableRow-hover:hover': { backgroundColor: alpha(tokens.mint, 0.7) } } } },
    MuiTextField: { defaultProps: { size: 'small', fullWidth: true } },
    MuiInputBase: { styleOverrides: { root: { fontSize: '0.8125rem' } } },
    MuiInputLabel: { styleOverrides: { root: { fontSize: '0.8125rem' } } },
    MuiMenuItem: { styleOverrides: { root: { fontSize: '0.8125rem' } } },
    MuiChip: { styleOverrides: { root: { fontWeight: 600, fontSize: '0.71875rem' } } },
    MuiTab: { styleOverrides: { root: { textTransform: 'none', fontWeight: 600 } } },
    MuiTabs: { styleOverrides: { indicator: { backgroundColor: tokens.action, height: 3, borderRadius: 3 } } },
    MuiToggleButton: {
      styleOverrides: {
        root: {
          textTransform: 'none', fontWeight: 600, borderColor: tokens.border, color: tokens.muted, whiteSpace: 'nowrap', px: 1.5,
          '&.Mui-selected': { backgroundColor: tokens.forest, color: '#fff', '&:hover': { backgroundColor: tokens.forest } },
        },
      },
    },
    MuiDialog: { styleOverrides: { paper: { borderRadius: 16 } } },
  },
});
