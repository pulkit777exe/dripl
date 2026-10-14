/**
 * Unit tests for `defineRoute` (src/lib/route.ts): the auth guard, schema
 * validation, success passthrough, service-error delegation, and 500 path.
 *
 * Route-level wire cases for the folders migration live in
 * `routes/folders.contract.test.ts` and `routes/folders.authorization.test.ts`;
 * these pin the helper's own contract with a bare express app (no global
 * authMiddleware/CSRF — `defineRoute` carries its own guard, and the stub
 * middleware below only sets `req.userId` from a header so each case can
 * choose to be authenticated or not).
 */

import express, { type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { defineRoute } from '../../lib/route';
import { logger } from '../../logger';

function stubUser(req: Request, _res: Response, next: NextFunction): void {
  const user = req.headers['x-test-user'];
  if (typeof user === 'string' && user.length > 0) {
    (req as unknown as Record<string, unknown>).userId = user;
  }
  next();
}

function testApp(mount: (app: express.Express) => void): express.Express {
  const app = express();
  app.use(express.json());
  app.use(stubUser);
  mount(app);
  return app;
}

const AUTH_HEADER = 'x-test-user';
const USER_ID = 'user-1';

describe('defineRoute auth', () => {
  const app = testApp(app => {
    app.get(
      '/',
      defineRoute({
        auth: 'required',
        event: 'auth_test',
        handler: async ({ userId, res }) => {
          res.json({ userId });
        },
      })
    );
  });

  it('answers 401 via sendError when auth is required and no userId is set', async () => {
    const response = await request(app).get('/');

    expect(response.status).toBe(401);
    expect(response.body).toEqual({
      error: 'UNAUTHORIZED',
      message: 'Authentication required',
      statusCode: 401,
    });
  });

  it('reaches the handler with userId when authenticated', async () => {
    const response = await request(app).get('/').set(AUTH_HEADER, USER_ID);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ userId: USER_ID });
  });
});

describe('defineRoute validation', () => {
  const bodySchema = z.object({ name: z.string().trim().min(1).max(200) });
  const querySchema = z.object({ page: z.coerce.number().int().positive().default(1) });

  it('answers 400 INVALID_PAYLOAD with zod details for a bad body', async () => {
    let called = false;
    const app = testApp(app => {
      app.post(
        '/',
        defineRoute({
          auth: 'required',
          body: bodySchema,
          event: 'validation_test',
          handler: async ({ res }) => {
            called = true;
            res.json({});
          },
        })
      );
    });

    const response = await request(app).post('/').set(AUTH_HEADER, USER_ID).send({});

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('INVALID_PAYLOAD');
    expect(response.body.statusCode).toBe(400);
    expect(response.body.details.fieldErrors.name).toBeDefined();
    expect(called).toBe(false);
  });

  it('hands the parsed body to the handler when valid', async () => {
    const app = testApp(app => {
      app.post(
        '/',
        defineRoute({
          auth: 'required',
          body: bodySchema,
          event: 'validation_test',
          handler: async ({ body, res }) => {
            res.json({ name: body.name });
          },
        })
      );
    });

    const response = await request(app).post('/').set(AUTH_HEADER, USER_ID).send({ name: '  hi  ' });

    expect(response.status).toBe(200);
    // The handler sees the schema output (trimmed), not the raw payload.
    expect(response.body).toEqual({ name: 'hi' });
  });

  it('answers 400 INVALID_QUERY with zod details for a bad query', async () => {
    const app = testApp(app => {
      app.get(
        '/',
        defineRoute({
          auth: 'required',
          query: querySchema,
          event: 'validation_test',
          handler: async ({ res }) => {
            res.json({});
          },
        })
      );
    });

    const response = await request(app).get('/?page=nope').set(AUTH_HEADER, USER_ID);

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('INVALID_QUERY');
    expect(response.body.statusCode).toBe(400);
    expect(response.body.details).toBeDefined();
  });

  it('answers 400 for bad params', async () => {
    const paramsSchema = z.object({ id: z.string().uuid() });
    const app = testApp(app => {
      const router = express.Router();
      router.get(
        '/:id',
        defineRoute({
          auth: 'required',
          params: paramsSchema,
          event: 'validation_test',
          handler: async ({ res }) => {
            res.json({});
          },
        })
      );
      app.use(router);
    });

    const response = await request(app).get('/not-a-uuid').set(AUTH_HEADER, USER_ID);

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('INVALID_PAYLOAD');
    expect(response.body.details).toBeDefined();
  });

  it('honours per-route validation overrides to keep a historical envelope', async () => {
    const app = testApp(app => {
      app.post(
        '/',
        defineRoute({
          auth: 'required',
          body: bodySchema,
          invalidBody: { code: 'Invalid widget payload', message: 'Invalid widget payload' },
          event: 'validation_test',
          handler: async ({ res }) => {
            res.json({});
          },
        })
      );
    });

    const response = await request(app).post('/').set(AUTH_HEADER, USER_ID).send({});

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Invalid widget payload');
    expect(response.body.message).toBe('Invalid widget payload');
  });
});

describe('defineRoute handler results', () => {
  it('passes an ok result through without touching the handler response', async () => {
    const app = testApp(app => {
      app.post(
        '/',
        defineRoute({
          auth: 'required',
          event: 'ok_test',
          handler: async ({ res }) => {
            res.status(201).json({ folder: { id: 'f1' } });
            return { kind: 'ok' as const, folder: { id: 'f1' } };
          },
        })
      );
    });

    const response = await request(app).post('/').set(AUTH_HEADER, USER_ID);

    expect(response.status).toBe(201);
    expect(response.body).toEqual({ folder: { id: 'f1' } });
  });

  it('delegates non-ok kinds to sendServiceError without changing KIND_TO_HTTP', async () => {
    const app = testApp(app => {
      app.get(
        '/',
        defineRoute({
          auth: 'required',
          errors: { not_found: 'Widget not found' },
          event: 'service_error_test',
          handler: async () => ({ kind: 'not_found' as const }),
        })
      );
    });

    const response = await request(app).get('/').set(AUTH_HEADER, USER_ID);

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      error: 'NOT_FOUND',
      message: 'Widget not found',
      statusCode: 404,
    });
  });

  it('logs the event and answers 500 when the handler throws', async () => {
    const spy = vi.spyOn(logger, 'error');
    const app = testApp(app => {
      app.get(
        '/',
        defineRoute({
          auth: 'required',
          event: 'boom_event',
          internalError: 'Failed to do the thing',
          handler: async () => {
            throw new Error('boom');
          },
        })
      );
    });

    try {
      const response = await request(app).get('/').set(AUTH_HEADER, USER_ID);

      expect(response.status).toBe(500);
      expect(response.body).toEqual({
        error: 'INTERNAL_ERROR',
        message: 'Failed to do the thing',
        statusCode: 500,
      });
      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'boom_event', error: expect.any(Error) })
      );
    } finally {
      spy.mockRestore();
    }
  });
});
