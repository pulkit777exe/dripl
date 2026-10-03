import { afterEach, describe, it, expect, vi } from 'vitest';
import { generateKey, keyToBase64, base64ToKey, encrypt, decrypt } from './encryption/crypto';
import {
  appendKeyToUrl,
  extractKeyFromUrl,
  createEncryptedRoomUrl,
  getKeyFromCurrentUrl,
} from './encryption/url';

// ===== crypto.ts =====

describe('generateKey', () => {
  it('generates a CryptoKey', async () => {
    const key = await generateKey();
    expect(key).toBeDefined();
    expect(key.extractable).toBe(true);
  });

  it('generates unique keys each time', async () => {
    const key1 = await generateKey();
    const key2 = await generateKey();
    const b64_1 = await keyToBase64(key1);
    const b64_2 = await keyToBase64(key2);
    expect(b64_1).not.toBe(b64_2);
  });
});

describe('keyToBase64 / base64ToKey', () => {
  it('round-trips key through base64', async () => {
    const original = await generateKey();
    const b64 = await keyToBase64(original);
    expect(typeof b64).toBe('string');
    expect(b64.length).toBeGreaterThan(0);

    const restored = await base64ToKey(b64);
    expect(restored).toBeDefined();
  });

  it('produces consistent base64 for same key', async () => {
    const key = await generateKey();
    const b64_1 = await keyToBase64(key);
    const b64_2 = await keyToBase64(key);
    expect(b64_1).toBe(b64_2);
  });

  it('base64 string is valid URL-safe length (32 bytes = 44 base64 chars)', async () => {
    const key = await generateKey();
    const b64 = await keyToBase64(key);
    expect(b64.length).toBe(44);
  });

  it('rejects invalid base64', async () => {
    await expect(base64ToKey('not-valid-base64!!!')).rejects.toThrow();
  });
});

describe('encrypt / decrypt', () => {
  it('round-trips string data', async () => {
    const key = await generateKey();
    const original = 'Hello, World!';
    const encrypted = await encrypt(original, key);
    const decrypted = await decrypt<string>(encrypted, key);
    expect(decrypted).toBe(original);
  });

  it('round-trips object data', async () => {
    const key = await generateKey();
    const original = { name: 'test', values: [1, 2, 3], nested: { a: true } };
    const encrypted = await encrypt(original, key);
    const decrypted = await decrypt<typeof original>(encrypted, key);
    expect(decrypted).toEqual(original);
  });

  it('round-trips array data', async () => {
    const key = await generateKey();
    const original = [1, 'two', { three: 3 }];
    const encrypted = await encrypt(original, key);
    const decrypted = await decrypt<typeof original>(encrypted, key);
    expect(decrypted).toEqual(original);
  });

  it('produces different ciphertext for same plaintext (random IV)', async () => {
    const key = await generateKey();
    const original = { data: 'same' };
    const enc1 = await encrypt(original, key);
    const enc2 = await encrypt(original, key);
    expect(enc1.data).not.toBe(enc2.data);
    expect(enc1.iv).not.toBe(enc2.iv);
  });

  it('fails to decrypt with wrong key', async () => {
    const key1 = await generateKey();
    const key2 = await generateKey();
    const original = 'secret';
    const encrypted = await encrypt(original, key1);
    await expect(decrypt(encrypted, key2)).rejects.toThrow();
  });

  it('fails to decrypt with tampered data', async () => {
    const key = await generateKey();
    const original = 'secret';
    const encrypted = await encrypt(original, key);
    // Change a ciphertext byte, not only base64 padding bits. Some final
    // base64 characters can decode to the same bytes while changing unused
    // padding bits, which is not ciphertext tampering at the crypto layer.
    const midpoint = Math.floor(encrypted.data.length / 2);
    const replacement = encrypted.data[midpoint] === 'A' ? 'B' : 'A';
    encrypted.data =
      encrypted.data.slice(0, midpoint) + replacement + encrypted.data.slice(midpoint + 1);
    await expect(decrypt(encrypted, key)).rejects.toThrow();
  });

  it('fails to decrypt with tampered IV', async () => {
    const key = await generateKey();
    const original = 'secret';
    const encrypted = await encrypt(original, key);
    encrypted.iv = encrypted.iv.slice(0, -1) + 'Y';
    await expect(decrypt(encrypted, key)).rejects.toThrow();
  });

  it('handles empty object', async () => {
    const key = await generateKey();
    const original = {};
    const encrypted = await encrypt(original, key);
    const decrypted = await decrypt<typeof original>(encrypted, key);
    expect(decrypted).toEqual({});
  });

  it('handles null', async () => {
    const key = await generateKey();
    const original = null;
    const encrypted = await encrypt(original, key);
    const decrypted = await decrypt<typeof original>(encrypted, key);
    expect(decrypted).toBeNull();
  });

  it('handles large data', async () => {
    const key = await generateKey();
    const original = { data: 'x'.repeat(100000) };
    const encrypted = await encrypt(original, key);
    const decrypted = await decrypt<typeof original>(encrypted, key);
    expect(decrypted).toEqual(original);
  });
});

// ===== url.ts =====

