import { describe, expect, it } from 'vitest';
import { CanvasContentSchema, type DriplElement } from '@dripl/common';
import {
  DRIPL_SCENE_TYPE,
  DRIPL_SCENE_VERSION,
  exportToDripl,
  exportToSvg,
  importFromJson,
} from '@/utils/export';

const rectangle = (id: string) => ({
  id,
  type: 'rectangle' as const,
  x: 10,
  y: 20,
  width: 100,
  height: 60,
});

async function readBlob(blob: Blob): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
}

/** Shared style the open path's schema defaults, so `scene` is canonical. */
const STYLE = {
  angle: 0,
  strokeColor: '#1e1e1e',
  fillColor: 'transparent',
  backgroundColor: 'transparent',
  strokeWidth: 2,
  opacity: 1,
  roughness: 1,
  locked: false,
  version: 3,
  versionNonce: 7,
};

/**
 * One representative element of every type in `ElementTypeSchema`, carrying the
 * Dripl-only fields that used to be stripped by the export's denylist
 * (fractionalIndex, groupId, containerId, rotation, flips, zIndex, points,
 * arrowHeads, arrowStyle, bindings).
 */
const REPRESENTATIVE_SCENE = [
  {
    ...STYLE,
    id: 'rect-1',
    type: 'rectangle',
    x: 0,
    y: 0,
    width: 120,
    height: 80,
    fractionalIndex: 'a0',
    zIndex: 1,
    groupId: 'group-1',
    seed: 11,
    strokeStyle: 'dashed',
    fillStyle: 'hachure',
    link: 'https://example.com/rect',
  },
  { ...STYLE, id: 'ellipse-1', type: 'ellipse', x: 200, y: 0, width: 90, height: 90 },
  { ...STYLE, id: 'diamond-1', type: 'diamond', x: 320, y: 0, width: 60, height: 60 },
  {
    ...STYLE,
    id: 'path-1',
    type: 'path',
    x: 0,
    y: 120,
    width: 100,
    height: 40,
    points: [
      { x: 0, y: 0 },
      { x: 50, y: 40 },
    ],
  },
  {
    ...STYLE,
    id: 'text-1',
    type: 'text',
    x: 140,
    y: 120,
    width: 80,
    height: 24,
    text: 'Login',
    originalText: 'Login',
    fontSize: 20,
    fontFamily: 'Caveat',
    textAlign: 'center',
    verticalAlign: 'middle',
    containerId: 'rect-1',
    boundElementId: 'rect-1',
  },
  {
    ...STYLE,
    id: 'image-1',
    type: 'image',
    x: 240,
    y: 120,
    width: 40,
    height: 40,
    src: 'data:image/png;base64,iVBORw0KGgo=',
    naturalWidth: 40,
    naturalHeight: 40,
  },
  {
    ...STYLE,
    id: 'line-1',
    type: 'line',
    x: 0,
    y: 220,
    width: 100,
    height: 0,
    points: [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ],
    rotation: 15,
    flipHorizontal: -1,
    flipVertical: 1,
  },
  {
    ...STYLE,
    id: 'arrow-1',
    type: 'arrow',
    x: 0,
    y: 260,
    width: 100,
    height: 20,
    points: [
      { x: 0, y: 0 },
      { x: 100, y: 20 },
    ],
    arrowStyle: 'elbow',
    arrowHeads: { start: 'none', end: 'triangle' },
    startBinding: { elementId: 'rect-1', fixedPoint: { x: 0, y: 0 }, mode: 'inside' },
    endBinding: { elementId: 'ellipse-1', fixedPoint: { x: 1, y: 1 }, mode: 'orbit' },
  },
  {
    ...STYLE,
    id: 'freedraw-1',
    type: 'freedraw',
    x: 0,
    y: 320,
    width: 60,
    height: 30,
    points: [
      { x: 0, y: 0 },
      { x: 30, y: 30 },
    ],
    brushSize: 4,
    pressureValues: [0.5, 0.75],
    widths: [3, 5],
  },
  {
    ...STYLE,
    id: 'frame-1',
    type: 'frame',
    x: 0,
    y: 0,
    width: 400,
    height: 400,
    title: 'Flow',
    padding: 12,
    containerId: 'group-1',
  },
  {
    ...STYLE,
    id: 'embed-1',
    type: 'embed',
    x: 320,
    y: 320,
    width: 200,
    height: 120,
    url: 'https://example.com/embed',
    title: 'Docs',
  },
];

