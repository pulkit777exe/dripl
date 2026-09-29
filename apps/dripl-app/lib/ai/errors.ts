import { isRecord } from './coerce';

export function errorStatus(error: unknown): number | undefined {
  if (!isRecord(error)) return undefined;
  const value = error.status ?? error.statusCode;
  return typeof value === 'number' ? value : undefined;
}

export function serializeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (isRecord(error)) {
    return JSON.stringify({
      name: typeof error.name === 'string' ? error.name : undefined,
      message: typeof error.message === 'string' ? error.message : undefined,
      status: errorStatus(error),
    });
  }
  return String(error);
}

export function isRetryableGeminiError(error: unknown): boolean {
  const status = errorStatus(error);
  // 429 commonly means exhausted quota/billing on Gemini. Retrying it adds
  // latency and cost without making the request succeed.
  if (status !== undefined) return [408, 500, 502, 503, 504].includes(status);
  const message = error instanceof Error ? error.message : String(error);
  return /(?:temporar|unavailable|overloaded|timeout|try again|retry)/i.test(message);
}
