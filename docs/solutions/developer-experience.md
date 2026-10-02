# Developer Experience Solutions

> **Historical DX/remediation record.** Counts and “passing” claims below were
> recorded at the time of the original change. The current tree has both newer
> tests and remaining evidence gaps; use [`docs/codebase-audit.md`](../codebase-audit.md)
> rather than treating this file as a current test report.

---

## 1. Integration Test Failures (12 → 0)

### Problem Statement

Twelve WebSocket server integration tests in `apps/ws-server/src/__tests__/integration.test.ts` were consistently failing. Tests for room joins, element operations, cursor movement, and connection lifecycle all timed out or received unexpected messages.

### Root Cause

Three compounding issues in the test mock server:

Historical root cause: the older test mock expected both `sync_room_state` and
legacy `room-state`. The current server sends `sync_room_state`; the client
retains compatibility handling for the legacy name.

2. **Listener leaks in `waitForMessage`/`waitForMessages`** — The helper functions attached `message` listeners but didn't always clean them up. If a timeout fired, the handler stayed registered. Subsequent tests received stale messages from earlier listeners, causing assertion failures on wrong message types.

3. **Race conditions with `user-join` broadcasts** — When a second user joined a room, the first user received a `user-join` broadcast. Tests that didn't account for this extra message would see it as an unexpected message, breaking `waitForMessages(ws, 2)` calls.

### Solution

Three changes to `integration.test.ts`:

1. **Historical mock alignment:** the old join mock was updated for the
   then-current two-message behavior. The current server’s canonical join
   response is `sync_room_state`; do not use the old line references as a
   protocol contract.

2. **Added `drainMessages` helper** — A new utility (lines 323-340) that silently consumes N messages with a short timeout. Tests call `await drainMessages(ws1, 1)` after joins to consume the `user-join` broadcast before asserting on the next meaningful message.

3. **Improved `waitForMessage`/`waitForMessages` cleanup** — Both functions now always call `ws.removeListener('message', handler)` in both the success and timeout paths, preventing listener accumulation across tests.

### Historical impact

- The original note recorded 12/12 integration tests passing. The current tree
  has a default protocol-model suite plus an opt-in `RUN_WS_INTEGRATION=true`
  two-client process test; that process test mocks ticket validation and
  persistence seams. This document does not claim a fresh runtime pass.

---

## 2. Stricter TypeScript Checks

### Problem Statement

Six strict TypeScript compiler options were commented out in `tooling/typescript-config/tsconfig.json`:

```json
// "noImplicitReturns": true,
// "noFallthroughCasesInSwitch": true,
// "noUnusedLocals": true,
// "noUnusedParameters": true,
```

This meant the compiler silently accepted code with unused variables, missing return paths, and fallthrough switch cases — bugs that would be caught at compile time with these enabled.

### Root Cause

The checks were likely disabled early in development to avoid fixing errors while iterating quickly. They were never re-enabled because doing so surfaced 20+ violations across the codebase that needed fixing.

### Solution

**Step 1 (historical):** Four checks were enabled in the shared TypeScript
configuration; the current config also has `noUncheckedIndexedAccess` and
`exactOptionalPropertyTypes`. The original “six checks/four enabled” wording
should not be read as a complete inventory of today's compiler options.

```json
"noImplicitReturns": true,
"noFallthroughCasesInSwitch": true,
"noUnusedLocals": true,
"noUnusedParameters": true,
```

**Step 2: Fixed 20+ violations across the codebase:**

- Removed dead `cacheKey` function in `packages/element/src/rough-renderer.ts`
- Removed unused `isLinear` variable in canvas path logic
- Removed unused imports (`useEffect`, `useState`, type imports) across multiple files
- Removed unused function parameters (prefixed with `_` where needed for callback signatures)
- Added explicit return statements in functions with partial code paths

### Impact

- **Compile-time bug detection** — unused variables and missing returns now cause build failures instead of silent runtime issues
- **Cleaner codebase** — dead code removed, reducing cognitive load for developers
- **Consistent strictness** — all packages now share the same strict baseline

---

## 3. Code Coverage Reporting

### Problem Statement

No test coverage metrics existed. Developers had no visibility into which code paths were tested, making it impossible to identify coverage gaps or prevent regressions.

### Root Cause

Neither `dripl-app` nor `ws-server` had coverage configuration in their `vitest.config.ts` files. The root `package.json` had no coverage script.

### Solution

**Step 1: Added v8 coverage to `apps/dripl-app/vitest.config.ts`** (lines 9-14):

```typescript
coverage: {
  provider: 'v8',
  reporter: ['text', 'lcov'],
  include: ['**/*.{ts,tsx}'],
  exclude: ['src/__tests__/**', 'node_modules/**', 'dist/**', '.next/**'],
},
```

**Step 2: Added v8 coverage to `apps/ws-server/vitest.config.ts`** (lines 8-13):

```typescript
coverage: {
  provider: 'v8',
  reporter: ['text', 'lcov'],
  include: ['src/**/*.ts'],
  exclude: ['src/__tests__/**', 'node_modules/**'],
},
```

**Step 3: Added root `test:coverage` script** to `package.json` for running coverage across all packages.

### Impact

- Coverage configuration exists in the frontend and WS packages; coverage output
  still does not establish browser, production, or full-route coverage.
- A root `test:coverage` script exists, but this note does not claim a current
  coverage run or threshold.

---

## 4. HTTP Caching

### Problem Statement

