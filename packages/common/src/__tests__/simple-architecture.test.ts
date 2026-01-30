import { describe, it, expect, beforeEach } from 'vitest';
import { Scene } from '../scene';
import { ActionCreator, ActionReducer } from '../actions';
import { DeltaManager } from '../delta';
import { SHAPES } from '../constants';

// Simple mock element for testing
function createMockElement(type: string, x: number, y: number, width: number, height: number) {
  const base = {
    id: `mock-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    type,
    x,
    y,
    width,
    height,
    strokeColor: '#000000',
    strokeWidth: 1,
    backgroundColor: 'transparent',
    opacity: 1,
    roughness: 1,
    strokeStyle: 'solid',
    fillStyle: 'hachure',
    seed: Math.floor(Math.random() * 2 ** 31),
    angle: 0,
    isDeleted: false
  };

  switch (type) {
    case 'text':
      return { ...base, text: 'Text', fontSize: 20, fontFamily: 'Arial' };
    case 'arrow':
    case 'line':
    case 'freedraw':
      return { ...base, points: [{ x: 0, y: 0 }, { x: width, y: height }] };
    case 'image':
      return { ...base, src: 'https://example.com/image.png' };
    default:
      return base;
  }
}

describe('Dripl Architecture', () => {
  describe('Scene Management', () => {
    let scene: Scene;
    
    beforeEach(() => {
      scene = new Scene();
    });

    it('should create an empty scene', () => {
      expect(scene.getElements()).toEqual([]);
      expect(scene.hasSelection()).toBe(false);
    });

    it('should add elements to the scene', () => {
      const rect = createMockElement(SHAPES.RECTANGLE, 100, 100, 200, 150);
      scene.addElement(rect as any);
      expect(scene.getElements()).toHaveLength(1);
      expect(scene.getElement(rect.id)).toEqual(rect);
    });

    it('should update elements in the scene', () => {
      const rect = createMockElement(SHAPES.RECTANGLE, 100, 100, 200, 150);
      scene.addElement(rect as any);
      
      const updates = { strokeColor: '#ff0000', strokeWidth: 3 };
      scene.updateElement(rect.id, updates);
      
      const updatedElement = scene.getElement(rect.id);
      expect(updatedElement?.strokeColor).toBe('#ff0000');
      expect(updatedElement?.strokeWidth).toBe(3);
    });

    it('should delete and restore elements', () => {
      const rect = createMockElement(SHAPES.RECTANGLE, 100, 100, 200, 150);
      scene.addElement(rect as any);
      
      scene.deleteElement(rect.id);
      expect(scene.getElements()).toEqual([]);
      
      scene.restoreElement(rect.id);
      expect(scene.getElements()).toHaveLength(1);
    });

    it('should manage element selection', () => {
      const rect = createMockElement(SHAPES.RECTANGLE, 100, 100, 200, 150);
      const circle = createMockElement(SHAPES.ELLIPSE, 400, 100, 150, 150);
      scene.addElement(rect as any);
      scene.addElement(circle as any);
      
      scene.setSelectedElements([rect.id]);
      expect(scene.getSelectedElements()).toHaveLength(1);
      expect(scene.isSelected(rect.id)).toBe(true);
      expect(scene.isSelected(circle.id)).toBe(false);
    });

    it('should toggle element selection', () => {
      const rect = createMockElement(SHAPES.RECTANGLE, 100, 100, 200, 150);
      scene.addElement(rect as any);
      
      scene.toggleElementSelection(rect.id);
      expect(scene.isSelected(rect.id)).toBe(true);
      
      scene.toggleElementSelection(rect.id);
      expect(scene.isSelected(rect.id)).toBe(false);
    });
  });

  describe('Action System', () => {
    it('should create actions with valid types', () => {
      const rect = createMockElement(SHAPES.RECTANGLE, 100, 100, 200, 150);
      
      const addAction = ActionCreator.addElement(rect as any);
      expect(addAction.type).toBe('ADD_ELEMENT');
      expect(addAction.payload.element).toEqual(rect);
      
      const updateAction = ActionCreator.updateElement(rect.id, { strokeColor: '#ff0000' });
      expect(updateAction.type).toBe('UPDATE_ELEMENT');
      expect(updateAction.payload.elementId).toBe(rect.id);
      expect(updateAction.payload.updates).toEqual({ strokeColor: '#ff0000' });
      
      const deleteAction = ActionCreator.deleteElement(rect.id);
      expect(deleteAction.type).toBe('DELETE_ELEMENT');
      expect(deleteAction.payload.elementId).toBe(rect.id);
    });

    it('should apply actions to scene', () => {
      const initialElements = [
        createMockElement(SHAPES.RECTANGLE, 100, 100, 200, 150)
      ];
      
      const scene = new Scene(initialElements as any);
      const deltaManager = new DeltaManager();
      
      const newElement = createMockElement(SHAPES.ELLIPSE, 400, 100, 150, 150);
      const action = ActionCreator.addElement(newElement as any);
      
      const newScene = ActionReducer.reduce(scene, action, deltaManager);
      
      expect(newScene.getElements()).toHaveLength(2);
      expect(newScene.getElement(newElement.id)).toEqual(newElement);
    });
  });

  describe('Delta System', () => {
    it('should create and apply deltas', () => {
      const scene = new Scene();
      const deltaManager = new DeltaManager();
      
      const element = createMockElement(SHAPES.RECTANGLE, 100, 100, 200, 150);
      deltaManager.createAddDelta(element as any);
      
      let newScene = deltaManager.applyDeltas(scene, deltaManager.getDeltas());
      expect(newScene.getElements()).toHaveLength(1);
      
      deltaManager.createUpdateDelta(element.id, {}, { strokeColor: '#ff0000' });
      newScene = deltaManager.applyDeltas(scene, deltaManager.getDeltas());
      expect(newScene.getElement(element.id)?.strokeColor).toBe('#ff0000');
    });

    it('should revert deltas', () => {
      const scene = new Scene();
      const deltaManager = new DeltaManager();
      
      const element = createMockElement(SHAPES.RECTANGLE, 100, 100, 200, 150);
      deltaManager.createAddDelta(element as any);
      
      const finalScene = deltaManager.applyDeltas(scene, deltaManager.getDeltas());
      expect(finalScene.getElements()).toHaveLength(1);
      
      const originalScene = deltaManager.revertDeltas(finalScene, deltaManager.getDeltas());
      expect(originalScene.getElements()).toEqual([]);
    });
  });
});