export type SharePermission = "view" | "edit";

export interface InMemoryShareRecord {
  token: string;
  fileId: string;
  name: string;
  elements: unknown[];
  permission: SharePermission;
  expiresAt: number | null;
  createdAt: number;
}

type ShareMap = Map<string, InMemoryShareRecord>;

declare global {
  var __driplInMemoryShares: ShareMap | undefined;
}

function getStore(): ShareMap {
  if (!globalThis.__driplInMemoryShares) {
    globalThis.__driplInMemoryShares = new Map<string, InMemoryShareRecord>();
  }
  return globalThis.__driplInMemoryShares;
}

export function setInMemoryShare(record: InMemoryShareRecord): void {
  getStore().set(record.token, record);
}

export function getInMemoryShare(token: string): InMemoryShareRecord | null {
  const value = getStore().get(token);
  if (!value) return null;
  if (value.expiresAt !== null && value.expiresAt < Date.now()) {
    getStore().delete(token);
    return null;
  }
  return value;
}
