import { describe, expect, it } from 'vitest';
import type { DriplElement } from '@dripl/common';

import { renderRoughElement } from './rough-renderer';

function makeCalls(rect: DriplElement) {
  const calls: unknown[][] = [];
  const fakeRc = {
    draw: (...args: unknown[]) => {
      calls.push(args);
    },
  } as unknown as Parameters<typeof renderRoughElement>[0];
  const ctx = {
    save: () => undefined,
    restore: () => undefined,
    translate: () => undefined,
    beginPath: () => undefined,
    closePath: () => undefined,
    fill: () => undefined,
    stroke: () => undefined,
    moveTo: () => undefined,
    lineTo: () => undefined,
    arc: () => undefined,
    rect: () => undefined,
    setLineDash: () => undefined,
    measureText: () => ({ width: 10 }),
    fillText: () => undefined,
  } as unknown as CanvasRenderingContext2D;
  renderRoughElement(fakeRc, ctx, rect, [], 'light');
  return calls;
}

function rect(overrides: Partial<DriplElement>): DriplElement {
  return {
    id: 'shape-1',
    type: 'rectangle',
    x: 10,
    y: 10,
    width: 160,
    height: 120,
    strokeColor: '#1e1e1e',
    backgroundColor: 'transparent',
    strokeWidth: 2,
    opacity: 1,
    roughness: 1,
    version: 1,
    versionNonce: 1,
    ...overrides,
  } as DriplElement;
}

describe('rough rendering determinism', () => {
  it('generates identical draw calls for a seedless element', () => {
    const first = JSON.stringify(makeCalls(rect({ id: 'seedless-a' })));
    const second = JSON.stringify(makeCalls(rect({ id: 'seedless-a' })));
    expect(second).toBe(first);
  });

  it('generates different geometry for different ids', () => {
    const a = JSON.stringify(makeCalls(rect({ id: 'id-a' })));
    const b = JSON.stringify(makeCalls(rect({ id: 'id-b' })));
    expect(b).not.toBe(a);
  });

  it('still honours an explicit seed', () => {
    const a = JSON.stringify(makeCalls(rect({ id: 'x', seed: 7 })));
    const b = JSON.stringify(makeCalls(rect({ id: 'y', seed: 7 })));
    expect(b).toBe(a);
  });
});
