"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FileSchema = exports.UpdateFileSchema = exports.CreateFileSchema = exports.CanvasContentSchema = exports.ElementSchema = exports.ImageSchema = exports.TextSchema = exports.PathSchema = exports.CircleSchema = exports.RectangleSchema = exports.BaseElementSchema = exports.ElementTypeSchema = void 0;
const zod_1 = require("zod");
// --- Element Schemas ---
exports.ElementTypeSchema = zod_1.z.enum([
    "rectangle",
    "circle",
    "path",
    "text",
    "image",
]);
exports.BaseElementSchema = zod_1.z.object({
    id: zod_1.z.string(),
    type: exports.ElementTypeSchema,
    x: zod_1.z.number(),
    y: zod_1.z.number(),
    width: zod_1.z.number().optional(),
    height: zod_1.z.number().optional(),
    rotation: zod_1.z.number().default(0),
    opacity: zod_1.z.number().min(0).max(1).default(1),
    fill: zod_1.z.string().optional(),
    stroke: zod_1.z.string().optional(),
    strokeWidth: zod_1.z.number().optional(),
});
exports.RectangleSchema = exports.BaseElementSchema.extend({
    type: zod_1.z.literal("rectangle"),
    cornerRadius: zod_1.z.number().default(0),
});
exports.CircleSchema = exports.BaseElementSchema.extend({
    type: zod_1.z.literal("circle"),
    radius: zod_1.z.number().optional(), // Can use width/height or radius
});
exports.PathSchema = exports.BaseElementSchema.extend({
    type: zod_1.z.literal("path"),
    points: zod_1.z.array(zod_1.z.array(zod_1.z.number())), // [[x,y], [x,y]]
});
exports.TextSchema = exports.BaseElementSchema.extend({
    type: zod_1.z.literal("text"),
    text: zod_1.z.string(),
    fontSize: zod_1.z.number().default(16),
    fontFamily: zod_1.z.string().default("Inter"),
    fontWeight: zod_1.z.string().optional(),
    textAlign: zod_1.z.enum(["left", "center", "right"]).default("left"),
});
exports.ImageSchema = exports.BaseElementSchema.extend({
    type: zod_1.z.literal("image"),
    src: zod_1.z.string(), // Base64 or URL
    mimeType: zod_1.z.enum(["image/png", "image/jpeg", "image/gif", "image/webp"]).optional(),
});
exports.ElementSchema = zod_1.z.discriminatedUnion("type", [
    exports.RectangleSchema,
    exports.CircleSchema,
    exports.PathSchema,
    exports.TextSchema,
    exports.ImageSchema,
]);
exports.CanvasContentSchema = zod_1.z.array(exports.ElementSchema);
// --- File/Canvas Schemas ---
exports.CreateFileSchema = zod_1.z.object({
    name: zod_1.z.string().min(1, "Name is required"),
    folderId: zod_1.z.string().optional(),
    teamId: zod_1.z.string().optional(),
});
exports.UpdateFileSchema = zod_1.z.object({
    name: zod_1.z.string().optional(),
    content: zod_1.z.string().optional(), // JSON stringified CanvasContentSchema
    preview: zod_1.z.string().optional(),
});
exports.FileSchema = zod_1.z.object({
    id: zod_1.z.string(),
    name: zod_1.z.string(),
    content: zod_1.z.string(), // JSON string
    preview: zod_1.z.string().nullable(),
    folderId: zod_1.z.string().nullable(),
    teamId: zod_1.z.string().nullable(),
    userId: zod_1.z.string().nullable(),
    createdAt: zod_1.z.date(),
    updatedAt: zod_1.z.date(),
});
