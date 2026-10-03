/**
 * Authenticated-request fixtures for the route suites.
 *
 * Deliberately minimal, per the task's constraint: a real signed token for a
 * known user id is the whole fixture. No user factory, no roles, no fixtures
 * the tests do not need — `ownerId()` and `outsiderId()` are the only two
 * principals these suites care about, and both are just strings handed to
 * `signToken`.
 *
 * The token is real rather than a stubbed middleware for one reason: the
 * boundary being tested is "does a request carrying user A's identity reach
 * user A's rows", and a fake middleware that sets `req.userId = 'whatever the
 * test passed'` would pass just as happily if `authMiddleware` were deleted
 * from the mount. Signing a JWT means a malformed or unsigned credential is
 * rejected by the production code path.
 */

import cookieParser from 'cookie-parser';
import express, { type Express, type RequestHandler, type Router } from 'express';
import request from 'supertest';
import { signToken } from '@dripl/utils/auth';
import { authMiddleware } from '../../middlewares/authMiddleware';
import { validateCsrfToken } from '../../middlewares/csrfMiddleware';

/** The two principals every authorisation case is written between. */
export const OWNER_ID = 'user-owner';
export const OUTSIDER_ID = 'user-outsider';

/** Any signed token for `userId`. */
export function bearer(userId: string): string {
  return `Bearer ${signToken(userId)}`;
}

/**
 * A syntactically plausible but unsigned credential, plus the two malformed
 * shapes that matter: a wrong-scheme header and a token whose signature does
 * not verify. `authMiddleware` must reject all of them.
 */
export function malformedCredentials(): Array<{ label: string; header?: string; cookie?: string }> {
  return [
    { label: 'no credential at all' },
    { label: 'unsigned three-part token', header: 'Bearer aaa.bbb.ccc' },
    { label: 'non-Bearer scheme carrying a token shape', header: 'Basic aaa.bbb.ccc' },
    { label: 'Bearer with no token', header: 'Bearer' },
    { label: 'empty session cookie', cookie: 'dripl-session=' },
  ];
}

const CSRF_TOKEN = 'e'.repeat(64);

/**
 * Builds an app that mounts each `[path, router]` pair behind exactly the guard
 * chain `src/app.ts` uses for it: CSRF first, then authentication. Mirroring
 * the composition root is the point — a hand-rolled mount that dropped
 * `authMiddleware` would let a route pass in isolation while the real server
 * still guards it, which is the opposite of what these suites are for.
 *
 * `public: true` opts a router out of authentication, for the two routes that
 * are capability-URL based by design (`GET /api/share/:token`,
 * `GET /api/images/:id`).
 */
export function buildApp(
  mounts: Array<{ path: string; router: Router; public?: boolean }>,
  options: { csrf?: boolean; auth?: boolean } = {}
): Express {
  const app: Express = express();
  app.use(express.json({ limit: '5mb' }));
  app.use(express.urlencoded({ extended: true, limit: '5mb' }));
  app.use(cookieParser());
  for (const mount of mounts) {
    const guards: RequestHandler[] = [];
    if (options.csrf !== false) guards.push(validateCsrfToken);
    if (options.auth !== false && !mount.public) guards.push(authMiddleware);
    app.use(mount.path, ...guards, mount.router);
  }
  return app;
}

// A supertest `Test`, i.e. what `request(app).get(path)` hands back. The
// previous spelling took `ReturnType<TestAgent>`, which is not a function and
// so did not satisfy the `(...args: any) => any` constraint below.
type Pending = ReturnType<ReturnType<typeof request>['get']>;

function withAuth(req: Pending, userId: string): Pending {
  return req.set('Authorization', bearer(userId));
}

/**
 * Mutation helpers attach the double-submit CSRF pair, because
 * `validateCsrfToken` rejects a state-changing request that carries only the
 * cookie — that is exactly what a cross-site POST looks like, so a suite that
 * omitted the header would be testing the CSRF guard instead of the route.
 */
export function get(
  app: Express,
  path: string,
  userId?: string,
  headers: Record<string, string> = {}
): Promise<request.Response> {
  const pending = request(app).get(path);
  const signed = userId ? withAuth(pending, userId) : pending;
  // Supplied last so a caller can send a conditional request (If-None-Match)
  // alongside the auth pair, without this helper needing a second shape.
  const conditional = Object.entries(headers).reduce(
    (req, [name, value]) => req.set(name, value),
    signed
  );
  return conditional;
}

export function post(
  app: Express,
  path: string,
  userId: string,
  body: unknown = {}
): Promise<request.Response> {
  return request(app)
    .post(path)
    .set('Authorization', bearer(userId))
    .set('Cookie', [`csrf-token=${CSRF_TOKEN}`])
    .set('x-csrf-token', CSRF_TOKEN)
    .send(body as object);
}

export function patch(
  app: Express,
  path: string,
  userId: string,
  body: unknown = {}
): Promise<request.Response> {
  return request(app)
    .patch(path)
    .set('Authorization', bearer(userId))
    .set('Cookie', [`csrf-token=${CSRF_TOKEN}`])
    .set('x-csrf-token', CSRF_TOKEN)
    .send(body as object);
}

export function put(
  app: Express,
  path: string,
  userId: string,
  body: unknown = {}
): Promise<request.Response> {
  return request(app)
    .put(path)
    .set('Authorization', bearer(userId))
    .set('Cookie', [`csrf-token=${CSRF_TOKEN}`])
    .set('x-csrf-token', CSRF_TOKEN)
    .send(body as object);
}

export function del(app: Express, path: string, userId: string): Promise<request.Response> {
  return request(app)
    .delete(path)
    .set('Authorization', bearer(userId))
    .set('Cookie', [`csrf-token=${CSRF_TOKEN}`])
    .set('x-csrf-token', CSRF_TOKEN);
}

/** A request carrying a raw (possibly absent or malformed) credential. */
export function raw(
  method: 'get' | 'post' | 'patch' | 'put' | 'delete',
  app: Express,
  path: string,
  credentials: { header?: string; cookie?: string },
  body: unknown = {}
): Promise<request.Response> {
  const pending = request(app)[method](path);
  if (credentials.header !== undefined) pending.set('Authorization', credentials.header);
  const cookies = [`csrf-token=${CSRF_TOKEN}`];
  if (credentials.cookie !== undefined) cookies.unshift(`dripl-session=${credentials.cookie}`);
  pending.set('Cookie', cookies);
  pending.set('x-csrf-token', CSRF_TOKEN);
  return pending.send(body as object);
}

/** A minimal valid rectangle element, for the scene-validation paths. */
export const VALID_ELEMENT = {
  id: 'el-1',
  type: 'rectangle',
  x: 0,
  y: 0,
  width: 10,
  height: 10,
} as const;

export { CSRF_TOKEN };
