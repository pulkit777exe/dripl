"use client";

import { useState, useCallback, useEffect } from "react";
import {
  generateKey,
  encrypt,
  decrypt,
  keyToBase64,
  base64ToKey,
  type EncryptedPayload,
} from "@dripl/encryption";
import type { DriplElement } from "@dripl/common";

const ENCRYPTION_KEY_PARAM = "key";

interface UseEncryptionOptions {
  enabled?: boolean;
}

interface EncryptionState {
  isEnabled: boolean;
  isLoading: boolean;
  error: string | null;
  hasKey: boolean;
}

export function useEncryption(options: UseEncryptionOptions = {}) {
  const { enabled = true } = options;
  const [key, setKey] = useState<CryptoKey | null>(null);
  const [state, setState] = useState<EncryptionState>({
    isEnabled: enabled,
    isLoading: true,
    error: null,
    hasKey: false,
  });

  useEffect(() => {
    if (!enabled || typeof window === "undefined") {
      setState((s) => ({ ...s, isLoading: false }));
      return;
    }

    const loadKeyFromUrl = async () => {
      try {
        const hash = window.location.hash.slice(1);
        if (!hash) {
          setState((s) => ({ ...s, isLoading: false, hasKey: false }));
          return;
        }

        const params = new URLSearchParams(hash);
        const keyBase64 = params.get(ENCRYPTION_KEY_PARAM);

        if (!keyBase64) {
          setState((s) => ({ ...s, isLoading: false, hasKey: false }));
          return;
        }

        const cryptoKey = await base64ToKey(keyBase64);
        setKey(cryptoKey);
        setState((s) => ({
          ...s,
          isLoading: false,
          hasKey: true,
          error: null,
        }));
      } catch (error) {
        console.error("Failed to load encryption key:", error);
        setState((s) => ({
          ...s,
          isLoading: false,
          error: "Invalid encryption key",
          hasKey: false,
        }));
      }
    };

    loadKeyFromUrl();
  }, [enabled]);

  const createNewKey = useCallback(async (): Promise<string | null> => {
    if (!enabled) return null;

    try {
      const newKey = await generateKey();
      const keyBase64 = await keyToBase64(newKey);

      const url = new URL(window.location.href);
      const params = new URLSearchParams(url.hash.slice(1));
      params.set(ENCRYPTION_KEY_PARAM, keyBase64);
      url.hash = params.toString();

      window.history.replaceState(null, "", url.toString());

      setKey(newKey);
      setState((s) => ({ ...s, hasKey: true, error: null }));

      return keyBase64;
    } catch (error) {
      console.error("Failed to create encryption key:", error);
      setState((s) => ({ ...s, error: "Failed to create encryption key" }));
      return null;
    }
  }, [enabled]);

  const encryptElements = useCallback(
    async (elements: DriplElement[]): Promise<EncryptedPayload | null> => {
      if (!enabled || !key) {
        return null;
      }

      try {
        return await encrypt(elements, key);
      } catch (error) {
        console.error("Encryption failed:", error);
        setState((s) => ({ ...s, error: "Encryption failed" }));
        return null;
      }
    },
    [enabled, key],
  );

  const decryptElements = useCallback(
    async (payload: EncryptedPayload): Promise<DriplElement[] | null> => {
      if (!enabled || !key) {
        return null;
      }

      try {
        return await decrypt<DriplElement[]>(payload, key);
      } catch (error) {
        console.error("Decryption failed:", error);
        setState((s) => ({ ...s, error: "Decryption failed" }));
        return null;
      }
    },
    [enabled, key],
  );

  const getShareableUrl = useCallback(async (): Promise<string | null> => {
    if (!enabled) return window.location.href;

    if (!key) {
      await createNewKey();
    }

    return window.location.href;
  }, [enabled, key, createNewKey]);

  return {
    ...state,
    encryptElements,
    decryptElements,
    createNewKey,
    getShareableUrl,
    key,
  };
}
