import { db } from '@dripl/db';

export const MAX_FOLDER_DEPTH = 1000;

export interface FolderRecord {
  id: string;
  name: string;
  parentId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface FolderWithFileCount extends FolderRecord {
  fileCount: number;
}

export type CreateFolderResult =
  { kind: 'ok'; folder: FolderRecord } | { kind: 'parent_not_found' };

export type UpdateFolderResult =
  | { kind: 'ok'; folder: FolderRecord }
  | { kind: 'not_found' }
  | { kind: 'parent_not_found' }
  | { kind: 'self_parent' }
  | { kind: 'cycle' };

export type DeleteFolderResult = { kind: 'ok' } | { kind: 'not_found' } | { kind: 'too_deep' };

const folderSelect = {
  id: true,
  name: true,
  parentId: true,
  createdAt: true,
  updatedAt: true,
} as const;

export class FolderService {
  static async assertParentFolder(
    userId: string,
    parentId: string | null | undefined
  ): Promise<boolean> {
    if (!parentId) return true;
    const parent = await db.folder.findFirst({
      where: { id: parentId, userId },
      select: { id: true },
    });
    return Boolean(parent);
  }

  static async wouldCreateFolderCycle(
    userId: string,
    folderId: string,
    parentId: string
  ): Promise<boolean> {
    const seen = new Set<string>();
    let currentId: string | null = parentId;

    for (let depth = 0; currentId && depth < MAX_FOLDER_DEPTH; depth += 1) {
      if (currentId === folderId || seen.has(currentId)) return true;
      seen.add(currentId);
      const parent: { parentId: string | null } | null = await db.folder.findFirst({
        where: { id: currentId, userId },
        select: { parentId: true },
      });
      currentId = parent?.parentId ?? null;
    }

    return currentId !== null;
  }

  static async listFolders(userId: string): Promise<FolderWithFileCount[]> {
    const folders = await db.folder.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      include: {
        _count: {
          select: {
            files: true,
          },
        },
      },
    });

    return folders.map(
      (folder: {
        id: string;
        name: string;
        parentId: string | null;
        _count: { files: number };
        createdAt: Date;
        updatedAt: Date;
      }) => ({
        id: folder.id,
        name: folder.name,
        parentId: folder.parentId,
        fileCount: folder._count.files,
        createdAt: folder.createdAt,
        updatedAt: folder.updatedAt,
      })
    );
  }

  static async createFolder(options: {
    userId: string;
    name: string;
    parentId: string | null;
  }): Promise<CreateFolderResult> {
    const { userId, name, parentId } = options;
    const hasParent = await FolderService.assertParentFolder(userId, parentId);
    if (!hasParent) return { kind: 'parent_not_found' };

    const folder = await db.folder.create({
      data: { name, parentId, userId },
      select: folderSelect,
    });

    return { kind: 'ok', folder };
  }

  static async updateFolder(options: {
    userId: string;
    id: string;
    name?: string;
    parentId?: string | null;
  }): Promise<UpdateFolderResult> {
    const { userId, id, name, parentId } = options;
    const existing = await db.folder.findFirst({
      where: { id, userId },
      select: { id: true },
    });
    if (!existing) return { kind: 'not_found' };

    if (parentId === id) return { kind: 'self_parent' };
    if (parentId !== undefined) {
      const hasParent = await FolderService.assertParentFolder(userId, parentId ?? null);
      if (!hasParent) return { kind: 'parent_not_found' };
      if (parentId && (await FolderService.wouldCreateFolderCycle(userId, id, parentId))) {
        return { kind: 'cycle' };
      }
    }

    const updated = await db.folder.update({
      where: { id },
      data: { name, parentId },
      select: folderSelect,
    });

    return { kind: 'ok', folder: updated };
  }

  static async deleteFolderCascade(userId: string, id: string): Promise<DeleteFolderResult> {
    const root = await db.folder.findFirst({
      where: { id, userId },
      select: { id: true },
    });
    if (!root) return { kind: 'not_found' };

    const toDelete = new Set<string>([id]);
    let frontier = [id];
    let depth = 0;

    while (frontier.length > 0) {
      depth += 1;
      if (depth > MAX_FOLDER_DEPTH) return { kind: 'too_deep' };
      const children = await db.folder.findMany({
        where: {
          parentId: { in: frontier },
          userId,
        },
        select: { id: true },
      });
      frontier = children
        .map((child: { id: string }) => child.id)
        .filter((childId: string) => !toDelete.has(childId));
      for (const folder of children) {
        toDelete.add(folder.id);
      }
    }

    const folderIds = Array.from(toDelete);

    await db.$transaction([
      db.file.deleteMany({
        where: {
          userId,
          folderId: { in: folderIds },
        },
      }),
      db.folder.deleteMany({
        where: {
          userId,
          id: { in: folderIds },
        },
      }),
    ]);

    return { kind: 'ok' };
  }
}
