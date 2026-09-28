#!/usr/bin/env node
/**
 * Preflight check for Google sign-in.
 *
 * A failed Google login surfaces as a browser redirect to
 * `/login?error=token_exchange_failed`, which says nothing about the cause. The
 * three real causes - a rotated secret, a mismatched id/secret pair, and an
 * unregistered redirect URI - all collapse into that one string, and the
 * existing log line reports `hasClientSecret: true` for a secret that is
 * present but rejected. This turns that into a specific verdict.
 *
 * What it checks:
 *   1. the required env vars exist and are shaped like Google credentials
 *   2. the authorize step and the callback agree on the redirect URI, since a
 *      mismatch only shows up as an opaque failure after consent
 *   3. Google accepts the client id/secret pair, by calling the token endpoint
 *      and reading the error class
 *
 * What it cannot check: that a real person consents, or that a session is
 * issued. Those need a browser and a live credential. Check 3 is the boundary -
 * a correct credential pair returns `invalid_grant` here (the dummy code is
 * rejected, which is expected); a bad one returns `invalid_client`.
 *
 * Secrets are read from the environment and never printed.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function loadDotEnv(path) {
  const out = {};
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return out;
  }
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r$/, '').trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

const fileEnv = loadDotEnv(resolve(repoRoot, '.env'));
const env = key => process.env[key] ?? fileEnv[key];

const problems = [];
const notes = [];

const clientId = env('GOOGLE_CLIENT_ID');
const clientSecret = env('GOOGLE_CLIENT_SECRET');
const appUrl = (env('NEXT_PUBLIC_APP_URL') || 'http://localhost:3000').replace(/\/$/, '');
const callbackPath = '/api/auth/google/callback';
const redirectUri = `${appUrl}${callbackPath}`;

// 1. Presence and shape.
if (!clientId) problems.push('GOOGLE_CLIENT_ID is not set');
if (!clientSecret) problems.push('GOOGLE_CLIENT_SECRET is not set');

if (clientId && !/^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/.test(clientId)) {
  problems.push(
    'GOOGLE_CLIENT_ID does not look like a Google OAuth client id ' +
      '(expected <number>-<hash>.apps.googleusercontent.com). ' +
      'A client secret pasted here by mistake is a common cause.'
  );
}
if (clientSecret && !/^GOCSPX-/.test(clientSecret)) {
  problems.push(
    'GOOGLE_CLIENT_SECRET does not start with the GOCSPX- prefix that current ' +
      'Google client secrets use. Confirm the value is the secret, not the id.'
  );
}

// 2. Authorize and callback must agree, or the failure appears only after consent.
try {
  const configSrc = readFileSync(
    resolve(repoRoot, 'apps/dripl-app/app/api/auth/google/google-config.ts'),
    'utf8'
  );
  const authorize = readFileSync(
    resolve(repoRoot, 'apps/dripl-app/app/api/auth/google/route.ts'),
    'utf8'
  );
  const callback = readFileSync(
    resolve(repoRoot, 'apps/dripl-app/app/api/auth/google/callback/route.ts'),
    'utf8'
  );
  const usesSharedConfig = src => src.includes('google-config');
  if (!configSrc.includes('process.env.NEXT_PUBLIC_APP_URL')) {
    problems.push('google-config.ts no longer derives the URL from NEXT_PUBLIC_APP_URL');
  } else if (!usesSharedConfig(authorize) || !usesSharedConfig(callback)) {
    problems.push('The authorize/callback routes no longer share one config module');
  } else {
    notes.push(`authorize and callback share google-config.ts, derived from NEXT_PUBLIC_APP_URL`);
  }
} catch {
  notes.push('could not read the OAuth routes to compare their redirect URI source');
}

if (!/^https?:\/\//.test(appUrl)) {
  problems.push(`NEXT_PUBLIC_APP_URL is not an absolute http(s) URL (got "${appUrl}")`);
}

notes.push(`redirect URI in use: ${redirectUri}`);
notes.push(`register exactly that string in the Google console's Authorized redirect URIs`);

// 3. Does Google accept the credential pair?
let verdict = 'SKIPPED';
if (clientId && clientSecret) {
  try {
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: 'preflight-dummy-code',
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });
    const parsed = JSON.parse(await response.text());
    if (parsed.error === 'invalid_client') {
      verdict = 'FAIL';
      problems.push(
        'Google rejects the client id/secret pair ("invalid_client"). The secret is ' +
          'rotated, deleted, or belongs to a different OAuth client than the id. ' +
          'Copy the id and secret together from the same console entry.'
      );
    } else if (parsed.error === 'invalid_grant') {
      verdict = 'PASS';
      notes.push('Google accepted the credential pair; only the dummy code was rejected');
    } else if (parsed.error === 'redirect_uri_mismatch') {
      verdict = 'FAIL';
      problems.push(
        `Google has no ${redirectUri} registered for this client ` +
          '("redirect_uri_mismatch"). The id/secret pair itself is fine.'
      );
    } else {
      verdict = 'UNKNOWN';
      notes.push(`Google replied "${parsed.error}", which this check does not classify`);
    }
  } catch (error) {
    verdict = 'UNKNOWN';
    notes.push(`could not reach the Google token endpoint: ${error.message}`);
  }
}

for (const note of notes) console.log(`  - ${note}`);

// 4. Is the running server using these values? A stale process (edited .env,
// forgot restart) is the most common cause of a persistent failure after a
// correct fix. The status endpoint exposes only a client ID prefix.
if (clientId && appUrl) {
  try {
    const statusUrl = `${appUrl}/api/auth/google/status`;
    const response = await fetch(statusUrl);
    if (response.ok) {
      const status = await response.json();
      const expectedPrefix = clientId.slice(0, 12);
      if (
        status.configured &&
        status.clientIdPrefix === expectedPrefix &&
        status.redirectUri === redirectUri
      ) {
        notes.push('running server reports the same client ID prefix and redirect URI as .env');
      } else {
        problems.push(
          'the running server disagrees with .env ' +
            `(server prefix "${status.clientIdPrefix}", uri "${status.redirectUri}"). ` +
            'Restart the dev server (and http-server) so the new values load.'
        );
      }
    } else {
      notes.push('status endpoint not reachable; start the dev server to compare running config');
    }
  } catch {
    notes.push('status endpoint not reachable; start the dev server to compare running config');
  }
  for (const note of notes.slice(-1)) console.log(`  - ${note}`);
}

if (problems.length > 0) {
  console.error('\nFAIL');
  for (const problem of problems) console.error(`  x ${problem}`);
  process.exit(1);
}

console.log(`\nPASS (credential pair ${verdict})`);
console.log('Sign-in still needs a browser to confirm consent and session issuance.');
