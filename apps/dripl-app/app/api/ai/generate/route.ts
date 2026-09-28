import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { DriplElementSchema, type DriplElement, type Point } from '@dripl/common';
import { extractBearerToken, verifyToken } from '@dripl/utils/auth';
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import { z } from 'zod';
import {
  readRequestBody as readSharedRequestBody,
  RequestBodyTooLargeError,
} from '@/lib/server/requestBody';
import { hasAllowedOrigin } from '@/lib/server/origin';

// Keep this route on the Node runtime. Session verification and the Gemini
// client both use Node-compatible APIs, and the route must never run as an
// Edge function with a different crypto/runtime contract.
export const runtime = 'nodejs';

const GEMINI_MODEL = 'gemini-2.5-flash';
const MAX_PROMPT_LENGTH = 2_000;
const MAX_REQUEST_BYTES = 32 * 1024;
const MAX_MODEL_RESPONSE_LENGTH = 200_000;
const GEMINI_REQUEST_TIMEOUT_MS = 15_000;
const MAX_GEMINI_RETRIES = 1;
const MAX_AI_ELEMENTS = 100;
const MAX_AI_POINTS = 10_000;
const MAX_LABEL_LENGTH = 500;
const MAX_LOCAL_RATE_LIMIT_ENTRIES = 10_000;
const RATE_LIMIT_MAX = 10;
const RATE_WINDOW_MS = 60 * 60 * 1_000;

const SYSTEM_PROMPT = `You are an AI that generates diagram layouts for a canvas drawing application called Dripl.

Return ONLY a JSON array of diagram elements. The response must be valid JSON with no markdown fences or explanation.
Each element must use these properties:
- id: a unique string (the server may replace it with a safe UUID)
- type: "rectangle" | "ellipse" | "diamond" | "arrow" | "line" | "text"
- x: finite number (absolute canvas x position)
- y: finite number (absolute canvas y position)
- width: finite positive number
- height: finite positive number
- strokeColor: hex color string
- backgroundColor: hex color string or "transparent"
- fillColor: hex color string or "transparent"
- strokeWidth: finite number
- roughness: number from 0 to 2
- text: string label for a shape, or the text content for a text element
- points: [{x: number, y: number}, ...] for arrows/lines, relative to x/y

Do not nest coordinates in a position object. Do not return nulls, partial objects, or explanatory text.
Create organized diagrams with 100-150px spacing. Start around x:100, y:100 and position elements left-to-right or top-to-bottom based on the flow.`;

const GenerateRequestSchema = z.object({
  prompt: z.string().trim().min(1).max(MAX_PROMPT_LENGTH),
});

const VALID_ELEMENT_TYPES = new Set(['rectangle', 'ellipse', 'diamond', 'arrow', 'line', 'text']);

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HEX_COLOR_PATTERN = /^(?:#[0-9a-f]{3,8}|transparent)$/i;
const CSS_COLOR_FUNCTION_PATTERN = /^(?:rgb|rgba|hsl|hsla)\([^)]{1,80}\)$/i;

let genAI: GoogleGenerativeAI | null = null;
let aiRateLimit: Ratelimit | null = null;

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

interface RateLimitResult {
  allowed: boolean;
  retryAfter?: number;
  unavailable?: boolean;
}

const rateLimitMap = new Map<string, RateLimitEntry>();

function getGenAI(): GoogleGenerativeAI {
  if (!genAI) genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY ?? '');
  return genAI;
}

function getAiRateLimit(): Ratelimit | null {
  if (aiRateLimit) return aiRateLimit;

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;

  aiRateLimit = new Ratelimit({
    redis: new Redis({ url, token }),
    limiter: Ratelimit.slidingWindow(RATE_LIMIT_MAX, '1 h'),
    prefix: 'dripl:ai:ratelimit:v2',
  });
  return aiRateLimit;
}

/**
 * The local fallback is deliberately lazy and bounded. A timer in a Next
 * route module is not reliable in serverless runtimes and would keep a warm
 * process alive; pruning on each request gives the same memory bound without
 * a lifecycle leak.
 */
