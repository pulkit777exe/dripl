import { v4 as uuidv4 } from 'uuid';
import { ElementSchema, type DriplElement } from '@dripl/common';

export type JsonRecord = Record<string, unknown>;

export function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function finiteNumber(value: unknown, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function normalizePoints(
  value: unknown,
  minimum: number
): Array<{ x: number; y: number }> | null {
  if (!Array.isArray(value) || value.length < minimum || value.length > 20_000) return null;
  const points: Array<{ x: number; y: number }> = [];
  for (const point of value) {
    const x = Array.isArray(point) ? point[0] : isJsonRecord(point) ? point.x : undefined;
    const y = Array.isArray(point) ? point[1] : isJsonRecord(point) ? point.y : undefined;
    const px = finiteNumber(x, Number.NaN);
    const py = finiteNumber(y, Number.NaN);
    if (!Number.isFinite(px) || !Number.isFinite(py)) return null;
    points.push({ x: px, y: py });
  }
  return points;
}

export function isSafeImageSource(value: string): boolean {
  if (value.startsWith('/')) return !value.startsWith('//');
  if (value.startsWith('data:')) return /^data:image\/(?:png|jpe?g|gif|webp);base64,/i.test(value);
  try {
    const protocol = new URL(value).protocol;
    return protocol === 'https:' || protocol === 'http:';
  } catch {
    return false;
  }
}

export function isSafeHttpUrl(value: string): boolean {
  try {
    const protocol = new URL(value).protocol;
    return protocol === 'https:' || protocol === 'http:';
  } catch {
    return false;
  }
}

function normalizeBinding(value: unknown): JsonRecord | undefined {
  if (!isJsonRecord(value) || typeof value.elementId !== 'string') return undefined;
  const rawFixedPoint = value.fixedPoint;
  const fixedPoint = Array.isArray(rawFixedPoint)
    ? { x: finiteNumber(rawFixedPoint[0], 0), y: finiteNumber(rawFixedPoint[1], 0) }
    : isJsonRecord(rawFixedPoint)
      ? { x: finiteNumber(rawFixedPoint.x, 0), y: finiteNumber(rawFixedPoint.y, 0) }
      : { x: 0, y: 0 };
  return {
    elementId: value.elementId,
    fixedPoint,
    mode: value.mode === 'orbit' ? 'orbit' : 'inside',
  };
}

/**
 * A deterministic, content-derived tie-break in the `versionNonce` range.
 *
 * FNV-1a over a canonical projection of the element. This is not a security
 * hash and does not need to be: the property being restored is only that two
 * *different* payloads for one element id do not share a freshness key, and a
 * 31-bit collision is the same order of risk the live mutation path already
 * accepts. The projection deliberately excludes `version`, `versionNonce` and
 * `updatedAt` — hashing those would be circular, and `updatedAt` differs per
 * import for identical content, which would make re-importing a file look like
 * a new edit.
 *
 * Key order is fixed because the caller builds the element from an object
 * literal and then assigns a known set of optional fields, so `JSON.stringify`
 * over the result is canonical for this path.
 */
function contentNonce(element: JsonRecord): number {
  const content: JsonRecord = {};
  for (const [key, value] of Object.entries(element)) {
    // `version` and `versionNonce` would be circular, and `updatedAt` differs
    // per import for identical content, which would make re-importing a file
    // look like a new edit.
    if (key === 'version' || key === 'versionNonce' || key === 'updatedAt') continue;
    content[key] = value;
  }
  const material = JSON.stringify(content);
  let hash = 0x811c9dc5;
  for (let index = 0; index < material.length; index += 1) {
    hash ^= material.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  // Stay inside the non-negative int32 range the schema and comparator expect.
  return hash % 2_147_483_647;
}

export function normalizeImportedElement(value: unknown, files: JsonRecord): DriplElement | null {
  if (!isJsonRecord(value)) return null;
  const rawType = typeof value.type === 'string' ? value.type : 'rectangle';
  const type = rawType === 'embeddable' ? 'embed' : rawType === 'magicframe' ? 'frame' : rawType;
  if (
    ![
      'rectangle',
      'ellipse',
      'diamond',
      'line',
      'arrow',
      'freedraw',
      'text',
      'image',
      'frame',
      'embed',
      'path',
    ].includes(type)
  ) {
    return null;
  }

  const id = typeof value.id === 'string' && value.id.length > 0 ? value.id : uuidv4();
  const x = finiteNumber(value.x, 0);
  const y = finiteNumber(value.y, 0);
  const width = Math.max(
    0,
    finiteNumber(value.width, type === 'line' || type === 'arrow' ? 1 : 100)
  );
  const height = Math.max(
    0,
    finiteNumber(value.height, type === 'line' || type === 'arrow' ? 1 : 100)
  );
  const points = normalizePoints(value.points, type === 'freedraw' || type === 'path' ? 1 : 2);
  const normalized: JsonRecord = {
    id,
    type,
    x,
    y,
    width,
    height,
    angle: finiteNumber(value.angle, 0),
    strokeColor: typeof value.strokeColor === 'string' ? value.strokeColor : '#1e1e1e',
    backgroundColor:
      typeof value.backgroundColor === 'string' ? value.backgroundColor : 'transparent',
    fillColor:
      typeof value.fillColor === 'string'
        ? value.fillColor
        : typeof value.backgroundColor === 'string'
          ? value.backgroundColor
          : 'transparent',
    strokeWidth: finiteNumber(value.strokeWidth, 2),
    strokeStyle:
      value.strokeStyle === 'dashed' || value.strokeStyle === 'dotted'
        ? value.strokeStyle
        : 'solid',
    roughness: finiteNumber(value.roughness, 1),
    opacity: finiteNumber(value.opacity, 1),
    locked: value.locked === true,
    isDeleted: value.isDeleted === true,
    version: Number.isInteger(value.version) && (value.version as number) >= 0 ? value.version : 1,
    updatedAt: Date.now(),
  };

  if (typeof value.fractionalIndex === 'string') normalized.fractionalIndex = value.fractionalIndex;
  else if (typeof value.index === 'string') normalized.fractionalIndex = value.index;
  if (typeof value.groupId === 'string') normalized.groupId = value.groupId;
  else if (Array.isArray(value.groupIds) && typeof value.groupIds[0] === 'string')
    normalized.groupId = value.groupIds[0];
  if (typeof value.frameId === 'string') normalized.containerId = value.frameId;
  if (Array.isArray(value.boundElements)) {
    const boundElements = value.boundElements.flatMap(bound => {
      if (!isJsonRecord(bound) || typeof bound.id !== 'string') return [];
      if (bound.type !== 'arrow' && bound.type !== 'text') return [];
      return [{ id: bound.id, type: bound.type }];
    });
    if (boundElements.length > 0) normalized.boundElements = boundElements;
  }
  if (typeof value.seed === 'number') normalized.seed = value.seed;

  // `versionNonce` is the tie-break *within* one version, so it must differ
  // whenever the payload differs. A file that omits it used to be given a
  // constant 0, which meant two divergent copies of the same canvas — two
  // people editing, exporting, and re-importing — produced elements tied at
  // the same (version, nonce) with different content. That tie is resolved by
  // arrival order, so the replicas did not converge: the merge keeps whichever
  // payload arrived first. `reconciliation.ts` documents the exact condition,
  // and this was the one place it was reachable by a user rather than by a
  // 2^-31 random collision.
  //
  // A file that DOES carry a nonce keeps it: that value came from the producer
  // that minted the version, and inventing a different one would break
  // ordering against the live scene. Only the absent case is filled in.
  normalized.versionNonce =
    Number.isInteger(value.versionNonce) && (value.versionNonce as number) >= 0
      ? (value.versionNonce as number)
      : contentNonce(normalized);

  if (type === 'line' || type === 'arrow' || type === 'freedraw' || type === 'path') {
    if (!points) return null;
    normalized.points = points;
  }
  if (type === 'arrow' || type === 'line') {
    if (
      value.arrowStyle === 'curved' ||
      value.arrowStyle === 'elbow' ||
      value.arrowStyle === 'straight'
    ) {
      normalized.arrowStyle = value.arrowStyle;
    } else if (value.elbowed === true) {
      normalized.arrowStyle = 'elbow';
    }
    if (isJsonRecord(value.arrowHeads)) normalized.arrowHeads = value.arrowHeads;
    else if (typeof value.startArrowhead === 'string' || typeof value.endArrowhead === 'string') {
      normalized.arrowHeads = {
        ...(typeof value.startArrowhead === 'string' ? { start: value.startArrowhead } : {}),
        ...(typeof value.endArrowhead === 'string' ? { end: value.endArrowhead } : {}),
      };
    }
    const startBinding = normalizeBinding(value.startBinding);
    const endBinding = normalizeBinding(value.endBinding);
    if (startBinding) normalized.startBinding = startBinding;
    if (endBinding) normalized.endBinding = endBinding;
  }
  if (type === 'text') {
    normalized.text = typeof value.text === 'string' ? value.text : '';
    normalized.originalText =
      typeof value.originalText === 'string' ? value.originalText : normalized.text;
    normalized.fontSize = Math.max(1, finiteNumber(value.fontSize, 20));
    normalized.fontFamily = typeof value.fontFamily === 'string' ? value.fontFamily : 'Caveat';
    normalized.textAlign =
      value.textAlign === 'center' || value.textAlign === 'right' ? value.textAlign : 'left';
    normalized.verticalAlign =
      value.verticalAlign === 'top' || value.verticalAlign === 'bottom'
        ? value.verticalAlign
        : 'middle';
    if (typeof value.containerId === 'string') normalized.containerId = value.containerId;
  }
  if (type === 'image') {
    const fileId = typeof value.fileId === 'string' ? value.fileId : null;
    const file = fileId && isJsonRecord(files[fileId]) ? files[fileId] : null;
    const src =
      typeof value.src === 'string'
        ? value.src
        : typeof value.dataUrl === 'string'
          ? value.dataUrl
          : typeof value.dataURL === 'string'
            ? value.dataURL
            : file && typeof file.dataURL === 'string'
              ? file.dataURL
              : file && typeof file.dataUrl === 'string'
                ? file.dataUrl
                : undefined;
    if (src && isSafeImageSource(src)) {
      normalized.src = src;
      if (!normalized.dataUrl && src.startsWith('data:')) normalized.dataUrl = src;
    } else {
      return null;
    }
  }
  if (type === 'embed') {
    const url =
      typeof value.url === 'string' ? value.url : typeof value.link === 'string' ? value.link : '';
    if (!url || !isSafeHttpUrl(url)) return null;
    normalized.url = url;
    if (typeof value.title === 'string') normalized.title = value.title;
  }
  if (type === 'frame' && typeof value.name === 'string') normalized.title = value.name;

  const parsed = ElementSchema.safeParse(normalized);
  return parsed.success ? (parsed.data as DriplElement) : null;
}

export function remapElementReferences(
  element: DriplElement,
  ids: Map<string, string>
): DriplElement {
  const next = { ...element } as DriplElement & {
    startBinding?: { elementId: string };
    endBinding?: { elementId: string };
  };
  const remap = (id: unknown): unknown => (typeof id === 'string' ? (ids.get(id) ?? id) : id);
  next.groupId = remap(next.groupId) as string | undefined;
  next.labelId = remap(next.labelId) as string | undefined;
  next.containerId = remap(next.containerId) as string | undefined;
  next.boundElementId = remap(next.boundElementId) as string | undefined;
  if (next.startBinding)
    next.startBinding = {
      ...next.startBinding,
      elementId: String(remap(next.startBinding.elementId)),
    };
  if (next.endBinding)
    next.endBinding = { ...next.endBinding, elementId: String(remap(next.endBinding.elementId)) };
  if (next.boundElements) {
    next.boundElements = next.boundElements.map(bound => ({
      ...bound,
      id: String(remap(bound.id)),
    }));
  }
  return next;
}
