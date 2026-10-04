/**
 * THE ERROR CLASSIFIER IN `app.ts`, AS AN ISOLATED SUBJECT.
 *
 * `classifyOperationalError` is the one place in this server that decides whether
 * a thrown error is the caller's fault or a fault in this process, and it decides
 * on *explicit markers* rather than on "the error carries a 4xx status". The
 * comment in `app.ts` gives the reason, and it is exactly the kind of thing a
 * well-meaning refactor undoes:
 *
 *   A service-layer exception that happens to carry `status: 403` is still a bug
 *   here. Sniffing the status would relabel it as the caller's problem, and the
 *   error level in the log -- the one place an incident is triaged from -- would
 *   stop being a signal.
 *
 * HOW THE ERRORS GET THERE
 *
 * Not by mounting a throwing router. `createApp()` registers its terminal handler
 * before returning, so anything appended afterwards is downstream of it and its
 * rejections land in Express's default handler -- which honours `err.status` and
 * answers 403, testing nothing. Instead every case below drives a *production*
 * route that has no try/catch of its own, `GET /api/share/:token/ws-ticket`,
 * whose `db.file.findUnique` is stubbed to reject with the shape under test. That
 * route was chosen because it is real: the classification decision is only
 * meaningful on the paths that actually reach it.
 *
 * `appComposition.test.ts` already drives the two positive markers (a real
 * `body-parser` rejection and a real CORS rejection). It cannot drive the negative
 * case, because nothing in the production tree throws a `403`-carrying error on
 * purpose — so these cases supply it.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';

/**
 * The general rate limiter reads Upstash config at module load; mocked so
 * `createApp()` imports offline and deterministically, and so the
 * `/live` `/health` `/metrics` exemption can be driven to exhaustion.
 */
vi.mock('@upstash/redis', () => ({ Redis: class FakeRedis {} }));
vi.mock('@upstash/ratelimit', () => ({
  Ratelimit: class FakeRatelimit {
    static slidingWindow() {
      return {};
    }
    async limit() {
      return { success: true, remaining: 999, reset: Date.now() + 60_000 };
    }
  },
}));

/**
 * `GET /api/share/:token/ws-ticket` resolves the share's file before anything
 * else, with no try/catch around it, so a rejection from here is the app-level
 * handler's own path. `$queryRaw` is present because `/health` needs it.
 */
const { findUnique, queryRaw } = vi.hoisted(() => ({
  findUnique: vi.fn(async () => null),
  queryRaw: vi.fn(async () => [{ ok: 1 }]),
}));

vi.mock('@dripl/db', () => ({
  db: { file: { findUnique }, $queryRaw: queryRaw },
  initializeDb: async () => {},
}));

// `generalRateLimit` is exported precisely so a caller can reason about the budget;
// spying on `limit` is how the probe exemption below is observed directly, rather
// than inferred from a loop that burns the shared window for every later test.
import { createApp, generalRateLimit } from '../app';
import { logger } from '../logger';

const TOKEN_PATH = '/api/share/some-token/ws-ticket';

let warn: ReturnType<typeof vi.spyOn>;
let error: ReturnType<typeof vi.spyOn>;
let app: ReturnType<typeof createApp>;

function eventsOf(spy: ReturnType<typeof vi.spyOn>): Array<string | undefined> {
  return (spy.mock.calls as unknown[][]).map(
    call => (call[0] as { event?: string } | undefined)?.event
  );
}

/** `status`-carrying error: the shape a status-sniffing classifier would match. */
function errorWithStatus(status: number, message: string): Error {
  const error = new Error(message);
  (error as Error & { status: number }).status = status;
  return error;
}

/** `type`-carrying error: the marker `body-parser` itself uses. */
function errorWithType(type: string, message: string): Error {
  const error = new Error(message);
  (error as Error & { type: string }).type = type;
  return error;
}

async function throwFromRoute(thrown: unknown): Promise<request.Response> {
  findUnique.mockRejectedValueOnce(thrown);
  return request(app).get(TOKEN_PATH);
}

