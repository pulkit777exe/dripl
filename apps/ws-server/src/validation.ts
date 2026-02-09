import { z } from "zod";

const pointSchema = z.object({
  x: z.number(),
  y: z.number(),
});

const elementBaseSchema = z
  .object({
    id: z.string(),
    type: z.string(),
    x: z.number(),
    y: z.number(),
    width: z.number(),
    height: z.number(),
    strokeColor: z.string().optional(),
    backgroundColor: z.string().optional(),
    strokeWidth: z.number().optional(),
    opacity: z.number().optional(),
    isDeleted: z.boolean().optional(),
    roughness: z.number().optional(),
    strokeStyle: z.enum(["solid", "dashed", "dotted"]).optional(),
    fillStyle: z
      .enum([
        "hachure",
        "solid",
        "zigzag",
        "cross-hatch",
        "dots",
        "dashed",
        "zigzag-line",
      ])
      .optional(),
    seed: z.number().optional(),
    angle: z.number().optional(),
    locked: z.boolean().optional(),
    groupId: z.string().optional(),
    zIndex: z.number().optional(),
    rotation: z.number().optional(),
    flipHorizontal: z.number().optional(),
    flipVertical: z.number().optional(),
  })
  .passthrough(); // Allow custom properties

const rectangleElementSchema = elementBaseSchema.extend({
  type: z.literal("rectangle"),
});

const ellipseElementSchema = elementBaseSchema.extend({
  type: z.literal("ellipse"),
});

const diamondElementSchema = elementBaseSchema.extend({
  type: z.literal("diamond"),
});

const linearElementSchema = elementBaseSchema.extend({
  type: z.enum(["arrow", "line"]),
  points: z.array(pointSchema),
  labelId: z.string().optional(),
  arrowHeads: z
    .object({
      start: z.boolean().optional(),
      end: z.boolean().optional(),
    })
    .optional(),
});

const freedrawElementSchema = elementBaseSchema.extend({
  type: z.literal("freedraw"),
  points: z.array(pointSchema),
  brushSize: z.number().optional(),
  pressureValues: z.array(z.number()).optional(),
  widths: z.array(z.number()).optional(),
});

const textElementSchema = elementBaseSchema.extend({
  type: z.literal("text"),
  text: z.string(),
  fontSize: z.number(),
  fontFamily: z.string(),
  textAlign: z.enum(["left", "center", "right"]).optional(),
  verticalAlign: z.enum(["top", "middle", "bottom"]).optional(),
  boundElementId: z.string().optional(),
  containerId: z.string().optional(),
});

const imageElementSchema = elementBaseSchema.extend({
  type: z.literal("image"),
  src: z.string(),
});

const frameElementSchema = elementBaseSchema.extend({
  type: z.literal("frame"),
  title: z.string().optional(),
  padding: z.number().optional(),
});

const driplElementSchema = z.union([
  rectangleElementSchema,
  ellipseElementSchema,
  diamondElementSchema,
  linearElementSchema,
  freedrawElementSchema,
  textElementSchema,
  imageElementSchema,
  frameElementSchema,
]);

export const joinRoomSchema = z.object({
  type: z.literal("join_room"),
  roomId: z.string().min(1).max(100),
  userName: z.string().min(1).max(50).optional(),
});

export const addElementSchema = z.object({
  type: z.literal("add_element"),
  element: driplElementSchema,
});

export const updateElementSchema = z.object({
  type: z.literal("update_element"),
  element: driplElementSchema,
});

export const deleteElementSchema = z.object({
  type: z.literal("delete_element"),
  elementId: z.string(),
});

export const cursorMoveSchema = z.object({
  type: z.literal("cursor_move"),
  x: z.number(),
  y: z.number(),
  userName: z.string().optional(),
});

export const messageSchema = z.discriminatedUnion("type", [
  joinRoomSchema,
  addElementSchema,
  updateElementSchema,
  deleteElementSchema,
  cursorMoveSchema,
  z.object({ type: z.literal("leave_room") }),
]);

export type WsMessage = z.infer<typeof messageSchema>;
