import { db } from '@dripl/db';
import { parseStoredFileContent } from '../lib/encrypt';

export interface ResolveShareResult {
  file: {
    id: string;
    name: string;
    updatedAt: Date;
  };
  permission: string;
  encryptedPayload: unknown;
  elements: unknown;
  expired: boolean;
}

export class ShareService {
  static async resolveShare(token: string): Promise<ResolveShareResult | null> {
    const file = await db.file.findFirst({
      where: { shareToken: token },
      select: {
        id: true,
        name: true,
        content: true,
        sharePermission: true,
        shareExpiresAt: true,
        updatedAt: true,
      },
    });

    if (!file) return null;

    const expired = Boolean(file.shareExpiresAt && file.shareExpiresAt.getTime() < Date.now());
    const parsed = parseStoredFileContent(file.content);

    return {
      file: { id: file.id, name: file.name, updatedAt: file.updatedAt },
      permission: file.sharePermission ?? 'view',
      encryptedPayload: parsed.encryptedPayload,
      elements: parsed.encryptedPayload ? null : parsed.elements,
      expired,
    };
  }
}
