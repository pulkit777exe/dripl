import * as Sentry from '@sentry/nextjs';
import { sentryInitOptions } from './sentry.options';

/** Node runtime entry point. The Edge counterpart is `sentry.edge.config.ts`. */
Sentry.init(sentryInitOptions);
