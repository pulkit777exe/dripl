import type { DriplElement, ShapeDefinition } from "@dripl/common";

class ShapeRegistry {
  private shapes = new Map<string, ShapeDefinition>();
  private categories = new Set<string>();

  register<T extends DriplElement>(definition: ShapeDefinition<T>) {
    if (this.shapes.has(definition.type)) {
      console.warn(
        `Shape type '${definition.type}' already registered. Overriding.`,
      );
    }

    this.shapes.set(definition.type, definition as unknown as ShapeDefinition);
    this.categories.add(definition.category);
  }

  deregister(type: string) {
    this.shapes.delete(type);
  }

  get(type: string): ShapeDefinition | undefined {
    return this.shapes.get(type);
  }

  has(type: string): boolean {
    return this.shapes.has(type);
  }

  getAll(): ShapeDefinition[] {
    return Array.from(this.shapes.values());
  }

  getCategories(): string[] {
    return Array.from(this.categories).sort();
  }

  getByCategory(category: string): ShapeDefinition[] {
    return Array.from(this.shapes.values()).filter(
      (shape) => shape.category === category,
    );
  }

  createElement(type: string, properties: Partial<DriplElement>): DriplElement {
    const definition = this.get(type);
    if (!definition) {
      throw new Error(`Shape type '${type}' not registered`);
    }
    return definition.create(properties);
  }

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

  renderElement(ctx: CanvasRenderingContext2D, element: DriplElement) {
    const definition = this.get(element.type);
    if (!definition) {
      console.warn(
        `Shape type '${element.type}' not registered. Skipping rendering.`,
      );
      return;
    }

    definition.render(ctx, element);
  }

  getElementProperties(element: DriplElement): any {
    const definition = this.get(element.type);
    if (!definition) {
      console.warn(
        `Shape type '${element.type}' not registered. Returning empty properties.`,
      );
      return {};
    }

    return definition.getProperties(element);
  }

  setElementProperties(element: DriplElement, properties: any): DriplElement {
    const definition = this.get(element.type);
    if (!definition) {
      console.warn(
        `Shape type '${element.type}' not registered. Returning original element.`,
      );
      return element;
    }

    return definition.setProperties(element, properties);
  }
}

export const shapeRegistry = new ShapeRegistry();
