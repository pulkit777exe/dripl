/**
 * Excalidraw's theme-neutral color palette.
 *
 * Values are stored as they are drawn in the light theme. Dark mode applies
 * `applyDarkModeFilter` at render/preview time, so a swatch, the canvas and an
 * export all derive their color from the same stored value.
 *
 * The quick-pick strips keep Excalidraw's first five entries and add Dripl's
 * existing extras after them (Purple/Pink/White for strokes, Light Purple for
 * fills), so every swatch is still reachable without an advanced picker.
 */

export const COLOR_PALETTE = {
  transparent: 'transparent',
  black: '#1e1e1e',
  white: '#ffffff',
  // open-color weights 50, 200, 400, 600, 800.
  gray: ['#f8f9fa', '#e9ecef', '#ced4da', '#868e96', '#343a40'],
  red: ['#fff5f5', '#ffc9c9', '#ff8787', '#fa5252', '#e03131'],
  pink: ['#fff0f6', '#fcc2d7', '#f783ac', '#e64980', '#c2255c'],
  grape: ['#f8f0fc', '#eebefa', '#da77f2', '#be4bdb', '#9c36b5'],
  violet: ['#f3f0ff', '#d0bfff', '#9775fa', '#7950f2', '#6741d9'],
  blue: ['#e7f5ff', '#a5d8ff', '#4dabf7', '#228be6', '#1971c2'],
  cyan: ['#e3fafc', '#99e9f2', '#3bc9db', '#15aabf', '#0c8599'],
  teal: ['#e6fcf5', '#96f2d7', '#38d9a9', '#12b886', '#099268'],
  green: ['#ebfbee', '#b2f2bb', '#69db7c', '#40c057', '#2f9e44'],
  yellow: ['#fff9db', '#ffec99', '#ffd43b', '#fab005', '#f08c00'],
  orange: ['#fff4e6', '#ffd8a8', '#ffa94d', '#fd7e14', '#e8590c'],
  bronze: ['#f8f1ee', '#eaddd7', '#d2bab0', '#a18072', '#846358'],
} as const;

/** Excalidraw's five quick picks for strokes, in display order. */
export const DEFAULT_ELEMENT_STROKE_PICKS = [
  COLOR_PALETTE.black,
  COLOR_PALETTE.red[4],
  COLOR_PALETTE.green[4],
  COLOR_PALETTE.blue[4],
  COLOR_PALETTE.yellow[4],
] as const;

/** Excalidraw's five quick picks for fills, in display order. */
export const DEFAULT_ELEMENT_BACKGROUND_PICKS = [
  COLOR_PALETTE.transparent,
  COLOR_PALETTE.red[1],
  COLOR_PALETTE.green[1],
  COLOR_PALETTE.blue[1],
  COLOR_PALETTE.yellow[1],
] as const;

/** Excalidraw's five canvas quick picks. Dripl's theme defaults live in `background.ts`. */
export const DEFAULT_CANVAS_BACKGROUND_PICKS = [
  COLOR_PALETTE.white,
  '#f8f9fa',
  '#f5faff',
  '#fffce8',
  '#fdf8f6',
] as const;

export const STROKE_COLORS = [
  { value: DEFAULT_ELEMENT_STROKE_PICKS[0], label: 'Black' },
  { value: DEFAULT_ELEMENT_STROKE_PICKS[1], label: 'Red' },
  { value: DEFAULT_ELEMENT_STROKE_PICKS[2], label: 'Green' },
  { value: DEFAULT_ELEMENT_STROKE_PICKS[3], label: 'Blue' },
  { value: DEFAULT_ELEMENT_STROKE_PICKS[4], label: 'Yellow' },
  { value: COLOR_PALETTE.violet[4], label: 'Purple' },
  { value: COLOR_PALETTE.pink[4], label: 'Pink' },
  { value: COLOR_PALETTE.white, label: 'White' },
] as const;

export const BACKGROUND_COLORS = [
  { value: DEFAULT_ELEMENT_BACKGROUND_PICKS[0], label: 'None' },
  { value: DEFAULT_ELEMENT_BACKGROUND_PICKS[1], label: 'Light Red' },
  { value: DEFAULT_ELEMENT_BACKGROUND_PICKS[2], label: 'Light Green' },
  { value: DEFAULT_ELEMENT_BACKGROUND_PICKS[3], label: 'Light Blue' },
  { value: DEFAULT_ELEMENT_BACKGROUND_PICKS[4], label: 'Light Yellow' },
  { value: COLOR_PALETTE.violet[1], label: 'Light Purple' },
] as const;
