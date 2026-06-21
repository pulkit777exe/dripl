import { db } from '@dripl/db';
import {
  buildEncryptedShare,
  parseStoredFileContent,
  serializeStoredFileContent,
} from '../lib/encrypt';

const FREE_PLAN_FILE_LIMIT = 3;

export interface ListFilesOptions {
  userId: string;
  search?: string;
  folderId?: string;
  limit: number;
  cursor?: string;
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
  cursor?: string;
}

export class FileService {
  static async ensureFolderOwnership(userId: string, folderId: string | null | undefined): Promise<boolean> {
    if (!folderId) return true;
    const folder = await db.folder.findFirst({
      where: { id: folderId, userId },
      select: { id: true },
    });
    return Boolean(folder);
  }

  static async listFiles(options: ListFilesOptions) {
    const { userId, search, folderId, limit, cursor } = options;
    const isCursorBased = typeof cursor === 'string' && cursor.length > 0;
    const skip = isCursorBased ? 0 : 0;

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
      db.file.count({
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
      files.length === limit
        ? files[files.length - 1]?.updatedAt?.toISOString() ?? null
        : null;

    return { files, total: isCursorBased ? undefined : total, nextCursor, isCursorBased };
  }

  static async listSharedFiles(options: ListSharedFilesOptions) {
    const { userId, search, limit, cursor } = options;
    const isCursorBased = typeof cursor === 'string' && cursor.length > 0;

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
        skip: 0,
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
        ? sharedFiles[sharedFiles.length - 1]?.createdAt?.toISOString() ?? null
        : null;

    const files = sharedFiles.map(sf => ({
      ...sf.file,
      sharedAt: sf.createdAt,
      sharedBy: sf.file.user,
    }));

    return { files, total: isCursorBased ? undefined : total, nextCursor, isCursorBased };
  }

  static async createFile(options: CreateFileOptions) {
    const { userId, name, folderId: rawFolderId, content, preview } = options;
    const folderId = rawFolderId ?? null;

    const ownedFileCount = await db.file.count({ where: { userId } });
    if (ownedFileCount >= FREE_PLAN_FILE_LIMIT) {
      return { error: `Free plan limit reached (${FREE_PLAN_FILE_LIMIT} canvases). Delete one or upgrade to Premium.` as const };
    }

    const hasFolderAccess = await FileService.ensureFolderOwnership(userId, folderId);
    if (!hasFolderAccess) {
      return { error: 'Folder not found' as const };
    }

    const contentRecord = parseStoredFileContent(
      JSON.stringify(content !== undefined ? content : [])
    );

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

    return {
      id: file.id,
      name: file.name,
      preview: file.preview,
      folderId: file.folderId,
      content: parsedContent.elements,
      encryptedPayload: parsedContent.encryptedPayload,
      shareToken: file.shareToken,
      sharePermission: file.sharePermission,
      shareExpiresAt: file.shareExpiresAt,
      createdAt: file.createdAt,
      updatedAt: file.updatedAt,
    };
  }

  static async updateFile(options: UpdateFileOptions) {
    const { userId, fileId, name, content, preview, folderId: rawFolderId } = options;

    const existing = await db.file.findFirst({
      where: { id: fileId, userId },
    });

    if (!existing) return null;

    const folderId = rawFolderId ?? existing.folderId;
    const hasFolderAccess = await FileService.ensureFolderOwnership(userId, folderId);
    if (!hasFolderAccess) {
      return { error: 'Folder not found' as const };
    }

    const existingContent = parseStoredFileContent(existing.content);
    const nextContent =
      content !== undefined
        ? parseStoredFileContent(JSON.stringify(content))
        : existingContent;

    const updated = await db.file.update({
      where: { id: existing.id },
      data: {
        name,
        preview,
        folderId,
        content:
          content !== undefined
            ? serializeStoredFileContent({
                elements: nextContent.elements,
                encryptedPayload: null,
                encryptedAt: null,
                appState: nextContent.appState ?? null,
              })
            : undefined,
      },
      select: {
        id: true,
        name: true,
        preview: true,
        folderId: true,
        updatedAt: true,
      },
    });

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

  static async createShare(options: CreateShareOptions) {
    const { userId, fileId, permission, expiresAt: explicitExpiry, expiresInHours } = options;

    const file = await db.file.findFirst({
      where: { id: fileId, userId },
    });

    if (!file) return null;

    const { nanoidLike } = await import('../routes/files');
    const token = nanoidLike(24);
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
    const baseShareUrl = `${baseUrl}/share/${token}`;
    const parsedContent = parseStoredFileContent(file.content);
    const { shareUrl, encryptedPayload } = await buildEncryptedShare(
      baseShareUrl,
      parsedContent.elements
    );
    const expiresAt =
      explicitExpiry ??
      (expiresInHours
        ? new Date(Date.now() + expiresInHours * 60 * 60 * 1000)
        : null);

    await db.file.update({
      where: { id: file.id },
      data: {
        shareToken: token,
        sharePermission: permission,
        shareExpiresAt: expiresAt,
        content: serializeStoredFileContent({
          elements: parsedContent.elements,
          encryptedPayload,
          encryptedAt: new Date().toISOString(),
        }),
      },
    });

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