function pruneLocalRateLimits(now: number): void {
  for (const [key, entry] of rateLimitMap) {
    if (entry.resetTime <= now) rateLimitMap.delete(key);
  }

  while (rateLimitMap.size >= MAX_LOCAL_RATE_LIMIT_ENTRIES) {
    const oldestKey = rateLimitMap.keys().next().value;
    if (oldestKey === undefined) break;
    rateLimitMap.delete(oldestKey);
  }
}

function checkLocalRateLimit(userId: string): RateLimitResult {
  const now = Date.now();
  pruneLocalRateLimits(now);

  const entry = rateLimitMap.get(userId);
  if (!entry || entry.resetTime <= now) {
    rateLimitMap.set(userId, { count: 1, resetTime: now + RATE_WINDOW_MS });
    return { allowed: true };
  }

  if (entry.count >= RATE_LIMIT_MAX) {
    return {
      allowed: false,
      retryAfter: Math.max(1, Math.ceil((entry.resetTime - now) / 1_000)),
    };
  }

  entry.count += 1;
  return { allowed: true };
}

async function checkRateLimit(userId: string): Promise<RateLimitResult> {
  let limiter: Ratelimit | null;
  try {
    limiter = getAiRateLimit();
  } catch {
    // A configured but broken Redis must fail closed. Falling through to the
    // Gemini call here would turn a rate-limit outage into unbounded spend.
    return { allowed: false, retryAfter: 60, unavailable: true };
  }

  if (!limiter) return checkLocalRateLimit(userId);

  try {
    const result = await limiter.limit(`user:${userId}`);
    const reset = Number(result.reset);
    if (!result.success) {
      const retryAfter = Number.isFinite(reset)
        ? Math.max(1, Math.ceil((reset - Date.now()) / 1_000))
        : 60;
      return { allowed: false, retryAfter };
    }
    return { allowed: true };
  } catch {
    return { allowed: false, retryAfter: 60, unavailable: true };
  }
}

