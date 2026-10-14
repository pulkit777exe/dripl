import { z } from 'zod';

// Shared request/response DTOs already defined in ./schemas.ts — re-exported
// here so the contract module is the single import surface. The wire is
// unchanged; these are the same schemas, not new validation.
export { CreateFileSchema, UpdateFileSchema, FileSchema } from './schemas';
export type { CreateFileInput, UpdateFileInput } from './schemas';

// Base pagination query fields. Shapes mirror the list routes in
// apps/http-server/src/routes/files.ts (listFilesQuerySchema and
// listSharedFilesQuerySchema): identical bounds, defaults, and coercion, so a
// route can adopt this helper without changing its wire behaviour.
const paginatedQueryBase = {
  search: z.string().trim().min(1).max(200).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  cursor: z.string().max(200).optional(),
};

/**
 * Build a pagination query schema, merged with route-specific `extra` fields
 * (e.g. `{ folderId: ... }`). Values arrive as strings from Express
 * `req.query`, hence the coercion on page/limit. No route adopts this yet —
 * adoption without wire change is the follow-up.
 */
export function paginatedQuery<Extra extends z.ZodRawShape>(extra?: Extra) {
  return z.object({ ...paginatedQueryBase, ...extra });
}

/** Parsed output of {@link paginatedQuery} with no extra fields. */
export type PaginatedQuery = z.output<ReturnType<typeof paginatedQuery>>;
/** Unparsed input of {@link paginatedQuery} with no extra fields. */
export type PaginatedQueryInput = z.input<ReturnType<typeof paginatedQuery>>;

/**
 * Uniform pagination envelope for list responses. New endpoints should return
 * this shape.
 *
 * DECISION (documented, not migrated): the existing file/share list endpoints
 * (`GET /files`, `GET /files/shared`) keep their historical `{ files, total,
 * page, limit, nextCursor }` keys — renaming `files` to `items` would churn
 * every caller for no wire benefit. What IS standardized is the shape's
 * stability: `total` and `page` are always populated (the cursor predicate is
 * excluded from the count, so `total` names the whole filtered set), and
 * `nextCursor` is `string | null` (null when the page is not full). `cursor`
 * is the primary forward-paging mechanism; `total`/`page` stay informational
 * for the existing offset UI. The stable shape is pinned by `FileListPage`
 * below and by the files contract tests.
 */
export interface Page<T> {
  items: T[];
  total?: number;
  page?: number;
  limit: number;
  nextCursor?: string;
}

/**
 * The stable list shape the file/share endpoints actually send (inside the
 * `{ data }` success envelope): every key always present, `nextCursor` null
 * when there is no further page. Kept distinct from `Page<T>` on purpose —
 * see the decision above — so a rename of one cannot silently become a rename
 * of the other.
 */
export interface FileListPage<T> {
  files: T[];
  total: number;
  page: number;
  limit: number;
  nextCursor: string | null;
}

/**
 * Stable `error` codes observed on the wire. Covers the KIND_TO_HTTP mapping
 * in apps/http-server/src/lib/serviceResult.ts (NOT_FOUND, FORBIDDEN,
 * CONFLICT, EXPIRED, RATE_LIMITED, INVALID_SCENE, CANNOT_RE_PARENT,
 * FOLDER_HIERARCHY_TOO_DEEP, INVALID_PAYLOAD) plus the literal codes sent
 * inline by routes and middleware. Deliberately excludes the message-shaped
 * `error` values in folders.ts catch blocks ('Failed to ...', 'Invalid ...
 * payload') — those are not stable codes and are left for the envelope
 * follow-up to normalize.
 */
export const ERROR_CODES = [
  'NOT_FOUND',
  'FORBIDDEN',
  'CONFLICT',
  'EXPIRED',
  'RATE_LIMITED',
  'INVALID_SCENE',
  'CANNOT_RE_PARENT',
  'FOLDER_HIERARCHY_TOO_DEEP',
  'INVALID_PAYLOAD',
  'UNAUTHORIZED',
  'INVALID_QUERY',
  'PAYLOAD_TOO_LARGE',
  'INTERNAL_ERROR',
  'FILE_ID_REQUIRED',
  'FOLDER_ID_REQUIRED',
  'INVALID_CREDENTIALS',
  'NEEDS_VERIFICATION',
  'ACCOUNT_LOCKED',
  'TOKEN_REQUIRED',
  'INVALID_GOOGLE_TOKEN',
  'EMAIL_REQUIRED',
  'PASSWORDS_REQUIRED',
  'VERIFICATION_TOKEN_REQUIRED',
  'VALIDATION_ERROR',
  'INVALID_IMAGE_ID',
  'INVALID_CONTENT_TYPE',
  'INVALID_IMAGE',
  'CSRF_TOKEN_MISSING',
  'CSRF_TOKEN_INVALID',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export const ErrorCodeSchema = z.enum(ERROR_CODES);

// Wire shapes below describe JSON over HTTP: dates are ISO strings (server
// Date objects serialize via JSON), matching what the frontend consumes today.
// The wire itself is unchanged — these schemas only name the current shapes.

// FileService.listFiles selects id/name/preview/folderId/createdAt/updatedAt,
// consumed as apps/dripl-app FileSummary.
export const FileSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  preview: z.string().nullable(),
  folderId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type FileSummary = z.infer<typeof FileSummarySchema>;

// FolderService.listFolders returns FolderWithFileCount, consumed as
// apps/dripl-app FolderSummary. (Create/update return FolderRecord without
// fileCount — the list shape is the summary contract.)
export const FolderSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  parentId: z.string().nullable(),
  fileCount: z.number().int().nonnegative(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type FolderSummary = z.infer<typeof FolderSummarySchema>;

// RoomService.listRooms selects id/slug/name/isPublic/createdAt/updatedAt plus
// ownerId, which the frontend list omits — hence optional here so the schema
// accepts the actual wire while staying assignable to the frontend shape.
export const RoomSummarySchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  isPublic: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
  ownerId: z.string().optional(),
});

export type RoomSummary = z.infer<typeof RoomSummarySchema>;
