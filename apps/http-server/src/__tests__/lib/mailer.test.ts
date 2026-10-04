/**
 * `lib/mailer.ts` — the only two functions in this server that talk to SMTP.
 *
 * Neither had a test. That is not surprising: they are `nodemailer` calls, and the
 * obvious test either sends real mail or asserts that a mock was called, neither of
 * which says anything. These cases assert the two things that are actually wrong
 * when they break, both of which have happened to real products:
 *
 *   1. **The link.** A verification or reset email whose URL points at the wrong
 *      path, or drops the token, is indistinguishable from "the mail never arrived"
 *      for the user, and the support answer is "try signing up again". The token is
 *      the entire content of the message.
 *   2. **The credential.** `createTransporter` calls `requiredEnv('SMTP_USER')`,
 *      which throws when it is unset. That is deliberate — a missing credential must
 *      be a loud failure at send time, not a silent "sent from undefined". The
 *      cases below pin the loudness, because the tempting "fix" for a mail failure
 *      is to wrap this in a try/catch and skip.
 *
 * The transport is mocked wholesale rather than `nodemailer`'s `createTransport`
 * alone, because the assertions are about what was handed to `sendMail`, and a mock
 * at the transport boundary is the only place that is observable without a network.
 *
 * MODULE-LOAD ENV, AND WHY EVERY CASE IMPORTS FRESH
 *
 * `mailer.ts` reads `NEXT_PUBLIC_APP_URL` once, at import, into a module-level
 * `const`. A `beforeEach` that stubbed the environment would therefore be too late:
 * the value is already frozen, and every case would assert against whatever the
 * developer's `.env` happened to hold — which is how a suite passes on one machine
 * and fails on another for reasons that have nothing to do with the code. So each
 * case loads the module itself, after the environment is in place.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The recorded sends and the transport configuration.
 *
 * `vi.hoisted` because `vi.mock` is hoisted above every top-level binding, so a
 * plain `const` here would be in the temporal dead zone when the factory runs and
 * the failure would be an opaque `ReferenceError` inside a mock.
 */
const { sent, transportOptions } = vi.hoisted(() => ({
  sent: [] as Array<{ from: string; to: string; subject: string; html: string }>,
  transportOptions: [] as unknown[],
}));

vi.mock('nodemailer', () => ({
  default: {
    createTransport: (options: unknown) => {
      transportOptions.push(options);
      return {
        sendMail: async (message: (typeof sent)[number]) => {
          sent.push(message);
          return { messageId: 'stub' };
        },
      };
    },
  },
}));

type Mailer = typeof import('../../lib/mailer');

const APP_URL = 'https://app.example.test';

/**
 * Load `mailer.ts` with the environment in place.
 *
 * `vi.resetModules()` gives a fresh registry so the module-level `APP_URL` is
 * recomputed from the stubbed environment, and so `dotenv.config()` inside it runs
 * against a deliberately set `process.env`. A local `dotenv` path is irrelevant
 * here: `dotenv.config()` does not overwrite variables that are already set, so
 * the stubs below win regardless of whether a `.env` is present.
 */
async function loadMailer(env: Record<string, string>): Promise<Mailer> {
  vi.resetModules();
  for (const key of ['NEXT_PUBLIC_APP_URL', 'SMTP_USER', 'SMTP_PASS']) {
    vi.stubEnv(key, env[key] ?? '');
  }
  sent.length = 0;
  transportOptions.length = 0;
  return import('../../lib/mailer');
}

/** The environment a correctly-configured deployment has. */
const CONFIGURED = {
  NEXT_PUBLIC_APP_URL: APP_URL,
  SMTP_USER: 'noreply@dripl.test',
  SMTP_PASS: 'smtp-secret',
};

beforeEach(() => {
  sent.length = 0;
  transportOptions.length = 0;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

/**
 * The single href in the message.
 *
 * Pulled out rather than string-matching the whole body: the html is prose, and an
 * assertion on prose breaks on a copy edit. The link is the contract.
 */
function hrefOf(html: string): string {
  const match = /href="([^"]+)"/.exec(html);
  if (!match?.[1]) throw new Error(`no href in message body:\n${html}`);
  return match[1];
}

