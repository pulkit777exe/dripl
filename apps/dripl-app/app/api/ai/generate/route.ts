import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { DriplElementSchema } from '@dripl/common';

let genAI: GoogleGenerativeAI | null = null;
function getGenAI() {
  if (!genAI) genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');
  return genAI;
}

const SYSTEM_PROMPT = `You are an AI that generates diagram layouts for a canvas drawing application called Dripl.

Return a JSON array of diagram elements with these exact properties:
- id: unique string (e.g., "box-1", "arrow-1")
- type: "rectangle" | "ellipse" | "diamond" | "arrow" | "line" | "text"
- x: number (x position in pixels, e.g., 100)
- y: number (y position in pixels, e.g., 100)
- width: number (e.g., 120)
- height: number (e.g., 80)
- strokeColor: hex color string (e.g., "#6965db", "#e03131")
- backgroundColor: hex color or "transparent" (fill color of the shape)
- fillColor: hex color or "transparent" (alias for backgroundColor, use this for fill)
- strokeWidth: number (1, 2, or 4)
- roughness: number (0=sharp, 1=sketchy, 2=hand-drawn)
- text: string (label for shapes, empty string if none)
- points: [{x: number, y: number}, ...] for arrows/lines (relative to x,y) - NOT arrays

IMPORTANT: Use x and y as direct properties, NOT nested position object.
IMPORTANT: Return ONLY a valid JSON array, no markdown code blocks, no explanation.

Create organized diagrams with 100-150px spacing.
Start first element around x:100, y:100.
Position elements left-to-right or top-to-bottom based on flow.`;

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

const rateLimitMap = new Map<string, RateLimitEntry>();
const RATE_LIMIT = 10; // requests per minute
const RATE_WINDOW = 60 * 1000; // 1 minute

