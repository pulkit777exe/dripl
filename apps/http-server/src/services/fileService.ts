import { randomBytes } from 'node:crypto';
import { db } from '@dripl/db';
import { isValidSceneContent } from '../lib/sceneValidation';
import {
  buildEncryptedShare,
  parseStoredFileContent,
  serializeStoredFileContent,
} from '../lib/encrypt';

export const FREE_PLAN_FILE_LIMIT = 3;

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
  | { token: string; permission: string; expiresAt: Date | null; shareUrl: string }
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
      isCursorBased
        ? Promise.resolve(undefined)
        : db.file.count({
            where: {
              userId,
              ...(typeof folderId === 'string' ? { folderId } : {}),
              ...(typeof search === 'string'
                ? { name: { contains: search, mode: 'insensitive' as const } }
                : {}),
            },
          }),
    ]);

    const nextCursor =
      files.length === limit ? (files[files.length - 1]?.updatedAt?.toISOString() ?? null) : null;

    return { files, total: isCursorBased ? undefined : total, nextCursor, isCursorBased };
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
      isCursorBased
        ? Promise.resolve(undefined)
        : db.sharedFile.count({
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

    return { files, total: isCursorBased ? undefined : total, nextCursor, isCursorBased };
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

    const rawContent = content !== undefined ? content : [];
    if (!isValidSceneContent(rawContent)) {
      return { kind: 'invalid_scene' } as const;
    }
    const contentRecord = parseStoredFileContent(JSON.stringify(rawContent));

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
    const elements = isValidSceneContent(parsedContent.elements) ? parsedContent.elements : [];

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

    if (content !== undefined && !isValidSceneContent(content)) {
      return { kind: 'invalid_scene' } as const;
    }

    const existingContent = parseStoredFileContent(existing.content);
    const requestedContent =
      content !== undefined ? parseStoredFileContent(JSON.stringify(content)) : existingContent;
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
    if (!isValidSceneContent(parsedContent.elements)) {
      return { kind: 'invalid_scene' } as const;
    }
    const { shareUrl, encryptedPayload } = await buildEncryptedShare(
      baseShareUrl,
      parsedContent.elements
    );
    const expiresAt =
      explicitExpiry ??
      (expiresInHours ? new Date(Date.now() + expiresInHours * 60 * 60 * 1000) : null);

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
