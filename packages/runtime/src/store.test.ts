import { describe, it, expect } from "vitest";
import { Store } from "./store";

describe("runtime/store", () => {
  it("should create a new store", () => {
    const store = new Store();
    expect(store).toBeDefined();
  });

  it("should have initial state", () => {
    const store = new Store();
    const state = store.getSnapshot();
    expect(state).toBeDefined();
    expect(Array.isArray(state.elements)).toBe(true);
    expect(state.selectedIds).toBeDefined();
    expect(state.editingTextId).toBeNull();
  });

  it("should create store with initial snapshot", () => {
    const initialSnapshot = {
      elements: [],
      selectedIds: [],
      editingTextId: null,
    };
    const store = new Store(initialSnapshot);
    const state = store.getSnapshot();
    expect(state).toEqual(initialSnapshot);
  });
});