function finiteNumber(value: unknown, fallback: number): number {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : fallback;
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function checkRateLimit(userId: string): {
  allowed: boolean;
  retryAfter?: number;
} {
  const now = Date.now();
  const entry = rateLimitMap.get(userId);

  if (!entry || now > entry.resetTime) {
    rateLimitMap.set(userId, { count: 1, resetTime: now + RATE_WINDOW });
    return { allowed: true };
  }

  if (entry.count >= RATE_LIMIT) {
    return {
      allowed: false,
      retryAfter: Math.ceil((entry.resetTime - now) / 1000),
    };
  }

  entry.count++;
  return { allowed: true };
}

export async function POST(request: NextRequest) {
  try {
    // Check for API key
    if (!process.env.GEMINI_API_KEY) {
      return NextResponse.json(
        { error: 'AI service not configured', code: 'CONFIG_ERROR' },
        { status: 503 }
      );
    }

    // Parse request body
    const body = await request.json().catch(() => null);
    const prompt = body?.prompt;

    // Validate prompt exists
    if (!prompt) {
      return NextResponse.json(
        { error: 'Prompt is required', code: 'VALIDATION_ERROR' },
        { status: 400 }
      );
    }

    // Rate limit by session cookie (X-Forwarded-For is spoofable)
    const cookies = (request as any).cookies?.get?.('session')?.value;
    const rateLimitKey = cookies ?? 'anonymous';
    const rateCheck = checkRateLimit(rateLimitKey);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        {
          error: `Rate limit exceeded. Retry in ${rateCheck.retryAfter} seconds.`,
          code: 'RATE_LIMIT',
          retryAfter: rateCheck.retryAfter,
        },
        { status: 429 }
      );
    }

    // Validate prompt length
    if (prompt.length > 2000) {
      return NextResponse.json(
        {
          error: 'Prompt too long. Maximum 2000 characters.',
          code: 'VALIDATION_ERROR',
        },
        { status: 400 }
      );
    }

    // Call Gemini API with retry logic
    const model = getGenAI().getGenerativeModel({ model: 'gemini-2.5-flash' });
    const maxRetries = 2;

    let lastError: Error | null = null;
    let result;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        result = await model.generateContent([
          { text: SYSTEM_PROMPT },
          { text: `Generate a diagram for: ${prompt}` },
        ]);
        break; // Success, exit retry loop
      } catch (err: unknown) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt < maxRetries && (lastError.message?.includes('503') || lastError.message?.includes('retry'))) {
          await new Promise(r => setTimeout(r, 1000 * (attempt + 1))); // Exponential backoff
          continue;
        }
        throw err; // Rethrow if no retries left or not retryable
      }
    }

    if (!result) {
      throw lastError || new Error('No result from AI');
    }

    const response = result.response;
    const text = response.text();

    // Parse the JSON response
    let elements;
    try {
      // Extract JSON from response (handle markdown code blocks)
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        throw new Error('No valid JSON array found');
      }
      elements = JSON.parse(jsonMatch[0]);
    } catch {
      return NextResponse.json(
        { error: 'Failed to parse AI response', code: 'PARSE_ERROR' },
        { status: 500 }
      );
    }

    // Validate elements structure
    if (!Array.isArray(elements)) {
      return NextResponse.json(
        { error: 'Invalid response format', code: 'PARSE_ERROR' },
        { status: 500 }
      );
    }

    let droppedElementCount = 0;

    // Add default properties to elements and validate
    const processedElements = (elements as Record<string, unknown>[])
      .map((el, index) => {
        const now = Date.now();

        // Normalize points: convert [x,y] arrays to {x,y} objects
        const rawPoints = Array.isArray(el.points) ? el.points : [];
        const normalizedPoints = rawPoints.map((p: unknown) => {
          if (Array.isArray(p) && p.length >= 2) {
            return { x: finiteNumber(p[0], 0), y: finiteNumber(p[1], 0) };
          }
          if (p && typeof p === 'object' && 'x' in p && 'y' in p) {
            return {
              x: finiteNumber((p as { x: unknown }).x, 0),
              y: finiteNumber((p as { y: unknown }).y, 0),
            };
          }
          return { x: 0, y: 0 };
        });

        return {
          id: typeof el.id === 'string' && el.id.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
            ? el.id
            : crypto.randomUUID(),
          type: stringValue(el.type, 'rectangle'),
          x: finiteNumber(el.x, 100) + index * 150,
          y: finiteNumber(el.y, 100),
          width: finiteNumber(el.width, 120),
          height: finiteNumber(el.height, 80),
          strokeColor: stringValue(el.strokeColor, '#6965db'),
          backgroundColor: stringValue(el.backgroundColor, 'transparent'),
          fillColor: stringValue(el.fillColor, 'transparent'),
          strokeWidth: finiteNumber(el.strokeWidth, 2),
          strokeStyle: stringValue(el.strokeStyle, 'solid'),
          roughness: finiteNumber(el.roughness, 1),
          opacity: finiteNumber(el.opacity, 1),
          text: stringValue(el.text, ''),
          fontSize: finiteNumber(el.fontSize, 16),
          points: normalizedPoints,
          angle: 0,
          locked: false,
          createdAt: now,
          updatedAt: now,
        };
      })
      .flatMap(el => {
        const result = DriplElementSchema.safeParse(el);
        if (!result.success) {
          droppedElementCount++;
          return [];
        }
        return [result.data];
      })
      .slice(0, 100); // Limit to 100 elements

    const warnings =
      droppedElementCount > 0
        ? [`${droppedElementCount} element${droppedElementCount === 1 ? '' : 's'} could not be rendered. Try rephrasing your prompt.`]
        : [];

    return NextResponse.json({
      elements: processedElements,
      message: 'Diagram generated successfully',
      warnings,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(JSON.stringify({ level: 'error', event: 'ai_generation_error', error: message }));

    if (message.includes('API_KEY')) {
      return NextResponse.json({ error: 'Invalid API key', code: 'AUTH_ERROR' }, { status: 401 });
    }

    if (message.includes('quota')) {
      return NextResponse.json(
        {
          error: 'API quota exceeded. Please try again later.',
          code: 'QUOTA_ERROR',
        },
        { status: 429 }
      );
    }

    return NextResponse.json(
      { error: 'Failed to generate diagram', code: 'INTERNAL_ERROR' },
      { status: 500 }
    );
  }
}
