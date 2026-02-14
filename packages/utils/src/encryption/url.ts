/**
 * URL fragment handling for encryption keys
 * The key is stored in the URL fragment (#key=...) which is never sent to the server
 */

import { generateKey, keyToBase64, base64ToKey } from "./crypto";

const KEY_PARAM = "key";

/**
 * Append encryption key to URL as fragment
 * Example: https://app.com/room/abc -> https://app.com/room/abc#key=base64key
 */
export function appendKeyToUrl(url: string, keyBase64: string): string {
  const urlObj = new URL(url);
  // URL fragments don't support URLSearchParams, so we handle manually
  const existingHash = urlObj.hash.slice(1); // Remove #
  const params = new URLSearchParams(existingHash);
  params.set(KEY_PARAM, keyBase64);
  urlObj.hash = params.toString();
  return urlObj.toString();
}

/**
 * Extract encryption key from URL fragment
 * Returns null if no key is present
 */
export function extractKeyFromUrl(url: string): string | null {
  try {
    const urlObj = new URL(url);
    const hash = urlObj.hash.slice(1); // Remove #
    if (!hash) return null;
    const params = new URLSearchParams(hash);
    return params.get(KEY_PARAM);
  } catch {
    return null;
  }
}

/**
 * Create a new encrypted room URL with a fresh encryption key
 * Returns both the URL and the CryptoKey for immediate use
 */
export async function createEncryptedRoomUrl(
  baseUrl: string,
): Promise<{ url: string; key: CryptoKey; keyBase64: string }> {
  const key = await generateKey();
  const keyBase64 = await keyToBase64(key);
  const url = appendKeyToUrl(baseUrl, keyBase64);
  return { url, key, keyBase64 };
}

/**
 * Get CryptoKey from current browser URL
 * Useful for client-side decryption on page load
 */
export async function getKeyFromCurrentUrl(): Promise<CryptoKey | null> {
  if (typeof window === "undefined") return null;
  const keyBase64 = extractKeyFromUrl(window.location.href);
  if (!keyBase64) return null;
  try {
    return await base64ToKey(keyBase64);
  } catch {
    return null;
  }
}
