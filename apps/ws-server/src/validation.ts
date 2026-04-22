import { z } from 'zod';

const pointSchema = z.object({
  x: z.number(),
  y: z.number(),
});

const elementBaseSchema = z
  .object({
    id: z.string().min(1).max(100),
    type: z.string(),
    x: z.number().min(-100000).max(100000),
    y: z.number().min(-100000).max(100000),
    width: z.number().min(0).max(50000),
    height: z.number().min(0).max(50000),
    strokeColor: z.string().optional(),
    backgroundColor: z.string().optional(),
    strokeWidth: z.number().min(0).max(100).optional(),
    opacity: z.number().min(0).max(1).optional(),
    isDeleted: z.boolean().optional(),
    roughness: z.number().min(0).max(10).optional(),
    strokeStyle: z.enum(['solid', 'dashed', 'dotted']).optional(),
    fillStyle: z
      .enum(['hachure', 'solid', 'zigzag', 'cross-hatch', 'dots', 'dashed', 'zigzag-line'])
      .optional(),
    seed: z.number().optional(),
    angle: z.number().min(-360).max(360).optional(),
    locked: z.boolean().optional(),
    groupId: z.string().optional(),
    zIndex: z.number().optional(),
    rotation: z.number().min(-360).max(360).optional(),
    flipHorizontal: z.number().optional(),
    flipVertical: z.number().optional(),
  })
  .passthrough(); // Allow custom properties

const rectangleElementSchema = elementBaseSchema.extend({
  type: z.literal('rectangle'),
});

const ellipseElementSchema = elementBaseSchema.extend({
  type: z.literal('ellipse'),
});

const diamondElementSchema = elementBaseSchema.extend({
  type: z.literal('diamond'),
});

const linearElementSchema = elementBaseSchema.extend({
  type: z.enum(['arrow', 'line']),
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
  type: z.literal('freedraw'),
  points: z.array(pointSchema),
  brushSize: z.number().optional(),
  pressureValues: z.array(z.number()).optional(),
  widths: z.array(z.number()).optional(),
});

const textElementSchema = elementBaseSchema.extend({
  type: z.literal('text'),
  text: z.string().max(10000),
  fontSize: z.number().min(1).max(500),
  fontFamily: z.string().max(100),
  textAlign: z.enum(['left', 'center', 'right']).optional(),
  verticalAlign: z.enum(['top', 'middle', 'bottom']).optional(),
  boundElementId: z.string().optional(),
  containerId: z.string().optional(),
});

const imageElementSchema = elementBaseSchema.extend({
  type: z.literal('image'),
  src: z.string(),
});

const frameElementSchema = elementBaseSchema.extend({
  type: z.literal('frame'),
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
  type: z.literal('join_room'),
  roomId: z.string().min(1).max(100),
  userName: z.string().min(1).max(50).optional(),
});

export const joinSchema = z.object({
  type: z.literal('join'),
  roomId: z.string().min(1).max(100),
  userId: z.string().optional(),
  displayName: z.string().min(1).max(50).optional(),
  color: z.string().optional(),
});

export const addElementSchema = z.object({
  type: z.literal('add_element'),
  element: driplElementSchema,
});

export const updateElementSchema = z.object({
  type: z.literal('update_element'),
  element: driplElementSchema,
});

export const deleteElementSchema = z.object({
  type: z.literal('delete_element'),
  elementId: z.string(),
});

export const cursorMoveSchema = z.object({
  type: z.literal('cursor_move'),
  x: z.number(),
  y: z.number(),
  userName: z.string().optional(),
  color: z.string().optional(),
});

export const cursorMoveKebabSchema = z.object({
  type: z.literal('cursor-move'),
  x: z.number(),
  y: z.number(),
  userName: z.string().optional(),
  displayName: z.string().optional(),
  color: z.string().optional(),
});

export const elementUpdateSchema = z.object({
  type: z.literal('element-update'),
  elements: z.array(driplElementSchema).optional(),
  element: driplElementSchema.optional(),
});

export const sceneUpdateSchema = z.object({
  type: z.literal('scene-update'),
  subtype: z.enum(['init', 'update']),
  elements: z.array(driplElementSchema),
});

export const messageSchema = z.discriminatedUnion('type', [
  joinRoomSchema,
  joinSchema,
  addElementSchema,
  updateElementSchema,
  deleteElementSchema,
  cursorMoveSchema,
  cursorMoveKebabSchema,
  elementUpdateSchema,
  sceneUpdateSchema,
  z.object({ type: z.literal('leave_room') }),
  z.object({ type: z.literal('leave') }),
  z.object({ type: z.literal('ping') }),
]);

export type WsMessage = z.infer<typeof messageSchema>;
