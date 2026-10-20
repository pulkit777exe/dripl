import { randomBytes } from 'node:crypto';
import { db } from '@dripl/db';
import { isValidSceneContent, isValidSceneString } from '../lib/sceneValidation';
import {
  buildEncryptedShare,
  parseStoredFileContent,
  serializeStoredFileContent,
} from '../lib/encrypt';
import { resolveShareExpiry } from '../lib/shareExpiry';

export const FREE_PLAN_FILE_LIMIT = 3;

/**
 * The scene's single serialization per save. Routes measure this exact string
 * for the 413 guard and hand it down, so validation and parsing reuse it
 * instead of each serializing the object again. Non-string input (legacy
 * callers, tests) serializes here — verdicts match the object path (see
 * createFile).
 */
function toContentString(content: unknown): string {
  return typeof content === 'string' ? content : JSON.stringify(content);
}

export type CreateFileResult =
  | { file: { id: string; name: string } }
  | { kind: 'quota_exceeded'; limit: number }
  | { kind: 'folder_not_found' }
  | { kind: 'invalid_scene' };

export type UpdateFileResult =
  | { file: Record<string, unknown> }
  | { kind: 'folder_not_found' }
  | { kind: 'invalid_scene' }
  | { kind: 'conflict' }
  | null;

export type CreateShareResult =
  | { token: string; permission: string; expiresAt: Date; shareUrl: string }
  | { kind: 'invalid_scene' }
  | { kind: 'conflict' }
  | null;

export interface ListFilesOptions {
  userId: string;
  search?: string;
  folderId?: string;
  limit: number;
  page?: number;
  cursor?: string;
}

interface SharedFileRecord {
  createdAt: Date;
  file: {
    id: string;
    name: string;
    preview: string | null;
    createdAt: Date;
    updatedAt: Date;
    userId: string | null;
    user: { id: string; name: string | null; email: string | null; image: string | null } | null;
  };
}

export interface CreateFileOptions {
  userId: string;
  name?: string;
  folderId?: string | null;
  content?: unknown;
  preview?: string | null;
}

export interface UpdateFileOptions {
  userId: string;
  fileId: string;
  name?: string;
  content?: unknown;
  preview?: string | null;
  folderId?: string | null;
  expectedUpdatedAt?: Date;
}

export interface CreateShareOptions {
  userId: string;
  fileId: string;
  permission: 'view' | 'edit';
  expiresAt?: Date;
  expiresInHours?: number;
}

export interface ListSharedFilesOptions {
  userId: string;
  search?: string;
  limit: number;
  page?: number;
  cursor?: string;
}

export class FileService {
  static async ensureFolderOwnership(
    userId: string,
    folderId: string | null | undefined
  ): Promise<boolean> {
    if (!folderId) return true;
    const folder = await db.folder.findFirst({
      where: { id: folderId, userId },
      select: { id: true },
    });
    return Boolean(folder);
  }

  static async listFiles(options: ListFilesOptions) {
    const { userId, search, folderId, limit, page = 1, cursor } = options;
    const isCursorBased = typeof cursor === 'string' && cursor.length > 0;
    const skip = isCursorBased ? 0 : Math.max(0, (page - 1) * limit);

    const where = {
      userId,
      ...(typeof folderId === 'string' ? { folderId } : {}),
      ...(typeof search === 'string'
        ? { name: { contains: search, mode: 'insensitive' as const } }
        : {}),
      ...(isCursorBased ? { updatedAt: { lt: new Date(cursor) } } : {}),
    };

    // `total` is always counted, even in cursor mode: the list wire shape is
    // stable (`{ files, total, page, limit, nextCursor }` — no keys drop out),
    // and `cursor` is the primary forward-paging mechanism while `total`/`page`
    // stay informational for the existing offset UI. The count ignores the
    // cursor predicate, so it names the whole filtered set, not the page.
    const countWhere = {
      userId,
      ...(typeof folderId === 'string' ? { folderId } : {}),
      ...(typeof search === 'string'
        ? { name: { contains: search, mode: 'insensitive' as const } }
        : {}),
    };

    const [files, total] = await Promise.all([
      db.file.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip,
        take: limit,
        select: {
          id: true,
          name: true,
          preview: true,
          folderId: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      db.file.count({ where: countWhere }),
    ]);

    const nextCursor =
      files.length === limit ? (files[files.length - 1]?.updatedAt?.toISOString() ?? null) : null;

    return { files, total, nextCursor, isCursorBased };
  }

  static async listSharedFiles(options: ListSharedFilesOptions) {
    const { userId, search, limit, page = 1, cursor } = options;
    const isCursorBased = typeof cursor === 'string' && cursor.length > 0;
    const skip = isCursorBased ? 0 : Math.max(0, (page - 1) * limit);

    const where = {
      userId,
      ...(typeof search === 'string'
        ? { file: { name: { contains: search, mode: 'insensitive' as const } } }
        : {}),
      ...(isCursorBased ? { createdAt: { lt: new Date(cursor) } } : {}),
    };

    const [sharedFiles, total] = await Promise.all([
      db.sharedFile.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        select: {
          id: true,
          createdAt: true,
          file: {
            select: {
              id: true,
              name: true,
              preview: true,
              createdAt: true,
              updatedAt: true,
              userId: true,
              user: {
                select: {
                  id: true,
                  name: true,
                  email: true,
                  image: true,
                },
              },
            },
          },
        },
      }),
      // Same stable-shape rule as `listFiles`: always counted, cursor
      // predicate excluded, so `total` names the whole filtered set.
      db.sharedFile.count({
        where: {
          userId,
          ...(typeof search === 'string'
            ? { file: { name: { contains: search, mode: 'insensitive' as const } } }
            : {}),
        },
      }),
    ]);

