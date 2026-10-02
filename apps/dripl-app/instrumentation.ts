import * as Sentry from '@sentry/nextjs';
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    if (process.env.DATABASE_URL) {
      const { initializeDb } = await import('@dripl/db');
      await initializeDb();
    }
    await import('./sentry.server.config');
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config');
  }
}
export const onRequestError = Sentry.captureRequestError;