beforeEach(() => {
  warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
  error = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
  findUnique.mockResolvedValue(null);
  app = createApp();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('classifyOperationalError — a service exception carrying 4xx is still a bug', () => {
  /**
   * The case the whole predicate exists for.
   *
   * A handler that throws `Object.assign(new Error('...'), { status: 403 })` is the
   * canonical shape of a service-layer mistake wearing a client-error costume. If
   * the classifier ever grew `if (status >= 400 && status < 500) return 'client'`,
   * the *response* would not change -- this module always answers 500 -- but the
   * log line would move to `warn`/`http_client_error`, and the operator triaging a
   * live incident would see a wall of client noise and no server fault.
   */
  it('logs a thrown error carrying status 403 as a server fault, not a client error', async () => {
    const res = await throwFromRoute(errorWithStatus(403, 'Forbidden by the storage driver'));

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('INTERNAL_ERROR');
    expect(eventsOf(error)).toContain('http_server_error');
    expect(eventsOf(warn)).not.toContain('http_client_error');
  });

  /**
   * The same predicate across the whole plausible status range, as a loop.
   *
   * One status would not notice the range being widened: `403` alone passes for a
   * classifier that special-cases exactly that one value, which is the more likely
   * shape of the regression. Asserted as a count of server faults rather than a
   * per-request log read so the loop cannot be satisfied by fewer calls than
   * requests.
   */
  it('never reclassifies a thrown error on the strength of its status alone', async () => {
    const statuses = [400, 401, 403, 404, 409, 410, 422, 429, 499];

    for (const status of statuses) {
      const res = await throwFromRoute(errorWithStatus(status, `service failure ${status}`));
      expect(res.status, `status ${status} must not become the response status`).toBe(500);
    }

    expect(eventsOf(error).filter(event => event === 'http_server_error')).toHaveLength(
      statuses.length
    );
    expect(warn).not.toHaveBeenCalled();
  });

  /**
   * A 5xx-carrying error is the same story: matching on "any status" would
   * relabel a genuine server fault as the caller's, which is the more damaging
   * direction of the mistake because it removes the fault from the error level
   * entirely.
   */
  it('does not treat a 5xx-carrying error as the client’s either', async () => {
    const res = await throwFromRoute(errorWithStatus(503, 'upstream unavailable'));

    expect(res.status).toBe(500);
    expect(eventsOf(error)).toContain('http_server_error');
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('classifyOperationalError — only the two documented markers count', () => {
  /**
   * The positive side of the same decision, so the cases above cannot be satisfied
   * by deleting the classifier. Each entry is the documented shape for a rejection
   * a client can provoke; a predicate that refused all of them would still pass
   * every negative case above.
   *
   * Driven through the same production route, so this is the classifier's real
   * decision rather than a restatement of it.
   */
  it('still classifies the documented client-caused rejections as the client’s', async () => {
    const markers: Array<[string, Error]> = [
      ['entity.parse.failed', errorWithType('entity.parse.failed', 'Unexpected token }')],
      ['entity.too.large', errorWithType('entity.too.large', 'request entity too large')],
      ['request.aborted', errorWithType('request.aborted', 'request aborted')],
      ['parameters.too.many', errorWithType('parameters.too.many', 'too many parameters')],
      ['cors', new Error('CORS: origin http://evil.example not allowed')],
    ];

    for (const [label, thrown] of markers) {
      const res = await throwFromRoute(thrown);
      expect(res.status, label).toBe(500);
    }

    expect(eventsOf(warn).filter(event => event === 'http_client_error')).toHaveLength(
      markers.length
    );
    expect(error).not.toHaveBeenCalled();
  });

  /**
   * `type` is matched against a fixed allow-list, not "looks like a type".
   *
   * The list exists because `body-parser` draws from it. A predicate widened to
   * "any string `type`" would classify every domain error that carries one as the
   * caller's fault. Pinned at the near-miss: a plausible-looking type that is not
   * on the list.
   */
  it('does not classify an unknown `type` marker as the client’s', async () => {
    const res = await throwFromRoute(errorWithType('validation.failed', 'a domain error'));

    expect(res.status).toBe(500);
    expect(eventsOf(error)).toContain('http_server_error');
    expect(eventsOf(warn)).not.toContain('http_client_error');
  });

  /**
   * The CORS check is a *prefix* match on this module's own error message, which is
   * the only thing separating it from an arbitrary service error whose text happens
   * to mention CORS. Widening `startsWith` to `includes` would classify any error
   * containing the phrase as the caller's -- including one thrown by a proxy
   * library on a server fault, which is precisely the mislabel this file is about.
   */
  it('does not classify an error that merely mentions the CORS phrase mid-message', async () => {
    const res = await throwFromRoute(new Error('proxy rejected: CORS: origin policy failed'));

    expect(res.status).toBe(500);
    expect(eventsOf(error)).toContain('http_server_error');
    expect(eventsOf(warn)).not.toContain('http_client_error');
  });

  /**
   * A non-string `type` must not be honoured.
   *
   * `typeof type === 'string'` is what guards this. Dropping the guard turns
   * `Set.has({...})` into a silent `false` -- the safe answer, but only by accident
   * of `has` semantics rather than by decision, and a future `Array.includes` or a
   * prefix check would not be so forgiving.
   */
  it('does not classify an object-valued `type` marker as the client’s', async () => {
    const thrown = new Error('a domain error');
    (thrown as Error & { type: unknown }).type = { name: 'entity.parse.failed' };

    const res = await throwFromRoute(thrown);

    expect(res.status).toBe(500);
    expect(eventsOf(error)).toContain('http_server_error');
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('the terminal handler’s response contract is independent of the classification', () => {
  /**
   * `appComposition.test.ts` pins malformed JSON to `500 INTERNAL_ERROR`, and the
   * comment in `app.ts` says the classification change must not renegotiate the
   * wire contract. This asserts the same status for the *opposite* classification:
   * if someone "fixed" the 403 case by propagating `err.status`, both branches
   * would stop agreeing on 500 and this fails.
   */
  it('answers 500 INTERNAL_ERROR for a client-caused rejection and a server fault alike', async () => {
    const client = await throwFromRoute(errorWithType('entity.parse.failed', 'Unexpected token'));
    const server = await throwFromRoute(new Error('a genuine fault'));

    expect(client.body).toEqual({
      error: 'INTERNAL_ERROR',
      message: 'Internal server error',
      statusCode: 500,
    });
    expect(server.body).toEqual(client.body);
  });

  /**
   * The classified branch logs `error.message` and the route — nothing else. The
   * `warn` path deliberately omits the stack, unlike the `error` path, because a
   * client can provoke it and a stack would point a reader at server internals for
   * no fault.
   *
   * Asserted as an absence rather than a presence, because the regression this
   * guards is *adding* the stack to the client-facing branch.
   */
  it('does not attach a stack to the client-caused branch', async () => {
    await throwFromRoute(errorWithType('entity.parse.failed', 'Unexpected token'));

    const record = warn.mock.calls[0]?.[0] as { stack?: unknown } | undefined;
    expect(record).toBeDefined();
    expect(record?.stack).toBeUndefined();
  });

  /**
   * The server-fault branch *does* attach the stack. Asserted because the two
   * branches are asymmetric by design, and a "tidy up the logging" change that
   * dropped it would remove the one piece of information an incident needs.
   */
  it('attaches the stack to the server-fault branch', async () => {
    await throwFromRoute(new Error('a genuine fault'));

    const record = error.mock.calls[0]?.[0] as { stack?: unknown } | undefined;
    expect(record).toBeDefined();
    expect(typeof record?.stack).toBe('string');
    expect(String(record?.stack)).toContain('a genuine fault');
  });
});

describe('liveness and readiness stay separated under the real composition', () => {
  /**
   * `/live` must answer with no I/O at all. `render.yaml` restarts on it, so a
   * `/live` that consulted Postgres would turn a 60-second database blip into a
   * restart of every http-server instance -- the failure mode the endpoint was
   * split out to prevent, and the one that used to discard live ws-server rooms.
   *
   * Asserted by breaking the database and requiring the two probes to disagree:
   * `/live` 200, `/health` 503, and exactly one database call between them.
   */
  it('answers /live with 200 even when the database cannot be reached', async () => {
    queryRaw.mockRejectedValue(new Error('connection refused'));

    const live = await request(app).get('/live');
    const health = await request(app).get('/health');

    expect(live.status).toBe(200);
    expect(live.body.status).toBe('ok');
    expect(health.status).toBe(503);
    expect(health.body).toMatchObject({ status: 'error', message: 'Database unreachable' });
    // Only the readiness probe touched the database at all.
    expect(queryRaw).toHaveBeenCalledTimes(1);
  });

  it('does not charge /live against the caller’s rate limit', async () => {
    const limited = vi.spyOn(generalRateLimit, 'limit');

    await request(app).get('/live');

    // Not "answered 200 anyway": the limiter is never *consulted*. A probe that
    // is charged and then answered regardless would still let a scrape drain the
    // budget of whatever address it comes from.
    expect(limited).not.toHaveBeenCalled();
  });

  it('charges an ordinary route against the caller’s rate limit', async () => {
    // The control for the case above. Without it, "not called" would also pass if
    // the middleware were simply never mounted.
    const limited = vi.spyOn(generalRateLimit, 'limit');

    const res = await request(app).get('/api/files');

    expect(limited).toHaveBeenCalled();
    expect(res.status).toBe(401);
  });
});

describe('the general rate limiter refuses an over-budget caller', () => {
  /**
   * A private app per case.
   *
   * `generalRateLimit` is created at module load, so its window is process-wide and
   * a limiter exhausted on the shared `app` would refuse every later request in this
   * file -- including the probes. `vi.resetModules()` plus a dynamic import is what
   * makes "exhaust the budget" a statement about one app rather than about the test
   * runner.
   */
  async function appWithItsOwnBudget(): Promise<ReturnType<typeof createApp>> {
    vi.resetModules();
    const fresh = await import('../app');
    return fresh.createApp();
  }

  /** Drive one caller past `app.ts`'s general limit, returning the refusal. */
  async function exhaust(budget: ReturnType<typeof createApp>): Promise<request.Response> {
    for (let attempt = 0; attempt < 400; attempt += 1) {
      const res = await request(budget).get('/api/files');
      if (res.status === 429) return res;
    }
    throw new Error('the general rate limiter never refused this caller');
  }

  it('does not charge /live, /health or /metrics against a caller’s rate limit', async () => {
    const budget = await appWithItsOwnBudget();
    expect((await exhaust(budget)).status).toBe(429);

    for (const path of ['/live', '/health', '/metrics']) {
      const res = await request(budget).get(path);
      expect(res.status, `${path} must not be rate limited`).not.toBe(429);
    }
  });

  /**
   * The refusal carries a `Retry-After` that is never zero or negative. A client
   * reading `Retry-After: 0` retries immediately, which is how a rate limit turns
   * into a self-inflicted load amplifier aimed at the server doing the refusing.
   */
  it('answers a rate-limited request with Retry-After of at least one second', async () => {
    const refusal = await exhaust(await appWithItsOwnBudget());

    expect(refusal.status).toBe(429);
    expect(refusal.body).toEqual({
      error: 'RATE_LIMITED',
      message: 'Rate limit exceeded',
      statusCode: 429,
    });
    const retryAfter = Number(refusal.headers['retry-after']);
    expect(Number.isFinite(retryAfter)).toBe(true);
    expect(retryAfter).toBeGreaterThanOrEqual(1);
  });
});

describe('the unauthenticated root and metrics endpoints', () => {
  /**
   * Both are open by design -- a load balancer and a scrape need them -- so the
   * invariant is that they expose *nothing* but process-level facts. A change that
   * added a row count, a version string carrying a connection target, or an
   * upstream URL would be a new disclosure on an unauthenticated endpoint, and
   * asserting the key set catches that where a spot check on values would not.
   */
  it('exposes only process-level facts on / and /metrics', async () => {
    const root = await request(app).get('/');
    const metrics = await request(app).get('/metrics');

    expect(root.status).toBe(200);
    expect(Object.keys(root.body).sort()).toEqual(['service', 'status']);
    expect(root.body).toEqual({ service: 'dripl-http', status: 'ok' });

    expect(metrics.status).toBe(200);
    expect(Object.keys(metrics.body).sort()).toEqual(['memoryUsageMB', 'uptime']);
  });

  /**
   * `/csrf-token` must hand out a token that the double-submit check then accepts,
   * as a pair. Asserting the round trip rather than the token's shape: a token
   * generated but not echoed into the cookie is a CSRF implementation that
   * rejects every legitimate cross-origin write.
   */
  it('issues a CSRF token the double-submit check accepts on the pair it hands out', async () => {
    const issued = await request(app).get('/csrf-token');

    expect(issued.status).toBe(200);
    expect(issued.body.token).toMatch(/^[0-9a-f]{64}$/);
    expect(String(issued.headers['set-cookie']?.[0] ?? '')).toContain('csrf-token=');

    const cookie = issued.headers['set-cookie']?.[0]?.split(';')[0] ?? '';
    const accepted = await request(app)
      .post('/api/auth/login')
      .set('Cookie', [cookie])
      .set('x-csrf-token', issued.body.token)
      .send({ email: 'nobody@example.com', password: 'x' });
    // Past the CSRF gate (not 403) and into the route, which refuses for its own
    // reasons. The point of the assertion is that it is not 403.
    expect(accepted.status).not.toBe(403);
  });
});
