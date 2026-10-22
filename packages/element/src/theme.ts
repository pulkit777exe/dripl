/**
 * Dark-mode color handling, matching Excalidraw's `applyDarkModeFilter`.
 *
 * Excalidraw does not store a second palette for dark mode. It stores one
 * theme-neutral color and renders it through the CSS filter
 * `invert(93%) hue-rotate(180deg)`. Keeping the transform here — instead of
 * rewriting element data on a theme switch — means a scene opens with the
 * same colors it was drawn with, and light/dark rendering is a pure function
 * of the stored color.
 *
 * The transform is applied per RGB channel, preserves alpha, and leaves
 * transparent/none/invalid values alone. A bounded cache keeps the repeated
 * parse+matrix work off the render hot path.
 */

const DARK_MODE_INVERT_PERCENT = 93;
const DARK_MODE_HUE_ROTATE_DEGREES = 180;
const DARK_MODE_CACHE_LIMIT = 2048;

interface RGBA {
  r: number;
  g: number;
  b: number;
  a: number;
}

const NAMED_COLORS: Record<string, string> = {
  black: '#000000',
  white: '#ffffff',
  red: '#ff0000',
  lime: '#00ff00',
  green: '#008000',
  blue: '#0000ff',
  yellow: '#ffff00',
  cyan: '#00ffff',
  aqua: '#00ffff',
  magenta: '#ff00ff',
  fuchsia: '#ff00ff',
  gray: '#808080',
  grey: '#808080',
  silver: '#c0c0c0',
  maroon: '#800000',
  olive: '#808000',
  navy: '#000080',
  purple: '#800080',
  teal: '#008080',
  orange: '#ffa500',
  pink: '#ffc0cb',
};

const darkModeCache = new Map<string, string>();

function clampChannel(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function clampAlpha(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function channelFromCss(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.endsWith('%')) {
    const percent = Number.parseFloat(trimmed.slice(0, -1));
    return Number.isFinite(percent) ? clampChannel((percent / 100) * 255) : null;
  }
  const number = Number.parseFloat(trimmed);
  return Number.isFinite(number) ? clampChannel(number) : null;
}

function alphaFromCss(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.endsWith('%')) {
    const percent = Number.parseFloat(trimmed.slice(0, -1));
    return Number.isFinite(percent) ? clampAlpha(percent / 100) : null;
  }
  const number = Number.parseFloat(trimmed);
  return Number.isFinite(number) ? clampAlpha(number) : null;
}

function parseHex(value: string): RGBA | null {
  const hex = value.slice(1);
  if (!/^[0-9a-f]+$/i.test(hex)) return null;

  const expand = (part: string): number => {
    const digit = Number.parseInt(part, 16);
    return Number.isNaN(digit) ? 0 : digit;
  };

  if (hex.length === 3 || hex.length === 4) {
    const r = expand(hex[0]!);
    const g = expand(hex[1]!);
    const b = expand(hex[2]!);
    const a = hex.length === 4 ? expand(hex[3]!) / 15 : 1;
    return { r: r * 17, g: g * 17, b: b * 17, a: clampAlpha(a) };
  }

  if (hex.length === 6 || hex.length === 8) {
    const r = Number.parseInt(hex.slice(0, 2), 16);
    const g = Number.parseInt(hex.slice(2, 4), 16);
    const b = Number.parseInt(hex.slice(4, 6), 16);
    const a = hex.length === 8 ? Number.parseInt(hex.slice(6, 8), 16) / 255 : 1;
    if ([r, g, b].some(Number.isNaN)) return null;
    return { r, g, b, a: clampAlpha(a) };
  }

  return null;
}

function parseRgb(value: string): RGBA | null {
  const slashParts = value.split('/');
  if (slashParts.length > 2) return null;
  const channelsPart = slashParts[0]!.trim();
  const alphaPart = slashParts[1]?.trim();

  const commaParts = channelsPart.includes(',')
    ? channelsPart.split(',').map(part => part.trim())
    : channelsPart.split(/\s+/).filter(Boolean);

  if (commaParts.length < 3 || commaParts.length > 4) return null;

  const r = channelFromCss(commaParts[0]!);
  const g = channelFromCss(commaParts[1]!);
  const b = channelFromCss(commaParts[2]!);
  if (r === null || g === null || b === null) return null;

  const alphaSource = alphaPart ?? commaParts[3];
  const a = alphaSource === undefined ? 1 : alphaFromCss(alphaSource);
  if (a === null) return null;

  return { r, g, b, a };
}

