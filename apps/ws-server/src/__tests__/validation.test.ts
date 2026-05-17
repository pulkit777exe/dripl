import { describe, it, expect } from 'vitest';
import {
  joinRoomSchema,
  joinSchema,
  addElementSchema,
  updateElementSchema,
  deleteElementSchema,
  cursorMoveSchema,
  cursorMoveKebabSchema,
  elementUpdateSchema,
  sceneUpdateSchema,
  messageSchema,
} from '../validation';

const validRectangle = {
  id: 'elem-1',
  type: 'rectangle',
  x: 0,
  y: 0,
  width: 100,
  height: 100,
  strokeColor: '#000000',
  backgroundColor: 'transparent',
  strokeWidth: 1,
  opacity: 1,
};

const validArrow = {
  id: 'elem-2',
  type: 'arrow',
  x: 0,
  y: 0,
  width: 200,
  height: 100,
  points: [{ x: 0, y: 0 }, { x: 200, y: 100 }],
};

const validText = {
  id: 'elem-3',
  type: 'text',
  x: 0,
  y: 0,
  width: 100,
  height: 30,
  text: 'Hello World',
  fontSize: 16,
  fontFamily: 'Helvetica',
};

describe('joinRoomSchema', () => {
  it('accepts valid join_room message', () => {
    const result = joinRoomSchema.safeParse({
      type: 'join_room',
      roomId: 'room-123',
    });
    expect(result.success).toBe(true);
  });

  it('accepts optional userName', () => {
    const result = joinRoomSchema.safeParse({
      type: 'join_room',
      roomId: 'room-123',
      userName: 'Alice',
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing roomId', () => {
    const result = joinRoomSchema.safeParse({ type: 'join_room' });
    expect(result.success).toBe(false);
  });

  it('rejects empty roomId', () => {
    const result = joinRoomSchema.safeParse({ type: 'join_room', roomId: '' });
    expect(result.success).toBe(false);
  });

  it('rejects roomId > 100 chars', () => {
    const result = joinRoomSchema.safeParse({
      type: 'join_room',
      roomId: 'a'.repeat(101),
    });
    expect(result.success).toBe(false);
  });

  it('rejects userName > 50 chars', () => {
    const result = joinRoomSchema.safeParse({
      type: 'join_room',
      roomId: 'room-1',
      userName: 'a'.repeat(51),
    });
    expect(result.success).toBe(false);
  });
});

describe('joinSchema', () => {
  it('accepts valid join message', () => {
    const result = joinSchema.safeParse({
      type: 'join',
      roomId: 'room-123',
    });
    expect(result.success).toBe(true);
  });

  it('accepts optional fields', () => {
    const result = joinSchema.safeParse({
      type: 'join',
      roomId: 'room-123',
      userId: 'user-1',
      displayName: 'Alice',
      color: '#ff0000',
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing roomId', () => {
    const result = joinSchema.safeParse({ type: 'join' });
    expect(result.success).toBe(false);
  });
});

describe('addElementSchema', () => {
  it('accepts valid rectangle element', () => {
    const result = addElementSchema.safeParse({
      type: 'add_element',
      element: validRectangle,
    });
    expect(result.success).toBe(true);
  });

  it('accepts valid arrow element', () => {
    const result = addElementSchema.safeParse({
      type: 'add_element',
      element: validArrow,
    });
    expect(result.success).toBe(true);
  });

  it('accepts valid text element', () => {
    const result = addElementSchema.safeParse({
      type: 'add_element',
      element: validText,
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing element', () => {
    const result = addElementSchema.safeParse({ type: 'add_element' });
    expect(result.success).toBe(false);
  });

  it('rejects element with x out of bounds', () => {
    const result = addElementSchema.safeParse({
      type: 'add_element',
      element: { ...validRectangle, x: -200000 },
    });
    expect(result.success).toBe(false);
  });

  it('rejects element with negative width', () => {
    const result = addElementSchema.safeParse({
      type: 'add_element',
      element: { ...validRectangle, width: -10 },
    });
    expect(result.success).toBe(false);
  });

  it('rejects element with id > 100 chars', () => {
    const result = addElementSchema.safeParse({
      type: 'add_element',
      element: { ...validRectangle, id: 'a'.repeat(101) },
    });
    expect(result.success).toBe(false);
  });

  it('rejects element with empty id', () => {
    const result = addElementSchema.safeParse({
      type: 'add_element',
      element: { ...validRectangle, id: '' },
    });
    expect(result.success).toBe(false);
  });
});

describe('updateElementSchema', () => {
  it('accepts valid update', () => {
    const result = updateElementSchema.safeParse({
      type: 'update_element',
      element: validRectangle,
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing element', () => {
    const result = updateElementSchema.safeParse({ type: 'update_element' });
    expect(result.success).toBe(false);
  });
});

describe('deleteElementSchema', () => {
  it('accepts valid delete', () => {
    const result = deleteElementSchema.safeParse({
      type: 'delete_element',
      elementId: 'elem-1',
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing elementId', () => {
    const result = deleteElementSchema.safeParse({ type: 'delete_element' });
    expect(result.success).toBe(false);
  });
});

describe('cursorMoveSchema', () => {
  it('accepts valid cursor move', () => {
    const result = cursorMoveSchema.safeParse({
      type: 'cursor_move',
      x: 100,
      y: 200,
    });
    expect(result.success).toBe(true);
  });

  it('accepts optional userName and color', () => {
    const result = cursorMoveSchema.safeParse({
      type: 'cursor_move',
      x: 0,
      y: 0,
      userName: 'Alice',
      color: '#ff0000',
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing x', () => {
    const result = cursorMoveSchema.safeParse({ type: 'cursor_move', y: 0 });
    expect(result.success).toBe(false);
  });

  it('rejects missing y', () => {
    const result = cursorMoveSchema.safeParse({ type: 'cursor_move', x: 0 });
    expect(result.success).toBe(false);
  });
});

describe('cursorMoveKebabSchema', () => {
  it('accepts valid cursor-move', () => {
    const result = cursorMoveKebabSchema.safeParse({
      type: 'cursor-move',
      x: 100,
      y: 200,
    });
    expect(result.success).toBe(true);
  });

  it('accepts optional displayName', () => {
    const result = cursorMoveKebabSchema.safeParse({
      type: 'cursor-move',
      x: 0,
      y: 0,
      displayName: 'Alice',
    });
    expect(result.success).toBe(true);
  });
});

describe('elementUpdateSchema', () => {
  it('accepts update with elements array', () => {
    const result = elementUpdateSchema.safeParse({
      type: 'element-update',
      elements: [validRectangle],
    });
    expect(result.success).toBe(true);
  });

  it('accepts update with single element', () => {
    const result = elementUpdateSchema.safeParse({
      type: 'element-update',
      element: validRectangle,
    });
    expect(result.success).toBe(true);
  });

  it('accepts missing both elements and element (both are optional)', () => {
    const result = elementUpdateSchema.safeParse({ type: 'element-update' });
    expect(result.success).toBe(true);
  });
});

describe('sceneUpdateSchema', () => {
  it('accepts valid init update', () => {
    const result = sceneUpdateSchema.safeParse({
      type: 'scene-update',
      subtype: 'init',
      elements: [],
    });
    expect(result.success).toBe(true);
  });

  it('accepts valid update with elements', () => {
    const result = sceneUpdateSchema.safeParse({
      type: 'scene-update',
      subtype: 'update',
      elements: [validRectangle, validArrow],
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing subtype', () => {
    const result = sceneUpdateSchema.safeParse({
      type: 'scene-update',
      elements: [],
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid subtype', () => {
    const result = sceneUpdateSchema.safeParse({
      type: 'scene-update',
      subtype: 'invalid',
      elements: [],
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing elements', () => {
    const result = sceneUpdateSchema.safeParse({
      type: 'scene-update',
      subtype: 'update',
    });
    expect(result.success).toBe(false);
  });

  it('rejects > 5000 elements', () => {
    const elements = Array.from({ length: 5001 }, (_, i) => ({
      ...validRectangle,
      id: `elem-${i}`,
    }));
    const result = sceneUpdateSchema.safeParse({
      type: 'scene-update',
      subtype: 'update',
      elements,
    });
    expect(result.success).toBe(false);
  });

  it('accepts exactly 5000 elements', () => {
    const elements = Array.from({ length: 5000 }, (_, i) => ({
      ...validRectangle,
      id: `elem-${i}`,
    }));
    const result = sceneUpdateSchema.safeParse({
      type: 'scene-update',
      subtype: 'update',
      elements,
    });
    expect(result.success).toBe(true);
  });
});

describe('messageSchema (discriminated union)', () => {
  it('accepts join_room', () => {
    const result = messageSchema.safeParse({
      type: 'join_room',
      roomId: 'room-1',
    });
    expect(result.success).toBe(true);
  });

  it('accepts join', () => {
    const result = messageSchema.safeParse({
      type: 'join',
      roomId: 'room-1',
    });
    expect(result.success).toBe(true);
  });

  it('accepts leave_room', () => {
    const result = messageSchema.safeParse({ type: 'leave_room' });
    expect(result.success).toBe(true);
  });

  it('accepts leave', () => {
    const result = messageSchema.safeParse({ type: 'leave' });
    expect(result.success).toBe(true);
  });

  it('accepts ping', () => {
    const result = messageSchema.safeParse({ type: 'ping' });
    expect(result.success).toBe(true);
  });

  it('accepts add_element', () => {
    const result = messageSchema.safeParse({
      type: 'add_element',
      element: validRectangle,
    });
    expect(result.success).toBe(true);
  });

  it('accepts update_element', () => {
    const result = messageSchema.safeParse({
      type: 'update_element',
      element: validRectangle,
    });
    expect(result.success).toBe(true);
  });

  it('accepts delete_element', () => {
    const result = messageSchema.safeParse({
      type: 'delete_element',
      elementId: 'elem-1',
    });
    expect(result.success).toBe(true);
  });

  it('accepts cursor_move', () => {
    const result = messageSchema.safeParse({
      type: 'cursor_move',
      x: 0,
      y: 0,
    });
    expect(result.success).toBe(true);
  });

  it('accepts cursor-move', () => {
    const result = messageSchema.safeParse({
      type: 'cursor-move',
      x: 0,
      y: 0,
    });
    expect(result.success).toBe(true);
  });

  it('accepts element-update', () => {
    const result = messageSchema.safeParse({
      type: 'element-update',
      element: validRectangle,
    });
    expect(result.success).toBe(true);
  });

  it('accepts scene-update', () => {
    const result = messageSchema.safeParse({
      type: 'scene-update',
      subtype: 'update',
      elements: [validRectangle],
    });
    expect(result.success).toBe(true);
  });

  it('rejects unknown type', () => {
    const result = messageSchema.safeParse({ type: 'unknown_type' });
    expect(result.success).toBe(false);
  });

  it('rejects missing type', () => {
    const result = messageSchema.safeParse({ roomId: 'room-1' });
    expect(result.success).toBe(false);
  });

  it('rejects malformed element in add_element', () => {
    const result = messageSchema.safeParse({
      type: 'add_element',
      element: { id: '', type: 'rectangle' },
    });
    expect(result.success).toBe(false);
  });
});

describe('element type validation', () => {
  it('accepts ellipse element', () => {
    const result = addElementSchema.safeParse({
      type: 'add_element',
      element: { ...validRectangle, type: 'ellipse' },
    });
    expect(result.success).toBe(true);
  });

  it('accepts diamond element', () => {
    const result = addElementSchema.safeParse({
      type: 'add_element',
      element: { ...validRectangle, type: 'diamond' },
    });
    expect(result.success).toBe(true);
  });

  it('accepts line element', () => {
    const result = addElementSchema.safeParse({
      type: 'add_element',
      element: validArrow,
    });
    expect(result.success).toBe(true);
  });

  it('accepts freedraw element', () => {
    const result = addElementSchema.safeParse({
      type: 'add_element',
      element: {
        id: 'fd-1',
        type: 'freedraw',
        x: 0,
        y: 0,
        width: 200,
        height: 100,
        points: [{ x: 0, y: 0 }, { x: 50, y: 50 }, { x: 200, y: 100 }],
      },
    });
    expect(result.success).toBe(true);
  });

  it('accepts image element', () => {
    const result = addElementSchema.safeParse({
      type: 'add_element',
      element: {
        id: 'img-1',
        type: 'image',
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        src: 'https://example.com/image.png',
      },
    });
    expect(result.success).toBe(true);
  });

  it('accepts frame element', () => {
    const result = addElementSchema.safeParse({
      type: 'add_element',
      element: {
        id: 'frame-1',
        type: 'frame',
        x: 0,
        y: 0,
        width: 500,
        height: 300,
        title: 'My Frame',
      },
    });
    expect(result.success).toBe(true);
  });

  it('rejects text with text > 10000 chars', () => {
    const result = addElementSchema.safeParse({
      type: 'add_element',
      element: { ...validText, text: 'a'.repeat(10001) },
    });
    expect(result.success).toBe(false);
  });

  it('rejects element with angle > 360', () => {
    const result = addElementSchema.safeParse({
      type: 'add_element',
      element: { ...validRectangle, angle: 361 },
    });
    expect(result.success).toBe(false);
  });

  it('rejects element with opacity > 1', () => {
    const result = addElementSchema.safeParse({
      type: 'add_element',
      element: { ...validRectangle, opacity: 1.5 },
    });
    expect(result.success).toBe(false);
  });

  it('rejects element with strokeWidth > 100', () => {
    const result = addElementSchema.safeParse({
      type: 'add_element',
      element: { ...validRectangle, strokeWidth: 101 },
    });
    expect(result.success).toBe(false);
  });

  it('rejects element with fontSize > 500', () => {
    const result = addElementSchema.safeParse({
      type: 'add_element',
      element: { ...validText, fontSize: 501 },
    });
    expect(result.success).toBe(false);
  });

  it('rejects element with y out of bounds', () => {
    const result = addElementSchema.safeParse({
      type: 'add_element',
      element: { ...validRectangle, y: 200000 },
    });
    expect(result.success).toBe(false);
  });

  it('rejects element with height > 50000', () => {
    const result = addElementSchema.safeParse({
      type: 'add_element',
      element: { ...validRectangle, height: 50001 },
    });
    expect(result.success).toBe(false);
  });
});
