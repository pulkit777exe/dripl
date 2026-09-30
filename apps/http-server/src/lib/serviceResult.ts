import type { Response } from 'express';
import { sendError } from './response';

/**
 * Single home for service-result → HTTP-error mapping.
 *
 * Services return discriminated `{ kind }` unions (room/folder/share) or —
 * historically — stringly-typed `{ error }` results (fileService, migrated
 * to kinds; see below). Every route hand-rolled its own kind→status switch,
 * so adding an error mode meant touching N files with no exhaustiveness
 * check, and file routes sniffed substrings (`includes('limit')`) to guess
 * the status. This module owns status+code per kind in one tested table;
 * messages stay at the call site (they vary per operation) and are passed
 * explicitly so the wire stays byte-identical.
 *
 * Boundary (deliberately outside this module):
 * - `null` / `boolean` results (get/delete-style "missing?" checks) keep
 *   their hand-written 404s — the message names the resource.
 * - `resolveShare`'s `{ expired: boolean }` payload keeps its inline
 *   404/410 branches for the same reason.
 */

/** Fixed HTTP contract per non-ok kind. */
const KIND_TO_HTTP: Record<string, { status: number; code: string; message: string }> = {
  not_found: { status: 404, code: 'NOT_FOUND', message: 'Not found' },
  forbidden: { status: 403, code: 'FORBIDDEN', message: 'Forbidden' },
  conflict: { status: 409, code: 'CONFLICT', message: 'Conflict' },
  expired: { status: 410, code: 'EXPIRED', message: 'Expired' },
  rate_limited: { status: 429, code: 'RATE_LIMITED', message: 'Rate limit exceeded' },
  quota_exceeded: { status: 403, code: 'FORBIDDEN', message: 'Quota exceeded' },
  folder_not_found: { status: 404, code: 'NOT_FOUND', message: 'Folder not found' },
  invalid_scene: { status: 400, code: 'INVALID_SCENE', message: 'Invalid scene content' },
  parent_not_found: { status: 404, code: 'NOT_FOUND', message: 'Parent folder not found' },
  self_parent: { status: 400, code: 'CANNOT_RE_PARENT', message: 'Invalid parent' },
  cycle: { status: 400, code: 'CANNOT_RE_PARENT', message: 'Invalid hierarchy' },
  too_deep: { status: 409, code: 'FOLDER_HIERARCHY_TOO_DEEP', message: 'Hierarchy too deep' },
  owner_self: { status: 400, code: 'INVALID_PAYLOAD', message: 'Invalid request' },
};

/** Non-ok kinds the table knows. Exported for tests. */
export const KNOWN_ERROR_KINDS: readonly string[] = Object.keys(KIND_TO_HTTP);

/**
 * Send the mapped error for a non-ok service result. The messages map must
 * cover every non-ok kind of the result union — it is a required (not
 * partial) mapped type, so adding a kind to a service breaks its route
 * call sites at compile time until mapped. Unknown kinds throw: a service
 * returning an unmapped kind is a programming error, and every call site
 * runs inside try/catch → 500, never a silent wrong status.
 *
 * Returns true (caller must return right after). Returns false without
 * sending when result.kind is 'ok'.
 */
export function sendServiceError<Result extends { kind: string }>(
  res: Response,
  result: Result,
  messages: { [Kind in Exclude<Result['kind'], 'ok'>]: string }
): boolean {
  if (result.kind === 'ok') return false;
  const mapping = KIND_TO_HTTP[result.kind];
  if (!mapping) {
    throw new Error(`Unmapped service result kind: ${result.kind}`);
  }
  const message = messages[result.kind as Exclude<Result['kind'], 'ok'>] ?? mapping.message;
  sendError(res, mapping.status, mapping.code, message);
  return true;
}
