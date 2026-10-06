import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * `sentry.options.ts` reads `process.env` at module load, which is correct — it is
 * imported by configs that `instrumentation.ts` loads before anything else runs — and
 * which means every assertion here has to re-import the module against a stubbed
 * environment rather than mutating a value it already read.
 */
async function loadOptions(env: Record<string, string | undefined>) {
  vi.resetModules();
  for (const [key, value] of Object.entries(env)) {
    // `undefined` *deletes* the variable in vitest; passing `''` would set it to the
    // empty string, which is a different assertion entirely and the one that matters here.
    vi.stubEnv(key, value as string);
  }
  const loaded = await import('../../sentry.options');
  return loaded.sentryInitOptions;
}

describe('sentryInitOptions', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  // Regression: the sample rate was copy-pasted into both Sentry configs and drifted
  // silently. Sharing the object means one edit changes both runtimes, which is only a
  // benefit if the value is actually pinned -- otherwise "shared" just means "wrong in
  // two places at once".
  it('traces fully in development and throttles everywhere else', async () => {
    expect((await loadOptions({ NODE_ENV: 'development' })).tracesSampleRate).toBe(1.0);
    expect((await loadOptions({ NODE_ENV: 'production' })).tracesSampleRate).toBe(0.1);
  });

  // Regression: an unset `SENTRY_DSN` must reach `Sentry.init` as undefined rather than
  // as an empty string. The SDK treats `dsn: ''` as "enabled but pointed nowhere" and
  // emits no transport errors, so the app would look instrumented while sending nothing.
  it('leaves the DSN undefined when the environment has none', async () => {
    const options = await loadOptions({ SENTRY_DSN: undefined });

    expect(options.dsn).toBeUndefined();
  });

  it('passes a configured DSN through unchanged', async () => {
    const options = await loadOptions({ SENTRY_DSN: 'https://key@o0.ingest.sentry.io/1' });

    expect(options.dsn).toBe('https://key@o0.ingest.sentry.io/1');
  });

  // Regression: `enableLogs` gates console-log capture. Dropping it would not fail any
  // test that only checks initialisation happened, and the symptom is missing logs in
  // production with no error anywhere.
  it('enables log capture', async () => {
    expect((await loadOptions({ NODE_ENV: 'production' })).enableLogs).toBe(true);
  });
});
