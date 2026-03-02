import type { DriplElement, Point } from "@dripl/common";

export interface Viewport {
  x: number;
  y: number;
  width: number;
  height: number;
  zoom: number;
}

export class Renderer {
  private sceneNonce: number = Math.random();
  private visibleElementsCache: DriplElement[] = [];
  private viewportCache: Viewport | null = null;

  constructor(private elements: DriplElement[]) {}

  public updateScene(elements: DriplElement[]): void {
    this.elements = elements;
    this.sceneNonce = Math.random();
    this.visibleElementsCache = [];
  }

  public getSceneNonce(): number {
    return this.sceneNonce;
  }

  public getRenderableElements(viewport: Viewport): DriplElement[] {
    if (
      this.viewportCache &&
      this.isViewportEqual(viewport, this.viewportCache) &&
      this.visibleElementsCache.length > 0
    ) {
      return [...this.visibleElementsCache];
    }

    const visibleElements = this.elements.filter((element) => {
      if (element.isDeleted) return false;

      const elementBounds = {
        x: element.x,
        y: element.y,
        width: element.width,
        height: element.height,
      };

      return this.isElementVisible(elementBounds, viewport);
    });

    this.visibleElementsCache = visibleElements;
    this.viewportCache = { ...viewport };

    return [...visibleElements];
  }

  private isViewportEqual(viewport1: Viewport, viewport2: Viewport): boolean {
    return (
      viewport1.x === viewport2.x &&
      viewport1.y === viewport2.y &&
      viewport1.width === viewport2.width &&
      viewport1.height === viewport2.height &&
      viewport1.zoom === viewport2.zoom
    );
  }

  private isElementVisible(elementBounds: { x: number; y: number; width: number; height: number }, viewport: Viewport): boolean {
    const { x, y, width, height } = elementBounds;
    const { x: vx, y: vy, width: vw, height: vh, zoom } = viewport;

    const viewportLeft = vx;
    const viewportRight = vx + vw / zoom;
    const viewportTop = vy;
    const viewportBottom = vy + vh / zoom;

    const elementLeft = x;
    const elementRight = x + width;
    const elementTop = y;
    const elementBottom = y + height;

    return (
      elementLeft < viewportRight &&
      elementRight > viewportLeft &&
      elementTop < viewportBottom &&
      elementBottom > viewportTop
    );
  }

  public getVisibleBounds(): { x: number; y: number; width: number; height: number } | null {
    if (this.visibleElementsCache.length === 0) return null;

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    this.visibleElementsCache.forEach((element) => {
      const { x, y, width, height } = element;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x + width);
      maxY = Math.max(maxY, y + height);
    });

    return {
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY,
    };
  }
}
