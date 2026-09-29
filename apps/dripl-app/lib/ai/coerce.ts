import { randomUUID } from 'node:crypto';
import type { Point } from '@dripl/common';
import {
  CSS_COLOR_FUNCTION_PATTERN,
  HEX_COLOR_PATTERN,
  MAX_AI_POINTS,
  UUID_PATTERN,
} from './constants';

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function readNumber(value: unknown, fallback: number): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

export function boundedNumber(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number
): number {
  const numberValue = readNumber(value, fallback);
  return Math.min(maximum, Math.max(minimum, numberValue ?? fallback));
}

export function readColor(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const color = value.trim();
  if (color.length > 80) return fallback;
  if (HEX_COLOR_PATTERN.test(color) || CSS_COLOR_FUNCTION_PATTERN.test(color)) return color;
  return fallback;
}

export function readString(value: unknown, fallback = '', maxLength = 10_000): string {
  if (typeof value !== 'string') return fallback;
  return value.trim().slice(0, maxLength);
}

export function readCoordinate(
  element: Record<string, unknown>,
  key: 'x' | 'y',
  fallback: number
): number {
  const position = isRecord(element.position) ? element.position : undefined;
  const value = element[key] ?? position?.[key];
  return boundedNumber(value, fallback, -100_000, 100_000);
}

export function normalizePoints(value: unknown): Point[] | null {
  if (!Array.isArray(value)) return [];
  if (value.length > MAX_AI_POINTS) return null;

  const points: Point[] = [];
  for (const point of value) {
    let x: unknown;
    let y: unknown;

    if (Array.isArray(point) && point.length >= 2) {
      [x, y] = point;
    } else if (isRecord(point)) {
      x = point.x;
      y = point.y;
    } else {
      return null;
    }

    const normalizedX = readNumber(x, Number.NaN);
    const normalizedY = readNumber(y, Number.NaN);
    if (normalizedX === null || normalizedY === null) return null;
    if (!Number.isFinite(normalizedX) || !Number.isFinite(normalizedY)) return null;
    points.push({
      x: Math.min(100_000, Math.max(-100_000, normalizedX)),
      y: Math.min(100_000, Math.max(-100_000, normalizedY)),
    });
  }
  return points;
}

export function newElementId(usedIds: Set<string>): string {
  let id = randomUUID();
  while (usedIds.has(id)) id = randomUUID();
  usedIds.add(id);
  return id;
}

export function normalizeId(value: unknown, usedIds: Set<string>): string {
  if (typeof value === 'string' && UUID_PATTERN.test(value) && !usedIds.has(value)) {
    usedIds.add(value);
    return value;
  }
  return newElementId(usedIds);
}
