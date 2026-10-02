/**
 * The repository's only sanctioned console boundary.
 *
 * Everything else in the workspace reports through these helpers, which keeps
 * diagnostics in one home and makes the noisy levels (`log`, `debug`, `trace`)
 * lint errors everywhere else (see `tooling/eslint-config/index.js`). Server
 * processes log structured records through `@dripl/utils/logger` (pino)
 * instead; these helpers cover the browser, the Next.js route handlers, and any
 * code that must not pull in a logger dependency.
 *
 * These helpers are unconditional on purpose: there is no `NODE_ENV` branch,
 * because a browser bundle has no `process.env.NODE_ENV` to read and a computed
 * member access is not statically foldable by DefinePlugin or SWC, so such a
 * branch would never be eliminated anyway. In the Next.js app the production
 * build additionally strips `info` via `compiler.removeConsole`
 * (`apps/dripl-app/next.config.mjs`, `exclude: ['error', 'warn']`), so
 * `logInfo` output is development-only in the browser bundle today. Outside
 * that build, `logInfo` prints in every environment.
 */

type LogArgs = readonly unknown[];

/** Failures worth surfacing in every environment. */
export const logError = (...args: LogArgs): void => {
  console.error(...args);
};

/** Recoverable problems and degraded states. */
export const logWarn = (...args: LogArgs): void => {
  console.warn(...args);
};

/**
 * Product signals and notable lifecycle events.
 *
 * Flagged, not fixed: the analytics sink in `apps/dripl-app/utils/analytics.ts`
 * routes through here and only reaches the browser console, so tracked events
 * are not a production data path today. Closing that gap means giving
 * `trackEvent` a real transport; it is out of scope for this change.
 */
export const logInfo = (...args: LogArgs): void => {
  console.info(...args);
};
