# http-server — Express REST API

> **Partially archived app guide.** Service boundaries remain useful, but old
> package/route names, auth-controller references, middleware order, and test
> imports below are not current source-of-truth. Follow the current code and
> root `CLAUDE.md`; use `docs/codebase-audit.md` for integration caveats.

---

## What This App Does

`http-server` is the Express 5 REST API backend for Dripl. It handles:

- **Authentication** — register, login, logout, Google OAuth, email verification
- **File management** — CRUD for canvas files and folders
- **Collaboration rooms** — room creation and access control
- **Share links** — create/resolve public share tokens
- **Rate limiting** — session/IP request throttling with bounded local fallback
- **Security** — CSRF protection, Helmet headers, JWT validation

Runs on **port 3002** in development.

---

## Tech Stack

| Layer      | Technology                                                         |
| ---------- | ------------------------------------------------------------------ |
| Framework  | Express 5                                                          |
| Language   | TypeScript 5 (ESM)                                                 |
| Runtime    | Node.js (tsx for dev, compiled JS for prod)                        |
| Database   | PostgreSQL via `@dripl/db` (Prisma)                                |
| Auth       | JWT (`jsonwebtoken`) + Google OAuth (`google-auth-library`)        |
| Email      | Nodemailer                                                         |
| Validation | Zod v4                                                             |
| Security   | Helmet, custom bounded rate limiters, double-submit CSRF, bcryptjs |
| Testing    | Vitest + Supertest                                                 |

---

## Directory Structure

```
apps/http-server/
├── src/
│   ├── app.ts                # Express app, middleware, and route mounting
│   ├── index.ts              # DB initialization, cleanup interval, listen/shutdown
│   ├── middlewares/
│   │   ├── authMiddleware.ts  # JWT session verification
│   │   └── csrfMiddleware.ts  # CSRF token generation/validation
│   ├── lib/rateLimiter.ts    # Upstash or bounded process-local limiter
│   ├── routes/
│   │   ├── auth.ts           # Auth routes and internal ticket validator
│   │   ├── files.ts          # CRUD /api/files
│   │   ├── folders.ts        # CRUD /api/folders
│   │   ├── share.ts          # POST/GET /api/share and scoped WS tickets
│   │   └── roomRoutes.ts     # Public room capability route + protected CRUD
│   ├── services/
│   │   ├── authService.ts    # Auth business logic
│   │   ├── fileService.ts    # File business logic and persistence fencing
│   │   ├── folderService.ts  # Folder hierarchy, cycle guard, cascade delete
│   │   ├── roomService.ts    # Room CRUD, quota, slug retry, share links
│   │   └── shareService.ts   # Share resolution/revocation
│   └── lib/                  # Scene validation, encryption, response, mailer
├── src/__tests__/            # Route, middleware, service, and opt-in DB tests
└── tests/                    # Supertest/service/share tests
├── tsconfig.json
└── package.json
```

---

## Running Locally

```bash
# From monorepo root (recommended — starts all services)
pnpm dev

# From this directory only
cd apps/http-server
pnpm dev     # Uses: dotenv -e ../../.env -- tsx watch src/index.ts
```

The dev command hot-reloads via `tsx watch`. It loads env from the **root** `.env` (two levels up).

---

## Key Scripts

```bash
pnpm dev      # Dev server with hot-reload (tsx watch)
pnpm build    # Compile TypeScript → dist/ (tsc -b --force)
pnpm start    # Serve compiled output: node dist/index.js
pnpm test     # Vitest test suite
```

---

## API Endpoints

### Auth (`/api/auth`)

| Method | Path                     | Description                       |
| ------ | ------------------------ | --------------------------------- |
| `POST` | `/api/auth/register`     | Create account (email + password) |
| `POST` | `/api/auth/login`        | Login → set session cookie        |
| `POST` | `/api/auth/logout`       | Clear session cookie              |
| `POST` | `/api/auth/google`       | Exchange Google ID token          |
| `POST` | `/api/auth/verify-email` | Verify email via token            |
| `GET`  | `/api/auth/me`           | Get current user (JWT required)   |

### Files (`/api/files`)

| Method   | Path             | Description                  |
| -------- | ---------------- | ---------------------------- |
| `GET`    | `/api/files`     | List user's files            |
| `POST`   | `/api/files`     | Create new canvas file       |
| `GET`    | `/api/files/:id` | Get file metadata            |
| `PATCH`  | `/api/files/:id` | Update file (name, elements) |
| `DELETE` | `/api/files/:id` | Delete file                  |

> **IDOR protection**: every file route verifies ownership through `file.userId === req.userId` (or the equivalent service query) before proceeding.

### Canvas Rooms (`/api/rooms`)

| Method | Path                      | Description                                     |
| ------ | ------------------------- | ----------------------------------------------- |
| `POST` | `/api/rooms`              | Create a collaboration room                     |
| `GET`  | `/api/rooms/:slug`        | Get room metadata + access check                |
| `GET`  | `/api/rooms/share/:token` | Public room capability resolution (before auth) |

### Share (`/api/share`)

| Method | Path                          | Description                          |
| ------ | ----------------------------- | ------------------------------------ |
| `POST` | `/api/share`                  | Create share link token              |
| `GET`  | `/api/share/:token`           | Resolve token → file                 |
| `GET`  | `/api/share/:token/ws-ticket` | Issue a scoped short-lived WS ticket |

### Health

| Method | Path      | Description                                      |
| ------ | --------- | ------------------------------------------------ |
| `GET`  | `/health` | Database-backed health, uptime, and memory check |

