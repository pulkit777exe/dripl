import { performance } from 'node:perf_hooks';
import { isValidSceneContent, isValidSceneString } from '../../apps/http-server/src/lib/sceneValidation';
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
  const elements = makeElements(count);
  const serialized = JSON.stringify(elements);
  // 16 distinct-byte variants (3 warmup + 10 measured + margin): trailing
  // whitespace changes the hash but not the parsed value, so every call
  // below misses the memo and pays parse + full Zod walk.
  const coldVariants = Array.from(
    { length: 16 },
    (_, variant) => `${serialized.slice(0, -1)}${' '.repeat(variant + 1)}]`
  );
  let coldCursor = 0;
  metrics.push(
    measure(`validate-object-${count}`, 10, () => {
      isValidSceneContent(elements);
    }),
    measure(`validate-string-cold-${count}`, 10, () => {
      // Cold: the first-save cost.
      const next = coldVariants[coldCursor % coldVariants.length] as string;
      coldCursor += 1;
      isValidSceneString(next);
    }),
    measure(`validate-string-warm-${count}`, 10, () => {
      // Warm: byte-identical repeat save — the memo-hit path.
      isValidSceneString(serialized);
    }),
    measure(`stringify-${count}`, 10, () => {
      JSON.stringify(elements);
    })
  );
}

// This is a CLI reporter, not application code, so it writes to stdout
// directly rather than through the app logging boundary.
process.stdout.write(
  `${JSON.stringify(
    {
      kind: 'synthetic-scene-save-microbenchmark',
      node: process.version,
      note: 'Microbenchmarks only; they do not represent browser FPS, render latency, or network performance.',
      metrics,
    },
    null,
    2
  )}\n`
);