function hueToRgb(p: number, q: number, t: number): number {
  let channel = t;
  if (channel < 0) channel += 1;
  if (channel > 1) channel -= 1;
  if (channel < 1 / 6) return p + (q - p) * 6 * channel;
  if (channel < 1 / 2) return q;
  if (channel < 2 / 3) return p + (q - p) * (2 / 3 - channel) * 6;
  return p;
}

function parseHsl(value: string): RGBA | null {
  const slashParts = value.split('/');
  if (slashParts.length > 2) return null;
  const channelsPart = slashParts[0]!.trim();
  const alphaPart = slashParts[1]?.trim();

  const commaParts = channelsPart.includes(',')
    ? channelsPart.split(',').map(part => part.trim())
    : channelsPart.split(/\s+/).filter(Boolean);

  if (commaParts.length < 3 || commaParts.length > 4) return null;

  const hue = Number.parseFloat(commaParts[0]!);
  const saturation = Number.parseFloat(commaParts[1]!);
  const lightness = Number.parseFloat(commaParts[2]!);
  if (![hue, saturation, lightness].every(Number.isFinite)) return null;

  const alphaSource = alphaPart ?? commaParts[3];
  const alpha = alphaSource === undefined ? 1 : alphaFromCss(alphaSource);
  if (alpha === null) return null;

  const h = (((hue % 360) + 360) % 360) / 360;
  const s = clampAlpha(saturation / 100);
  const l = clampAlpha(lightness / 100);

  if (s === 0) {
    const gray = clampChannel(l * 255);
    return { r: gray, g: gray, b: gray, a: alpha };
  }

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return {
    r: clampChannel(hueToRgb(p, q, h + 1 / 3) * 255),
    g: clampChannel(hueToRgb(p, q, h) * 255),
    b: clampChannel(hueToRgb(p, q, h - 1 / 3) * 255),
    a: alpha,
  };
}

function parseColor(input: string): RGBA | null {
  const normalized = input.trim().toLowerCase();
  if (!normalized) return null;

  if (normalized === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };

  const named = NAMED_COLORS[normalized];
  if (named) return parseHex(named);

  if (normalized.startsWith('#')) return parseHex(normalized);

  const rgbMatch = normalized.match(/^rgba?\((.*)\)$/);
  if (rgbMatch) return parseRgb(rgbMatch[1]!);

  const hslMatch = normalized.match(/^hsla?\((.*)\)$/);
  if (hslMatch) return parseHsl(hslMatch[1]!);

  return null;
}

function formatColor({ r, g, b, a }: RGBA): string {
  const hex6 = [r, g, b]
    .map(channel => clampChannel(channel).toString(16).padStart(2, '0'))
    .join('');
  if (a < 0.999) {
    const alphaHex = Math.round(clampAlpha(a) * 255)
      .toString(16)
      .padStart(2, '0');
    return `#${hex6}${alphaHex}`;
  }
  return `#${hex6}`;
}

function cssInvert(r: number, g: number, b: number): { r: number; g: number; b: number } {
  const amount = DARK_MODE_INVERT_PERCENT / 100;
  const inverse = (channel: number): number =>
    clampChannel(channel * (1 - amount) + (255 - channel) * amount);
  return { r: inverse(r), g: inverse(g), b: inverse(b) };
}

function reverseCssInvert(r: number, g: number, b: number): { r: number; g: number; b: number } {
  const amount = DARK_MODE_INVERT_PERCENT / 100;
  const denominator = 1 - 2 * amount;
  if (denominator === 0) return { r, g, b };
  const inverse = (channel: number): number => clampChannel((channel - 255 * amount) / denominator);
  return { r: inverse(r), g: inverse(g), b: inverse(b) };
}

