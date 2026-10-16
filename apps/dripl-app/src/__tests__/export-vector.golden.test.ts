import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import type { DriplElement } from '@dripl/common';
import { exportToSvg } from '@/utils/export/vector';
import { linear, rectangle } from './helpers/elements';

/**
 * SVG golden files: `exportToSvg` is fully deterministic (seeded Rough
 * options never reach SVG, perfect-freehand is pure math, no timestamps),
 * so representative scenes are pinned byte-for-byte under `golden/`.
 * A diff here means the visible export changed — review the SVG, not just
 * the test.
 *
 * Regenerate after an intentional rendering change with:
 *   UPDATE_GOLDENS=1 pnpm vitest run src/__tests__/export-vector.golden.test.ts
 */

const GOLDEN_DIR = path.join(__dirname, 'golden');

function svgOf(elements: DriplElement[], options: Record<string, unknown> = {}): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(exportToSvg(elements, options));
  });
}

async function expectGolden(name: string, elements: DriplElement[], options = {}): Promise<void> {
  const actual = await svgOf(elements, options);
  const file = path.join(GOLDEN_DIR, name);
  if (process.env.UPDATE_GOLDENS === '1') {
    fs.mkdirSync(GOLDEN_DIR, { recursive: true });
    fs.writeFileSync(file, actual);
    return;
  }
  expect(actual).toBe(fs.readFileSync(file, 'utf8'));
}

const STYLE = {
  strokeColor: '#1e1e1e',
  backgroundColor: '#e9e7e2',
  strokeWidth: 2,
  opacity: 1,
  roughness: 1,
  strokeStyle: 'solid' as const,
  fillStyle: 'hachure' as const,
  seed: 1234,
};

describe('exportToSvg goldens', () => {
  it('shapes, arrows, text and a frame', async () => {
    await expectGolden('shapes.svg', [
      rectangle('r', { ...STYLE, x: 10, y: 20, width: 100, height: 60, strokeStyle: 'dashed' }),
      {
        ...rectangle('e', { ...STYLE, x: 150, y: 10, width: 90, height: 70 }),
        type: 'ellipse',
      } as unknown as DriplElement,
      {
        ...rectangle('d', { ...STYLE, x: 260, y: 10, width: 80, height: 80, angle: 0.3 }),
        type: 'diamond',
      } as unknown as DriplElement,
      linear(
        'a',
        'arrow',
        [
          { x: 10, y: 120 },
          { x: 110, y: 150 },
        ],
        {
          ...STYLE,
          arrowHeads: { start: 'dot', end: 'triangle' },
          arrowStyle: 'curved',
        }
      ) as DriplElement,
      {
        ...rectangle('t', { ...STYLE, x: 150, y: 110, width: 120, height: 60 }),
        type: 'text',
        text: 'Hello\nWorld',
        originalText: 'Hello\nWorld',
        fontSize: 20,
        fontFamily: 'Caveat',
        textAlign: 'center',
        verticalAlign: 'middle',
      } as unknown as DriplElement,
      {
        ...rectangle('f', { ...STYLE, x: 300, y: 100, width: 160, height: 120 }),
        type: 'frame',
        title: 'Flow',
      } as unknown as DriplElement,
    ]);
  });

  it('a pressure-varying freedraw stroke', async () => {
    await expectGolden(
      'freedraw.svg',
      [
        linear(
          's',
          'freedraw',
          [
            { x: 0, y: 0 },
            { x: 15, y: 4 },
            { x: 30, y: -3 },
            { x: 45, y: 6 },
            { x: 60, y: 0 },
            { x: 75, y: -5 },
            { x: 90, y: 2 },
          ],
          { ...STYLE, strokeWidth: 3, pressureValues: [0.3, 0.5, 0.9, 0.7, 0.4, 0.6, 0.8] }
        ) as DriplElement,
      ],
      {}
    );
  });

  it('the shapes scene in the dark theme', async () => {
    await expectGolden(
      'shapes-dark.svg',
      [
        rectangle('r', { ...STYLE, x: 10, y: 20, width: 100, height: 60 }),
        {
          ...rectangle('t', { ...STYLE, x: 150, y: 20, width: 120, height: 40 }),
          type: 'text',
          text: 'Dark',
          originalText: 'Dark',
          fontSize: 20,
          fontFamily: 'Caveat',
        } as unknown as DriplElement,
      ],
      { theme: 'dark' }
    );
  });
});