describe('sendResetPasswordEmail', () => {
  /**
   * The link has to carry the token the reset route validates. A message that
   * renders `APP_URL/reset-password` without `?token=` produces an email whose
   * link the server answers 400 for, and the user has no way to tell why.
   *
   * Asserted by parsing the URL rather than by substring, so a wrong path, a
   * missing query, or a token in the fragment (which the server never reads) all
   * fail — none of which a `toContain(token)` check would catch.
   */
  it('sends a reset link that carries the token as a query parameter', async () => {
    const { sendResetPasswordEmail } = await loadMailer(CONFIGURED);

    await sendResetPasswordEmail('someone@example.test', 'reset-token-abc');

    expect(sent).toHaveLength(1);
    const url = new URL(hrefOf(sent[0]?.html ?? ''));
    expect(url.origin).toBe(APP_URL);
    expect(url.pathname).toBe('/reset-password');
    expect(url.searchParams.get('token')).toBe('reset-token-abc');
    // In the fragment, not the query, the server would never see it.
    expect(url.hash).toBe('');
  });

  it('addresses the message to the requested recipient and identifies the sender', async () => {
    const { sendResetPasswordEmail } = await loadMailer(CONFIGURED);

    await sendResetPasswordEmail('someone@example.test', 't');

    expect(sent[0]?.to).toBe('someone@example.test');
    // `from` interpolates `SMTP_USER`, so an unset credential would produce the
    // literal string "undefined" as the sender — a deliverability failure with no
    // error anywhere.
    expect(sent[0]?.from).toContain('noreply@dripl.test');
    expect(sent[0]?.subject).toBe('Reset your password');
  });

  /**
   * The credential is read at send time, not at module load.
   *
   * That ordering is what makes the missing-credential case loud: `requiredEnv`
   * throws, the register/forgot-password route's own try/catch turns it into a 500,
   * and the operator sees a failed send. Constructing the transporter at module
   * scope instead would throw on `import`, which takes down every route in the
   * process over a mail credential.
   */
  it('builds the transport per send, using the configured SMTP service and credentials', async () => {
    const { sendResetPasswordEmail } = await loadMailer(CONFIGURED);

    await sendResetPasswordEmail('someone@example.test', 't');

    expect(transportOptions).toHaveLength(1);
    expect(transportOptions[0]).toMatchObject({
      service: 'gmail',
      auth: { user: 'noreply@dripl.test', pass: 'smtp-secret' },
    });
  });

  /**
   * No SMTP credential, no silent skip.
   *
   * The failure mode this guards is a `try { send } catch {}` added around a mail
   * failure "so signup keeps working". That converts a misconfigured deployment
   * into accounts that can never verify, with no log line and no error response.
   */
  it('throws rather than silently succeeding when SMTP_USER is unset', async () => {
    const { sendResetPasswordEmail } = await loadMailer({
      ...CONFIGURED,
      SMTP_USER: '',
    });

    await expect(sendResetPasswordEmail('someone@example.test', 't')).rejects.toThrow(/SMTP_USER/);
    expect(sent).toEqual([]);
  });

  it('throws rather than silently succeeding when SMTP_PASS is unset', async () => {
    const { sendResetPasswordEmail } = await loadMailer({
      ...CONFIGURED,
      SMTP_PASS: '',
    });

    await expect(sendResetPasswordEmail('someone@example.test', 't')).rejects.toThrow(/SMTP_PASS/);
    expect(sent).toEqual([]);
  });

  /**
   * Importing the module with no credential configured must still succeed.
   *
   * The same "loud at send time, not at import" property seen from the other side.
   * If this ever throws, the failure is at process start over a value that only
   * matters when someone actually asks for a password reset.
   */
  it('imports cleanly with no SMTP credential configured', async () => {
    const mailer = await loadMailer({ NEXT_PUBLIC_APP_URL: APP_URL });

    expect(typeof mailer.sendResetPasswordEmail).toBe('function');
    expect(sent).toEqual([]);
  });
});

describe('sendVerificationEmail', () => {
  /**
   * The mirror of the reset link, and the reason these two are asserted separately
   * rather than through a table: the paths are `/verify-email` and
   * `/reset-password`, they are different routes with different validation, and a
   * copy-paste that swapped them produces mail that is well-formed, delivered, and
   * useless. Only one of the two link assertions would notice.
   */
  it('sends a verification link that carries the token as a query parameter', async () => {
    const { sendVerificationEmail } = await loadMailer(CONFIGURED);

    await sendVerificationEmail('newcomer@example.test', 'verify-token-xyz');

    expect(sent).toHaveLength(1);
    const url = new URL(hrefOf(sent[0]?.html ?? ''));
    expect(url.origin).toBe(APP_URL);
    expect(url.pathname).toBe('/verify-email');
    expect(url.searchParams.get('token')).toBe('verify-token-xyz');
    expect(url.hash).toBe('');
  });

  it('addresses the message to the requested recipient with its own subject', async () => {
    const { sendVerificationEmail } = await loadMailer(CONFIGURED);

    await sendVerificationEmail('newcomer@example.test', 't');

    expect(sent[0]?.to).toBe('newcomer@example.test');
    // Distinct from the reset subject: a shared subject line is what makes a user
    // click the wrong link, and one of the two flows then fails for them.
    expect(sent[0]?.subject).toBe('Verify your Dripl account');
  });

  it('tells an unexpected verification mail that ignoring it is safe', async () => {
    const { sendVerificationEmail } = await loadMailer(CONFIGURED);

    await sendVerificationEmail('newcomer@example.test', 't');

    // The "if you didn't create an account, ignore this" line is what stops a
    // verification mail from reading as a breach notice. Its removal is a support
    // cost, so it is pinned rather than left to a copy edit.
    expect(sent[0]?.html).toContain("If you didn't create an account");
  });

  it('throws rather than silently succeeding when the credential is missing', async () => {
    const { sendVerificationEmail } = await loadMailer({
      ...CONFIGURED,
      SMTP_USER: '',
    });

    await expect(sendVerificationEmail('newcomer@example.test', 't')).rejects.toThrow();
    expect(sent).toEqual([]);
  });
});

describe('the app URL used in both messages', () => {
  /**
   * `NEXT_PUBLIC_APP_URL` is the source, with a localhost fallback.
   *
   * The fallback is what makes this case worth asserting: it is the URL a
   * developer-run server sends, and a mail that arrives pointing at
   * `http://localhost:3000` is undeliverable in practice — the recipient's browser
   * resolves localhost to their own machine. Pinning the precedence means a change
   * to it has to be deliberate.
   */
  it('falls back to localhost when NEXT_PUBLIC_APP_URL is unset', async () => {
    const { sendVerificationEmail } = await loadMailer({
      NEXT_PUBLIC_APP_URL: '',
      SMTP_USER: 'noreply@dripl.test',
      SMTP_PASS: 'smtp-secret',
    });

    await sendVerificationEmail('newcomer@example.test', 't');

    expect(new URL(hrefOf(sent[0]?.html ?? '')).origin).toBe('http://localhost:3000');
  });
});