describe('scene import/export', () => {
  it('exports a native .dripl document envelope', async () => {
    const blob = exportToDripl([rectangle('shape-1') as DriplElement], { zoom: 2 }, 1_700_000);
    const document = JSON.parse(await readBlob(blob)) as {
      version: number;
      type: string;
      exportedAt: number;
      elements: unknown[];
      appState: Record<string, unknown>;
    };

    expect(blob.type).toBe('application/json');
    expect(document).toMatchObject({
      type: DRIPL_SCENE_TYPE,
      version: DRIPL_SCENE_VERSION,
      exportedAt: 1_700_000,
      appState: { zoom: 2 },
    });
    expect(document.elements).toHaveLength(1);
  });

  it('keeps Dripl-only fields verbatim instead of projecting them through a denylist', async () => {
    const blob = exportToDripl(REPRESENTATIVE_SCENE as DriplElement[], { gridEnabled: true }, 1);
    const document = JSON.parse(await readBlob(blob)) as {
      elements: Array<Record<string, unknown>>;
    };
    const byId = new Map(document.elements.map(element => [element.id, element]));

    // The fields the old export had to strip, plus the arrow binding/head
    // mapping it used to translate into foreign names.
    expect(byId.get('rect-1')).toMatchObject({
      fractionalIndex: 'a0',
      zIndex: 1,
      groupId: 'group-1',
    });
    expect(byId.get('arrow-1')).toMatchObject({
      arrowStyle: 'elbow',
      arrowHeads: { start: 'none', end: 'triangle' },
      startBinding: { elementId: 'rect-1', fixedPoint: { x: 0, y: 0 }, mode: 'inside' },
      endBinding: { elementId: 'ellipse-1', fixedPoint: { x: 1, y: 1 }, mode: 'orbit' },
      points: [
        { x: 0, y: 0 },
        { x: 100, y: 20 },
      ],
    });
    expect(byId.get('text-1')).toMatchObject({
      originalText: 'Login',
      containerId: 'rect-1',
      boundElementId: 'rect-1',
    });
    expect(byId.get('line-1')).toMatchObject({ rotation: 15, flipHorizontal: -1 });
    expect(byId.get('frame-1')).toMatchObject({ title: 'Flow' });
    expect(byId.get('image-1')).toMatchObject({ src: 'data:image/png;base64,iVBORw0KGgo=' });
  });

  it("round-trips an export back through the open path's validation unchanged", async () => {
    const canonical = CanvasContentSchema.parse(REPRESENTATIVE_SCENE) as DriplElement[];
    const blob = exportToDripl(canonical, { zoom: 1.5 }, 1_700_000);
    const document = JSON.parse(await readBlob(blob)) as {
      type: string;
      elements: unknown[];
      appState: Record<string, unknown>;
    };

    // `handleOpenFile` accepts arrays and `{ elements }` envelopes, and runs
    // `CanvasContentSchema.parse(scene.elements)` on the latter.
    expect(document.type).toBe(DRIPL_SCENE_TYPE);
    expect(CanvasContentSchema.parse(document.elements)).toEqual(canonical);
    expect(document.appState).toEqual({ zoom: 1.5 });
  });

  it('imports a native element array and remaps relationships on merge', () => {
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
            { x: 0, y: 0 },
            { x: 80, y: 0 },
          ],
          startBinding: { elementId: 'shape-1', fixedPoint: { x: 0, y: 0 } },
          endBinding: { elementId: 'label-1', fixedPoint: { x: 0, y: 0 } },
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
    const blob = exportToSvg([rectangle('shape-1') as DriplElement], {
      customWidth: 640,
      customHeight: 360,
    });
    const text = await readBlob(blob);

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
