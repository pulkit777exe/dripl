/**
 * Unit tests for @dripl/sync message validation
 */

import { describe, it, expect } from "vitest";
import {
  parseClientMessage,
  JoinRoomMessageSchema,
  AddElementMessageSchema,
  CursorMoveMessageSchema,
} from "../schemas";

describe("sync schemas", () => {
  describe("JoinRoomMessageSchema", () => {
    it("should validate valid join message", () => {
      const message = {
        type: "join_room",
        roomId: "test-room",
        userName: "User1",
      };
      const result = JoinRoomMessageSchema.safeParse(message);
      expect(result.success).toBe(true);
    });

    it("should accept join without userName", () => {
      const message = { type: "join_room", roomId: "test-room" };
      const result = JoinRoomMessageSchema.safeParse(message);
      expect(result.success).toBe(true);
    });

    it("should reject join without roomId", () => {
      const message = { type: "join_room" };
      const result = JoinRoomMessageSchema.safeParse(message);
      expect(result.success).toBe(false);
    });
  });

  describe("AddElementMessageSchema", () => {
    it("should validate rectangle element", () => {
      const message = {
        type: "add_element",
        timestamp: Date.now(),
        element: {
          id: "elem-1",
          type: "rectangle",
          x: 100,
          y: 100,
          width: 200,
          height: 150,
          strokeColor: "#000000",
          backgroundColor: "#ffffff",
          strokeWidth: 2,
          opacity: 1,
        },
      };
      const result = AddElementMessageSchema.safeParse(message);
      expect(result.success).toBe(true);
    });

    it("should validate diamond element", () => {
      const message = {
        type: "add_element",
        timestamp: Date.now(),
        element: {
          id: "elem-2",
          type: "diamond",
          x: 50,
          y: 50,
          width: 100,
          height: 100,
          strokeColor: "#ff0000",
          backgroundColor: "transparent",
          strokeWidth: 2,
          opacity: 0.8,
        },
      };
      const result = AddElementMessageSchema.safeParse(message);
      expect(result.success).toBe(true);
    });

    it("should validate freedraw element with points", () => {
      const message = {
        type: "add_element",
        timestamp: Date.now(),
        element: {
          id: "elem-3",
          type: "freedraw",
          x: 0,
          y: 0,
          width: 500,
          height: 300,
          strokeColor: "#0000ff",
          backgroundColor: "transparent",
          strokeWidth: 3,
          opacity: 1,
          points: [
            { x: 0, y: 0 },
            { x: 50, y: 100 },
            { x: 100, y: 50 },
          ],
        },
      };
      const result = AddElementMessageSchema.safeParse(message);
      expect(result.success).toBe(true);
    });
  });

  describe("CursorMoveMessageSchema", () => {
    it("should validate cursor move", () => {
      const message = { type: "cursor_move", x: 123.5, y: 456.7 };
      const result = CursorMoveMessageSchema.safeParse(message);
      expect(result.success).toBe(true);
    });
  });

  describe("parseClientMessage", () => {
    it("should parse valid message", () => {
      const message = { type: "ping" };
      const result = parseClientMessage(message);
      expect(result).toEqual(message);
    });

    it("should return null for invalid message", () => {
      const message = { type: "unknown_type" };
      const result = parseClientMessage(message);
      expect(result).toBeNull();
    });
  });
});
