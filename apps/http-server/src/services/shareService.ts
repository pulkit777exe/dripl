import { randomBytes } from 'crypto';
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

export type SharePermission = 'view' | 'edit';

export type UpsertShareResult =
  | { kind: 'ok'; token: string | null }
  | { kind: 'not_found' }
  | { kind: 'forbidden' };

const TOKEN_BYTES = 24;

function generateToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
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

  /**
   * Idempotently set a file's share token + permission for the
   * given user. Only the file owner may modify its share state.
   *
   * Returns a discriminated result so the route layer can map to
   * the right HTTP status without inspecting error shapes.
   */
  static async upsertShareToken(
    fileId: string,
    userId: string,
    permission: SharePermission | null
  ): Promise<UpsertShareResult> {
    const file = await db.file.findFirst({
      where: { id: fileId },
      select: { id: true, userId: true, shareToken: true, sharePermission: true },
    });

    if (!file) return { kind: 'not_found' };
    if (file.userId !== userId) return { kind: 'forbidden' };

    // Revoke: explicit null clears the share state.
    if (permission === null) {
      await db.file.update({
        where: { id: fileId },
        data: { shareToken: null, sharePermission: null },
      });
      return { kind: 'ok', token: null };
    }

    // Idempotent: if the existing token + permission already match,
    // don't rotate the token (would invalidate live shared links).
    if (file.shareToken && file.sharePermission === permission) {
      return { kind: 'ok', token: file.shareToken };
    }

    // New or permission changed: rotate.
    const token = generateToken();
    await db.file.update({
      where: { id: fileId },
      data: { shareToken: token, sharePermission: permission },
    });
    return { kind: 'ok', token };
  }
}