---

## Authentication Flow

```
Client POSTs /api/auth/login
  └─► auth route validates credentials (bcryptjs)
        └─► signs a session JWT (jsonwebtoken) with JWT_SECRET
              └─► sets HttpOnly `dripl-session` cookie
                    └─► subsequent requests attach cookie automatically
```

Protected routes use the `auth` middleware which:

1. Reads the JWT from the `dripl-session` cookie or an `Authorization: Bearer` header
2. Verifies the signature with `JWT_SECRET`
3. Attaches the verified `req.userId` for downstream use

---

## Middleware Stack (in order)

```
Helmet (security headers)
  └─► Compression
        └─► Global rate limit
              └─► CORS (exact configured origins + credentials)
                    └─► Cookie parser
                          └─► JSON/urlencoded body parsers (5mb limit)
                                └─► CSRF protection on mounted mutation paths
                                      └─► Auth/route middleware
                                            └─► Routes
                                                  └─► Global error handler
```

---

## Validation Pattern

Most input-bearing route handlers validate request bodies with **Zod** before
DB interaction. A few legacy auth handlers still perform manual checks; do not
assume every endpoint has the same validation depth:

```typescript
// Example pattern
const schema = z.object({ name: z.string().min(1).max(100) });
const parsed = schema.safeParse(req.body);
if (!parsed.success) {
  return res.status(400).json({ error: parsed.error.flatten() });
}
```

---

## Service Layer

Business logic is extracted into service classes in `src/services/`. Route handlers are thin HTTP adapters that:

1. Validate request input (Zod schemas)
2. Delegate to service methods
3. Map service results to HTTP responses

| Service        | Responsibilities                                                                              |
| -------------- | --------------------------------------------------------------------------------------------- |
| `AuthService`  | Registration, login, Google OAuth, email verification, password reset/change, profile updates |
| `FileService`  | File CRUD, folder ownership checks, share creation/revocation, plan limits                    |
| `ShareService` | Share token resolution, expiry checks                                                         |

Services are static classes that import `db` from `@dripl/db` directly. They return typed result objects (discriminated unions) that routes map to HTTP status codes.

---

## Error Handling

- Route/service handlers use `try/catch`, but the current code generally maps
  errors directly to JSON responses rather than calling `next(err)`.
- The global error handler is mounted in `src/app.ts`; it is not defined in
  `src/index.ts`.
- Structured JSON logging is used in server paths, but a few utility/legacy
  console calls remain.
- Avoid empty catch blocks; preserve or log the error context.

---

## Environment Variables

Loaded from the **root** `.env` via `dotenv -e ../../.env`.

| Variable                                              | Required               | Purpose                                             |
| ----------------------------------------------------- | ---------------------- | --------------------------------------------------- |
| `DATABASE_URL`                                        | ✅                     | PostgreSQL connection string                        |
| `JWT_SECRET`                                          | ✅                     | Token signing key (min 32 chars)                    |
| `HTTP_PORT`                                           | ✅                     | Server port (default `3002`)                        |
| `FRONTEND_URL`                                        | ✅                     | CORS allowed origin                                 |
| `GOOGLE_CLIENT_ID`                                    | ✅                     | Google OAuth client ID                              |
| `INTERNAL_SECRET`                                     | Required in production | Server-to-server ticket validation secret           |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | Optional               | Distributed limiter; bounded process-local fallback |
| `SMTP_USER`                                           | Optional               | Email sender address                                |
| `SMTP_PASS`                                           | Optional               | Email sender password                               |

> `JWT_SECRET` **throws at startup** if missing — this is intentional.

---

## Testing

```bash
pnpm test          # All tests (Vitest)
```

Tests use a mixture of route/service unit tests and Supertest requests. The
in-process app is created through `createApp()`; database-backed tests are
opt-in via `RUN_DB_INTEGRATION=true` and require a migrated PostgreSQL
instance.

**Pattern for new route tests:**

```typescript
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
const app = createApp();

describe('POST /api/auth/login', () => {
  it('returns 400 for missing body', async () => {
    const res = await request(app).post('/api/auth/login').send({});
    expect(res.status).toBe(400);
  });
});
```

---

## Adding a New Route

1. Create service in `src/services/<name>Service.ts` returning result unions (`{ kind: ... }`)
2. Create route file in `src/routes/<name>.ts`: Zod validation, service call, response mapping
3. Register router in `src/app.ts`: `app.use('/api/<name>', <name>Router)` (the current Express composition root is `app.ts`)
4. Add Zod schema for request body validation (module scope in the route file)
5. Apply `auth` middleware for protected endpoints
6. Write at least one Vitest test (mock `@dripl/db`; see `src/__tests__/services/`)

---

## Common Gotchas

- **ESM only** — `"type": "module"` in `package.json`. Use `import`/`export`, never `require()`. Imports are standard extensionless; servers bundle with esbuild (`scripts/bundle-server.mjs`) so `dist/` is a single `index.js` with no relative specifiers left.
- **`tsx watch`** vs **bundled** — dev uses `tsx` (no emit), prod runs the esbuild bundle in `dist/`. If you see module resolution errors in prod but not dev, rebuild: `pnpm --filter http-server build`.
- **CSRF** — mutation endpoints require the CSRF token header. Integration tests must obtain and send it.
- **Rate limiter** — Upstash-backed when configured, with a bounded in-memory fallback. Don't rely on specific fallback state between requests in tests.
- **Prisma** — all DB access goes through `@dripl/db`, not a local Prisma instance. Never add a second `prisma` dependency here.
