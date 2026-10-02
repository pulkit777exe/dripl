import { NextRequest, NextResponse } from 'next/server';
import { readRequestBody, RequestBodyTooLargeError } from '@/lib/server/requestBody';
import { z } from 'zod';

const CreateShareSchema = z.object({
  fileId: z.string().trim().min(1).max(100),
  permission: z.enum(['view', 'edit']),
  expiresInHours: z
    .number()
    .int()
    .positive()
    .max(24 * 365)
    .optional(),
});

function apiBaseUrl(): string {
  const configured =
    process.env.API_SERVER_URL ??
    process.env.HTTP_SERVER_URL ??
    process.env.NEXT_PUBLIC_API_URL ??
    'http://localhost:3002';
  const base = configured.replace(/\/$/, '');
  return base.endsWith('/api') ? base : `${base}/api`;
}

function forwardedCookie(request: NextRequest, csrfToken?: string): string {
  const existing = request.headers.get('cookie') ?? '';
  if (!csrfToken) return existing;
  const withoutOld = existing
    .split(';')
    .filter(part => !part.trim().startsWith('csrf-token='))
    .join(';');
  return `${withoutOld}${withoutOld ? '; ' : ''}csrf-token=${encodeURIComponent(csrfToken)}`;
}

/**
 * Authenticated BFF proxy for share creation.
 *
 * The old implementation wrote directly to Prisma and trusted a caller-
 * supplied file id. Ownership and CSRF enforcement now live in the HTTP
 * server's owner-scoped `/files/:id/share` route; this adapter only forwards
 * the authenticated request and never accepts scene content or names.
 */
function configuredAppOrigin(): string | null {
  const value = process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL;
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  const origin = request.headers.get('origin');
  const allowedOrigin = configuredAppOrigin();
  const originRejected =
    process.env.NODE_ENV === 'production'
      ? !origin || !allowedOrigin || origin !== allowedOrigin
      : Boolean(origin && allowedOrigin && origin !== allowedOrigin);
  if (originRejected) {
    return NextResponse.json({ error: 'Forbidden origin' }, { status: 403 });
  }

  const contentLength = Number(request.headers.get('content-length') ?? 0);
  if (Number.isFinite(contentLength) && contentLength > 10_000) {
    return NextResponse.json({ error: 'Payload too large' }, { status: 413 });
  }

  let body: unknown;
  try {
    const raw = await readRequestBody(request, 10_000);
    body = JSON.parse(raw);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return NextResponse.json({ error: 'Payload too large' }, { status: 413 });
    }
    return NextResponse.json({ error: 'Invalid request payload' }, { status: 400 });
  }

  const parsed = CreateShareSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'fileId and permission are required' }, { status: 400 });
  }

  const baseUrl = apiBaseUrl();
  const cookie = request.headers.get('cookie') ?? '';
  const authorization = request.headers.get('authorization');

  try {
    const csrfResponse = await fetch(`${baseUrl}/csrf-token`, {
      method: 'GET',
      headers: {
        ...(cookie ? { cookie } : {}),
        ...(authorization ? { authorization } : {}),
      },
      cache: 'no-store',
    });
    if (!csrfResponse.ok) {
      return NextResponse.json({ error: 'Unable to initialize security token' }, { status: 503 });
    }
    const csrfPayload = (await csrfResponse.json()) as { token?: string };
    if (!csrfPayload.token) {
      return NextResponse.json({ error: 'Unable to initialize security token' }, { status: 503 });
    }

    const response = await fetch(
      `${baseUrl}/files/${encodeURIComponent(parsed.data.fileId)}/share`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-csrf-token': csrfPayload.token,
          cookie: forwardedCookie(request, csrfPayload.token),
          ...(authorization ? { authorization } : {}),
        },
        body: JSON.stringify({
          permission: parsed.data.permission,
          ...(parsed.data.expiresInHours !== undefined
            ? { expiresInHours: parsed.data.expiresInHours }
            : {}),
        }),
        cache: 'no-store',
      }
    );

    const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    return NextResponse.json(body, { status: response.status });
  } catch {
    return NextResponse.json({ error: 'Share service unavailable' }, { status: 503 });
  }
}
