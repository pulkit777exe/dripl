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
 * Note for anyone reaching for this to ship analytics: the Next.js production
 * build strips `info` (`removeConsole`, `exclude: ['error','warn']`), so
 * `logInfo` is **not** a data path in a production browser bundle. The analytics
 * module (`apps/dripl-app/utils/analytics.ts`) still calls it so local debugging
 * shows events, but delivery goes over HTTP to `NEXT_PUBLIC_ANALYTICS_ENDPOINT`
 * via `sendBeacon`. With that variable unset, events are logged and nothing
 * leaves the browser.
 */
export const logInfo = (...args: LogArgs): void => {
  console.info(...args);
};
