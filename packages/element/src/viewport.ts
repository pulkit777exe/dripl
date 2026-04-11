import type { Point } from '@dripl/common';

export interface ViewportState {
  zoom: number;
  scrollX: number;
  scrollY: number;
}

export interface ViewportConstraints {
  minZoom: number;
  maxZoom: number;
}

const DEFAULT_CONSTRAINTS: ViewportConstraints = {
  minZoom: 0.1,
  maxZoom: 10,
};

export class Viewport {
  private state: ViewportState;
  private constraints: ViewportConstraints;
  private listeners: Set<(state: ViewportState) => void> = new Set();

  constructor(
    initialState: Partial<ViewportState> = {},
    constraints: Partial<ViewportConstraints> = {}
  ) {
    this.state = {
      zoom: initialState.zoom ?? 1,
      scrollX: initialState.scrollX ?? 0,
      scrollY: initialState.scrollY ?? 0,
    };
    this.constraints = { ...DEFAULT_CONSTRAINTS, ...constraints };
  }

  getState(): Readonly<ViewportState> {
    return { ...this.state };
  }

  getZoom(): number {
    return this.state.zoom;
  }

  getScroll(): { x: number; y: number } {
    return { x: this.state.scrollX, y: this.state.scrollY };
  }

  setZoom(zoom: number, center?: Point): void {
    const newZoom = Math.max(this.constraints.minZoom, Math.min(this.constraints.maxZoom, zoom));

    if (center && newZoom !== this.state.zoom) {
      const scale = newZoom / this.state.zoom;
      this.state.scrollX = center.x - (center.x - this.state.scrollX) * scale;
      this.state.scrollY = center.y - (center.y - this.state.scrollY) * scale;
    }

    this.state.zoom = newZoom;
    this.notify();
  }

  setScroll(x: number, y: number): void {
    this.state.scrollX = x;
    this.state.scrollY = y;
    this.notify();
  }

  pan(deltaX: number, deltaY: number): void {
    this.state.scrollX += deltaX;
    this.state.scrollY += deltaY;
    this.notify();
  }

  zoomIn(factor: number = 1.2, center?: Point): void {
    this.setZoom(this.state.zoom * factor, center);
  }

  zoomOut(factor: number = 1.2, center?: Point): void {
    this.setZoom(this.state.zoom / factor, center);
  }

  reset(): void {
    this.state = { zoom: 1, scrollX: 0, scrollY: 0 };
    this.notify();
  }

  screenToCanvas(screenX: number, screenY: number): Point {
    return {
      x: screenX / this.state.zoom - this.state.scrollX,
      y: screenY / this.state.zoom - this.state.scrollY,
    };
  }

  canvasToScreen(canvasX: number, canvasY: number): Point {
    return {
      x: (canvasX + this.state.scrollX) * this.state.zoom,
      y: (canvasY + this.state.scrollY) * this.state.zoom,
    };
  }

  fitToContent(
    elementsBounds: { minX: number; minY: number; maxX: number; maxY: number },
    containerWidth: number,
    containerHeight: number,
    padding: number = 50
  ): void {
    const contentWidth = elementsBounds.maxX - elementsBounds.minX;
    const contentHeight = elementsBounds.maxY - elementsBounds.minY;

    if (contentWidth === 0 || contentHeight === 0) {
      this.reset();
      return;
    }

    const availableWidth = containerWidth - padding * 2;
    const availableHeight = containerHeight - padding * 2;

    const scaleX = availableWidth / contentWidth;
    const scaleY = availableHeight / contentHeight;
    const zoom = Math.min(scaleX, scaleY, this.constraints.maxZoom);

    const centeredX = (containerWidth - contentWidth * zoom) / 2 - elementsBounds.minX * zoom;
    const centeredY = (containerHeight - contentHeight * zoom) / 2 - elementsBounds.minY * zoom;

    this.state.zoom = Math.max(this.constraints.minZoom, zoom);
    this.state.scrollX = centeredX / zoom;
    this.state.scrollY = centeredY / zoom;
    this.notify();
  }

  subscribe(listener: (state: ViewportState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    const snapshot = { ...this.state };
    this.listeners.forEach(fn => fn(snapshot));
  }
}

export function clampZoom(zoom: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, zoom));
}

export function zoomToFit(
  contentBounds: { minX: number; minY: number; maxX: number; maxY: number },
  containerWidth: number,
  containerHeight: number,
  padding: number = 50
): { zoom: number; scrollX: number; scrollY: number } {
  const width = contentBounds.maxX - contentBounds.minX;
  const height = contentBounds.maxY - contentBounds.minY;

  if (width === 0 || height === 0) {
    return { zoom: 1, scrollX: 0, scrollY: 0 };
  }

  const availableWidth = containerWidth - padding * 2;
  const availableHeight = containerHeight - padding * 2;

  const scaleX = availableWidth / width;
  const scaleY = availableHeight / height;
  const zoom = Math.min(scaleX, scaleY, 10);

  const centeredX = (containerWidth - width * zoom) / 2 - contentBounds.minX * zoom;
  const centeredY = (containerHeight - height * zoom) / 2 - contentBounds.minY * zoom;

  return { zoom, scrollX: centeredX / zoom, scrollY: centeredY / zoom };
}
