import { describe, expect, it, vi } from 'vitest';
import type { Response } from 'express';
import { KNOWN_ERROR_KINDS, sendServiceError } from '../lib/serviceResult';

function mockRes() {
  const json = vi.fn();
  const status = vi.fn(() => ({ json }));
  return { res: { status } as unknown as Response, json, status };
}

describe('sendServiceError', () => {
  it('returns false without sending for ok results', () => {
    const { res, status } = mockRes();
    expect(sendServiceError(res, { kind: 'ok', room: {} }, {})).toBe(false);
    expect(status).not.toHaveBeenCalled();
  });

  it('maps every known kind to its fixed status and code', () => {
    const expected: Record<string, [number, string]> = {
      not_found: [404, 'NOT_FOUND'],
      forbidden: [403, 'FORBIDDEN'],
      conflict: [409, 'CONFLICT'],
      expired: [410, 'EXPIRED'],
      rate_limited: [429, 'RATE_LIMITED'],
      quota_exceeded: [403, 'FORBIDDEN'],
      folder_not_found: [404, 'NOT_FOUND'],
      invalid_scene: [400, 'INVALID_SCENE'],
      parent_not_found: [404, 'NOT_FOUND'],
      self_parent: [400, 'CANNOT_RE_PARENT'],
      cycle: [400, 'CANNOT_RE_PARENT'],
      too_deep: [409, 'FOLDER_HIERARCHY_TOO_DEEP'],
      owner_self: [400, 'INVALID_PAYLOAD'],
    };
    expect(new Set(KNOWN_ERROR_KINDS)).toEqual(new Set(Object.keys(expected)));
    for (const [kind, [status, code]] of Object.entries(expected)) {
      const { res, status: statusFn, json } = mockRes();
      const messages = { [kind]: `msg-for-${kind}` } as Record<string, string>;
      expect(sendServiceError(res, { kind }, messages)).toBe(true);
      expect(statusFn).toHaveBeenCalledWith(status);
      expect(json).toHaveBeenCalledWith(
        expect.objectContaining({ statusCode: status, error: code, message: `msg-for-${kind}` })
      );
    }
  });

  it('falls back to the table default message when the caller omits it', () => {
    const { res, json } = mockRes();
    // Narrow kind so the messages map is required: omitting it must not typecheck.
    // @ts-expect-error - deliberately omitting the message to pin the fallback
    sendServiceError(res, { kind: 'not_found' as const }, {});
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 404, error: 'NOT_FOUND', message: 'Not found' })
    );
  });

  it('throws on unknown kinds instead of guessing a status', () => {
    const { res } = mockRes();
    expect(() => sendServiceError(res, { kind: 'no_such_kind' }, { no_such_kind: 'x' })).toThrow(
      /Unmapped service result kind: no_such_kind/
    );
  });
});
