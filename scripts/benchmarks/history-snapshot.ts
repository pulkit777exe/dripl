import { performance } from 'node:perf_hooks';
import { pushPast } from '../../apps/dripl-app/lib/store/helpers';
import type { DriplElement } from '@dripl/common';

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

const metrics: Record<string, unknown>[] = [];
for (const count of [1_000, 5_000]) {
  // Distinct scene per push: a fresh element appended, so every push clones.
  // A rolling single-entry stack keeps this about push cost, not stack growth.
  let evolving = makeElements(count);
  metrics.push(
    measure(`history-push-distinct-${count}`, 20, () => {
      evolving = [
        ...evolving.slice(0, count),
        {
          id: `extra-${Math.random()}`,
          type: 'rectangle',
          x: 0,
          y: 0,
          width: 10,
          height: 10,
          version: 1,
          versionNonce: 1,
        } as DriplElement,
      ];
      pushPast([], evolving);
    })
  );
  // Identical repeat push: the no-op skip path (equality scan, no clone).
  const steady = makeElements(count);
  const steadyStack = pushPast([], steady);
  metrics.push(
    measure(`history-push-redundant-${count}`, 20, () => {
      pushPast(steadyStack, makeElements(count));
    })
  );
  metrics.push(
    measure(`structuredClone-baseline-${count}`, 20, () => {
      structuredClone(makeElements(count));
    })
  );
}

// This is a CLI reporter, not application code, so it writes to stdout
// directly rather than through the app logging boundary.
process.stdout.write(
  `${JSON.stringify(
    {
      kind: 'synthetic-history-microbenchmark',
      node: process.version,
      note: 'Microbenchmarks only; they do not represent browser FPS, render latency, or network performance.',
      metrics,
    },
    null,
    2
  )}\n`
);
