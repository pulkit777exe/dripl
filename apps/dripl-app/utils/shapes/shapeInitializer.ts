import { shapeRegistry } from "./ShapeRegistry";
import { defaultShapes } from "./defaultShapes";

export function initializeShapeRegistry() {
  defaultShapes.forEach((shape) => {
    shapeRegistry.register(shape);
  });

  console.log(
    `Shape registry initialized with ${defaultShapes.length} default shapes`,
  );
}

export function getRegisteredShapes() {
  const shapes = shapeRegistry.getAll();

  const groupedShapes = shapes.reduce(
    (groups, shape) => {
      const category = shape.category || "uncategorized";
      if (!groups[category]) {
        groups[category] = [];
      }
      groups[category].push(shape);
      return groups;
    },
    {} as Record<string, typeof defaultShapes>,
  );

  return groupedShapes;
}

export function getShapeByType(type: string) {
  return shapeRegistry.get(type);
}

export function createElementFromType(type: string, properties: any) {
  try {
    return shapeRegistry.createElement(type, properties);
  } catch (error) {
    console.error(`Failed to create element of type '${type}':`, error);
    return null;
  }
}
