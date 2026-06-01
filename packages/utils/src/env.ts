/**
 * Validate a required environment variable.
 * Throws an error if the variable is not set.
 */
export function requiredEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

/**
 * Validate a required integer environment variable.
 * Throws if the variable is missing or not a valid finite integer.
 */
export function requiredIntEnv(key: string): number {
  const value = requiredEnv(key);
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid integer environment variable: ${key}`);
  }
  return parsed;
}
