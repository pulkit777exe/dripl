import { NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';

export async function GET() {
  Sentry.captureMessage('Sentry test message from dripl-app', 'info');

  try {
    throw new Error('Sentry test error — triggered via /api/test-sentry');
  } catch (error) {
    Sentry.captureException(error);
    return NextResponse.json({
      sentry: true,
      message: 'Error captured by Sentry. Check your Sentry dashboard.',
    });
  }
}
