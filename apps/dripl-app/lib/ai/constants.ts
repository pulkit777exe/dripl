/** Bounds and patterns for AI-generated scene content. */

export const MAX_AI_ELEMENTS = 100;
export const MAX_AI_POINTS = 10_000;
export const MAX_LABEL_LENGTH = 500;
export const MAX_MODEL_RESPONSE_LENGTH = 200_000;

export const VALID_ELEMENT_TYPES = new Set([
  'rectangle',
  'ellipse',
  'diamond',
  'arrow',
  'line',
  'text',
]);

export const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const HEX_COLOR_PATTERN = /^(?:#[0-9a-f]{3,8}|transparent)$/i;
export const CSS_COLOR_FUNCTION_PATTERN = /^(?:rgb|rgba|hsl|hsla)\([^)]{1,80}\)$/i;
