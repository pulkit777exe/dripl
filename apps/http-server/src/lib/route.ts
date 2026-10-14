import type { Request, RequestHandler, Response } from 'express';
import type { ZodType } from 'zod';
import type { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { logger } from '../logger';
import { sendError } from './response';
import { sendServiceError } from './serviceResult';

/**
 * One home for the auth/validation/service-error/500 boilerplate every
 * http-server route hand-rolls.
 *
 * SUCCESS ENVELOPE (uniform, enforced here): every 2xx JSON body sent through
 * `defineRoute` is wrapped as `{ data: <original-body> }` — the original body
 * is wrapped whole, never restructured. `GET /files/:id` answering `{ file }`
 * arrives as `{ data: { file } }`; `POST /files` answering the raw
 * `{ id, name }` row arrives as `{ data: { id, name } }`. Deletes keep their
 * 204 with no body, and 304s pass through untouched. Error answers keep
 * `{ error, message, statusCode }` (+ `details` where Zod or the service put
 * one) and are never wrapped: only `res.json` calls made while the response
 * status is 2xx are enveloped, so `sendError`/`sendServiceError` (4xx/5xx)
 * flow through byte-identical.
 *
 * NOT enveloped (deliberate, documented exceptions — none of these go through
 * `defineRoute`): the `auth.ts` routes (`{ user }`, `{ ok: true }`, …), the
 * image upload (`{ id, url, size }`, a streamed binary body that cannot go
 * through JSON validation), `/csrf-token` (`{ token }`, read by the CSRF
 * bootstrap before any envelope could be negotiated), the internal ticket
 * router, the share `ws-ticket` bridge (kept raw so a thrown route error
 * still reaches the terminal handler), and the ops probes (`/live`,
 * `/health`, `/metrics`, `/`). Clients unwrap `{ data }` transparently and
 * accept a raw body too, so both shapes keep working.
 *
 * The handler owns the success response (status + inner shape stay at the
 * call site, byte-identical inside `data`). `defineRoute` owns
 * everything else:
 * - `auth: 'required'` answers 401 when the mount did not authenticate, and
 *   narrows the handler's `userId` to `string`.
 * - `body`/`query`/`params` schemas answer 400 with the zod flatten details.
 * - a returned `{ kind }` union with a non-`'ok'` kind is delegated to the
 *   existing `sendServiceError` table — `KIND_TO_HTTP` is untouched. Handlers
 *   return the service result on every path (`ok` results are ignored) and
 *   send the success envelope themselves.
 * - a thrown error is logged under `event` and answered 500.
 *
 * Wire defaults match the existing routes (`INVALID_PAYLOAD` for body/params,
 * `INVALID_QUERY` for query, `INTERNAL_ERROR`/`'Internal server error'` for
 * 500s). Per-route overrides (`invalidBody`, `internalError`, …) exist only
 * so a migrated route can keep its historical envelope byte-identical; new
 * routes should use the defaults.
 *
 * `errors` keeps `sendServiceError`'s exhaustiveness: it must map every
 * non-`'ok'` kind of the handler's result union, so adding a kind to a
 * service breaks its route call sites at compile time.
 */
export type RouteAuth = 'required' | 'optional' | 'none';

export interface RouteValidationOverride {
  code?: string;
  message?: string;
}

export type RouteInternalError = string | { code?: string; message?: string };

export interface RouteHandlerContext<Body, Query, Params> {
  userId: string | undefined;
  body: Body;
  query: Query;
  params: Params;
  req: AuthenticatedRequest;
  res: Response;
}

export type ErrorKindOf<Result> = Exclude<Extract<Result, { kind: string }>['kind'], 'ok'>;

export type ErrorMessages<Result> = [ErrorKindOf<Result>] extends [never]
  ? Record<string, string> | undefined
  : { [Kind in ErrorKindOf<Result>]: string };

export interface DefineRouteOptions<Body, Query, Params, Result> {
  body?: ZodType<Body>;
  query?: ZodType<Query>;
  params?: ZodType<Params>;
  invalidBody?: RouteValidationOverride;
  invalidQuery?: RouteValidationOverride;
  invalidParams?: RouteValidationOverride;
  errors?: ErrorMessages<Result>;
  event: string;
  internalError?: RouteInternalError;
}

export type AuthUserId<Auth extends RouteAuth> = Auth extends 'required'
  ? string
  : string | undefined;

export function defineRoute<
  Body = unknown,
  Query = unknown,
  Params = unknown,
  Result = unknown,
  const Auth extends RouteAuth = 'optional',
>(options: DefineRouteOptions<Body, Query, Params, Result> & {
  auth?: Auth;
  handler: (
    ctx: Omit<RouteHandlerContext<Body, Query, Params>, 'userId'> & { userId: AuthUserId<Auth> }
  ) => Promise<Result> | Result;
}): RequestHandler {
  const {
    auth = 'optional',
    body: bodySchema,
    query: querySchema,
    params: paramsSchema,
    invalidBody,
    invalidQuery,
    invalidParams,
    errors,
    event,
    internalError,
    handler,
  } = options;

  const routeHandler = async (req: Request, res: Response): Promise<void> => {
    const authed = req as AuthenticatedRequest;

    if (auth === 'required' && !authed.userId) {
      sendError(res, 401, 'UNAUTHORIZED', 'Authentication required');
      return;
    }

    // Uniform success envelope, enforced in this one place: any 2xx `res.json`
    // body the handler sends is wrapped whole as `{ data: body }`. The status
    // gate is what keeps errors raw — `sendError`/`sendServiceError` answer
    // 4xx/5xx, so they flow through untouched — and 204/304 never reach
    // `res.json` (they use `.send()`/`.end()`).
    const originalJson = res.json.bind(res);
    res.json = ((body: unknown) => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        return originalJson({ data: body });
      }
      return originalJson(body);
    }) as typeof res.json;

    let body = req.body as Body;
    if (bodySchema) {
      const parsed = bodySchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: invalidBody?.code ?? 'INVALID_PAYLOAD',
          message: invalidBody?.message ?? 'Invalid request payload',
          statusCode: 400,
          details: parsed.error.flatten(),
        });
        return;
      }
      body = parsed.data;
    }

    let query = req.query as Query;
    if (querySchema) {
      const parsed = querySchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json({
          error: invalidQuery?.code ?? 'INVALID_QUERY',
          message: invalidQuery?.message ?? 'Invalid query parameters',
          statusCode: 400,
          details: parsed.error.flatten(),
        });
        return;
      }
      query = parsed.data;
    }

    let params = req.params as Params;
    if (paramsSchema) {
      const parsed = paramsSchema.safeParse(req.params);
      if (!parsed.success) {
        res.status(400).json({
          error: invalidParams?.code ?? 'INVALID_PAYLOAD',
          message: invalidParams?.message ?? 'Invalid request parameters',
          statusCode: 400,
          details: parsed.error.flatten(),
        });
        return;
      }
      params = parsed.data;
    }

    try {
      const result = await handler({
        // Guaranteed by the 401 guard above when `auth` is `'required'`;
        // otherwise the handler opted into `string | undefined`.
        userId: authed.userId as AuthUserId<Auth>,
        body,
        query,
        params,
        req: authed,
        res,
      });
      if (isServiceError(result)) {
        const failure: { kind: string } = result;
        sendServiceError(res, failure, (errors ?? {}) as unknown as Record<string, string>);
      }
    } catch (error) {
      logger.error({ event, error });
      const { code, message } = internalErrorParts(internalError);
      sendError(res, 500, code, message);
    }
  };

  return routeHandler;
}

function isServiceError(value: unknown): value is { kind: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    (value as { kind: unknown }).kind !== 'ok'
  );
}

function internalErrorParts(internalError: RouteInternalError | undefined): {
  code: string;
  message: string;
} {
  if (typeof internalError === 'string') return { code: 'INTERNAL_ERROR', message: internalError };
  return {
    code: internalError?.code ?? 'INTERNAL_ERROR',
    message: internalError?.message ?? 'Internal server error',
  };
}
