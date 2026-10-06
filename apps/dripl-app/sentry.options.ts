import * as Sentry from '@sentry/nextjs';

/**
 * Sentry settings shared by both runtimes.
 *
 * `sentry.server.config.ts` and `sentry.edge.config.ts` are both required, at those
 * exact paths, by the Next.js SDK — which runtime a bundle gets is decided by *which
 * file* is imported, not by inspecting what is inside it. So they cannot collapse into
 * one file that imports the other: the edge entry point has to keep existing as its own
 * module, and `instrumentation.ts` imports the two under `runtime` guards.
 *
 * What that leaves duplicated is the settings themselves, and those did drift by being
 * copy-pasted rather than shared. They live here so `SENTRY_DSN` and the sample rate are
 * stated once, while each config stays an independently loadable entry point that the two
 * runtimes can diverge on later — an edge-only integration, for one, would be added to
 * `sentry.edge.config.ts` and not to this file.
 *
 * Read at module load, like the configs themselves: `instrumentation.ts` runs before
 * anything else has had a chance to populate the environment.
 */
// Typed from `Sentry.init`'s own parameter rather than a named options type, because the
// SDK does not export one under that name — and a type derived from the call it feeds
// cannot drift if the SDK changes its options.
export const sentryInitOptions: Parameters<typeof Sentry.init>[0] = {
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: process.env.NODE_ENV === 'development' ? 1.0 : 0.1,
  enableLogs: true,
};
