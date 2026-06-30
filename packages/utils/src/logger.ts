import pino from 'pino';

export function createLogger(service: string) {
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
    (opts as any).transport = { target: 'pino-pretty', options: { colorize: true } };
  }

  return pino(opts);
}
