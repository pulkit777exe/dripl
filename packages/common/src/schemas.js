import { z } from "zod";
// --- Element Schemas ---
export const ElementTypeSchema = z.enum([
    "rectangle",
    "circle",
    "path",
    "text",
    "image",
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
export const CircleSchema = BaseElementSchema.extend({
    type: z.literal("circle"),
    radius: z.number().optional(), // Can use width/height or radius
});
export const PathSchema = BaseElementSchema.extend({
    type: z.literal("path"),
    points: z.array(z.array(z.number())), // [[x,y], [x,y]]
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
    CircleSchema,
    PathSchema,
    TextSchema,
    ImageSchema,
]);
export const CanvasContentSchema = z.array(ElementSchema);
// --- File/Canvas Schemas ---
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
//# sourceMappingURL=schemas.js.map