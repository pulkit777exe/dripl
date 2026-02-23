import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { LocalStorageAdapter, StorageError } from "./storage";
import type { DriplElement } from "@dripl/common";

describe("utils/storage", () => {
  describe("LocalStorageAdapter", () => {
    beforeEach(() => {
      // Mock localStorage
      (global as any).localStorage = {
        getItem: vi.fn(),
        setItem: vi.fn(),
        removeItem: vi.fn(),
        clear: vi.fn(),
        key: vi.fn(),
        length: 0,
      };
    });

    afterEach(() => {
      delete (global as any).localStorage;
    });

    it("should save elements to localStorage", async () => {
      const adapter = new LocalStorageAdapter("test-dripl-data");
      const testElements: DriplElement[] = [
        {
          id: "1",
          type: "rectangle",
          x: 0,
          y: 0,
          width: 100,
          height: 100,
          strokeColor: "#000000",
          strokeWidth: 2,
        },
      ];

      await adapter.save(testElements);

      expect((global as any).localStorage.setItem).toHaveBeenCalledWith(
        "test-dripl-data",
        JSON.stringify(testElements)
      );
    });

    it("should throw error when save operation fails", async () => {
      const adapter = new LocalStorageAdapter("test-dripl-data");
      const testElements: DriplElement[] = [
        {
          id: "1",
          type: "rectangle",
          x: 0,
          y: 0,
          width: 100,
          height: 100,
          strokeColor: "#000000",
          strokeWidth: 2,
        },
      ];

      const mockError = new Error("Storage quota exceeded");
      ((global as any).localStorage.setItem as vi.Mock).mockImplementation(() => {
        throw mockError;
      });

      await expect(adapter.save(testElements)).rejects.toThrow(StorageError);
      await expect(adapter.save(testElements)).rejects.toThrow("Failed to save elements");
    });

    it("should load elements from localStorage", async () => {
      const adapter = new LocalStorageAdapter("test-dripl-data");
      const testElements: DriplElement[] = [
        {
          id: "1",
          type: "rectangle",
          x: 0,
          y: 0,
          width: 100,
          height: 100,
          strokeColor: "#000000",
          strokeWidth: 2,
        },
      ];

      ((global as any).localStorage.getItem as vi.Mock).mockReturnValue(
        JSON.stringify(testElements)
      );

      const loadedElements = await adapter.load();
      expect(loadedElements).toEqual(testElements);
    });

    it("should throw error when load operation fails", async () => {
      const adapter = new LocalStorageAdapter("test-dripl-data");
      const mockError = new Error("Storage access denied");
      ((global as any).localStorage.getItem as vi.Mock).mockImplementation(() => {
        throw mockError;
      });

      await expect(adapter.load()).rejects.toThrow(StorageError);
      await expect(adapter.load()).rejects.toThrow("Failed to load elements");
    });

    it("should return empty array if no data in localStorage", async () => {
      const adapter = new LocalStorageAdapter("test-dripl-data");
      ((global as any).localStorage.getItem as vi.Mock).mockReturnValue(null);

      const loadedElements = await adapter.load();
      expect(loadedElements).toEqual([]);
    });
  });
});
