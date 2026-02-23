import { DriplElement } from "@dripl/common";

export class StorageError extends Error {
  constructor(message: string, cause: Error) {
    super(message);
    this.name = "StorageError";
    this.cause = cause;
  }
}

export interface StorageAdapter {
  save(elements: DriplElement[]): Promise<void>;
  load(): Promise<DriplElement[]>;
}

export class LocalStorageAdapter implements StorageAdapter {
  private key: string;

  constructor(key: string = "dripl-data") {
    this.key = key;
  }

  async save(elements: DriplElement[]): Promise<void> {
    try {
      localStorage.setItem(this.key, JSON.stringify(elements));
    } catch (error) {
      console.error("Error saving elements to localStorage:", error);
      throw new StorageError("Failed to save elements", error as Error);
    }
  }

  async load(): Promise<DriplElement[]> {
    try {
      const data = localStorage.getItem(this.key);
      return data ? JSON.parse(data) : [];
    } catch (error) {
      console.error("Error loading elements from localStorage:", error);
      throw new StorageError("Failed to load elements", error as Error);
    }
  }
}
