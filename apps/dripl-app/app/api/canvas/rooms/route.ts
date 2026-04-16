import { NextRequest, NextResponse } from 'next/server';

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ??
  process.env.NEXT_PUBLIC_HTTP_URL ??
  'http://localhost:3002/api';

export async function POST(request: NextRequest) {
  const cookie = request.headers.get('cookie') ?? '';
  try {
    const response = await fetch(`${API_BASE_URL}/rooms`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        cookie,
      },
      body: JSON.stringify({}),
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
