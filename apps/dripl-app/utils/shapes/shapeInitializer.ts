import { shapeRegistry } from "./ShapeRegistry";
import { defaultShapes } from "./defaultShapes";

// Initialize shape registry with all default shapes
export function initializeShapeRegistry() {
  defaultShapes.forEach((shape) => {
    shapeRegistry.register(shape);
  });
  
  console.log(`Shape registry initialized with ${defaultShapes.length} default shapes`);
}

// Get all registered shapes for UI display
export function getRegisteredShapes() {
  const shapes = shapeRegistry.getAll();
  
  // Group shapes by category
  const groupedShapes = shapes.reduce((groups, shape) => {
    const category = shape.category || 'uncategorized';
    if (!groups[category]) {
      groups[category] = [];
    }
    groups[category].push(shape);
    return groups;
  }, {} as Record<string, typeof defaultShapes>);
  
  return groupedShapes;
}

// Get a shape definition by type
export function getShapeByType(type: string) {
  return shapeRegistry.get(type);
}

// Create an element from type and properties
export function createElementFromType(type: string, properties: any) {
  try {
    return shapeRegistry.createElement(type, properties);
  } catch (error) {
    console.error(`Failed to create element of type '${type}':`, error);
    return null;
  }
}