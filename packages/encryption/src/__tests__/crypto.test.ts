/**
 * Unit tests for @dripl/encryption package
 * Tests key generation, encrypt/decrypt roundtrip
 */

import { describe, it, expect } from "vitest";
import {
  generateKey,
  encrypt,
  decrypt,
  keyToBase64,
  base64ToKey,
} from "../crypto";
import { appendKeyToUrl, extractKeyFromUrl } from "../url";

describe("crypto", () => {
  describe("generateKey", () => {
    it("should generate a CryptoKey", async () => {
      const key = await generateKey();
      expect(key).toBeDefined();
      expect(key.type).toBe("secret");
    });
  });

  describe("keyToBase64 / base64ToKey", () => {
    it("should serialize and deserialize key", async () => {
      const key = await generateKey();
      const base64 = await keyToBase64(key);

      expect(typeof base64).toBe("string");
      expect(base64.length).toBeGreaterThan(0);

      const restored = await base64ToKey(base64);
      expect(restored.type).toBe("secret");
    });
  });

  describe("encrypt / decrypt", () => {
    it("should encrypt and decrypt data", async () => {
      const key = await generateKey();
      const originalData = {
        test: "hello",
        number: 42,
        nested: { value: true },
      };

      const encrypted = await encrypt(originalData, key);

      expect(encrypted).toHaveProperty("iv");
      expect(encrypted).toHaveProperty("data");
      expect(typeof encrypted.iv).toBe("string");
      expect(typeof encrypted.data).toBe("string");

      const decrypted = await decrypt(encrypted, key);

      expect(decrypted).toEqual(originalData);
    });

    it("should produce different ciphertext for same data (random IV)", async () => {
      const key = await generateKey();
      const data = { test: "consistent" };

      const encrypted1 = await encrypt(data, key);
      const encrypted2 = await encrypt(data, key);

      // IVs should be different
      expect(encrypted1.iv).not.toBe(encrypted2.iv);
      // Ciphertext should be different
      expect(encrypted1.data).not.toBe(encrypted2.data);
    });

    it("should handle empty object", async () => {
      const key = await generateKey();
      const encrypted = await encrypt({}, key);
      const decrypted = await decrypt(encrypted, key);
      expect(decrypted).toEqual({});
    });

    it("should handle arrays", async () => {
      const key = await generateKey();
      const data = [1, 2, 3, "test"];
      const encrypted = await encrypt(data, key);
      const decrypted = await decrypt(encrypted, key);
      expect(decrypted).toEqual(data);
    });
  });
});

describe("url", () => {
  describe("appendKeyToUrl / extractKeyFromUrl", () => {
    it("should append key to URL", () => {
      const url = "https://example.com/room/test";
      const key = "abcd1234";

      const result = appendKeyToUrl(url, key);

      expect(result).toContain("#");
      expect(result).toContain("key=abcd1234");
    });

    it("should extract key from URL", () => {
      const url = "https://example.com/room/test#key=mySecretKey";

      const key = extractKeyFromUrl(url);

      expect(key).toBe("mySecretKey");
    });

    it("should return null when no key in URL", () => {
      const url = "https://example.com/room/test";

      const key = extractKeyFromUrl(url);

      expect(key).toBeNull();
    });

    it("should handle URL with other hash params", () => {
      const url =
        "https://example.com/room/test#other=value&key=myKey&another=param";

      const key = extractKeyFromUrl(url);

      expect(key).toBe("myKey");
    });
  });
});
