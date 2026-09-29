import { DriplElementSchema, type DriplElement } from '@dripl/common';
import { MAX_AI_ELEMENTS, MAX_LABEL_LENGTH, VALID_ELEMENT_TYPES } from './constants';
import {
  boundedNumber,
  isRecord,
  newElementId,
  normalizeId,
  normalizePoints,
  readColor,
  readCoordinate,
  readString,
} from './coerce';

export function wrapLabel(text: string, width: number, fontSize: number): string[] {
  const maxCharacters = Math.max(1, Math.floor(width / Math.max(1, fontSize * 0.58)));
  const lines: string[] = [];

  for (const paragraph of text.split(/\r?\n/)) {
    const words = paragraph.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      lines.push('');
      continue;
    }

    let line = '';
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (line && candidate.length > maxCharacters) {
        lines.push(line);
        line = word;
      } else {
        line = candidate;
      }
    }
    if (line) lines.push(line);
  }

  return lines.length > 0 ? lines : [''];
}

export function createBoundLabel(
  rawElement: Record<string, unknown>,
  owner: DriplElement,
  usedIds: Set<string>
): DriplElement | null {
  if (owner.type === 'text') return null;

  const label = readString(rawElement.text, '', MAX_LABEL_LENGTH);
  if (!label) return null;

  const fontSize = boundedNumber(rawElement.fontSize, 16, 8, 72);
  const labelWidth = Math.max(1, owner.width - 20);
  const lines = wrapLabel(label, labelWidth, fontSize);
  const labelHeight = Math.max(fontSize * 1.2, lines.length * fontSize * 1.2);
  const rawLabel = {
    id: newElementId(usedIds),
    type: 'text' as const,
    x: owner.x + Math.max(0, (owner.width - labelWidth) / 2),
    y: owner.y + Math.max(0, (owner.height - labelHeight) / 2),
    width: labelWidth,
    height: labelHeight,
    text: lines.join('\n'),
    fontSize,
    fontFamily: readString(rawElement.fontFamily, 'Caveat', 100),
    textAlign: 'center' as const,
    verticalAlign: 'middle' as const,
    strokeColor: readColor(rawElement.strokeColor, owner.strokeColor ?? '#000000'),
    boundElementId: owner.id,
    containerId: owner.id,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  const parsed = DriplElementSchema.safeParse(rawLabel);
  return parsed.success ? (parsed.data as DriplElement) : null;
}

export interface NormalizedModelOutput {
  elements: DriplElement[];
  droppedCount: number;
  truncatedCount: number;
}

export function normalizeModelElements(rawElements: unknown[]): NormalizedModelOutput {
  const usedIds = new Set<string>();
  const prepared: Array<{ raw: Record<string, unknown>; id: string }> = [];

  for (const rawValue of rawElements.slice(0, MAX_AI_ELEMENTS)) {
    if (!isRecord(rawValue)) continue;
    const rawType = rawValue.type;
    const type =
      typeof rawType === 'string' && VALID_ELEMENT_TYPES.has(rawType)
        ? rawType
        : rawType === undefined || rawType === null
          ? 'rectangle'
          : null;
    if (!type) continue;

    const id = normalizeId(rawValue.id, usedIds);
    prepared.push({ raw: { ...rawValue, type }, id });
  }

  const elements: DriplElement[] = [];
  let droppedCount = rawElements.length - prepared.length;
  let labelsDropped = 0;

  for (const { raw, id } of prepared) {
    const type = raw.type as string;
    const x = readCoordinate(raw, 'x', 100);
    const y = readCoordinate(raw, 'y', 100);
    const width = boundedNumber(raw.width, 120, 1, 50_000);
    const height = boundedNumber(raw.height, 80, 1, 50_000);
    const points = normalizePoints(raw.points);
    const hasLinearPoints =
      type === 'arrow' || type === 'line' || type === 'freedraw' || type === 'path';

    if (points === null || ((type === 'arrow' || type === 'line') && points.length < 2)) {
      droppedCount += 1;
      continue;
    }

    const normalized: Record<string, unknown> = {
      id,
      type,
      x,
      y,
      width,
      height,
      angle: boundedNumber(raw.angle, 0, -Math.PI * 2, Math.PI * 2),
      strokeColor: readColor(raw.strokeColor, '#6965db'),
      backgroundColor: readColor(raw.fillColor, readColor(raw.backgroundColor, 'transparent')),
      fillColor: readColor(raw.fillColor, readColor(raw.backgroundColor, 'transparent')),
      strokeWidth: boundedNumber(raw.strokeWidth, 2, 0.5, 20),
      strokeStyle:
        raw.strokeStyle === 'dashed' || raw.strokeStyle === 'dotted' || raw.strokeStyle === 'solid'
          ? raw.strokeStyle
          : 'solid',
      roughness: boundedNumber(raw.roughness, 1, 0, 2),
      opacity: boundedNumber(raw.opacity, 1, 0, 1),
      locked: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    if (hasLinearPoints) normalized.points = points;
    if (type === 'text') {
      normalized.text = readString(raw.text, '', 10_000);
      normalized.originalText = normalized.text;
      normalized.fontSize = boundedNumber(raw.fontSize, 20, 1, 500);
      normalized.fontFamily = readString(raw.fontFamily, 'Caveat', 100);
      normalized.textAlign =
        raw.textAlign === 'center' || raw.textAlign === 'right' || raw.textAlign === 'left'
          ? raw.textAlign
          : 'left';
      normalized.verticalAlign =
        raw.verticalAlign === 'top' ||
        raw.verticalAlign === 'bottom' ||
        raw.verticalAlign === 'middle'
          ? raw.verticalAlign
          : 'middle';
    }

    const parsed = DriplElementSchema.safeParse(normalized);
    if (!parsed.success) {
      droppedCount += 1;
      continue;
    }

    const element = parsed.data as DriplElement;
    elements.push(element);

    const label = createBoundLabel(raw, element, usedIds);
    if (label) {
      if (elements.length < MAX_AI_ELEMENTS) {
        const ownerIndex = elements.findIndex(candidate => candidate.id === element.id);
        if (ownerIndex >= 0) {
          const owner = elements[ownerIndex]!;
          const boundElements = [
            ...(owner.boundElements ?? []),
            { id: label.id, type: 'text' as const },
          ].slice(-1000);
          elements[ownerIndex] = {
            ...owner,
            labelId: label.id,
            boundElements,
          } as DriplElement;
        }
        elements.push(label);
      } else labelsDropped += 1;
    } else if (readString(raw.text, '', MAX_LABEL_LENGTH)) {
      labelsDropped += 1;
    }
  }

  const truncatedCount = Math.max(0, rawElements.length - MAX_AI_ELEMENTS) + labelsDropped;
  if (elements.length > MAX_AI_ELEMENTS) elements.splice(MAX_AI_ELEMENTS);

  return { elements, droppedCount, truncatedCount };
}
