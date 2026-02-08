import { NextRequest, NextResponse } from "next/server";
import { db } from "@dripl/db";
import { z } from "zod";

const ShareCanvasSchema = z.object({
  elements: z.array(z.any()), // Validate more strictly if possible
  name: z.string().optional().default("Untitled Shared Canvas"),
});

// Simple in-memory rate limiter for demo purpose
// In production, use Redis or similar
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute
const MAX_REQUESTS = 10;
const requestCounts = new Map<string, { count: number; timestamp: number }>();

function checkRateLimit(ip: string) {
  const now = Date.now();
  const record = requestCounts.get(ip);

  if (!record) {
    requestCounts.set(ip, { count: 1, timestamp: now });
    return true;
  }

  if (now - record.timestamp > RATE_LIMIT_WINDOW) {
    requestCounts.set(ip, { count: 1, timestamp: now });
    return true;
  }

  if (record.count >= MAX_REQUESTS) {
    return false;
  }

  record.count++;
  return true;
}

export async function POST(req: NextRequest) {
  try {
    const ip = req.headers.get("x-forwarded-for") || "unknown";
    if (!checkRateLimit(ip)) {
      return NextResponse.json(
        { error: "Rate limit exceeded" },
        { status: 429 },
      );
    }

    const body = await req.json();
    const result = ShareCanvasSchema.safeParse(body);

    if (!result.success) {
      return NextResponse.json(
        { error: "Invalid request data", details: result.error },
        { status: 400 },
      );
    }

    const { elements, name } = result.data;

    // Sanitize elements (basic check)
    // Ensure no recursive structures or huge payloads
    if (JSON.stringify(elements).length > 5 * 1024 * 1024) {
      // 5MB limit
      return NextResponse.json({ error: "Canvas too large" }, { status: 400 });
    }

    // Create a new file without a user (anonymous share)
    // Or link to current user if available (would need auth token)

    // For now, create an anonymous file
    const file = await db.file.create({
      data: {
        name,
        content: JSON.stringify(elements),
        // No userId, making it anonymous/publicly accessible via ID
      },
    });

    return NextResponse.json({ id: file.id });
  } catch (error) {
    console.error("Error sharing canvas:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}
