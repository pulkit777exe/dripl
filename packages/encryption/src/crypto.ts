/**
 * End-to-end encryption using Web Crypto API
 * Uses AES-GCM 256-bit encryption
 */

const ALGORITHM = "AES-GCM";
const KEY_LENGTH = 256;
const IV_LENGTH = 12; // 96 bits for GCM

export interface EncryptedPayload {
  iv: string; // Base64 encoded IV
  data: string; // Base64 encoded ciphertext
}

/**
 * Generate a new AES-GCM 256-bit encryption key
 * This key should be stored in URL fragment, never sent to server
 */
export async function generateKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey(
    {
      name: ALGORITHM,
      length: KEY_LENGTH,
    },
    true, // extractable - needed for URL serialization
    ["encrypt", "decrypt"],
  );
}

/**
 * Convert CryptoKey to base64 string for URL storage
 */
export async function keyToBase64(key: CryptoKey): Promise<string> {
  const exported = await crypto.subtle.exportKey("raw", key);
  return arrayBufferToBase64(exported);
}

/**
 * Convert base64 string back to CryptoKey
 */
export async function base64ToKey(base64: string): Promise<CryptoKey> {
  const keyData = base64ToArrayBuffer(base64);
  return crypto.subtle.importKey(
    "raw",
    keyData,
    { name: ALGORITHM, length: KEY_LENGTH },
    true,
    ["encrypt", "decrypt"],
  );
}

/**
 * Encrypt data with the provided key
 * Returns base64-encoded IV and ciphertext
 */
export async function encrypt(
  data: unknown,
  key: CryptoKey,
): Promise<EncryptedPayload> {
  // Generate random IV for each encryption
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));

  // Convert data to JSON string, then to bytes
  const jsonString = JSON.stringify(data);
  const encoder = new TextEncoder();
  const plaintext = encoder.encode(jsonString);

  // Encrypt
  const ciphertext = await crypto.subtle.encrypt(
    { name: ALGORITHM, iv },
    key,
    plaintext,
  );

  return {
    iv: arrayBufferToBase64(iv.buffer),
    data: arrayBufferToBase64(ciphertext),
  };
}

/**
 * Decrypt data with the provided key
 * Returns the original JSON-parsed data
 */
export async function decrypt<T = unknown>(
  payload: EncryptedPayload,
  key: CryptoKey,
): Promise<T> {
  const iv = base64ToArrayBuffer(payload.iv);
  const ciphertext = base64ToArrayBuffer(payload.data);

  const plaintext = await crypto.subtle.decrypt(
    { name: ALGORITHM, iv: new Uint8Array(iv) },
    key,
    ciphertext,
  );

  const decoder = new TextDecoder();
  const jsonString = decoder.decode(plaintext);

  return JSON.parse(jsonString) as T;
}

// Helper: ArrayBuffer to Base64
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}

// Helper: Base64 to ArrayBuffer
function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}
