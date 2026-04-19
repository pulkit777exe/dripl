import { describe, it, expect } from 'vitest';
import { store, actions, selectors, defaultAppState } from './index';
import type {
  RectangleElement,
  LinearElement,
  FreeDrawElement,
  TextElement,
  ImageElement,
  FrameElement,
} from '@dripl/common';

describe('store', () => {
  describe('initial state', () => {
    it('should have default app state values', () => {
      expect(defaultAppState.zoom).toBe(1);
      expect(defaultAppState.gridEnabled).toBe(true);
      expect(defaultAppState.selectedElementIds).toBeInstanceOf(Set);
    });
  });

  describe('actions', () => {
    it('should set app state', () => {
      const initialZoom = store.state.appState.zoom;
      actions.setAppState({ zoom: 2 });
      expect(store.state.appState.zoom).toBe(2);
      actions.setAppState({ zoom: initialZoom });
    });

    it('should set tool', () => {
      actions.setTool('rectangle');
      expect(store.state.appState.activeTool).toBe('rectangle');
    });

    it('should add rectangle element', () => {
      const element: RectangleElement = {
        id: 'test-1',
        type: 'rectangle',
        x: 0,
        y: 0,
        width: 10,
        height: 10,
        strokeColor: '#000',
        version: 1,
        versionNonce: 1,
        updated: Date.now(),
        roughness: 1,
        strokeStyle: 'solid',
        fillStyle: 'solid',
        seed: 0,
        angle: 0,
        locked: false,
        groupId: '',
        zIndex: 0,
        rotation: 0,
        flipHorizontal: 1,
        flipVertical: 1,
        points: [],
        labelId: '',
        containerId: '',
        text: '',
        fontSize: 16,
        fontFamily: 'Arial',
        lineHeight: 1.2,
        autoResize: false,
        padding: 0,
        title: '',
      };
      actions.addElement(element);
      expect(store.state.elements.length).toBeGreaterThan(0);
    });

    it('should add linear element', () => {
      const element: LinearElement = {
        id: 'test-2',
        type: 'arrow',
        x: 0,
        y: 0,
        width: 100,
        height: 0,
        strokeColor: '#000',
        version: 1,
        versionNonce: 1,
        updated: Date.now(),
        roughness: 1,
        strokeStyle: 'solid',
        fillStyle: 'solid',
        seed: 0,
        angle: 0,
        locked: false,
        groupId: '',
        zIndex: 0,
        rotation: 0,
        flipHorizontal: 1,
        flipVertical: 1,
        points: [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
        ],
        labelId: '',
        containerId: '',
        text: '',
        fontSize: 16,
        fontFamily: 'Arial',
        lineHeight: 1.2,
        autoResize: false,
        padding: 0,
        title: '',
        arrowHeads: { start: false, end: true },
      };
      actions.addElement(element);
      expect(store.state.elements.length).toBeGreaterThan(1);
    });
  });

  describe('selectors', () => {
    it('should select elements', () => {
      const element: RectangleElement = {
        id: 'sel-1',
        type: 'rectangle',
        x: 0,
        y: 0,
        width: 10,
        height: 10,
        strokeColor: '#000',
        version: 1,
        versionNonce: 1,
        updated: Date.now(),
        roughness: 1,
        strokeStyle: 'solid',
        fillStyle: 'solid',
        seed: 0,
        angle: 0,
        locked: false,
        groupId: '',
        zIndex: 0,
        rotation: 0,
        flipHorizontal: 1,
        flipVertical: 1,
        points: [],
        labelId: '',
        containerId: '',
        text: '',
        fontSize: 16,
        fontFamily: 'Arial',
        lineHeight: 1.2,
        autoResize: false,
        padding: 0,
        title: '',
      };
      actions.addElement(element);
      actions.selectElements(['sel-1']);
      const selected = selectors.selectedElements(store.state);
      expect(selected.length).toBe(1);
    });

    it('should get element by id', () => {
      const element: RectangleElement = {
        id: 'get-1',
        type: 'rectangle',
        x: 0,
        y: 0,
        width: 10,
        height: 10,
        strokeColor: '#000',
        version: 1,
        versionNonce: 1,
        updated: Date.now(),
        roughness: 1,
        strokeStyle: 'solid',
        fillStyle: 'solid',
        seed: 0,
        angle: 0,
        locked: false,
        groupId: '',
        zIndex: 0,
        rotation: 0,
        flipHorizontal: 1,
        flipVertical: 1,
        points: [],
        labelId: '',
        containerId: '',
        text: '',
        fontSize: 16,
        fontFamily: 'Arial',
        lineHeight: 1.2,
        autoResize: false,
        padding: 0,
        title: '',
      };
      actions.addElement(element);
      const found = selectors.getElementById('get-1')(store.state);
      expect(found?.id).toBe('get-1');
    });
  });

  describe('history', () => {
    it('should track undo/redo', () => {
      const initialLen = store.state.elements.length;
      const element: RectangleElement = {
        id: 'hist-1',
        type: 'rectangle',
        x: 0,
        y: 0,
        width: 10,
        height: 10,
        strokeColor: '#000',
        version: 1,
        versionNonce: 1,
        updated: Date.now(),
        roughness: 1,
        strokeStyle: 'solid',
        fillStyle: 'solid',
        seed: 0,
        angle: 0,
        locked: false,
        groupId: '',
        zIndex: 0,
        rotation: 0,
        flipHorizontal: 1,
        flipVertical: 1,
        points: [],
        labelId: '',
        containerId: '',
        text: '',
        fontSize: 16,
        fontFamily: 'Arial',
        lineHeight: 1.2,
        autoResize: false,
        padding: 0,
        title: '',
      };
      actions.addElement(element);
      expect(actions.canUndo()).toBe(true);
      actions.undo();
      expect(store.state.elements.length).toBe(initialLen);
      actions.redo();
      expect(store.state.elements.length).toBe(initialLen + 1);
    });
  });
});
