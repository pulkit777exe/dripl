import pino from 'pino';

export interface StructuredLogger {
  trace(...args: unknown[]): void;
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
  fatal(...args: unknown[]): void;
}

export function createLogger(service: string): StructuredLogger {
  const opts: pino.LoggerOptions = {
    level: process.env.LOG_LEVEL ?? 'info',
    base: {
      service,
      version: process.env.npm_package_version,
    },
    serializers: {
      err: pino.stdSerializers.err,
      // `error` is registered as well as `err` because `Error` has no own
      // enumerable properties, so pino stringifies a raw one to `{}`. Every
      // `logger.error({ event, error }, msg)` in this repo therefore logged
      // the event and nothing else — no message, no stack — for 40 call sites
      // across both servers. Registering the key here fixes all of them at
      // once, and any future one, rather than renaming a field 40 times.
      error: pino.stdSerializers.err,
      req: pino.stdSerializers.req,
      res: pino.stdSerializers.res,
    },
  };

  if (process.env.NODE_ENV === 'development') {
    opts.transport = { target: 'pino-pretty', options: { colorize: true } };
  }

  return pino(opts) as StructuredLogger;
}
