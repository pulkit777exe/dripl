import { describe, it, expect, beforeEach } from 'vitest';
import {
  messageSchema,
  addElementSchema,
  updateElementSchema,
  deleteElementSchema,
  cursorMoveSchema,
} from '../validation';

describe('WebSocket Integration', () => {
  describe('Element Processing', () => {
    const validRectangle = {
      id: 'el-1',
      type: 'rectangle' as const,
      x: 100,
      y: 100,
      width: 200,
      height: 150,
    };

    const validEllipse = {
      id: 'el-2',
      type: 'ellipse' as const,
      x: 0,
      y: 0,
      width: 100,
      height: 100,
    };

    describe('add_element', () => {
      it('should validate adding a rectangle element', () => {
        const result = messageSchema.safeParse({
          type: 'add_element',
          element: validRectangle,
        });
        expect(result.success).toBe(true);
      });

      it('should validate adding multiple element types', () => {
        const rectangle = messageSchema.safeParse({
          type: 'add_element',
          element: {
            id: 'el-rect',
            type: 'rectangle',
            x: 0,
            y: 0,
            width: 100,
            height: 100,
          },
        });
        expect(rectangle.success).toBe(true);

        const ellipse = messageSchema.safeParse({
          type: 'add_element',
          element: {
            id: 'el-ellipse',
            type: 'ellipse',
            x: 0,
            y: 0,
            width: 100,
            height: 100,
          },
        });
        expect(ellipse.success).toBe(true);

        const text = messageSchema.safeParse({
          type: 'add_element',
          element: {
            id: 'el-text',
            type: 'text',
            x: 0,
            y: 0,
            width: 100,
            height: 30,
            text: 'Hello',
            fontSize: 16,
            fontFamily: 'sans-serif',
          },
        });
        expect(text.success).toBe(true);

        const freedraw = messageSchema.safeParse({
          type: 'add_element',
          element: {
            id: 'el-freedraw',
            type: 'freedraw',
            x: 0,
            y: 0,
            width: 100,
            height: 100,
            points: [
              { x: 0, y: 0 },
              { x: 50, y: 50 },
              { x: 100, y: 100 },
            ],
          },
        });
        expect(freedraw.success).toBe(true);
      });

      it('should reject element with negative dimensions', () => {
        const result = messageSchema.safeParse({
          type: 'add_element',
          element: {
            ...validRectangle,
            width: -100,
          },
        });
        expect(result.success).toBe(false);
      });

      it('should reject element with excessive dimensions', () => {
        const result = messageSchema.safeParse({
          type: 'add_element',
          element: {
            ...validRectangle,
            width: 100000,
          },
        });
        expect(result.success).toBe(false);
      });

      it('should validate text element with required fields', () => {
        const result = messageSchema.safeParse({
          type: 'add_element',
          element: {
            id: 'el-text',
            type: 'text',
            x: 50,
            y: 50,
            width: 100,
            height: 30,
            text: 'Test',
            fontSize: 16,
            fontFamily: 'sans-serif',
          },
        });
        expect(result.success).toBe(true);
      });
    });

    describe('update_element', () => {
      it('should validate updating an existing element', () => {
        const result = messageSchema.safeParse({
          type: 'update_element',
          element: {
            ...validRectangle,
            width: 300,
            height: 200,
          },
        });
        expect(result.success).toBe(true);
      });

      it('should allow updating element position', () => {
        const result = messageSchema.safeParse({
          type: 'update_element',
          element: {
            ...validRectangle,
            x: 500,
            y: 600,
          },
        });
        expect(result.success).toBe(true);
      });

      it('should allow updating element styling', () => {
        const result = messageSchema.safeParse({
          type: 'update_element',
          element: {
            ...validRectangle,
            strokeColor: '#FF0000',
            backgroundColor: '#00FF00',
            strokeWidth: 2,
          },
        });
        expect(result.success).toBe(true);
      });
    });

    describe('delete_element', () => {
      it('should validate deleting an element', () => {
        const result = messageSchema.safeParse({
          type: 'delete_element',
          elementId: 'el-1',
        });
        expect(result.success).toBe(true);
      });

      it('should reject delete without elementId', () => {
        const result = messageSchema.safeParse({
          type: 'delete_element',
        });
        expect(result.success).toBe(false);
      });
    });

    describe('element-update batch', () => {
      it('should validate batch element updates', () => {
        const result = messageSchema.safeParse({
          type: 'element-update',
          elements: [validRectangle, validEllipse],
        });
        expect(result.success).toBe(true);
      });

      it('should validate single element update in batch format', () => {
        const result = messageSchema.safeParse({
          type: 'element-update',
          element: validRectangle,
        });
        expect(result.success).toBe(true);
      });
    });
  });

  describe('Cursor Processing', () => {
    describe('cursor_move', () => {
      it('should validate cursor move with all fields', () => {
        const result = messageSchema.safeParse({
          type: 'cursor_move',
          x: 100,
          y: 200,
          userName: 'TestUser',
          color: '#FF6B6B',
        });
        expect(result.success).toBe(true);
      });

      it('should validate cursor move with minimal fields', () => {
        const result = messageSchema.safeParse({
          type: 'cursor_move',
          x: 0,
          y: 0,
        });
        expect(result.success).toBe(true);
      });

      it('should validate negative coordinates', () => {
        const result = messageSchema.safeParse({
          type: 'cursor_move',
          x: -100,
          y: -200,
        });
        expect(result.success).toBe(true);
      });

      it('should validate large coordinates', () => {
        const result = messageSchema.safeParse({
          type: 'cursor_move',
          x: 50000,
          y: 50000,
        });
        expect(result.success).toBe(true);
      });
    });
  });

  describe('Room Management', () => {
    describe('join_room', () => {
      it('should validate room join with userName', () => {
        const result = messageSchema.safeParse({
          type: 'join_room',
          roomId: 'test-room',
          userName: 'TestUser',
        });
        expect(result.success).toBe(true);
      });

      it('should validate room join without optional fields', () => {
        const result = messageSchema.safeParse({
          type: 'join_room',
          roomId: 'test-room',
        });
        expect(result.success).toBe(true);
      });
    });

    describe('leave_room', () => {
      it('should validate leave room message', () => {
        const result = messageSchema.safeParse({
          type: 'leave_room',
        });
        expect(result.success).toBe(true);
      });
    });

    describe('ping', () => {
      it('should validate ping message', () => {
        const result = messageSchema.safeParse({
          type: 'ping',
        });
        expect(result.success).toBe(true);
      });
    });
  });

  describe('Boundary Conditions', () => {
    it('should handle maximum roomId length', () => {
      const result = messageSchema.safeParse({
        type: 'join_room',
        roomId: 'a'.repeat(100),
      });
      expect(result.success).toBe(true);
    });

    it('should reject roomId exceeding maximum', () => {
      const result = messageSchema.safeParse({
        type: 'join_room',
        roomId: 'a'.repeat(101),
      });
      expect(result.success).toBe(false);
    });

    it('should handle element at coordinate boundaries', () => {
      const result = messageSchema.safeParse({
        type: 'add_element',
        element: {
          id: 'el-boundary',
          type: 'rectangle',
          x: -100000,
          y: -100000,
          width: 50000,
          height: 50000,
        },
      });
      expect(result.success).toBe(true);
    });

    it('should reject element outside coordinate boundaries', () => {
      const result = messageSchema.safeParse({
        type: 'add_element',
        element: {
          id: 'el-outside',
          type: 'rectangle',
          x: -200000,
          y: -200000,
          width: 100,
          height: 100,
        },
      });
      expect(result.success).toBe(false);
    });

    it('should handle very long text element', () => {
      const longText = 'a'.repeat(10000);
      const result = messageSchema.safeParse({
        type: 'add_element',
        element: {
          id: 'el-long-text',
          type: 'text',
          x: 0,
          y: 0,
          width: 500,
          height: 30,
          text: longText,
          fontSize: 16,
          fontFamily: 'sans-serif',
        },
      });
      expect(result.success).toBe(true);
    });

    it('should reject text exceeding max length', () => {
      const tooLongText = 'a'.repeat(10001);
      const result = messageSchema.safeParse({
        type: 'add_element',
        element: {
          id: 'el-too-long',
          type: 'text',
          x: 0,
          y: 0,
          width: 500,
          height: 30,
          text: tooLongText,
          fontSize: 16,
          fontFamily: 'sans-serif',
        },
      });
      expect(result.success).toBe(false);
    });
  });
});
