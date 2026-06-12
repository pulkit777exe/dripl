import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import type { DriplElement } from '@dripl/common';
import { DriplElementSchema } from '@dripl/common';

const ELEMENTS_KEY = 'elements';

export interface YjsRoomState {
  doc: Y.Doc;
  elements: Y.Map<DriplElement>;
  awareness: Awareness;
}

const yjsRooms = new Map<string, YjsRoomState>();

export function getOrCreateYjsRoom(roomId: string): YjsRoomState {
  let state = yjsRooms.get(roomId);
  if (!state) {
    const doc = new Y.Doc();
    const elements = doc.getMap<DriplElement>(ELEMENTS_KEY);
    const awareness = new Awareness(doc);
    state = { doc, elements, awareness };
    yjsRooms.set(roomId, state);
  }
  return state;
}

export function getYjsRoom(roomId: string): YjsRoomState | undefined {
  return yjsRooms.get(roomId);
}

export function deleteYjsRoom(roomId: string): void {
  const state = yjsRooms.get(roomId);
  if (state) {
    state.awareness.destroy();
    state.doc.destroy();
    yjsRooms.delete(roomId);
  }
}

export function hasYjsRoom(roomId: string): boolean {
  return yjsRooms.has(roomId);
}

export function applyElementToYjs(yjsState: YjsRoomState, element: DriplElement): void {
  yjsState.elements.set(element.id, element);
}

export function applyElementsToYjs(yjsState: YjsRoomState, elements: DriplElement[]): void {
  yjsState.doc.transact(() => {
    for (const el of elements) {
      yjsState.elements.set(el.id, el);
    }
  });
}

export function deleteElementFromYjs(yjsState: YjsRoomState, elementId: string): void {
  yjsState.elements.delete(elementId);
}

export function deleteElementsFromYjs(yjsState: YjsRoomState, elementIds: string[]): void {
  yjsState.doc.transact(() => {
    for (const id of elementIds) {
      yjsState.elements.delete(id);
    }
  });
}

export function getElementsFromYjs(yjsState: YjsRoomState): DriplElement[] {
  const elements: DriplElement[] = [];
  yjsState.elements.forEach((el) => {
    elements.push(el);
  });
  return elements.sort((a, b) => {
    const ai = a.fractionalIndex ?? '';
    const bi = b.fractionalIndex ?? '';
    if (ai === bi) return 0;
    if (ai === '') return -1;
    if (bi === '') return 1;
    return ai < bi ? -1 : ai > bi ? 1 : 0;
  });
}

export function getYjsUpdate(yjsState: YjsRoomState, stateVector?: Uint8Array): Uint8Array {
  if (stateVector) {
    return Y.encodeStateAsUpdate(yjsState.doc, stateVector);
  }
  return Y.encodeStateAsUpdate(yjsState.doc);
}

export function applyYjsUpdate(yjsState: YjsRoomState, update: Uint8Array): void {
  Y.applyUpdate(yjsState.doc, update);
}

export function getStateVector(yjsState: YjsRoomState): Uint8Array {
  return Y.encodeStateVector(yjsState.doc);
}

export function encodeYjsDoc(yjsState: YjsRoomState): Uint8Array {
  return Y.encodeStateAsUpdate(yjsState.doc);
}

export function decodeYjsDoc(yjsState: YjsRoomState, data: Uint8Array): void {
  Y.applyUpdate(yjsState.doc, data);
}

export function loadElementsIntoYjs(yjsState: YjsRoomState, elements: DriplElement[]): void {
  yjsState.doc.transact(() => {
    for (const el of elements) {
      const existing = yjsState.elements.get(el.id);
      if (!existing) {
        yjsState.elements.set(el.id, el);
      } else {
        const existingVersion = existing.version ?? 0;
        const newVersion = el.version ?? 0;
        if (newVersion >= existingVersion) {
          yjsState.elements.set(el.id, el);
        }
      }
    }
  });
}

export function observeYjsElements(
  yjsState: YjsRoomState,
  callback: (event: Y.YMapEvent<DriplElement>) => void
): void {
  yjsState.elements.observe(callback);
}

export function validateElement(raw: unknown): DriplElement | null {
  const parsed = DriplElementSchema.safeParse(raw);
  if (!parsed.success) return null;
  return parsed.data as DriplElement;
}
