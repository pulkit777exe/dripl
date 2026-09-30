import { describe, expect, it } from 'vitest';
import { MAX_FILE_CONTENT_BYTES } from '@dripl/common';
import { roomContentSchema } from '../routes/roomRoutes';

const validScene = JSON.stringify([
  { id: 'a', type: 'rectangle', x: 0, y: 0, width: 10, height: 10 },
]);

describe('roomContentSchema', () => {
  it('accepts a valid scene', () => {
    expect(roomContentSchema.safeParse(validScene).success).toBe(true);
  });

  it('rejects semantically invalid scenes', () => {
    expect(roomContentSchema.safeParse('not json').success).toBe(false);
    expect(roomContentSchema.safeParse(JSON.stringify([{ nope: true }])).success).toBe(false);
  });

  it('measures size in UTF-8 bytes, not UTF-16 code units', () => {
    // 'é' is 1 UTF-16 unit but 2 UTF-8 bytes. 150 text elements of 10k é's
    // form a VALID scene that fits the old .max() check (1.5M units) yet
    // exceeds the byte budget (3M bytes) — the files.ts path always
    // rejected it, rooms silently accepted it.
    const elements = Array.from({ length: 150 }, (_, i) => ({
      id: `t-${i}`,
      type: 'text',
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      text: 'é'.repeat(10000),
    }));
    const payload = JSON.stringify(elements);
    expect(payload.length).toBeLessThan(MAX_FILE_CONTENT_BYTES);
    expect(Buffer.byteLength(payload, 'utf8')).toBeGreaterThan(MAX_FILE_CONTENT_BYTES);
    expect(roomContentSchema.safeParse(payload).success).toBe(false);
  });

  it('accepts ASCII scenes up to the byte limit', () => {
    const atLimit = 'a'.repeat(MAX_FILE_CONTENT_BYTES);
    // Not a valid scene, but must fail on semantics — not on size.
    const result = roomContentSchema.safeParse(atLimit);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(JSON.stringify(result.error.issues)).not.toContain('bytes');
    }
  });
});
