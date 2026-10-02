# Security Solutions — Dripl

> **Historical remediation record (2026-04-28).** The seven entries below
> document earlier fixes. The current source has additional hardening and
> different limits (notably a 200 KB WS message bound). Use
> [`Problems.md`](../../Problems.md) and [`docs/codebase-audit.md`](../codebase-audit.md)
> for current status; this file is not a production security sign-off.
> Date: 2026-04-28 | Historical status: seven listed remediations recorded as resolved

---

## Table of Contents

1. [Race Condition: http-server starts before DB init](#1-race-condition-http-server-starts-before-db-init)
2. [Race Condition: ws-server overlapping saves](#2-race-condition-ws-server-overlapping-saves)
3. [CSRF on /api/auth/logout](#3-csrf-on-apiauthlogout)
4. [Zod validation on unprotected routes](#4-zod-validation-on-unprotected-routes)
5. [pg.Pool connection limit](#5-pgpool-connection-limit)
6. [AI response validation](#6-ai-response-validation)
7. [Duplicate .env files with credentials](#7-duplicate-env-files-with-credentials)

---

## 1. Race Condition: http-server starts before DB init

### Problem Statement

The HTTP server could begin accepting requests before the database connection was established. This caused `PrismaClient not initialized` errors when the first requests arrived, resulting in 500 responses and potential data loss during startup.

### Root Cause

The original code structure had `initializeDb()` and `app.listen()` running as independent statements in the module scope. Since `initializeDb()` is async, it returned a Promise but did not `await` it — the server started immediately.

```typescript
// BEFORE — broken
initializeDb(); // not awaited
app.listen(port); // starts immediately
```

If a client sent a request during the window between `app.listen()` and the Prisma client connecting to PostgreSQL, every handler that touched `db` would throw.

### Solution

Wrapped both calls in an `async start()` function that `await`s `initializeDb()` before calling `app.listen()`. If the DB connection fails, the process exits with a descriptive log rather than starting a half-functional server.

```typescript
// AFTER — apps/http-server/src/index.ts:102-135
async function start() {
  try {
    await initializeDb();
    console.log(JSON.stringify({ level: 'info', event: 'db_connected' }));
  } catch (err: unknown) {
    console.error(
      JSON.stringify({
        level: 'error',
        event: 'db_connection_failed',
        error: err instanceof Error ? err.message : String(err),
      })
    );
    process.exit(1); // Fail fast — no half-baked server
  }

  // ... periodic cleanup setup ...

  app.listen(port, () => {
    console.log(JSON.stringify({ level: 'info', event: 'http_server_started', port }));
  });
}

start();
```

### Impact

- **Startup ordering** is fixed: the server awaits database initialization before listening.
- **Fail-fast** behavior on DB failure remains the intended runtime behavior; no live failure/restart test is claimed here.
- This entry does not establish zero production errors or a complete deployment guarantee.

---

## 2. Race Condition: ws-server overlapping saves

### Problem Statement

The WebSocket server persisted room state to the database on a `setInterval`. Each tick ran an `async` callback that iterated over all rooms sequentially with `for...of` and `await`. If a save for room A took longer than the interval, the next tick would start saving room A again while the previous save was still in flight — causing overlapping writes and potential data corruption.

### Root Cause

```typescript
// BEFORE — overlapping writes possible
setInterval(async () => {
  for (const [roomId, state] of rooms) {
    await db.canvasRoom.update({ ... }); // sequential, but interval doesn't wait
  }
}, SAVE_INTERVAL);
```

Node.js `setInterval` does not wait for the callback's returned Promise. A slow DB write doesn't block the next tick.

### Solution

Added a per-room `saving` boolean flag. When a save starts, the flag is set `true`; when it completes, `false`. The next tick skips rooms where `saving === true`. Replaced the sequential `for...of` with `Promise.allSettled` for parallel writes.

```typescript
// AFTER — apps/ws-server/src/index.ts
const savingRooms = new Set<string>();

setInterval(async () => {
  const saves: Promise<void>[] = [];

  for (const [roomId, state] of rooms) {
    if (savingRooms.has(roomId)) continue; // skip if already saving
    savingRooms.add(roomId);

    saves.push(
      db.canvasRoom
        .update({
          where: { slug: roomId },
          data: { content: JSON.stringify(state.elements) },
        })
        .then(() => { savingRooms.delete(roomId); })
        .catch((err) => {
          console.error(...);
          savingRooms.delete(roomId);
        })
    );
  }

  await Promise.allSettled(saves);
}, SAVE_INTERVAL);
```

### Impact

- **Overlapping debounced writes** are guarded by the current `saving`/mutation-generation logic.
- **Parallel periodic saves** use `Promise.allSettled` for active rooms.
- **Persistence fencing** can reject stale database writes; integration behavior is not claimed as live-verified here.
- A failed save is logged and retried on a later schedule; “no data loss” would be too strong without a database-backed failure test.

---

## 3. CSRF on /api/auth/logout

### Problem Statement

The `POST /api/auth/logout` endpoint was missing CSRF protection. An attacker could craft a cross-site form submission that logs out a victim user without their consent, disrupting their session.

### Root Cause

The CSRF middleware was applied to login, register, and other mutation endpoints, but logout was omitted from the middleware chain.

```typescript
// BEFORE — missing logout from CSRF list
app.use('/api/auth/login', validateCsrfToken);
app.use('/api/auth/register', validateCsrfToken);
// logout not listed
```

### Solution

Added `validateCsrfToken` middleware to the logout endpoint in the HTTP server's middleware chain.

```typescript
// AFTER — apps/http-server/src/index.ts:73-78
app.use('/api/auth/login', validateCsrfToken);
app.use('/api/auth/forgot-password', validateCsrfToken);
app.use('/api/auth/register', validateCsrfToken);
app.use('/api/auth/reset-password', validateCsrfToken);
app.use('/api/auth/change-password', validateCsrfToken);
app.use('/api/auth/logout', validateCsrfToken); // ← added
```

### Impact

- **CSRF protection** on logout — cross-origin form submissions are rejected.
- **Consistency** — the explicitly mounted auth mutation paths (including logout)
  enforce CSRF validation. This is not a claim that every auth route, such as
  Google-token exchange or verification handlers, uses the same middleware.
- **Client compatibility** is path-specific; integration evidence should be
  checked for each auth flow.

---

## 4. Zod validation on unprotected routes

### Problem Statement

`createRoom`, `addMember`, and `shareRoom` endpoints used manual validation (or no validation at all). Attackers could send malformed payloads that crash handlers, cause unexpected DB behavior, or store arbitrary data.

### Root Cause

These handlers relied on ad-hoc property checks (`if (!req.body.name)`) rather than schema validation. No structural validation existed — extra properties, wrong types, and missing fields all passed through.

### Solution

Added Zod schemas with `safeParse` to each handler. Invalid payloads now return `400` with structured error details.

**createRoom** (`apps/http-server/src/controllers/roomController.ts:56-65`):

```typescript
const createRoomSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  isPublic: z.boolean().optional(),
});

const parsed = createRoomSchema.safeParse(req.body);
if (!parsed.success) {
  res.status(400).json({ error: 'Invalid payload', details: parsed.error.flatten() });
  return;
}
```

**addMember** (`apps/http-server/src/controllers/roomController.ts:252-261`):

```typescript
const addMemberSchema = z.object({
  userId: z.string().min(1).max(100),
  role: z.enum(['EDITOR', 'VIEWER']).default('EDITOR'),
});

const parsed = addMemberSchema.safeParse(req.body);
if (!parsed.success) {
  res.status(400).json({ error: 'Invalid payload', details: parsed.error.flatten() });
  return;
}
```

**shareRoom** (`apps/http-server/src/controllers/roomController.ts:356-365`):

```typescript
const shareRoomSchema = z.object({
  permission: z.enum(['view', 'edit']).default('view'),
  expiresIn: z.number().min(1).max(720).default(24),
});

const parsed = shareRoomSchema.safeParse(req.body);
if (!parsed.success) {
  res.status(400).json({ error: 'Invalid payload', details: parsed.error.flatten() });
  return;
}
```

### Impact

- **Type-safe** request bodies — wrong types rejected before hitting Prisma.
- **Length bounds** — prevents abuse via oversized `name` or `userId` strings.
- **Enum constraints** — `role` and `permission` can only be valid values.
- **Structured errors** — clients receive actionable validation feedback.

---

## 5. pg.Pool connection limit

### Problem Statement

The PostgreSQL connection pool used the default `pg.Pool` limit of 10 connections. With three services (http-server, ws-server, dripl-app) sharing the same database, 10 connections were easily exhausted under moderate load, causing connection timeouts and request failures.

### Root Cause

The `Pool` constructor in `packages/db/src/index.ts` did not set a `max` option, defaulting to `pg`'s built-in default of 10.

```typescript
// BEFORE — default pool size
const pool = new Pool(poolConfig); // max defaults to 10
```

### Solution

Added a configurable `DB_POOL_SIZE` environment variable with a default of 20. The pool config now explicitly sets `max`.

```typescript
// Current packages/db/src/index.ts
const poolConfig = {
  host: url.hostname,
  port: parseInt(url.port) || 5432,
  user: url.username,
  password: url.password,
  database: url.pathname.replace('/', ''),
  // TLS verification stays enabled by default; insecure remote TLS is an
  // explicit development-only opt-in.
  ssl: shouldDisableSsl
    ? false
    : allowInsecureRemoteTls
      ? { rejectUnauthorized: false }
      : undefined,
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 30000,
  max: Math.max(1, parseInt(process.env.DB_POOL_SIZE || '20', 10) || 20),
};

const pool = new Pool(poolConfig);
```

### Impact

- The configured default is now 20, with a bounded `DB_POOL_SIZE` override.
- TLS verification is not disabled by default for remote databases; the
  development-only escape hatch is explicit.
- No database load or connection-exhaustion benchmark is claimed by this
  historical note.

---

## 6. AI response validation

> The snippets below are historical. The current route adds authenticated
> identity enforcement, origin/body/response bounds, normalized points/colors,
> retry classification, and cancellation; no real Gemini request is claimed in
> this note.

The `/api/ai/generate` endpoint received JSON from Google Gemini and cast it directly with `any` types. No schema validation was performed — arbitrary data from the AI could flow into the API response, causing type errors, crashes, or injection of unexpected fields.

### Root Cause

The route handler parsed Gemini's text response as JSON and processed it through `any`-typed maps without structural validation.

```typescript
// BEFORE — no validation, any types
const processedElements = elements.map((el: any, index) => {
  return { ... }; // no validation
});
```

Additionally, element IDs from the AI were not guaranteed to be valid UUIDs, and there was no limit on how many elements the AI could return.

### Solution

Added four layers of protection in `apps/dripl-app/app/api/ai/generate/route.ts`:

**1. UUID generation for untrusted IDs** (line 174-176):

```typescript
id: typeof el.id === 'string' && el.id.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
  ? el.id
  : crypto.randomUUID(),
```

**2. DriplElementSchema validation via safeParse** (line 197-200):

```typescript
.filter(el => {
  const result = DriplElementSchema.safeParse(el);
  return result.success;
})
```

**3. Element count limit** (line 201):

```typescript
.slice(0, 100); // Cap at 100 elements
```

**4. Error type narrowing** (line 128, 207):

```typescript
} catch (err: unknown) {
  lastError = err instanceof Error ? err : new Error(String(err));
```

### Impact

- **Malformed AI output** rejected — only valid `DriplElement` objects pass through.
- **Deterministic IDs** — AI-provided IDs that aren't valid UUIDs are replaced with `crypto.randomUUID()`.
- **Resource exhaustion prevented** — max 100 elements per generation request.
- **Type safety** — eliminated `any` casts, errors handled with `unknown` narrowing.

---

## 7. Duplicate .env files with credentials

### Problem Statement

Four `.env` files existed in the repository: root `.env`, `apps/dripl-app/.env`, `apps/http-server/.env`, and `apps/ws-server/.env`. These contained real database URLs, API keys, and JWT secrets. They could leak into version control, conflict with each other, and create confusion about which file is the source of truth.

### Root Cause

Each app originally loaded its own `.env` via `dotenv`. Over time, developers copied the root `.env` into each app directory for convenience, creating duplicates with identical or slightly different values.

```bash
# Files that existed
.env
apps/dripl-app/.env      # duplicate
apps/http-server/.env     # duplicate
apps/ws-server/.env       # duplicate
```

### Solution

**1. Deleted all duplicate `.env` files:**

```bash
rm apps/dripl-app/.env apps/http-server/.env apps/ws-server/.env
```

**2. Verified `.gitignore` coverage:**

The root `.gitignore` already includes `.env` patterns. Confirmed no duplicates are tracked:

```gitignore
.env
.env.local
.env.*.local
```

**3. Enforced single-source-of-truth pattern:**

All apps load from the root `.env` via `dotenv` path resolution:

```typescript
// apps/http-server/src/index.ts:5-6
config({ path: resolve(process.cwd(), '../../.env') });
config({ path: resolve(process.cwd(), '../../.env.local'), override: true });
```

**4. Documented the pattern in CLAUDE.md** to prevent regression:

> Environment variables are loaded from the **root** `.env`. Never create per-app `.env` files.

### Impact

- **No credential duplication** — single `.env` at root is the only source of truth.
- **No silent conflicts** — apps can't accidentally load different config values.
- **Reduced leak surface** — fewer files containing secrets in the repository.
- **Developer clarity** — one place to update environment variables.

---

## Summary

| #   | Issue                       | Severity | Risk Reduction                                      |
| --- | --------------------------- | -------- | --------------------------------------------------- |
| 1   | http-server DB init race    | HIGH     | Eliminated startup crashes from uninitialized DB    |
| 2   | ws-server overlapping saves | HIGH     | Prevented data corruption from concurrent writes    |
| 3   | CSRF on logout              | HIGH     | Blocked cross-site session termination attacks      |
| 4   | Missing Zod validation      | MEDIUM   | Type-safe inputs, rejected malformed payloads       |
| 5   | Pool connection limit       | MEDIUM   | Doubled capacity, configurable under load           |
| 6   | AI response validation      | HIGH     | Blocked injection of unvalidated external data      |
| 7   | Duplicate .env files        | CONFIG   | Single source of truth, reduced credential exposure |

**Historical scope:** the seven listed remediations were recorded as resolved
in this April solution note. Current code has additional controls and the
remaining integration/runtime caveats in `docs/codebase-audit.md`; this summary
is not a fresh security sign-off.