function cssHueRotate(
  red: number,
  green: number,
  blue: number,
  degrees: number
): { r: number; g: number; b: number } {
  const r = red / 255;
  const g = green / 255;
  const b = blue / 255;
  const angle = (degrees * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);

  const matrix = [
    0.213 + cos * 0.787 - sin * 0.213,
    0.715 - cos * 0.715 - sin * 0.715,
    0.072 - cos * 0.072 + sin * 0.928,

    0.213 - cos * 0.213 + sin * 0.143,
    0.715 + cos * 0.285 + sin * 0.14,
    0.072 - cos * 0.072 - sin * 0.283,

    0.213 - cos * 0.213 - sin * 0.787,
    0.715 - cos * 0.715 + sin * 0.715,
    0.072 + cos * 0.928 + sin * 0.072,
  ];

  const nextR = r * matrix[0]! + g * matrix[1]! + b * matrix[2]!;
  const nextG = r * matrix[3]! + g * matrix[4]! + b * matrix[5]!;
  const nextB = r * matrix[6]! + g * matrix[7]! + b * matrix[8]!;

  return {
    r: clampChannel(Math.max(0, Math.min(1, nextR)) * 255),
    g: clampChannel(Math.max(0, Math.min(1, nextG)) * 255),
    b: clampChannel(Math.max(0, Math.min(1, nextB)) * 255),
  };
}

function cacheResult(input: string, result: string): string {
  if (darkModeCache.size >= DARK_MODE_CACHE_LIMIT) darkModeCache.clear();
  darkModeCache.set(input, result);
  return result;
}

/**
 * Apply Excalidraw's dark-mode color transform to a stored color.
 *
 * `theme` is left in the signature because every call site already has one;
 * only dark mode transforms, and light mode is the exact stored value.
 */
export function applyDarkModeFilter(
  color: string | undefined,
  theme: 'light' | 'dark'
): string | undefined {
  if (theme !== 'dark' || typeof color !== 'string') return color;

  const normalized = color.trim();
  if (!normalized) return color;
  const lower = normalized.toLowerCase();
  if (lower === 'none' || lower === 'currentcolor') return color;

  const cached = darkModeCache.get(normalized);
  if (cached !== undefined) return cached;

  const parsed = parseColor(normalized);
  if (!parsed) return color;

  const inverted = cssInvert(parsed.r, parsed.g, parsed.b);
  const rotated = cssHueRotate(inverted.r, inverted.g, inverted.b, DARK_MODE_HUE_ROTATE_DEGREES);
  return cacheResult(normalized, formatColor({ ...rotated, a: parsed.a }));
}

/**
 * Reverse the dark-mode transform. Excalidraw exports the filtered scene and
 * needs the inverse when it copies a displayed color back into app state; this
 * is the same round-trip with the hue rotation applied first and the invert
 * solved algebraically.
 */
export function removeDarkModeFilter(color: string | undefined): string | undefined {
  if (typeof color !== 'string') return color;

  const normalized = color.trim();
  if (!normalized) return color;
  const lower = normalized.toLowerCase();
  if (lower === 'transparent' || lower === 'none' || lower === 'currentcolor') return color;

  const parsed = parseColor(normalized);
  if (!parsed) return color;

  const rotated = cssHueRotate(parsed.r, parsed.g, parsed.b, DARK_MODE_HUE_ROTATE_DEGREES);
  const inverted = reverseCssInvert(rotated.r, rotated.g, rotated.b);
  return formatColor({ ...inverted, a: parsed.a });
}

/**
 * Perceived brightness (0-1) for UI decisions such as swatch outlines. This is
 * deliberately independent of the dark-mode transform: callers pass the color
 * they are about to paint, not the stored color.
 */
export function isColorDark(color: string | undefined, threshold = 0.5): boolean {
  if (typeof color !== 'string') return false;
  const parsed = parseColor(color);
  if (!parsed || parsed.a === 0) return false;
  const luminance = (0.299 * parsed.r + 0.587 * parsed.g + 0.114 * parsed.b) / 255;
  return luminance < threshold;
}

/** A light swatch needs a border to stay visible on the panel surface. */
export function needsSwatchOutline(color: string | undefined): boolean {
  if (typeof color !== 'string') return false;
  const parsed = parseColor(color);
  if (!parsed || parsed.a === 0) return false;
  return !isColorDark(color, 0.8);
}
