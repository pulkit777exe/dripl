import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

const SYSTEM_PROMPT = `You are an AI that generates diagram layouts for a canvas drawing application called Dripl.

When given a text description, return a JSON array of diagram elements. Each element should have:
- id: unique string
- type: "rectangle" | "ellipse" | "diamond" | "arrow" | "line" | "text"
- x: number (x position)
- y: number (y position)  
- width: number (for shapes)
- height: number (for shapes)
- strokeColor: string (hex color, default "#6965db")
- backgroundColor: string (hex color or "transparent")
- strokeWidth: number (1, 2, or 4)
- roughness: number (0, 1, or 2)
- text: string (for text elements)

For arrows, also include:
- points: [[x1, y1], [x2, y2]] (start and end points relative to x,y)

Create visually organized diagrams with proper spacing (100-150px between elements).
Position elements logically based on the description.
Use a variety of shapes appropriate for the content.
Return ONLY the JSON array, no other text.`;

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

const rateLimitMap = new Map<string, RateLimitEntry>();
const RATE_LIMIT = 10; // requests per minute
const RATE_WINDOW = 60 * 1000; // 1 minute

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
        { error: "AI service not configured", code: "CONFIG_ERROR" },
        { status: 503 },
      );
    }

    // Parse request body
    const body = await request.json().catch(() => null);
    if (!body || !body.prompt) {
      return NextResponse.json(
        { error: "Prompt is required", code: "VALIDATION_ERROR" },
        { status: 400 },
      );
    }

    const { prompt } = body;

    // Identify user by IP slightly better than just "anonymous"
    const ip = request.headers.get("x-forwarded-for") || "unknown";
    const userIdentifier =
      body.userId && body.userId !== "anonymous" ? body.userId : ip;

    // Rate limiting
    const rateCheck = checkRateLimit(userIdentifier);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        {
          error: `Rate limit exceeded. Retry in ${rateCheck.retryAfter} seconds.`,
          code: "RATE_LIMIT",
          retryAfter: rateCheck.retryAfter,
        },
        { status: 429 },
      );
    }

    // Validate prompt length
    if (prompt.length > 2000) {
      return NextResponse.json(
        {
          error: "Prompt too long. Maximum 2000 characters.",
          code: "VALIDATION_ERROR",
        },
        { status: 400 },
      );
    }

    // Call Gemini API
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    const result = await model.generateContent([
      { text: SYSTEM_PROMPT },
      { text: `Generate a diagram for: ${prompt}` },
    ]);

    const response = result.response;
    const text = response.text();

    // Parse the JSON response
    let elements;
    try {
      // Extract JSON from response (handle markdown code blocks)
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        throw new Error("No valid JSON array found");
      }
      elements = JSON.parse(jsonMatch[0]);
    } catch {
      return NextResponse.json(
        { error: "Failed to parse AI response", code: "PARSE_ERROR" },
        { status: 500 },
      );
    }

    // Validate elements structure
    if (!Array.isArray(elements)) {
      return NextResponse.json(
        { error: "Invalid response format", code: "PARSE_ERROR" },
        { status: 500 },
      );
    }

    // Add default properties to elements
    const processedElements = elements.map((el: any, index: number) => ({
      id: el.id || `ai-${Date.now()}-${index}`,
      type: el.type || "rectangle",
      x: el.x ?? 100 + index * 150,
      y: el.y ?? 100,
      width: el.width ?? 120,
      height: el.height ?? 80,
      strokeColor: el.strokeColor || "#6965db",
      backgroundColor: el.backgroundColor || "transparent",
      strokeWidth: el.strokeWidth || 2,
      strokeStyle: el.strokeStyle || "solid",
      roughness: el.roughness ?? 1,
      opacity: el.opacity ?? 1,
      text: el.text || "",
      fontSize: el.fontSize || 16,
      points: el.points || [],
      angle: 0,
    }));

    return NextResponse.json({
      elements: processedElements,
      message: "Diagram generated successfully",
    });
  } catch (error: any) {
    console.error("AI generation error:", error);

    // Handle specific Gemini errors
    if (error.message?.includes("API_KEY")) {
      return NextResponse.json(
        { error: "Invalid API key", code: "AUTH_ERROR" },
        { status: 401 },
      );
    }

    if (error.message?.includes("quota")) {
      return NextResponse.json(
        {
          error: "API quota exceeded. Please try again later.",
          code: "QUOTA_ERROR",
        },
        { status: 429 },
      );
    }

    return NextResponse.json(
      { error: "Failed to generate diagram", code: "INTERNAL_ERROR" },
      { status: 500 },
    );
  }
}