No caching headers were set on any HTTP endpoint. Every `GET /api/files` request hit the database and returned the full response, even when the data hadn't changed. This wasted bandwidth and database resources.

### Root Cause

The `filesRouter` in `apps/http-server/src/routes/files.ts` had no caching logic — it queried the database, serialized the result, and sent it with default Express headers (no `Cache-Control`, no `ETag`).

### Solution

Added ETag-based caching to the file listing endpoint in `apps/http-server/src/routes/files.ts` (lines 150-161):

```typescript
// Generate ETag from response content
const responseHash = createHash('md5')
  .update(JSON.stringify({ files, total: isCursorBased ? undefined : total }))
  .digest('hex');
const etag = `"${responseHash}"`;

// Return 304 if client already has this version
if (req.headers['if-none-match'] === etag) {
  res.status(304).end();
  return;
}

// Set caching headers
res.set('Cache-Control', 'private, max-age=0, must-revalidate');
res.set('ETag', etag);
```

### Impact

- **Reduced response bandwidth** — a matching ETag returns 304 without a body.
- **Important limitation:** the ETag is computed after `FileService.listFiles`
  queries the database, so this implementation does not short-circuit the DB
  query itself.

---

## 5. Metrics Endpoints

### Problem Statement

No production visibility into server health. When issues occurred, there was no way to check active connections, room counts, or memory usage without adding ad-hoc logging.

### Root Cause

Both servers only had `/health` endpoints returning `{ status: "ok" }`. No operational metrics were exposed.

### Solution

**ws-server** — Added `/metrics` endpoint at `apps/ws-server/src/index.ts:77-91`:

```typescript
} else if (req.url === '/metrics') {
  let totalUsers = 0;
  for (const room of rooms.values()) {
    totalUsers += room.users.size;
  }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    uptime: process.uptime(),
    activeRooms: rooms.size,
    activeConnections: wss.clients.size,
    totalUsers,
    memoryUsageMB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
  }));
}
```

**http-server** — Added `/metrics` endpoint at `apps/http-server/src/index.ts:61-66`:

```typescript
app.get('/metrics', (_req, res) => {
  res.json({
    uptime: process.uptime(),
    memoryUsageMB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
  });
});
```

### Impact

- JSON metrics endpoints expose basic process/room/connection counters.
- They are not a Prometheus exposition format and do not by themselves make an
  alerting pipeline; deployment and scrape configuration remain unverified.

---

## 6. Documentation Overhaul

### Problem Statement

Documentation was outdated, inconsistent, or missing entirely:

- `TODOS.md` referenced a planned roadmap but wasn't organized by priority
- `AGENTS.md` was referenced by `CLAUDE.md` but didn't exist
- `CLAUDE.md` files contained incorrect directory structures (e.g., ws-server documented `rooms.ts`, `handlers.ts` files that didn't exist)
- `CONTRIBUTING.md` lacked specific setup instructions and coding standards
- Root `CLAUDE.md` said "use bun" but the project uses pnpm

### Root Cause

Documentation was written incrementally as the project evolved. Files weren't updated when architecture changed (e.g., ws-server remained a monolith but docs described a modular structure). No single owner was responsible for doc accuracy.

### Solution

Historical documentation changes were made, but the current repository still
contains archived guides and historical status tables. Treat this section as a
record of that earlier effort, not proof that every document is current.

**AGENTS.md** — Created from scratch with:

- Issue tracker configuration (GitHub Issues, triage labels, workflow)
- Domain terminology glossary (Canvas, Element, Room, Scene, etc.)
- Key architectural decisions (ADR-001 through ADR-006)
- File map for quick navigation
- Agent workflow checklist

**CLAUDE.md files (historical):** the original overhaul corrected several
inaccuracies, but current app guides still contain archived line counts,
package-layout references, and auth/protocol details. Use the current root
`CLAUDE.md` and `AGENTS.md` plus the source manifests instead.

**CONTRIBUTING.md** — Expanded with:

- Prerequisites section (Node 20+, pnpm 10+, PostgreSQL)
- Step-by-step setup instructions (clone, env, db migrate, dev)
- Coding standards (TypeScript strict, ESM, no barrel files, Prettier, Conventional Commits)
- PR process with validation checklist
- Common tasks (adding packages, routes, canvas elements)

### Impact

- **Historical onboarding impact:** the earlier note described faster onboarding
  and clearer agent context. The current repository still has archived guides,
  so these benefits are not a current completeness claim.
- `AGENTS.md` and the root `CLAUDE.md` provide terminology and source-layout
  guidance, while `docs/codebase-audit.md` is the current evidence/status
  reference.
- `TODOS.md` is historical planning context, not a single current source of
  truth.

---

## Summary

| Solution                 | Historical problem       | Current interpretation                                           |
| ------------------------ | ------------------------ | ---------------------------------------------------------------- |
| Integration test fixes   | 12 failing tests         | Historical count; current process test is opt-in and seam-mocked |
| TypeScript strict checks | Disabled checks          | Shared config now enables several strict options                 |
| Code coverage            | No coverage visibility   | Coverage config exists; no fresh run claimed here                |
| HTTP caching             | No caching headers       | ETag/304 exists; DB query still occurs first                     |
| Metrics endpoints        | No production visibility | JSON metrics exist; monitoring integration is unverified         |
| Documentation overhaul   | Outdated docs            | Historical effort; current reconciliation is still needed        |

These are historical DX entries, not current release evidence.
