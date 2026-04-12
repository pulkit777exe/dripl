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
