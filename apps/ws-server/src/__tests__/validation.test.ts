import { describe, it, expect } from "vitest";
import { messageSchema } from "../validation";

describe("WebSocket Message Validation", () => {
  describe("join_room", () => {
    it("should validate a valid join_room message", () => {
      const result = messageSchema.safeParse({
        type: "join_room",
        roomId: "abc123",
        userName: "TestUser",
      });
      expect(result.success).toBe(true);
    });

    it("should validate join_room without userName", () => {
      const result = messageSchema.safeParse({
        type: "join_room",
        roomId: "abc123",
      });
      expect(result.success).toBe(true);
    });

    it("should reject join_room with empty roomId", () => {
      const result = messageSchema.safeParse({
        type: "join_room",
        roomId: "",
      });
      expect(result.success).toBe(false);
    });

    it("should reject join_room with roomId > 100 chars", () => {
      const result = messageSchema.safeParse({
        type: "join_room",
        roomId: "a".repeat(101),
      });
      expect(result.success).toBe(false);
    });
  });

  describe("add_element", () => {
    it("should validate a valid rectangle element", () => {
      const result = messageSchema.safeParse({
        type: "add_element",
        element: {
          id: "el-1",
          type: "rectangle",
          x: 100,
          y: 100,
          width: 200,
          height: 150,
        },
      });
      expect(result.success).toBe(true);
    });

    it("should validate a valid ellipse element", () => {
      const result = messageSchema.safeParse({
        type: "add_element",
        element: {
          id: "el-2",
          type: "ellipse",
          x: 0,
          y: 0,
          width: 100,
          height: 100,
        },
      });
      expect(result.success).toBe(true);
    });

    it("should validate a valid arrow element", () => {
      const result = messageSchema.safeParse({
        type: "add_element",
        element: {
          id: "el-3",
          type: "arrow",
          x: 0,
          y: 0,
          width: 200,
          height: 100,
          points: [
            { x: 0, y: 0 },
            { x: 200, y: 100 },
          ],
        },
      });
      expect(result.success).toBe(true);
    });

    it("should validate a valid text element", () => {
      const result = messageSchema.safeParse({
        type: "add_element",
        element: {
          id: "el-4",
          type: "text",
          x: 50,
          y: 50,
          width: 100,
          height: 30,
          text: "Hello",
          fontSize: 16,
          fontFamily: "sans-serif",
        },
      });
      expect(result.success).toBe(true);
    });

    it("should reject element with missing type", () => {
      const result = messageSchema.safeParse({
        type: "add_element",
        element: {
          id: "el-5",
          x: 0,
          y: 0,
          width: 100,
          height: 100,
        },
      });
      expect(result.success).toBe(false);
    });

    it("should reject element with invalid type", () => {
      const result = messageSchema.safeParse({
        type: "add_element",
        element: {
          id: "el-6",
          type: "invalid_shape",
          x: 0,
          y: 0,
          width: 100,
          height: 100,
        },
      });
      expect(result.success).toBe(false);
    });
  });

  describe("update_element", () => {
    it("should validate a valid update_element message", () => {
      const result = messageSchema.safeParse({
        type: "update_element",
        element: {
          id: "el-1",
          type: "rectangle",
          x: 150,
          y: 200,
          width: 250,
          height: 180,
        },
      });
      expect(result.success).toBe(true);
    });
  });

  describe("delete_element", () => {
    it("should validate a valid delete_element message", () => {
      const result = messageSchema.safeParse({
        type: "delete_element",
        elementId: "el-1",
      });
      expect(result.success).toBe(true);
    });

    it("should reject delete_element with missing elementId", () => {
      const result = messageSchema.safeParse({
        type: "delete_element",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("cursor_move", () => {
    it("should validate a valid cursor_move message", () => {
      const result = messageSchema.safeParse({
        type: "cursor_move",
        x: 500,
        y: 300,
        userName: "TestUser",
        color: "#FF6B6B",
      });
      expect(result.success).toBe(true);
    });

    it("should validate cursor_move without optional fields", () => {
      const result = messageSchema.safeParse({
        type: "cursor_move",
        x: 0,
        y: 0,
      });
      expect(result.success).toBe(true);
    });

    it("should reject cursor_move with non-numeric coordinates", () => {
      const result = messageSchema.safeParse({
        type: "cursor_move",
        x: "not a number",
        y: 0,
      });
      expect(result.success).toBe(false);
    });
  });

  describe("leave_room", () => {
    it("should validate a valid leave_room message", () => {
      const result = messageSchema.safeParse({
        type: "leave_room",
      });
      expect(result.success).toBe(true);
    });
  });

  describe("unknown message types", () => {
    it("should reject unknown message types", () => {
      const result = messageSchema.safeParse({
        type: "unknown_type",
        data: "test",
      });
      expect(result.success).toBe(false);
    });
  });
});
