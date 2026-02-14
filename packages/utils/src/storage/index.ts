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
    localStorage.setItem(this.key, JSON.stringify(elements));
  }

  async load(): Promise<DriplElement[]> {
    const data = localStorage.getItem(this.key);
    return data ? JSON.parse(data) : [];
  }
}
