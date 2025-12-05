import { Point } from "@dripl/common";
import { EraserPoint, EraserConfig, EraserState, TrailSegment } from "./types";
import { easeOut, streamlinePoints, distance, now } from "./utils";

export class EraserTrail {
  private ctx: CanvasRenderingContext2D;
  private config: EraserConfig;
  private state: EraserState;
  private animationFrameId: number | null = null;

  constructor(
    ctx: CanvasRenderingContext2D,
    config: Partial<EraserConfig> = {}
  ) {
    this.ctx = ctx;
    this.config = {
      size: config.size ?? 5,
      color: config.color ?? "rgba(255, 100, 100, 0.3)",
      fadeTime: config.fadeTime ?? 200,
      streamline: config.streamline ?? 0.2,
      keepHead: config.keepHead ?? true,
    };
    this.state = {
      isActive: false,
      points: [],
      elementsToErase: new Set(),
    };
  }

  /**
   * Start a new eraser path
   */
  startPath(x: number, y: number): void {
    this.endPath();
    this.state.isActive = true;
    this.state.points = [
      {
        x,
        y,
        timestamp: now(),
        pressure: 1,
      },
    ];
    this.state.elementsToErase.clear();
  }

  /**
   * Add a point to the current path
   */
  addPoint(x: number, y: number): void {
    if (!this.state.isActive) return;

    const point: EraserPoint = {
      x,
      y,
      timestamp: now(),
      pressure: 1,
    };

    this.state.points.push(point);
  }

  /**
   * End the current path
   */
  endPath(): void {
    this.state.isActive = false;
    this.state.points = [];
    this.state.elementsToErase.clear();
  }

  /**
   * Get the current trail points (streamlined)
   */
  getTrailPoints(): EraserPoint[] {
    if (this.config.streamline && this.config.streamline > 0) {
      return streamlinePoints(this.state.points, this.config.streamline);
    }
    return this.state.points;
  }

  /**
   * Get trail segments for intersection testing
   */
  getTrailSegments(): TrailSegment[] {
    const points = this.getTrailPoints();
    const segments: TrailSegment[] = [];

    for (let i = 0; i < points.length - 1; i++) {
      const start = points[i]!;
      const end = points[i + 1]!;
      segments.push({
        start: { x: start.x, y: start.y },
        end: { x: end.x, y: end.y },
        timestamp: start.timestamp,
      });
    }

    return segments;
  }

  /**
   * Get the last segment for incremental testing
   */
  getLastSegment(): TrailSegment | null {
    const points = this.state.points;
    if (points.length < 2) return null;

    const start = points[points.length - 2]!;
    const end = points[points.length - 1]!;

    return {
      start: { x: start.x, y: start.y },
      end: { x: end.x, y: end.y },
      timestamp: start.timestamp,
    };
  }

  /**
   * Render the eraser trail with fade-out animation
   */
  render(panOffset: Point = { x: 0, y: 0 }, zoom: number = 1): void {
    if (this.state.points.length < 2) return;

    const points = this.getTrailPoints();
    const currentTime = now();

    this.ctx.save();
    this.ctx.translate(panOffset.x, panOffset.y);
    this.ctx.scale(zoom, zoom);

    // Draw trail segments with fade
    for (let i = 0; i < points.length - 1; i++) {
      const p1 = points[i]!;
      const p2 = points[i + 1]!;

      // Calculate fade based on time
      const age = currentTime - p1.timestamp;
      const fadeProgress = Math.max(0, 1 - age / this.config.fadeTime);
      const alpha = easeOut(fadeProgress);

      if (alpha <= 0) continue;

      // Parse color and apply alpha
      const color = this.config.color.replace(/[\d.]+\)$/g, `${alpha * 0.3})`);

      this.ctx.beginPath();
      this.ctx.strokeStyle = color;
      this.ctx.lineWidth = this.config.size / zoom;
      this.ctx.lineCap = "round";
      this.ctx.lineJoin = "round";
      this.ctx.moveTo(p1.x, p1.y);
      this.ctx.lineTo(p2.x, p2.y);
      this.ctx.stroke();
    }

    // Draw head circle if enabled
    if (this.config.keepHead && points.length > 0) {
      const head = points[points.length - 1]!;
      this.ctx.beginPath();
      this.ctx.fillStyle = this.config.color;
      this.ctx.arc(head.x, head.y, this.config.size / zoom, 0, Math.PI * 2);
      this.ctx.fill();
    }

    this.ctx.restore();
  }

  /**
   * Mark an element for erasing
   */
  markElementForErase(elementId: string): void {
    this.state.elementsToErase.add(elementId);
  }

  /**
   * Unmark an element from erasing
   */
  unmarkElementForErase(elementId: string): void {
    this.state.elementsToErase.delete(elementId);
  }

  /**
   * Get elements marked for erasing
   */
  getElementsToErase(): string[] {
    return Array.from(this.state.elementsToErase);
  }

  /**
   * Check if trail is active
   */
  isActive(): boolean {
    return this.state.isActive;
  }

  /**
   * Clear all trail data
   */
  clear(): void {
    this.state.points = [];
    this.state.elementsToErase.clear();
  }
}
