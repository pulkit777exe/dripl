import { NextRequest, NextResponse } from 'next/server';
import { readRequestBody, RequestBodyTooLargeError } from '@/lib/server/requestBody';
import { hasAllowedOrigin } from '@/lib/server/origin';

const MAX_CONTENT_BYTES = 2 * 1024 * 1024;

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

export async function POST(request: NextRequest) {
  if (!hasAllowedOrigin(request)) {
    return NextResponse.json({ error: 'Forbidden origin' }, { status: 403 });
  }

  const declaredLength = Number(request.headers.get('content-length') ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_CONTENT_BYTES + 16_384) {
    return NextResponse.json({ error: 'Canvas content too large.' }, { status: 413 });
  }

  let content = '[]';
  try {
    const raw = await readRequestBody(request, MAX_CONTENT_BYTES);
    const body = JSON.parse(raw) as { content?: unknown };
    if (typeof body.content === 'string') content = body.content;
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return NextResponse.json({ error: 'Canvas content too large.' }, { status: 413 });
    }
    return NextResponse.json({ error: 'Invalid canvas payload.' }, { status: 400 });
  }

  const cookie = request.headers.get('cookie') ?? '';
  const authorization = request.headers.get('authorization');
  const baseUrl = apiBaseUrl();

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

    const response = await fetch(`${baseUrl}/rooms`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-csrf-token': csrfPayload.token,
        cookie: forwardedCookie(request, csrfPayload.token),
        ...(authorization ? { authorization } : {}),
      },
      body: JSON.stringify({ content }),
      cache: 'no-store',
    });
    if (response.status === 401) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!response.ok) {
      return NextResponse.json({ error: 'Unable to create room.' }, { status: response.status });
    }
    const payload = (await response.json()) as { room?: { slug?: string } };
    if (!payload.room?.slug) {
      return NextResponse.json({ error: 'Invalid room response.' }, { status: 500 });
    }
    return NextResponse.json({ roomId: payload.room.slug });
  } catch {
    return NextResponse.json({ error: 'Unable to create room.' }, { status: 500 });
  }
}
