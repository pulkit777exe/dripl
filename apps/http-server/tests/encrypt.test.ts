import { describe, it, expect } from 'vitest';
import { parseStoredFileContent, serializeStoredFileContent } from '../src/lib/encrypt';

describe('parseStoredFileContent', () => {
  it('returns empty elements for null/undefined/empty', () => {
    expect(parseStoredFileContent(null)).toEqual({
      elements: [],
      encryptedPayload: null,
      encryptedAt: null,
    });
    expect(parseStoredFileContent(undefined)).toEqual({
      elements: [],
      encryptedPayload: null,
      encryptedAt: null,
    });
    expect(parseStoredFileContent('')).toEqual({
      elements: [],
      encryptedPayload: null,
      encryptedAt: null,
    });
  });

  it('parses a plain array of elements', () => {
    const elements = [{ id: '1', type: 'rectangle' }, { id: '2', type: 'ellipse' }];
    const result = parseStoredFileContent(JSON.stringify(elements));
    expect(result.elements).toEqual(elements);
    expect(result.encryptedPayload).toBeNull();
  });

  it('parses an object with elements array', () => {
    const content = { elements: [{ id: '1' }], appState: { zoom: 1 } };
    const result = parseStoredFileContent(JSON.stringify(content));
    expect(result.elements).toEqual([{ id: '1' }]);
    expect(result.appState).toEqual({ zoom: 1 });
  });

  it('detects encrypted payload', () => {
    const content = { iv: 'abc', data: 'def' };
    const result = parseStoredFileContent(JSON.stringify(content));
    expect(result.encryptedPayload).toEqual({ iv: 'abc', data: 'def' });
    expect(result.elements).toEqual([]);
  });

  it('returns empty for invalid JSON', () => {
    const result = parseStoredFileContent('not-json');
    expect(result.elements).toEqual([]);
    expect(result.encryptedPayload).toBeNull();
  });
});

describe('serializeStoredFileContent', () => {
  it('round-trips elements', () => {
    const content = {
      elements: [{ id: '1' }],
      encryptedPayload: null,
      encryptedAt: null,
    };
    const serialized = serializeStoredFileContent(content);
    const parsed = parseStoredFileContent(serialized);
    expect(parsed.elements).toEqual([{ id: '1' }]);
  });

  it('includes appState when present', () => {
    const content = {
      elements: [],
      encryptedPayload: null,
      encryptedAt: null,
      appState: { zoom: 2 },
    };
    const serialized = serializeStoredFileContent(content);
    const parsed = JSON.parse(serialized) as Record<string, unknown>;
    expect(parsed.appState).toEqual({ zoom: 2 });
  });

  it('omits appState when null', () => {
    const content = {
      elements: [],
      encryptedPayload: null,
      encryptedAt: null,
      appState: null,
    };
    const serialized = serializeStoredFileContent(content);
    const parsed = JSON.parse(serialized) as Record<string, unknown>;
    expect(parsed).not.toHaveProperty('appState');
  });
});