/** Clear the in-process limiter state for graceful shutdowns and tests. */
export function clearAiRateLimitState(): void {
  rateLimitMap.clear();
  aiRateLimit = null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getSessionTokens(request: NextRequest): string[] {
  const tokens: string[] = [];
  const cookieToken = request.cookies?.get('dripl-session')?.value;
  if (cookieToken) {
    try {
      tokens.push(decodeURIComponent(cookieToken));
    } catch {
      tokens.push(cookieToken);
    }
  }

  const bearerToken = extractBearerToken(request.headers.get('authorization') ?? undefined);
  if (bearerToken && !tokens.includes(bearerToken)) tokens.push(bearerToken);
  return tokens;
}

function getAuthenticatedUserId(request: NextRequest): string | null {
  for (const token of getSessionTokens(request)) {
    const payload = verifyToken(token);
    if (!payload || typeof payload.userId !== 'string') continue;
    const userId = payload.userId.trim();
    if (userId && userId.length <= 200) return userId;
  }
  return null;
}

function readNumber(value: unknown, fallback: number): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function boundedNumber(value: unknown, fallback: number, minimum: number, maximum: number): number {
  const numberValue = readNumber(value, fallback);
  return Math.min(maximum, Math.max(minimum, numberValue ?? fallback));
}

function readColor(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const color = value.trim();
  if (color.length > 80) return fallback;
  if (HEX_COLOR_PATTERN.test(color) || CSS_COLOR_FUNCTION_PATTERN.test(color)) return color;
  return fallback;
}

function readString(value: unknown, fallback = '', maxLength = 10_000): string {
  if (typeof value !== 'string') return fallback;
  return value.trim().slice(0, maxLength);
}

function readCoordinate(
  element: Record<string, unknown>,
  key: 'x' | 'y',
  fallback: number
): number {
  const position = isRecord(element.position) ? element.position : undefined;
  const value = element[key] ?? position?.[key];
  return boundedNumber(value, fallback, -100_000, 100_000);
}

function normalizePoints(value: unknown): Point[] | null {
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

function newElementId(usedIds: Set<string>): string {
  let id = randomUUID();
  while (usedIds.has(id)) id = randomUUID();
  usedIds.add(id);
  return id;
}

function normalizeId(value: unknown, usedIds: Set<string>): string {
  if (typeof value === 'string' && UUID_PATTERN.test(value) && !usedIds.has(value)) {
    usedIds.add(value);
    return value;
  }
  return newElementId(usedIds);
}

function wrapLabel(text: string, width: number, fontSize: number): string[] {
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

function createBoundLabel(
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

interface NormalizedModelOutput {
  elements: DriplElement[];
  droppedCount: number;
  truncatedCount: number;
}

function normalizeModelElements(rawElements: unknown[]): NormalizedModelOutput {
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

function extractBalancedArray(text: string): string | null {
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  // Scan once. The previous implementation restarted at every unmatched '[',
  // which made a response containing many opening brackets quadratic.
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') inString = false;
      continue;
    }

    if (character === '"') {
      inString = true;
    } else if (character === '[') {
      if (depth === 0) start = index;
      depth += 1;
    } else if (character === ']' && depth > 0) {
      depth -= 1;
      if (depth === 0 && start >= 0) return text.slice(start, index + 1);
    }
  }
  return null;
}

function parseJsonCandidate(candidate: string): unknown[] | null {
  try {
    const parsed: unknown = JSON.parse(candidate);
    if (Array.isArray(parsed)) return parsed;
    if (isRecord(parsed) && Array.isArray(parsed.elements)) return parsed.elements;
  } catch {
    // Try the next candidate. Model prose and Markdown fences are common.
  }
  return null;
}

function parseModelElements(text: string): unknown[] {
  if (text.length > MAX_MODEL_RESPONSE_LENGTH) {
    throw new AiResponseError('AI_RESPONSE_ERROR', 'The AI response was too large to process.');
  }

  const candidates: string[] = [text.trim()];
  const fencedPattern = /```(?:json)?\s*([\s\S]*?)\s*```/gi;
  for (const match of text.matchAll(fencedPattern)) {
    const fenced = match[1]?.trim();
    if (fenced) candidates.push(fenced);
  }
  const balancedArray = extractBalancedArray(text);
  if (balancedArray) candidates.push(balancedArray);

  for (const candidate of candidates) {
    const parsed = parseJsonCandidate(candidate);
    if (parsed) return parsed;
  }

  throw new AiResponseError('AI_RESPONSE_ERROR', 'The AI returned an unusable diagram.');
}

class AiResponseError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 502
  ) {
    super(message);
    this.name = 'AiResponseError';
  }
}

function responseText(result: unknown): string {
  if (!isRecord(result) || !isRecord(result.response)) {
    throw new AiResponseError('AI_RESPONSE_ERROR', 'The AI returned an empty response.');
  }

  const response = result.response;
  const feedback = isRecord(response.promptFeedback) ? response.promptFeedback : undefined;
  const blockReason = feedback?.blockReason;
  if (typeof blockReason === 'string' && blockReason !== 'BLOCKED_REASON_UNSPECIFIED') {
    throw new AiResponseError(
      'CONTENT_BLOCKED',
      'The AI could not generate a diagram for that prompt.',
      422
    );
  }

  const candidate = Array.isArray(response.candidates) ? response.candidates[0] : undefined;
  const finishReason = isRecord(candidate) ? candidate.finishReason : undefined;
  if (
    typeof finishReason === 'string' &&
    !['STOP', 'FINISH_REASON_UNSPECIFIED'].includes(finishReason)
  ) {
    const code = finishReason === 'MAX_TOKENS' ? 'AI_INCOMPLETE' : 'CONTENT_BLOCKED';
    const message =
      finishReason === 'MAX_TOKENS'
        ? 'The AI response was incomplete. Try a shorter or simpler prompt.'
        : 'The AI could not generate a diagram for that prompt.';
    throw new AiResponseError(code, message, finishReason === 'MAX_TOKENS' ? 502 : 422);
  }

  const textMethod = response.text;
  let text: unknown;
  try {
    text =
      typeof textMethod === 'function' ? (textMethod as () => unknown).call(response) : textMethod;
  } catch {
    throw new AiResponseError('AI_RESPONSE_ERROR', 'The AI returned an empty response.');
  }

  if (typeof text !== 'string' || text.trim() === '') {
    throw new AiResponseError('AI_RESPONSE_ERROR', 'The AI returned an empty response.');
  }
  return text;
}

function errorStatus(error: unknown): number | undefined {
  if (!isRecord(error)) return undefined;
  const value = error.status ?? error.statusCode;
  return typeof value === 'number' ? value : undefined;
}

function serializeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (isRecord(error)) {
    return JSON.stringify({
      name: typeof error.name === 'string' ? error.name : undefined,
      message: typeof error.message === 'string' ? error.message : undefined,
      status: errorStatus(error),
    });
  }
  return String(error);
}

