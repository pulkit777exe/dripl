import type { DriplElement, ShapeDefinition } from "@dripl/common";

// Shape registry singleton
class ShapeRegistry {
  private shapes = new Map<string, ShapeDefinition>();
  private categories = new Set<string>();

  // Register a new shape
  register<T extends DriplElement>(definition: ShapeDefinition<T>) {
    if (this.shapes.has(definition.type)) {
      console.warn(`Shape type '${definition.type}' already registered. Overriding.`);
    }

    this.shapes.set(definition.type, definition as unknown as ShapeDefinition);
    this.categories.add(definition.category);
  }

  // Deregister a shape
  deregister(type: string) {
    this.shapes.delete(type);
  }

  // Get a shape definition by type
  get(type: string): ShapeDefinition | undefined {
    return this.shapes.get(type);
  }

  // Check if a shape type is registered
  has(type: string): boolean {
    return this.shapes.has(type);
  }

  // Get all registered shapes
  getAll(): ShapeDefinition[] {
    return Array.from(this.shapes.values());
  }

  // Get all categories
  getCategories(): string[] {
    return Array.from(this.categories).sort();
  }

  // Get shapes by category
  getByCategory(category: string): ShapeDefinition[] {
    return Array.from(this.shapes.values()).filter((shape) => shape.category === category);
  }

  // Create an element from shape type and properties
  createElement(type: string, properties: Partial<DriplElement>): DriplElement {
    const definition = this.get(type);
    if (!definition) {
      throw new Error(`Shape type '${type}' not registered`);
    }
    return definition.create(properties);
  }

  // Validate an element against its shape definition
  validateElement(element: any): boolean {
    if (!element || !element.type) {
      return false;
    }

    const definition = this.get(element.type);
    if (!definition) {
      return false;
    }

    return definition.validate(element);
  }

  // Render an element using its shape definition
  renderElement(ctx: CanvasRenderingContext2D, element: DriplElement) {
    const definition = this.get(element.type);
    if (!definition) {
      console.warn(`Shape type '${element.type}' not registered. Skipping rendering.`);
      return;
    }

    definition.render(ctx, element);
  }

  // Get properties for an element
  getElementProperties(element: DriplElement): any {
    const definition = this.get(element.type);
    if (!definition) {
      console.warn(`Shape type '${element.type}' not registered. Returning empty properties.`);
      return {};
    }

    return definition.getProperties(element);
  }

  // Set properties for an element
  setElementProperties(element: DriplElement, properties: any): DriplElement {
    const definition = this.get(element.type);
    if (!definition) {
      console.warn(`Shape type '${element.type}' not registered. Returning original element.`);
      return element;
    }

    return definition.setProperties(element, properties);
  }
}

// Create and export singleton instance
export const shapeRegistry = new ShapeRegistry();