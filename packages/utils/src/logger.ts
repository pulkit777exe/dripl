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
      req: pino.stdSerializers.req,
      res: pino.stdSerializers.res,
    },
  };

  if (process.env.NODE_ENV === 'development') {
    opts.transport = { target: 'pino-pretty', options: { colorize: true } };
  }

  return pino(opts) as StructuredLogger;
}