function isRetryableGeminiError(error: unknown): boolean {
  const status = errorStatus(error);
  // 429 commonly means exhausted quota/billing on Gemini. Retrying it adds
  // latency and cost without making the request succeed.
  if (status !== undefined) return [408, 500, 502, 503, 504].includes(status);
  const message = error instanceof Error ? error.message : String(error);
  return /(?:temporar|unavailable|overloaded|timeout|try again|retry)/i.test(message);
}

type GeminiModel = ReturnType<GoogleGenerativeAI['getGenerativeModel']>;
type GeminiResult = Awaited<ReturnType<GeminiModel['generateContent']>>;

class RequestAbortedError extends Error {
  constructor() {
    super('The AI request was cancelled');
    this.name = 'AbortError';
  }
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new RequestAbortedError();
}

function waitWithAbort(delayMs: number, signal: AbortSignal): Promise<void> {
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, delayMs);
    const onAbort = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      reject(new RequestAbortedError());
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function raceWithAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      reject(new RequestAbortedError());
    };
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      value => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      error => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      }
    );
  });
}

async function generateWithRetry(
  model: GeminiModel,
  prompt: string,
  signal: AbortSignal
): Promise<GeminiResult> {
  for (let attempt = 0; attempt <= MAX_GEMINI_RETRIES; attempt += 1) {
    throwIfAborted(signal);
    try {
      return await raceWithAbort(
        model.generateContent(prompt, {
          timeout: GEMINI_REQUEST_TIMEOUT_MS,
          signal,
        }),
        signal
      );
    } catch (error) {
      if (error instanceof RequestAbortedError) throw error;
      throwIfAborted(signal);
      if (attempt === MAX_GEMINI_RETRIES || !isRetryableGeminiError(error)) throw error;
      const delay = Math.min(4_000, 750 * 2 ** attempt + Math.floor(Math.random() * 250));
      await waitWithAbort(delay, signal);
    }
  }
  throw new Error('Gemini request failed');
}

function errorResponse(
  error: string,
  code: string,
  status: number,
  extra: Record<string, unknown> = {}
): NextResponse {
  const headers: Record<string, string> = { 'Cache-Control': 'no-store' };
  if (typeof extra.retryAfter === 'number' && Number.isFinite(extra.retryAfter)) {
    headers['Retry-After'] = String(Math.max(1, Math.ceil(extra.retryAfter)));
  } else if (status === 429) {
    headers['Retry-After'] = '60';
  }
  return NextResponse.json({ error, code, ...extra }, { status, headers });
}

async function readRequestBodyWithDeclaredLengthCheck(request: NextRequest): Promise<string> {
  // Keep the declared-length fast path; the streaming loop itself is shared
  // so the two body readers cannot drift again.
  const declaredLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BYTES) {
    throw new RequestBodyTooLargeError();
  }
  return readSharedRequestBody(request, MAX_REQUEST_BYTES);
}

