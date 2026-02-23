import { DriplElement } from "@dripl/common";

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
      throw error;
    }
  }

  async load(): Promise<DriplElement[]> {
    try {
      const data = localStorage.getItem(this.key);
      return data ? JSON.parse(data) : [];
    } catch (error) {
      console.error("Error loading elements from localStorage:", error);
      return [];
    }
  }
}
