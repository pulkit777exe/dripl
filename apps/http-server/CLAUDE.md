# http-server — Express REST API

> Part of the Dripl monorepo. Read the root `CLAUDE.md` first.

---

## What This App Does

`http-server` is the Express 5 REST API backend for Dripl. It handles:

- **Authentication** — register, login, logout, Google OAuth, email verification
- **File management** — CRUD for canvas files and folders
- **Collaboration rooms** — room creation and access control
- **Share links** — create/resolve public share tokens
- **Rate limiting** — per-user request throttling (HTTP layer)
- **Security** — CSRF protection, Helmet headers, JWT validation

Runs on **port 3002** in development.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Express 5 |
| Language | TypeScript 5 (ESM) |
| Runtime | Node.js (tsx for dev, compiled JS for prod) |
| Database | PostgreSQL via `@dripl/db` (Prisma) |
| Auth | JWT (`jsonwebtoken`) + Google OAuth (`google-auth-library`) |
| Email | Nodemailer |
| Validation | Zod v4 |
| Security | Helmet, express-rate-limit, csurf, bcryptjs |
| Testing | Vitest + Supertest |

---

## Directory Structure

```
apps/http-server/
├── src/
│   ├── index.ts              # Entry point — creates Express app, mounts routers
│   ├── middleware/
│   │   ├── auth.ts           # JWT verification middleware
│   │   ├── rateLimiter.ts    # Per-user rate limiting
│   │   └── errorHandler.ts   # Global error handler
│   ├── routes/
│   │   ├── auth.ts           # POST /api/auth/login, /register, /logout, /google
│   │   ├── files.ts          # CRUD /api/files, /api/folders
│   │   ├── canvas.ts         # GET/POST /api/canvas/rooms
│   │   └── share.ts          # POST/GET /api/share
│   ├── controllers/
│   │   ├── authController.ts
│   │   ├── fileController.ts
│   │   └── shareController.ts
│   └── lib/
│       ├── jwt.ts            # Token sign/verify helpers
│       └── mailer.ts         # Nodemailer wrapper
├── tests/                    # Vitest + Supertest integration tests
├── tsconfig.json
└── turbo.json (if present)
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

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/auth/register` | Create account (email + password) |
| `POST` | `/api/auth/login` | Login → set session cookie |
| `POST` | `/api/auth/logout` | Clear session cookie |
| `POST` | `/api/auth/google` | Exchange Google ID token |
| `GET` | `/api/auth/verify` | Verify email via token |
| `GET` | `/api/auth/me` | Get current user (JWT required) |

### Files (`/api/files`)

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/files` | List user's files |
| `POST` | `/api/files` | Create new canvas file |
| `GET` | `/api/files/:id` | Get file metadata |
| `PATCH` | `/api/files/:id` | Update file (name, elements) |
| `DELETE` | `/api/files/:id` | Delete file |

> **IDOR protection**: every file route verifies `file.userId === req.user.id` before proceeding.

### Canvas Rooms (`/api/canvas/rooms`)

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/canvas/rooms` | Create collaboration room for a file |
| `GET` | `/api/canvas/rooms/:roomId` | Get room metadata + access check |

### Share (`/api/share`)

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/share` | Create share link token |
| `GET` | `/api/share/:token` | Resolve token → file |

### Health

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Uptime + version check |

---

## Authentication Flow

```
Client POSTs /api/auth/login
  └─► authController validates credentials (bcryptjs)
        └─► signs JWT (jsonwebtoken) with JWT_SECRET
              └─► sets HttpOnly cookie (+ CSRF token header)
                    └─► subsequent requests attach cookie automatically
```

Protected routes use the `auth` middleware which:
1. Reads the JWT from the cookie
2. Verifies signature with `JWT_SECRET`
3. Attaches `req.user` for downstream use

---

## Middleware Stack (in order)

```
Helmet (security headers)
  └─► CORS (allow FRONTEND_URL origin + credentials)
        └─► Cookie parser
              └─► JSON body parser (10mb limit)
                    └─► CSRF protection (on mutation endpoints)
                          └─► Rate limiter (per user/IP)
                                └─► Routes
                                      └─► Global error handler
```

---

## Validation Pattern

All route handlers validate request bodies with **Zod** before any DB interaction:

```typescript
// Example pattern
const schema = z.object({ name: z.string().min(1).max(100) });
const parsed = schema.safeParse(req.body);
if (!parsed.success) {
  return res.status(400).json({ error: parsed.error.flatten() });
}
```

---

## Error Handling

- All controllers use `try/catch` and pass errors to `next(err)`
- The global error handler in `middleware/errorHandler.ts` formats all errors as JSON
- **No empty catch blocks** — every caught error must be logged or rethrown
- Use structured JSON logging (no plain `console.log`)

---

## Environment Variables

Loaded from the **root** `.env` via `dotenv -e ../../.env`.

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | ✅ | PostgreSQL connection string |
| `JWT_SECRET` | ✅ | Token signing key (min 32 chars) |
| `PORT` | ✅ | Server port (default `3002`) |
| `FRONTEND_URL` | ✅ | CORS allowed origin |
| `GOOGLE_CLIENT_ID` | ✅ | Google OAuth client ID |
| `REDIS_URL` | Optional | Rate-limit store (falls back to memory) |
| `SMTP_USER` | Optional | Email sender address |
| `SMTP_PASS` | Optional | Email sender password |

> `JWT_SECRET` **throws at startup** if missing — this is intentional.

---

## Testing

```bash
pnpm test          # All tests (Vitest)
```

Tests in `tests/` use **Supertest** to make real HTTP requests against an in-process Express app. The test DB is controlled via `DATABASE_URL` in `.env.test`.

**Pattern for new route tests:**

```typescript
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../src/index';

describe('POST /api/auth/login', () => {
  it('returns 400 for missing body', async () => {
    const res = await request(app).post('/api/auth/login').send({});
    expect(res.status).toBe(400);
  });
});
```

---

## Adding a New Route

1. Create controller in `src/controllers/<name>Controller.ts`
2. Create route file in `src/routes/<name>.ts`, mount the controller
3. Register router in `src/index.ts`: `app.use('/api/<name>', <name>Router)`
4. Add Zod schema for request body validation
5. Apply `auth` middleware for protected endpoints
6. Write at least one Vitest test

---

## Common Gotchas

- **ESM only** — `"type": "module"` in `package.json`. Use `import`/`export`, never `require()`. Relative imports in compiled output need `.js` extensions (handled by `tsc` paths).
- **`tsx watch`** vs **compiled** — dev uses `tsx` (no emit), prod uses compiled `dist/`. If you see module resolution errors in prod but not dev, check `dist/` exists and is up-to-date.
- **CSRF** — mutation endpoints require the CSRF token header. Integration tests must obtain and send it.
- **Rate limiter** — Redis-backed in prod, in-memory in dev/test. Don't rely on specific memory state between requests in tests.
- **Prisma** — all DB access goes through `@dripl/db`, not a local Prisma instance. Never add a second `prisma` dependency here.