describe('appendKeyToUrl', () => {
  it('appends key as fragment', () => {
    const url = appendKeyToUrl('https://app.com/room/abc', 'testkey123');
    expect(url).toContain('#key=testkey123');
  });

  it('preserves existing URL structure', () => {
    const url = appendKeyToUrl('https://app.com/room/abc?foo=bar', 'key1');
    expect(url).toContain('https://app.com/room/abc?foo=bar');
    expect(url).toContain('#key=key1');
  });

  it('replaces existing key in fragment', () => {
    const url = appendKeyToUrl('https://app.com/room/abc#key=old', 'new');
    expect(url).toContain('#key=new');
    expect(url).not.toContain('old');
  });

  it('preserves other fragment params', () => {
    const url = appendKeyToUrl('https://app.com/room/abc#foo=bar', 'key1');
    expect(url).toContain('foo=bar');
    expect(url).toContain('key=key1');
  });
});

describe('extractKeyFromUrl', () => {
  it('extracts key from fragment', () => {
    const key = extractKeyFromUrl('https://app.com/room/abc#key=testkey123');
    expect(key).toBe('testkey123');
  });

  it('returns null when no key present', () => {
    const key = extractKeyFromUrl('https://app.com/room/abc');
    expect(key).toBeNull();
  });

  it('returns null when fragment has no key param', () => {
    const key = extractKeyFromUrl('https://app.com/room/abc#foo=bar');
    expect(key).toBeNull();
  });

  it('handles invalid URLs gracefully', () => {
    const key = extractKeyFromUrl('not-a-valid-url');
    expect(key).toBeNull();
  });

  it('extracts key with other params', () => {
    const key = extractKeyFromUrl('https://app.com/room/abc#foo=bar&key=mykey&baz=qux');
    expect(key).toBe('mykey');
  });
});

describe('createEncryptedRoomUrl', () => {
  it('creates URL with key fragment', async () => {
    const result = await createEncryptedRoomUrl('https://app.com/room/abc');
    expect(result.url).toContain('#key=');
    expect(result.key).toBeDefined();
    expect(result.keyBase64).toBeDefined();
    expect(result.keyBase64.length).toBe(44);
  });

  it('key in URL matches returned keyBase64 (URL-encoded)', async () => {
    const result = await createEncryptedRoomUrl('https://app.com/room/abc');
    // URL fragment encodes special characters
    const encoded = encodeURIComponent(result.keyBase64);
    expect(result.url).toContain(encoded);
  });

  it('extracted key can be used to decrypt', async () => {
    const result = await createEncryptedRoomUrl('https://app.com/room/abc');
    const { encrypt: enc, decrypt: dec } = await import('./encryption/crypto');
    const encrypted = await enc({ test: 'data' }, result.key);
    const decrypted = await dec<typeof encrypted>(encrypted, result.key);
    expect(decrypted).toEqual({ test: 'data' });
  });
});

// ===== getKeyFromCurrentUrl =====
//
// This is the entry point that actually turns a shared link's fragment into a
// usable decryption key, and it had no tests at all — the sibling helpers
// `appendKeyToUrl` / `extractKeyFromUrl` were covered while this one, which
// touches `window`, was not.
//
// Its three early returns are all load-bearing:
//   - `typeof window === 'undefined'` is the SSR path. This repo server-renders
//     the share route, so the guard is reached during render, and a broken one
//     would throw instead of returning null.
//   - a URL with no key fragment is an ordinary unencrypted link.
//   - a key that will not import must fail *closed* to null rather than reject,
//     since a hostile or truncated fragment is user-supplied input.

describe('getKeyFromCurrentUrl', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns null during server-side rendering, where window is undefined', async () => {
    // No window stub at all: this is the SSR case, and the guard must be what
    // stops it rather than a ReferenceError from touching window.location.
    expect(typeof window).toBe('undefined');
    await expect(getKeyFromCurrentUrl()).resolves.toBeNull();
  });

  it('returns null when the URL carries no key fragment', async () => {
    vi.stubGlobal('window', { location: { href: 'https://app.com/share/abc' } });
    await expect(getKeyFromCurrentUrl()).resolves.toBeNull();
  });

  it('fails closed to null when the fragment is not a usable key', async () => {
    // 'AAAA' is syntactically valid base64 but decodes to 3 bytes, and
    // importKey is called with length 256 — so this throws inside WebCrypto.
    // The requirement is that it surfaces as null, not as a rejected promise.
    vi.stubGlobal('window', { location: { href: 'https://app.com/share/abc#key=AAAA' } });
    await expect(getKeyFromCurrentUrl()).resolves.toBeNull();
  });

  it('returns a usable CryptoKey for a real key in the fragment', async () => {
    const created = await createEncryptedRoomUrl('https://app.com/share/abc');
    vi.stubGlobal('window', { location: { href: created.url } });

    const key = await getKeyFromCurrentUrl();

    expect(key).not.toBeNull();
    expect(key?.algorithm).toMatchObject({ name: 'AES-GCM' });
  });

  it('produces a key that actually decrypts a payload', async () => {
    // The end-to-end property that matters: a link built by
    // `createEncryptedRoomUrl`, read back through `getKeyFromCurrentUrl`, has to
    // decrypt its own ciphertext. Anything that broke the base64 round trip or
    // the fragment parsing would fail here rather than on a null check alone.
    const created = await createEncryptedRoomUrl('https://app.com/share/abc');
    const payload = await encrypt({ secret: 'shared canvas' }, created.key);
    vi.stubGlobal('window', { location: { href: created.url } });

    const key = await getKeyFromCurrentUrl();
    // Narrow rather than cast: `expect(...).not.toBeNull()` does not narrow the
    // type, so a cast here would hide the very null case under test.
    if (key === null) throw new Error('expected a key from the URL fragment');

    const decrypted = await decrypt<{ secret: string }>(payload, key);
    expect(decrypted).toEqual({ secret: 'shared canvas' });
  });
});
