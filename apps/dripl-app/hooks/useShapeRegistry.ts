import { useEffect, useState } from 'react';
import { initializeShapeRegistry, getRegisteredShapes, getShapeByType, createElementFromType } from '@/utils/shapes/shapeInitializer';
import { shapeRegistry } from '@/utils/shapes/ShapeRegistry';
import type { ShapeDefinition, DriplElement } from '@dripl/common';

export function useShapeRegistry() {
  const [initialized, setInitialized] = useState(false);
  const [shapes, setShapes] = useState<ShapeDefinition[]>([]);
  const [groupedShapes, setGroupedShapes] = useState<Record<string, ShapeDefinition[]>>({});

  useEffect(() => {
    if (!initialized) {
      initializeShapeRegistry();
      setInitialized(true);
      
      const allShapes = shapeRegistry.getAll();
      setShapes(allShapes);
      
      const grouped = allShapes.reduce((groups, shape) => {
        const category = shape.category || 'uncategorized';
        if (!groups[category]) {
          groups[category] = [];
        }
        groups[category].push(shape);
        return groups;
      }, {} as Record<string, ShapeDefinition[]>);
      
      setGroupedShapes(grouped);
    }
  }, [initialized]);

  const getShape = (type: string) => {
    return getShapeByType(type);
  };

  const createElement = (type: string, properties: any) => {
    return createElementFromType(type, properties);
  };

  const registerShape = (shape: ShapeDefinition) => {
    shapeRegistry.register(shape);
    setShapes(shapeRegistry.getAll());
    
    const grouped = shapeRegistry.getAll().reduce((groups, s) => {
      const category = s.category || 'uncategorized';
      if (!groups[category]) {
        groups[category] = [];
      }
      groups[category].push(s);
      return groups;
    }, {} as Record<string, ShapeDefinition[]>);
    
    setGroupedShapes(grouped);
  };

  const deregisterShape = (type: string) => {
    shapeRegistry.deregister(type);
    setShapes(shapeRegistry.getAll());
    
    const grouped = shapeRegistry.getAll().reduce((groups, s) => {
      const category = s.category || 'uncategorized';
      if (!groups[category]) {
        groups[category] = [];
      }
      groups[category].push(s);
      return groups;
    }, {} as Record<string, ShapeDefinition[]>);
    
    setGroupedShapes(grouped);
  };

  const renderElement = (ctx: CanvasRenderingContext2D, element: DriplElement) => {
    shapeRegistry.renderElement(ctx, element);
  };

  const getElementProperties = (element: DriplElement) => {
    return shapeRegistry.getElementProperties(element);
  };

  const setElementProperties = (element: DriplElement, properties: any) => {
    return shapeRegistry.setElementProperties(element, properties);
  };

  return {
    shapes,
    groupedShapes,
    initialized,
    getShape,
    createElement,
    registerShape,
    deregisterShape,
    renderElement,
    getElementProperties,
    setElementProperties,
  };
}