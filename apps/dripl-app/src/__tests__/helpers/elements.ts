/**
 * Element factories for renderer and tool tests.
 *
 * Mirrors the `as DriplElement` literal style used by
 * `utils/__tests__/arrow-binding.test.ts`: the shapes under test are partial by
 * design (that is how they arrive from a scene, a JSON payload and a draft at
 * once), so the cast is the honest way to express "a valid element that may be
 * missing every optional field".
 */
import type { DriplElement, Point } from '@dripl/common';

/**
 * Overrides for a test element.
 *
 * `type` is widened to `string` on purpose: `renderElement` dispatches on a
 * string and falls back to the rectangle renderer for anything it does not
 * recognise, so an unknown type is a legitimate thing to construct here.
 */
export type ElementOverrides = Omit<Partial<DriplElement>, 'type'> & {
  type?: string;
} & Record<string, unknown>;

/** A rectangle with every optional style field explicitly set to the schema default. */
export function rectangle(id: string, overrides: ElementOverrides = {}): DriplElement {
  return {
    id,
    type: 'rectangle',
    x: 0,
    y: 0,
    width: 100,
    height: 80,
    ...overrides,
  } as DriplElement;
}

/** A rectangle carrying nothing but the schema-required fields. */
export function bareElement(id: string, overrides: ElementOverrides = {}): DriplElement {
  return {
    id,
    type: 'rectangle',
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    ...overrides,
  } as DriplElement;
}

/** A linear element (line/arrow/freedraw) with WORLD points and a matching bbox. */
export function linear(
  id: string,
  type: 'line' | 'arrow' | 'freedraw',
  worldPoints: Point[],
  overrides: ElementOverrides = {}
): DriplElement {
  const xs = worldPoints.map(p => p.x);
  const ys = worldPoints.map(p => p.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return {
    id,
    type,
    x: minX,
    y: minY,
    width: Math.max(...xs) - minX,
    height: Math.max(...ys) - minY,
    points: worldPoints.map(p => ({ x: p.x - minX, y: p.y - minY })),
    ...overrides,
  } as DriplElement;
}

/**
 * The style bag `useDrawingTools.makeProps` hands to every `create*Element`.
 *
 * Returned as a concrete record so a test can prove a tool preserved it.
 */
export function baseProps(id: string): Record<string, unknown> {
  return {
    id,
    strokeColor: '#1e1e1e',
    backgroundColor: 'transparent',
    strokeWidth: 2,
    opacity: 1,
    roughness: 1,
    strokeStyle: 'solid',
    fillStyle: 'hachure',
    seed: 1234,
  };
}