export async function POST(request: NextRequest): Promise<Response> {
  if (!hasAllowedOrigin(request)) {
    return errorResponse('Forbidden', 'FORBIDDEN', 403);
  }

  if (!process.env.JWT_SECRET) {
    return errorResponse('Authentication is not configured', 'AUTH_CONFIG_ERROR', 503);
  }

  const userId = getAuthenticatedUserId(request);
  if (!userId) {
    return errorResponse('Sign in to use AI diagram generation', 'AUTH_REQUIRED', 401);
  }

  if (!process.env.GEMINI_API_KEY) {
    return errorResponse('AI service not configured', 'CONFIG_ERROR', 503);
  }

  let body: unknown;
  try {
    const rawBody = await readRequestBodyWithDeclaredLengthCheck(request);
    body = JSON.parse(rawBody);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return errorResponse('Request body is too large', 'PAYLOAD_TOO_LARGE', 413);
    }
    return errorResponse('Request body must be valid JSON', 'VALIDATION_ERROR', 400);
  }

  const parsedRequest = GenerateRequestSchema.safeParse(body);
  if (!parsedRequest.success) {
    return errorResponse(
      'Prompt is required and must be at most 2000 characters',
      'VALIDATION_ERROR',
      400
    );
  }

  const prompt = parsedRequest.data.prompt;
  const rateCheck = await checkRateLimit(userId);
  if (!rateCheck.allowed) {
    if (rateCheck.unavailable) {
      return errorResponse(
        'AI generation is temporarily unavailable. Please try again shortly.',
        'RATE_LIMIT_UNAVAILABLE',
        503
      );
    }
    return errorResponse(
      `Rate limit exceeded. Try again in ${rateCheck.retryAfter ?? 60} seconds.`,
      'RATE_LIMIT',
      429,
      { retryAfter: rateCheck.retryAfter ?? 60 }
    );
  }

  try {
    const model = getGenAI().getGenerativeModel({
      model: GEMINI_MODEL,
      systemInstruction: SYSTEM_PROMPT,
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.2,
        maxOutputTokens: 8_192,
      },
    });
    const result = await generateWithRetry(
      model,
      `Generate a diagram for: ${prompt}`,
      request.signal
    );
    const rawElements = parseModelElements(responseText(result));
    const normalized = normalizeModelElements(rawElements);

    if (normalized.elements.length === 0) {
      throw new AiResponseError(
        'AI_RESPONSE_ERROR',
        'The AI returned no renderable diagram elements.'
      );
    }

    const warnings: string[] = [];
    if (normalized.droppedCount > 0) {
      warnings.push(
        `${normalized.droppedCount} element${normalized.droppedCount === 1 ? '' : 's'} could not be rendered. Try rephrasing your prompt.`
      );
    }
    if (normalized.truncatedCount > 0) {
      warnings.push('The diagram was simplified because it contained too many elements.');
    }

    return NextResponse.json(
      {
        elements: normalized.elements,
        message: 'Diagram generated successfully',
        warnings,
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error: unknown) {
    if (error instanceof RequestAbortedError || request.signal.aborted) {
      return errorResponse('AI request cancelled', 'REQUEST_ABORTED', 499);
    }
    if (error instanceof AiResponseError) {
      return errorResponse(error.message, error.code, error.status);
    }

    const message = serializeError(error);
    // eslint-disable-next-line no-console -- server-side AI failure telemetry
    console.error(JSON.stringify({ level: 'error', event: 'ai_generation_error', error: message }));
    const lowerMessage = message.toLowerCase();

    if (lowerMessage.includes('api key') || lowerMessage.includes('api_key')) {
      return errorResponse('AI service authentication failed', 'AUTH_ERROR', 502);
    }
    if (
      lowerMessage.includes('quota') ||
      lowerMessage.includes('resource_exhausted') ||
      lowerMessage.includes('billing')
    ) {
      return errorResponse('AI quota exceeded. Please try again later.', 'QUOTA_ERROR', 429);
    }
    if (errorStatus(error) === 429 || lowerMessage.includes('rate limit')) {
      return errorResponse(
        'AI service is busy. Please try again shortly.',
        'UPSTREAM_RATE_LIMIT',
        429
      );
    }

    return errorResponse('Failed to generate diagram', 'INTERNAL_ERROR', 502);
  }
}
