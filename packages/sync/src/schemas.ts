import { z } from "zod";

export const PointSchema = z.object({
  x: z.number(),
  y: z.number(),
});

export const ElementBaseSchema = z.object({
  id: z.string(),
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
  strokeColor: z.string(),
  backgroundColor: z.string(),
  strokeWidth: z.number(),
  opacity: z.number().min(0).max(1),
  isDeleted: z.boolean().optional(),
  roughness: z.number().optional(),
  strokeStyle: z.enum(["solid", "dashed", "dotted"]).optional(),
  fillStyle: z
    .enum(["hachure", "solid", "zigzag", "cross-hatch", "dots", "dashed", "zigzag-line"])
    .optional(),
  seed: z.number().optional(),
  angle: z.number().optional(),
  locked: z.boolean().optional(),
  groupId: z.string().optional(),
});

export const RectangleSchema = ElementBaseSchema.extend({
  type: z.literal("rectangle"),
});

export const EllipseSchema = ElementBaseSchema.extend({
  type: z.literal("ellipse"),
});

export const DiamondSchema = ElementBaseSchema.extend({
  type: z.literal("diamond"),
});

export const LinearSchema = ElementBaseSchema.extend({
  type: z.enum(["arrow", "line"]),
  points: z.array(PointSchema),
});

export const FreeDrawSchema = ElementBaseSchema.extend({
  type: z.literal("freedraw"),
  points: z.array(PointSchema),
});

export const TextSchema = ElementBaseSchema.extend({
  type: z.literal("text"),
  text: z.string(),
  fontSize: z.number(),
  fontFamily: z.string(),
});

export const ImageSchema = ElementBaseSchema.extend({
  type: z.literal("image"),
  src: z.string(),
});

export const DriplElementSchema = z.discriminatedUnion("type", [
  RectangleSchema,
  EllipseSchema,
  DiamondSchema,
  LinearSchema,
  FreeDrawSchema,
  TextSchema,
  ImageSchema,
]);

export const JoinRoomMessageSchema = z.object({
  type: z.literal("join_room"),
  roomId: z.string(),
  userName: z.string().optional(),
});

export const LeaveRoomMessageSchema = z.object({
  type: z.literal("leave_room"),
});

export const AddElementMessageSchema = z.object({
  type: z.literal("add_element"),
  element: DriplElementSchema,
  timestamp: z.number(),
});

export const UpdateElementMessageSchema = z.object({
  type: z.literal("update_element"),
  element: DriplElementSchema,
  timestamp: z.number(),
});

export const DeleteElementMessageSchema = z.object({
  type: z.literal("delete_element"),
  elementId: z.string(),
  timestamp: z.number(),
});

export const CursorMoveMessageSchema = z.object({
  type: z.literal("cursor_move"),
  x: z.number(),
  y: z.number(),
});

export const SyncRequestMessageSchema = z.object({
  type: z.literal("sync_request"),
});

export const PingMessageSchema = z.object({
  type: z.literal("ping"),
});

export const PongMessageSchema = z.object({
  type: z.literal("pong"),
});

export const ElementLockMessageSchema = z.object({
  type: z.literal("element_lock"),
  elementId: z.string(),
});

export const ElementUnlockMessageSchema = z.object({
  type: z.literal("element_unlock"),
  elementId: z.string(),
});

export const ClientMessageSchema = z.discriminatedUnion("type", [
  JoinRoomMessageSchema,
  LeaveRoomMessageSchema,
  AddElementMessageSchema,
  UpdateElementMessageSchema,
  DeleteElementMessageSchema,
  CursorMoveMessageSchema,
  SyncRequestMessageSchema,
  PingMessageSchema,
  ElementLockMessageSchema,
  ElementUnlockMessageSchema,
]);

export const SyncRoomStateSchema = z.object({
  type: z.literal("sync_room_state"),
  roomId: z.string(),
  elements: z.array(DriplElementSchema),
  users: z.array(
    z.object({
      userId: z.string(),
      userName: z.string(),
      color: z.string(),
    }),
  ),
  cursors: z.array(
    z.object({
      userId: z.string(),
      x: z.number(),
      y: z.number(),
    }),
  ),
  yourUserId: z.string(),
  timestamp: z.number(),
});

export const UserJoinSchema = z.object({
  type: z.literal("user_join"),
  userId: z.string(),
  userName: z.string(),
  color: z.string(),
  timestamp: z.number(),
});

export const UserLeaveSchema = z.object({
  type: z.literal("user_leave"),
  userId: z.string(),
  timestamp: z.number(),
});

export const ErrorMessageSchema = z.object({
  type: z.literal("error"),
  message: z.string(),
  code: z.string().optional(),
});

export function parseClientMessage(data: unknown) {
  const result = ClientMessageSchema.safeParse(data);
  if (result.success) {
    return result.data;
  }
  console.error("Invalid client message:", result.error.issues);
  return null;
}

export type DriplElement = z.infer<typeof DriplElementSchema>;
export type ClientMessage = z.infer<typeof ClientMessageSchema>;
export type SyncRoomState = z.infer<typeof SyncRoomStateSchema>;
