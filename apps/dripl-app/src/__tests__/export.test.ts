import { describe, expect, it } from 'vitest';
import { exportToExcalidraw, exportToSvg, importFromJson } from '@/utils/export';

const rectangle = (id: string) => ({
  id,
  type: 'rectangle' as const,
  x: 10,
  y: 20,
  width: 100,
  height: 60,
});

describe('scene import/export', () => {
  it('exports a native Excalidraw document envelope', async () => {
    const blob = exportToExcalidraw([rectangle('shape-1')]);
    const text = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsText(blob);
    });
    const document = JSON.parse(text) as {
      type: string;
      version: number;
      source: string;
      elements: unknown[];
    };

    expect(document).toMatchObject({ type: 'excalidraw', version: 2, source: 'dripl' });
    expect(document.elements).toHaveLength(1);
  });

  it('maps Dripl bindings to native Excalidraw binding fields', async () => {
    const blob = exportToExcalidraw([
      {
        ...rectangle('shape-1'),
        groupId: 'group-1',
        fractionalIndex: 'a0',
      },
      {
        id: 'arrow-1',
        type: 'arrow' as const,
        x: 0,
        y: 0,
        width: 100,
        height: 20,
        points: [
          { x: 0, y: 0 },
          { x: 100, y: 20 },
        ],
        startBinding: { elementId: 'shape-1', fixedPoint: { x: 0, y: 0 }, mode: 'inside' },
        endBinding: { elementId: 'shape-1', fixedPoint: { x: 1, y: 1 }, mode: 'orbit' },
        arrowHeads: { start: 'none', end: 'triangle' },
        arrowStyle: 'elbow' as const,
      },
    ]);
    const text = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsText(blob);
    });
    const document = JSON.parse(text) as { elements: Array<Record<string, unknown>> };
    const arrow = document.elements.find(element => element.id === 'arrow-1');
    expect(arrow).toMatchObject({
      startBinding: { elementId: 'shape-1', focus: 0, gap: 1, fixedPoint: [0, 0] },
      endBinding: { elementId: 'shape-1', focus: 0, gap: 1, fixedPoint: [1, 1] },
      startArrowhead: null,
      endArrowhead: 'arrow',
      elbowed: true,
      points: [
        [0, 0],
        [100, 20],
      ],
    });
    expect(document.elements[0]).toMatchObject({ index: 'a0', groupIds: ['group-1'] });
  });

  it('imports a native Excalidraw array and remaps relationships on merge', () => {
    const imported = importFromJson(
      JSON.stringify([
        rectangle('shape-1'),
        {
          id: 'label-1',
          type: 'text',
          x: 20,
          y: 30,
          width: 80,
          height: 20,
          text: 'Login',
          containerId: 'shape-1',
        },
        {
          id: 'arrow-1',
          type: 'arrow',
          x: 110,
          y: 50,
          width: 80,
          height: 0,
          points: [
            [0, 0],
            [80, 0],
          ],
          startBinding: { elementId: 'shape-1', fixedPoint: [0, 0] },
          endBinding: { elementId: 'label-1', fixedPoint: [0, 0] },
        },
      ]),
      [],
      'merge'
    );

    expect(imported).toHaveLength(3);
    const shapeId = imported[0]?.id;
    const labelId = imported[1]?.id;
    const arrow = imported[2];
    expect(shapeId).not.toBe('shape-1');
    expect(labelId).not.toBe('label-1');
    expect(imported[1]?.containerId).toBe(shapeId);
    expect(arrow?.type).toBe('arrow');
    if (arrow?.type === 'arrow') {
      expect(arrow.startBinding?.elementId).toBe(shapeId);
      expect(arrow.endBinding?.elementId).toBe(labelId);
    }
  });

  it('honors custom SVG output dimensions without changing the scene viewBox', async () => {
    const blob = exportToSvg([rectangle('shape-1')], {
      customWidth: 640,
      customHeight: 360,
    });
    const text = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsText(blob);
    });

    expect(text).toContain('width="640"');
    expect(text).toContain('height="360"');
    expect(text).toContain('viewBox="-6 4 132 92"');
  });

  it('rejects unsafe embed URLs during import', () => {
    expect(() =>
      importFromJson(
        JSON.stringify([
          {
            id: 'unsafe-embed',
            type: 'embed',
            x: 0,
            y: 0,
            width: 100,
            height: 100,
            url: 'javascript:alert(1)',
          },
        ]),
        []
      )
    ).toThrow(/no valid elements/i);
  });

  it('rejects unsafe image data URLs during import', () => {
    expect(() =>
      importFromJson(
        JSON.stringify([
          {
            id: 'unsafe-image',
            type: 'image',
            x: 0,
            y: 0,
            width: 20,
            height: 20,
            src: 'data:image/svg+xml,<svg onload=alert(1)></svg>',
          },
        ]),
        []
      )
    ).toThrow(/no valid elements/i);
  });

  it('rejects files with no valid scene elements', () => {
    expect(() =>
      importFromJson(JSON.stringify({ elements: [{ id: 'bad', type: 'unsupported' }] }), [])
    ).toThrow(/no valid elements/i);
  });
});