    const nextCursor =
      sharedFiles.length === limit
        ? (sharedFiles[sharedFiles.length - 1]?.createdAt?.toISOString() ?? null)
        : null;

    const files = sharedFiles.map((sf: SharedFileRecord) => ({
      ...sf.file,
      sharedAt: sf.createdAt,
      sharedBy: sf.file.user,
    }));

    return { files, total, nextCursor, isCursorBased };
  }

  static async createFile(options: CreateFileOptions): Promise<CreateFileResult> {
    const { userId, name, folderId: rawFolderId, content, preview } = options;
    const folderId = rawFolderId ?? null;

    const ownedFileCount = await db.file.count({ where: { userId } });
    if (ownedFileCount >= FREE_PLAN_FILE_LIMIT) {
      return { kind: 'quota_exceeded', limit: FREE_PLAN_FILE_LIMIT } as const;
    }

    const hasFolderAccess = await FileService.ensureFolderOwnership(userId, folderId);
    if (!hasFolderAccess) {
      return { kind: 'folder_not_found' } as const;
    }

    // The route hands over the already-serialized scene (it measured the
    // same string for the 413 guard), so validation runs on the string form
    // through the memoized validator and the record parses from it directly:
    // one serialization per save instead of three. A caller passing an
    // object takes the legacy path with identical verdicts — stringify /
    // parse round-trips preserve everything the schema can observe (NaN and
    // undefined array holes fail on both sides), so the two forms agree.
    const rawContent = content !== undefined ? content : [];
    const contentString = toContentString(rawContent);
    if (!isValidSceneString(contentString)) {
      return { kind: 'invalid_scene' } as const;
    }
    const contentRecord = parseStoredFileContent(contentString);

    const file = await db.file.create({
      data: {
        name: name ?? 'Untitled file',
        userId,
        folderId,
        preview: preview ?? null,
        content: serializeStoredFileContent(contentRecord),
      },
      select: { id: true, name: true },
    });

    return { file };
  }

  static async getFile(userId: string, fileId: string) {
    const file = await db.file.findFirst({
      where: { id: fileId, userId },
    });

    if (!file) return null;

    const parsedContent = parseStoredFileContent(file.content);
    // Stored string at hand: memoized verdict, same boolean as validating
    // the parsed elements (whole-string parse covers both array and
    // envelope stored forms).
    const elements = isValidSceneString(file.content) ? parsedContent.elements : [];

    return {
      id: file.id,
      name: file.name,
      preview: file.preview,
      folderId: file.folderId,
      content: elements,
      encryptedPayload: parsedContent.encryptedPayload,
      shareToken: file.shareToken,
      sharePermission: file.sharePermission,
      shareExpiresAt: file.shareExpiresAt,
      createdAt: file.createdAt,
      updatedAt: file.updatedAt,
    };
  }

  static async updateFile(options: UpdateFileOptions): Promise<UpdateFileResult> {
    const {
      userId,
      fileId,
      name,
      content,
      preview,
      folderId: rawFolderId,
      expectedUpdatedAt,
    } = options;

    const existing = await db.file.findFirst({
      where: { id: fileId, userId },
    });

    if (!existing) return null;

    const folderId = rawFolderId !== undefined ? rawFolderId : existing.folderId;
    const hasFolderAccess = await FileService.ensureFolderOwnership(userId, folderId);
    if (!hasFolderAccess) {
      return { kind: 'folder_not_found' } as const;
    }

    // Same single-serialization rule as createFile above: the route passes
    // the measured string, validation is memoized on it, and the record
    // parses from it directly.
    const contentString = content !== undefined ? toContentString(content) : undefined;
    if (contentString !== undefined && !isValidSceneString(contentString)) {
      return { kind: 'invalid_scene' } as const;
    }

    const existingContent = parseStoredFileContent(existing.content);
    const requestedContent =
      contentString !== undefined ? parseStoredFileContent(contentString) : existingContent;
    const nextContent = {
      ...requestedContent,
      // Owner saves carry the current scene but normally do not carry the
      // encrypted share envelope. Merge it from the stored row so a live
      // share cannot silently downgrade to plaintext after the next save.
      encryptedPayload: requestedContent.encryptedPayload ?? existingContent.encryptedPayload,
      encryptedAt: requestedContent.encryptedAt ?? existingContent.encryptedAt,
      appState: requestedContent.appState ?? existingContent.appState ?? null,
    };

    const updatedRows = await db.file.updateManyAndReturn({
      where: {
        id: existing.id,
        userId,
        updatedAt: expectedUpdatedAt ?? existing.updatedAt,
      },
      data: {
        name,
        preview,
        folderId,
        content:
          content !== undefined
            ? serializeStoredFileContent({
                elements: nextContent.elements,
                // Preserve an already-issued encrypted share snapshot. Otherwise
                // the next owner save silently makes every existing share URL
                // lose its decryption payload.
                encryptedPayload: nextContent.encryptedPayload,
                encryptedAt: nextContent.encryptedAt,
                appState: nextContent.appState ?? null,
              })
            : undefined,
      },
      select: { id: true, name: true, preview: true, folderId: true, updatedAt: true },
    });

    const updated = updatedRows[0];
    if (!updated) {
      return { kind: 'conflict' } as const;
    }

    return { file: updated };
  }

  static async deleteFile(userId: string, fileId: string): Promise<boolean> {
    const file = await db.file.findFirst({
      where: { id: fileId, userId },
      select: { id: true },
    });

    if (!file) return false;

    await db.file.delete({ where: { id: file.id } });
    return true;
  }

  static async createShare(options: CreateShareOptions): Promise<CreateShareResult> {
    const { userId, fileId, permission, expiresAt: explicitExpiry, expiresInHours } = options;

    const file = await db.file.findFirst({
      where: { id: fileId, userId },
    });

    if (!file) return null;

    const token = randomBytes(24).toString('base64url');
    const baseUrl = (
      process.env.NEXT_PUBLIC_APP_URL ??
      process.env.FRONTEND_URL ??
      'http://localhost:3000'
    ).replace(/\/$/, '');
    const baseShareUrl = `${baseUrl}/share/${token}`;
    const parsedContent = parseStoredFileContent(file.content);
    // Object form deliberately: parseStoredFileContent is lenient (corrupt
    // rows decode to an empty scene), and the pinned behavior for those rows
    // is to proceed, not refuse. Changing that verdict is a product call,
    // not a performance fix, so this guard stays off the memo path.
    if (!isValidSceneContent(parsedContent.elements)) {
      return { kind: 'invalid_scene' } as const;
    }
    const { shareUrl, encryptedPayload } = await buildEncryptedShare(
      baseShareUrl,
      parsedContent.elements
    );
    const expiresAt = resolveShareExpiry({ expiresAt: explicitExpiry, expiresInHours });

    const updated = await db.file.updateMany({
      where: { id: file.id, userId, updatedAt: file.updatedAt },
      data: {
        shareToken: token,
        sharePermission: permission,
        shareExpiresAt: expiresAt,
        content: serializeStoredFileContent({
          elements: parsedContent.elements,
          encryptedPayload,
          encryptedAt: new Date().toISOString(),
          appState: parsedContent.appState ?? null,
        }),
      },
    });
    if (updated.count === 0) {
      return { kind: 'conflict' } as const;
    }

    return { token, permission, expiresAt, shareUrl };
  }

  static async revokeShare(userId: string, fileId: string): Promise<boolean> {
    const file = await db.file.findFirst({
      where: { id: fileId, userId },
    });

    if (!file) return false;

    await db.file.update({
      where: { id: file.id },
      data: {
        shareToken: null,
        sharePermission: null,
        shareExpiresAt: null,
      },
    });

    return true;
  }
}
