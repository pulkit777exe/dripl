import { describe, it, expect } from 'vitest';
import {
  PointSchema,
  ElementTypeSchema,
  BaseElementSchema,
  DriplElementSchema,
  FileSchema,
  CreateFileSchema,
} from './schemas';

const UUID = '123e4567-e89b-12d3-a456-426614174000';

describe('PointSchema', () => {
  it('validates valid points', () => {
    expect(PointSchema.safeParse({ x: 0, y: 0 }).success).toBe(true);
    expect(PointSchema.safeParse({ x: -100, y: 200.5 }).success).toBe(true);
  });

  it('rejects invalid points', () => {
    expect(PointSchema.safeParse({ x: '0', y: 0 }).success).toBe(false);
    expect(PointSchema.safeParse({ x: 0 }).success).toBe(false);
    expect(PointSchema.safeParse({}).success).toBe(false);
  });
});

describe('ElementTypeSchema', () => {
  it('validates all element types', () => {
    const types = ['rectangle', 'ellipse', 'path', 'text', 'image', 'line', 'arrow', 'diamond', 'freedraw', 'frame'];
    for (const type of types) {
      expect(ElementTypeSchema.safeParse(type).success).toBe(true);
    }
  });

  it('rejects invalid types', () => {
    expect(ElementTypeSchema.safeParse('circle').success).toBe(false);
    expect(ElementTypeSchema.safeParse('box').success).toBe(false);
  });
});

describe('BaseElementSchema', () => {
  it('validates base element properties', () => {
    const result = BaseElementSchema.safeParse({
      id: UUID,
      type: 'rectangle',
      x: 0,
      y: 0,
      width: 100,
      height: 100,
    });
    expect(result.success).toBe(true);
  });

  it('handles optional fields', () => {
    const result = BaseElementSchema.safeParse({
      id: UUID,
      type: 'rectangle',
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      isDeleted: true,
      version: 5,
      strokeStyle: 'dashed',
    });
    expect(result.success).toBe(true);
  });

  it('rejects non-UUID id', () => {
    const result = BaseElementSchema.safeParse({
      id: 'not-a-uuid',
      type: 'rectangle',
      x: 0,
      y: 0,
      width: 100,
      height: 100,
    });
    expect(result.success).toBe(false);
  });

  it('validates element with boundElements', () => {
    const result = BaseElementSchema.safeParse({
      id: UUID,
      type: 'rectangle',
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      boundElements: [{ id: 'arrow-1', type: 'arrow' }],
    });
    expect(result.success).toBe(true);
  });

  it('validates element without boundElements (backward compat)', () => {
    const result = BaseElementSchema.safeParse({
      id: UUID,
      type: 'rectangle',
      x: 0,
      y: 0,
      width: 100,
      height: 100,
    });
    expect(result.success).toBe(true);
    expect(result.data?.boundElements).toBeUndefined();
  });

  it('rejects invalid boundElements entry type', () => {
    const result = BaseElementSchema.safeParse({
      id: UUID,
      type: 'rectangle',
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      boundElements: [{ id: 'a', type: 'invalid' }],
    });
    expect(result.success).toBe(false);
  });
});

describe('DriplElementSchema', () => {
  it('validates rectangle elements', () => {
    const result = DriplElementSchema.safeParse({
      id: UUID,
      type: 'rectangle',
      x: 0,
      y: 0,
      width: 100,
      height: 100,
    });
    expect(result.success).toBe(true);
  });

  it('validates ellipse elements', () => {
    const result = DriplElementSchema.safeParse({
      id: UUID,
      type: 'ellipse',
      x: 0,
      y: 0,
      width: 100,
      height: 50,
    });
    expect(result.success).toBe(true);
  });

  it('validates arrow elements', () => {
    const result = DriplElementSchema.safeParse({
      id: UUID,
      type: 'arrow',
      x: 0,
      y: 0,
      width: 200,
      height: 100,
      points: [
        { x: 0, y: 0 },
        { x: 200, y: 100 },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('validates text elements', () => {
    const result = DriplElementSchema.safeParse({
      id: UUID,
      type: 'text',
      x: 0,
      y: 0,
      width: 100,
      height: 30,
      text: 'Hello',
      fontSize: 16,
    });
    expect(result.success).toBe(true);
  });

  it('validates freedraw elements', () => {
    const result = DriplElementSchema.safeParse({
      id: UUID,
      type: 'freedraw',
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      points: [
        { x: 0, y: 0 },
        { x: 50, y: 50 },
        { x: 100, y: 0 },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('validates image elements', () => {
    const result = DriplElementSchema.safeParse({
      id: UUID,
      type: 'image',
      x: 0,
      y: 0,
      width: 200,
      height: 150,
      src: 'https://example.com/image.png',
    });
    expect(result.success).toBe(true);
  });

  it('validates frame elements', () => {
    const result = DriplElementSchema.safeParse({
      id: UUID,
      type: 'frame',
      x: 0,
      y: 0,
      width: 500,
      height: 300,
      title: 'My Frame',
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid type', () => {
    const result = DriplElementSchema.safeParse({
      id: UUID,
      type: 'invalid',
      x: 0,
      y: 0,
      width: 100,
      height: 100,
    });
    expect(result.success).toBe(false);
  });
});

describe('File schemas', () => {
  it('validates CreateFileSchema', () => {
    const result = CreateFileSchema.safeParse({
      name: 'My Canvas',
      folderId: UUID,
    });
    expect(result.success).toBe(true);
  });

  it('validates FileSchema with all required fields', () => {
    const result = FileSchema.safeParse({
      id: UUID,
      name: 'My Canvas',
      content: '{}',
      preview: null,
      folderId: null,
      teamId: null,
      userId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    expect(result.success).toBe(true);
  });

  it('rejects FileSchema with missing required fields', () => {
    const result = FileSchema.safeParse({
      id: UUID,
      name: 'My Canvas',
    });
    expect(result.success).toBe(false);
  });
});
