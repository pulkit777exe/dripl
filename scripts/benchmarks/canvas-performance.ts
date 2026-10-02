import { performance } from 'node:perf_hooks';
import RBush from 'rbush';
import { getElementBounds } from '@dripl/math/intersection';
import { mutateElement } from '@dripl/element/mutateElement';
import { compareElementFreshness } from '@dripl/common/reconciliation';
import type { DriplElement } from '@dripl/common';

interface SpatialItem {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  id: string;
}

function makeElements(count: number): DriplElement[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `element-${index}`,
    type: 'rectangle',
    x: (index % 100) * 140,
    y: Math.floor(index / 100) * 100,
    width: 100,
    height: 70,
    strokeColor: '#1e1e1e',
    backgroundColor: 'transparent',
    strokeWidth: 2,
    opacity: 1,
    roughness: 1,
    version: 1,
    versionNonce: 1,
  }));
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function measure(
  label: string,
  iterations: number,
  operation: () => void
): Record<string, unknown> {
  for (let i = 0; i < 3; i += 1) operation();
  const samples: number[] = [];
  for (let i = 0; i < iterations; i += 1) {
    const start = performance.now();
    operation();
    samples.push(performance.now() - start);
  }
  return {
    label,
    iterations,
    medianMs: Number(median(samples).toFixed(4)),
    minMs: Number(Math.min(...samples).toFixed(4)),
    maxMs: Number(Math.max(...samples).toFixed(4)),
  };
}

const elements = makeElements(10_000);
const tree = new RBush<SpatialItem>();
for (const element of elements) {
  const bounds = getElementBounds(element);
  tree.insert({
    minX: bounds.x,
    minY: bounds.y,
    maxX: bounds.x + bounds.width,
    maxY: bounds.y + bounds.height,
    id: element.id,
  });
}

const metrics = [
  measure('rbush-viewport-query-10k', 20, () => {
    tree.search({ minX: 0, minY: 0, maxX: 1400, maxY: 1000 });
  }),
  measure('element-bounds-10k', 20, () => {
    for (const element of elements) getElementBounds(element);
  }),
  measure('version-reconciliation-10k', 20, () => {
    for (const element of elements) compareElementFreshness(element, element);
  }),
  measure('mutate-element-1k', 20, () => {
    for (let i = 0; i < 1_000; i += 1) {
      mutateElement(elements[i % elements.length]!, { x: i });
    }
  }),
];

// This is a CLI reporter, not application code, so it writes to stdout
// directly rather than through the app logging boundary.
process.stdout.write(
  `${JSON.stringify(
    {
      kind: 'synthetic-canvas-microbenchmark',
      node: process.version,
      elementCount: elements.length,
      note: 'Microbenchmarks only; they do not represent browser FPS, render latency, or network performance.',
      metrics,
    },
    null,
    2
  )}\n`
);
