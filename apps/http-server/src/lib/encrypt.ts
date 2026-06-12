import { createEncryptedRoomUrl, encrypt, type EncryptedPayload } from '@dripl/utils';

export interface StoredFileContent {
  elements: unknown[];
  encryptedPayload: EncryptedPayload | null;
  encryptedAt: string | null;
  appState?: Record<string, unknown> | null;
}

function isEncryptedPayload(value: unknown): value is EncryptedPayload {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.iv === 'string' && typeof candidate.data === 'string';
}

export function parseStoredFileContent(raw: string | null | undefined): StoredFileContent {
  if (!raw) {
    return {
      elements: [],
      encryptedPayload: null,
      encryptedAt: null,
    };
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      return {
        elements: parsed,
        encryptedPayload: null,
        encryptedAt: null,
      };
    }

    if (parsed && typeof parsed === 'object') {
      const record = parsed as Record<string, unknown>;
      const parsedElements = Array.isArray(record.elements) ? record.elements : [];
      const parsedEncryptedPayload = isEncryptedPayload(record.encryptedPayload)
        ? record.encryptedPayload
        : null;
      const parsedEncryptedAt = typeof record.encryptedAt === 'string' ? record.encryptedAt : null;

      if (isEncryptedPayload(parsed)) {
        return {
          elements: [],
          encryptedPayload: parsed,
          encryptedAt: null,
        };
      }

      const parsedAppState =
        record.appState && typeof record.appState === 'object' && !Array.isArray(record.appState)
          ? (record.appState as Record<string, unknown>)
          : null;

      return {
        elements: parsedElements,
        encryptedPayload: parsedEncryptedPayload,
        encryptedAt: parsedEncryptedAt,
        appState: parsedAppState,
      };
    }
  } catch {
    return {
      elements: [],
      encryptedPayload: null,
      encryptedAt: null,
    };
  }

  return {
    elements: [],
    encryptedPayload: null,
    encryptedAt: null,
  };
}

export function serializeStoredFileContent(content: StoredFileContent): string {
  const payload: Record<string, unknown> = {
    elements: content.elements,
    encryptedPayload: content.encryptedPayload,
    encryptedAt: content.encryptedAt,
  };
  if (content.appState) {
    payload.appState = content.appState;
  }
  return JSON.stringify(payload);
}

export async function buildEncryptedShare(
  baseShareUrl: string,
  elements: unknown[]
): Promise<{ shareUrl: string; encryptedPayload: EncryptedPayload }> {
  const { url, key } = await createEncryptedRoomUrl(baseShareUrl);
  const encryptedPayload = await encrypt(elements, key);
  return { shareUrl: url, encryptedPayload };
}
