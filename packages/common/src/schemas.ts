import { z } from 'zod';

export const PointSchema = z.object({
  x: z.number(),
  y: z.number(),
});

export const TextAlignSchema = z.enum(['left', 'center', 'right']);

export const ElementTypeSchema = z.enum([
  'rectangle',
  'ellipse',
  'path',
  'text',
  'image',
  'line',
  'arrow',
  // Legacy types kept for backwards compatibility
  'diamond',
  'freedraw',
  'frame',
]);

export const BaseElementSchema = z.object({
  id: z.string().uuid(),
  type: ElementTypeSchema,
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
  angle: z.number().default(0),
  strokeColor: z.string().default('#000000'),
  fillColor: z.string().default('transparent'),
  backgroundColor: z.string().default('transparent'),
  strokeWidth: z.number().default(2),
  opacity: z.number().min(0).max(1).default(1),
  roughness: z.number().min(0).max(2).default(1),
  locked: z.boolean().default(false),
  createdAt: z.number().default(() => Date.now()),
  updatedAt: z.number().default(() => Date.now()),

  // Existing fields preserved
  isDeleted: z.boolean().optional(),
  version: z.number().optional(),
  versionNonce: z.number().optional(),
  updated: z.number().optional(),
  strokeStyle: z.enum(['solid', 'dashed', 'dotted']).optional(),
  fillStyle: z
    .enum(['hachure', 'solid', 'zigzag', 'cross-hatch', 'dots', 'dashed', 'zigzag-line'])
    .optional(),
  seed: z.number().optional(),
  groupId: z.string().optional(),
  zIndex: z.number().optional(),
});

export const RectangleElementSchema = BaseElementSchema.extend({
  type: z.literal('rectangle'),
});

export const EllipseElementSchema = BaseElementSchema.extend({
  type: z.literal('ellipse'),
});

export const PathElementSchema = BaseElementSchema.extend({
  type: z.literal('path'),
  points: z.array(PointSchema).min(1),
});

export const LineElementSchema = BaseElementSchema.extend({
  type: z.literal('line'),
  points: z.array(PointSchema).min(2),
});

export const ArrowElementSchema = BaseElementSchema.extend({
  type: z.literal('arrow'),
  points: z.array(PointSchema).min(2),
});

export const TextElementSchema = BaseElementSchema.extend({
  type: z.literal('text'),
  text: z.string(),
  fontSize: z.number().default(20),
  fontFamily: z.string().default('Caveat'),
  textAlign: TextAlignSchema.default('left'),
});

export const ImageElementSchema = BaseElementSchema.extend({
  type: z.literal('image'),
  dataUrl: z.string().optional(),
  src: z.string().optional(),
  naturalWidth: z.number().optional(),
  naturalHeight: z.number().optional(),
});

const DiamondElementSchema = BaseElementSchema.extend({
  type: z.literal('diamond'),
});

const FreeDrawElementSchema = BaseElementSchema.extend({
  type: z.literal('freedraw'),
  points: z.array(PointSchema).min(1),
});

const FrameElementSchema = BaseElementSchema.extend({
  type: z.literal('frame'),
  title: z.string().optional(),
  padding: z.number().optional(),
});

export const DriplElementSchema = z.discriminatedUnion('type', [
  RectangleElementSchema,
  EllipseElementSchema,
  PathElementSchema,
  TextElementSchema,
  ImageElementSchema,
  LineElementSchema,
  ArrowElementSchema,
  DiamondElementSchema,
  FreeDrawElementSchema,
  FrameElementSchema,
]);

export const ElementSchema = DriplElementSchema;
export const CanvasContentSchema = z.array(DriplElementSchema);

export const CreateFileSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  folderId: z.string().optional(),
  teamId: z.string().optional(),
});

export const UpdateFileSchema = z.object({
  name: z.string().optional(),
  content: z.string().optional(),
  preview: z.string().optional(),
});

export const FileSchema = z.object({
  id: z.string(),
  name: z.string(),
  content: z.string(),
  preview: z.string().nullable(),
  shareToken: z.string().nullable().optional(),
  sharePermission: z.enum(['view', 'edit']).nullable().optional(),
  shareExpiresAt: z.date().nullable().optional(),
  folderId: z.string().nullable(),
  teamId: z.string().nullable(),
  userId: z.string().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type DriplElementSchemaType = z.infer<typeof DriplElementSchema>;
export type ElementType = z.infer<typeof ElementTypeSchema>;
export type CanvasContent = z.infer<typeof CanvasContentSchema>;
export type CreateFileInput = z.infer<typeof CreateFileSchema>;
export type UpdateFileInput = z.infer<typeof UpdateFileSchema>;
