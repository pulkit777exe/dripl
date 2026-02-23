import { z } from "zod";

export const ElementTypeSchema = z.enum([
  "rectangle",
  "ellipse",
  "diamond",
  "arrow",
  "line",
  "freedraw",
  "text",
  "image",
  "frame",
]);

export const BaseElementSchema = z.object({
  id: z.string(),
  type: ElementTypeSchema,
  x: z.number(),
  y: z.number(),
  width: z.number().optional(),
  height: z.number().optional(),
  rotation: z.number().default(0),
  opacity: z.number().min(0).max(1).default(1),
  fill: z.string().optional(),
  stroke: z.string().optional(),
  strokeWidth: z.number().optional(),
});

export const RectangleSchema = BaseElementSchema.extend({
  type: z.literal("rectangle"),
  cornerRadius: z.number().default(0),
});

export const EllipseSchema = BaseElementSchema.extend({
  type: z.literal("ellipse"),
});

export const LinearSchema = BaseElementSchema.extend({
  type: z.literal("arrow").or(z.literal("line")),
  points: z.array(z.array(z.number())), // [[x,y], [x,y]]
  labelId: z.string().optional(),
  arrowHeads: z
    .object({
      start: z.boolean().optional(),
      end: z.boolean().optional(),
    })
    .optional(),
});

export const FreeDrawSchema = BaseElementSchema.extend({
  type: z.literal("freedraw"),
  points: z.array(z.array(z.number())), // [[x,y], [x,y]]
  brushSize: z.number().optional(),
  pressureValues: z.array(z.number()).optional(),
  widths: z.array(z.number()).optional(),
});

export const DiamondSchema = BaseElementSchema.extend({
  type: z.literal("diamond"),
});

export const FrameSchema = BaseElementSchema.extend({
  type: z.literal("frame"),
  title: z.string().optional(),
  padding: z.number().optional(),
});

export const TextSchema = BaseElementSchema.extend({
  type: z.literal("text"),
  text: z.string(),
  fontSize: z.number().default(16),
  fontFamily: z.string().default("Inter"),
  fontWeight: z.string().optional(),
  textAlign: z.enum(["left", "center", "right"]).default("left"),
});

export const ImageSchema = BaseElementSchema.extend({
  type: z.literal("image"),
  src: z.string(), // Base64 or URL
  mimeType: z
    .enum(["image/png", "image/jpeg", "image/gif", "image/webp"])
    .optional(),
});

export const ElementSchema = z.discriminatedUnion("type", [
  RectangleSchema,
  EllipseSchema,
  DiamondSchema,
  LinearSchema,
  FreeDrawSchema,
  TextSchema,
  ImageSchema,
  FrameSchema,
]);

export const CanvasContentSchema = z.array(ElementSchema);

export const CreateFileSchema = z.object({
  name: z.string().min(1, "Name is required"),
  folderId: z.string().optional(),
  teamId: z.string().optional(),
});

export const UpdateFileSchema = z.object({
  name: z.string().optional(),
  content: z.string().optional(), // JSON stringified CanvasContentSchema
  preview: z.string().optional(),
});

export const FileSchema = z.object({
  id: z.string(),
  name: z.string(),
  content: z.string(), // JSON string
  preview: z.string().nullable(),
  folderId: z.string().nullable(),
  teamId: z.string().nullable(),
  userId: z.string().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type ElementType = z.infer<typeof ElementTypeSchema>;
export type CanvasContent = z.infer<typeof CanvasContentSchema>;
export type CreateFileInput = z.infer<typeof CreateFileSchema>;
export type UpdateFileInput = z.infer<typeof UpdateFileSchema>;
