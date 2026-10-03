import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { logError } from '@dripl/common';
import { extractBearerToken, verifyToken } from '@dripl/utils/auth';
import { loadStoredTokenVersion } from '@dripl/db';
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import { z } from 'zod';
import {
  readRequestBody as readSharedRequestBody,
  RequestBodyTooLargeError,
} from '@/lib/server/requestBody';
import { hasAllowedOrigin } from '@/lib/server/origin';
import { normalizeModelElements } from '@/lib/ai/normalize';
import { AiResponseError, parseModelElements, responseText } from '@/lib/ai/parse';
import { errorStatus, isRetryableGeminiError, serializeError } from '@/lib/ai/errors';

// Keep this route on the Node runtime. Session verification and the Gemini
// client both use Node-compatible APIs, and the route must never run as an
// Edge function with a different crypto/runtime contract.
export const runtime = 'nodejs';

const GEMINI_MODEL = 'gemini-2.5-flash';
const MAX_PROMPT_LENGTH = 2_000;
const MAX_REQUEST_BYTES = 32 * 1024;
const GEMINI_REQUEST_TIMEOUT_MS = 15_000;
const MAX_GEMINI_RETRIES = 1;
const MAX_LOCAL_RATE_LIMIT_ENTRIES = 10_000;
const RATE_LIMIT_MAX = 10;
const RATE_WINDOW_MS = 60 * 60 * 1_000;

const SYSTEM_PROMPT = `You are an AI that generates diagram layouts for a canvas drawing application called Dripl.

OUTPUT CONTRACT (must hold for every response):
- Return ONLY a JSON array. No markdown fences, no explanation, no trailing text.
- At most 100 elements. Prefer fewer, well-placed elements over many.
- Each element is a flat object with EXACTLY these properties (no extras, no nesting, no nulls):
  - id: unique string per element
  - type: one of "rectangle" | "ellipse" | "diamond" | "arrow" | "line" | "text"
  - x, y: finite numbers, absolute canvas position, within -100000..100000
  - width, height: finite positive numbers, 1..50000
  - strokeColor: hex string like "#1e1e1e"
  - backgroundColor, fillColor: hex string or "transparent"
  - strokeWidth: 0.5..20, roughness: 0..2
  - text: short label (max ~80 chars); empty string when a shape has no label
  - points: REQUIRED for "arrow"/"line" (2+ points as [{x,y}, ...] relative to x/y);
    OMIT for all other types
- Layout: start around x:100, y:100; 100-150px spacing; left-to-right or top-to-bottom flow.
- Any element violating this contract is dropped by the server, so staying inside it is how your output survives.`;

const GenerateRequestSchema = z.object({
  prompt: z.string().trim().min(1).max(MAX_PROMPT_LENGTH),
});

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

/**
 * The caller's `User.id`, or `null`.
 *
 * Asynchronous because revocation is: `verifyToken` compares the token's `ver`
 * claim against the generation stored for the account, which needs a database
 * read. A revoked token is refused exactly as a forged one is, so this endpoint
 * cannot be used to learn whether a captured token was ever valid.
 *
 * A storage failure propagates. Answering 401 for it would tell a signed-in user
 * that their session ended, when what actually happened is that the revocation
 * check could not run — and it would hide an outage behind an auth error.
 */
async function getAuthenticatedUserId(request: NextRequest): Promise<string | null> {
  for (const token of getSessionTokens(request)) {
    const payload = await verifyToken(token, loadStoredTokenVersion);
    if (!payload || typeof payload.userId !== 'string') continue;
    const userId = payload.userId.trim();
    if (userId && userId.length <= 200) return userId;
  }
  return null;
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

  const userId = await getAuthenticatedUserId(request);
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
    logError(JSON.stringify({ level: 'error', event: 'ai_generation_error', error: message }));
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
