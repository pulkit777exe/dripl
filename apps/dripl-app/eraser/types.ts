import { Point } from "@dripl/common";

export interface EraserPoint extends Point {
  timestamp: number;
  pressure?: number;
}

export interface EraserConfig {
  size: number;
  color: string;
  fadeTime: number;
  streamline?: number;
  keepHead?: boolean;
}

export interface EraserState {
  isActive: boolean;
  points: EraserPoint[];
  elementsToErase: Set<string>;
}

export interface TrailSegment {
  start: Point;
  end: Point;
  timestamp: number;
}
