import * as Sentry from '@sentry/nextjs';
import { sentryInitOptions } from './sentry.options';

/**
 * Edge runtime entry point. The Node counterpart is `sentry.server.config.ts`.
 *
 * Deliberately a separate module from its counterpart rather than a re-export of it: the
 * Next.js Sentry SDK resolves the runtime by which of these two paths is loaded, so
 * collapsing them would change which bundle believes it is running where.
 */
Sentry.init(sentryInitOptions);
