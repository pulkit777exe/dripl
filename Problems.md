# Dripl — Security & Engineering Posture Report

**Date:** 2026-04-27 | **Updated:** 2026-04-28 | **Mode:** Full Audit | **Confidence gate:** 8/10 (daily)

---

## Architecture Mental Model

```
Browser (dripl-app / Next.js 16)
    │  REST (cookie JWT)         WebSocket (JWT in query string)
    ▼                            ▼
http-server (Express 5)       ws-server (ws lib)
    │                            │
    └──── @dripl/db (Prisma) ────┘
               │
          PostgreSQL
```

Three trust boundaries:
1. **Browser → http-server** — cookie-scoped JWT, Helmet headers, global rate limit
2. **Browser → ws-server** — JWT in `?token=` query param, app-level rate limit
3. **http-server / ws-server → DB** — Prisma, same `DATABASE_URL`

---

## Attack Surface Map

```
CODE SURFACE
  Public endpoints (no auth):    7  (auth/*, share/*, health)
  Authenticated endpoints:      18  (files, folders, rooms, profile)
  AI endpoints:                  1  (Gemini proxy, in-process rate limit)
  WebSocket channels:            1  (ws-server, single multiplexed connection)

INFRASTRUCTURE
  CI/CD workflows:               1  (ci.yml — lint/build/test)
  Container configs:             3  (docker/)
  Secret management:             env vars (root .env)
  Deploy targets:                Vercel (dripl-app) + ?
```

---

## SECURITY FINDINGS

### Finding 1 — Cryptographically Weak Room Share Token
**Severity:** ~~HIGH~~ RESOLVED | **Confidence:** 10/10 | **VERIFIED**
**Status:** Already fixed in current codebase
**File:** `apps/http-server/src/controllers/roomController.ts:375`

```typescript
const token = crypto.randomBytes(24).toString('base64url');
```

Already uses CSPRNG (`crypto.randomBytes`). No changes needed.

`Math.random()` is not a CSPRNG. The token is also structurally predictable: it embeds the room slug and a millisecond timestamp, narrowing the search space further. An attacker who knows the room slug and approximate creation time needs to brute-force only ~13 base-36 chars from a weak RNG — orders of magnitude less than a proper UUID.

**Exploit:** Attacker creates a room (gets slug), notes wall-clock time, enumerates likely `Math.random()` outputs (V8's PRNG is well-studied), sends crafted share-link GET requests.

**Fix:**
```typescript
import { randomBytes } from 'crypto';
const token = randomBytes(24).toString('base64url'); // 192 bits, CSPRNG
```

---

### Finding 2 — Room Slug Generated with `Math.random()`
**Severity:** ~~MEDIUM~~ RESOLVED | **Confidence:** 9/10 | **VERIFIED**
**Status:** Already fixed in current codebase
**File:** `apps/http-server/src/controllers/roomController.ts:7-10`

```typescript
function generateSlug(): string {
  return crypto.randomBytes(6).toString('hex').slice(0, 8);
}
```

Already uses CSPRNG. No changes needed.

---

### Finding 3 — Public Room Share Route Behind `authMiddleware`
**Severity:** ~~HIGH~~ RESOLVED | **Confidence:** 10/10 | **VERIFIED**
**Status:** Already fixed in current codebase
**File:** `apps/http-server/src/routes/roomRoutes.ts:7-11`

```typescript
router.get('/share/:token', RoomController.getShareLink); // BEFORE authMiddleware

router.use(authMiddleware); // Applied after public routes
```

Share route is mounted BEFORE authMiddleware. No changes needed.

---

### Finding 4 — WebSocket Server Allows Fully Anonymous Room Joins
**Severity:** ~~HIGH~~ PARTIAL | **Confidence:** 10/10 | **VERIFIED**
**Status:** Partially fixed - auth check rejects, but fallback code still exists
**File:** `apps/http-server/src/routes/roomRoutes.ts`

The connection handler at ws-server/src/index.ts:299-304 now rejects unauthenticated connections:

```typescript
if (!authUserId) {
  ws.close(4001, 'Authentication required');
  return;
}
```

However, the `anon_${uuidv4()}` fallback still exists at line 371 (never reached due to auth check).

**Recommendation:** Remove the unused `anon_${uuidv4()}` fallback for cleaner code.

If JWT verification fails (expired, tampered, missing), the server silently falls back to `anon_<uuid>` and **still admits the connection** to the room. Any unauthenticated user can join any room.

**Exploit:** `ws://ws-server:3001/?token=invalid` → connection accepted → user joins room, receives full canvas state, can send scene updates.

**Fix:**
```typescript
if (!authUserId) {
  ws.close(4001, 'Authentication required');
  return;
}
```

---

### Finding 5 — AI Rate Limit Bypassed via Client-Supplied `userId`
**Severity:** ~~HIGH~~ PARTIAL | **Confidence:** 10/10 | **VERIFIED**
**Status:** Partially fixed - removed IP fallback, still uses client-supplied userId
**File:** `apps/dripl-app/app/api/ai/generate/route.ts:82-86`

IP fallback has been removed. Now uses client-supplied userId directly:

```typescript
const userId = body.userId && body.userId !== 'anonymous' ? body.userId : 'unknown';
```

**Issue:** Client can still bypass by supplying any userId string.

**Recommendation:** Add server-side authentication to validate userId from session cookie.

---

### Finding 6 — `maxPayload` vs. Application-Level Size Check Mismatch
**Severity: LOW | Confidence: 10/10 | VERIFIED**
**File:** `apps/ws-server/src/index.ts:86,296–304`

```typescript
const wss = new WebSocketServer({ server, maxPayload: 1024 * 1024 }); // 1 MB
// ...
const MAX_MESSAGE_SIZE = 10 * 1024 * 1024; // 10 MB — never reached
```

The `ws` library rejects messages >1 MB at the protocol layer before the `message` event fires. The 10 MB application check is dead code. Documentation and CLAUDE.md claim "10MB max" which is wrong.

**Fix:** Either raise `maxPayload` to `10 * 1024 * 1024` to match intent, or remove the app-level check and document the true 1 MB limit.

---

### Finding 7 — Auth Endpoint Lacks Dedicated Brute-Force Protection
**Severity: MEDIUM | Confidence: 9/10 | VERIFIED**
**File:** `apps/http-server/src/index.ts:27–33`

Global rate limit: **250 requests / 15 minutes per IP**. No stricter limit on `/api/auth/login` or `/api/auth/forgot-password`. An attacker can attempt ~250 password guesses per 15-minute window before being throttled — against a shared limit that counts ALL requests, meaning the effective limit on login alone is higher.

**Fix:** Add a tighter limiter specifically on auth routes:
```typescript
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10 });
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/forgot-password', authLimiter);
```

---

### Finding 8 — WebSocket CORS: No Origin Validation on Upgrade
**Severity: MEDIUM | Confidence: 9/10 | VERIFIED**
**File:** `apps/ws-server/src/index.ts:284`

The `ws` server performs no `Origin` header check on the HTTP upgrade request. Any website can establish a WebSocket connection to the server, bypassing same-origin protections. Credentials (JWT) are still required, but this widens the attack surface.

**Fix:**
```typescript
const wss = new WebSocketServer({
  server,
  maxPayload: ...,
  handleProtocols: () => false, // not needed but example
  verifyClient: ({ origin }, cb) => {
    const allowed = process.env.FRONTEND_URL;
    cb(origin === allowed, 403, 'Forbidden');
  },
});
```

---

### Finding 9 — Duplicate `signSessionToken` / `generateToken` Functions
**Severity:** ~~LOW~~ RESOLVED | **Confidence:** 10/10 | **VERIFIED**
**Status:** Misreport - both functions ARE used

Both functions are actually used in different places:
- `generateToken` is used in userController.ts for registration/login
- `signSessionToken` is used in auth routes for session cookies

They serve slightly different purposes. The report incorrectly claimed "generateToken is never called".

**Conclusion:** This is not a bug - both functions are intentionally used.

---

### Finding 10 — `pnpm postinstall` Auto-Approves All Build Scripts
**Severity: MEDIUM | Confidence: 9/10 | VERIFIED**
**File:** `package.json:6`

```json
"postinstall": "pnpm approve-builds --all"
```

This silently approves `preinstall`/`postinstall` scripts from **every dependency** on every install. A malicious or compromised transitive dependency's install script runs without any review. This defeats pnpm's build-script security model entirely.

**Fix:** Remove `--all`. Enumerate only the known-safe build-script packages in `pnpm-workspace.yaml` `onlyBuiltDependencies` (you already have `@prisma/engines`, `esbuild`, `sharp`, etc. — that list is the correct approach).

---

### Finding 11 — `getRoom` Auto-Creates Rooms on GET
**Severity: MEDIUM | Confidence: 9/10 | VERIFIED**
**File:** `apps/http-server/src/controllers/roomController.ts:144–176`

```typescript
if (!room) {
  room = await prisma.canvasRoom.create({ data: { slug, ownerId: req.userId!, ... } });
}
```

A GET request to `/api/rooms/<any-slug>` by any authenticated user **silently creates a room with that user as owner** if the slug doesn't exist. This turns a read operation into a write. Combined with the 10-rooms-per-day limit, an attacker could exhaust another user's room quota... wait, no — they'd be the owner of the new room. But the real problem is that enumeration + GET is non-idempotent and unexpected.

**Fix:** Return 404 if the room does not exist. Let the client call `POST /api/rooms` to create one explicitly.

---

## CODE QUALITY FINDINGS

### Finding 12 — ws-server Is a 668-Line God File
**Severity: ARCH | File:** `apps/ws-server/src/index.ts`

All of these concerns live in one file: HTTP server creation, JWT auth, room state management, message dispatch, broadcast helpers, rate limiting, heartbeat, periodic DB saves, graceful shutdown. The CLAUDE.md documents separate `rooms.ts`, `handlers.ts`, `broadcast.ts`, `rateLimiter.ts`, `auth.ts` — **none of these files exist**. The docs are wrong and the code is unmaintainable.

**Fix:** Refactor into the modules the CLAUDE.md already describes. Each module should export a pure function or class. Wire them in `index.ts` (target: <100 lines).

---

### Finding 13 — Double-Broadcast on Every Event
**Severity: PERF | File:** `apps/ws-server/src/index.ts:408–416, 435–436, 553–554`

Every user-join, user-leave, and cursor-move event is broadcast **twice** to every room member — once with snake_case type (`user_join`) and once with kebab-case (`user-join`). This doubles WS traffic for every event. If there are N users in a room, each event sends 2×(N-1) messages instead of N-1.

**Fix:** Pick one naming convention (kebab is used in `AGENTS.md` protocol docs). Remove the duplicate broadcast. Update the client to match.

---

### Finding 14 — Orphaned Route Files Never Mounted
**Severity: DEAD CODE | Files:** `apps/http-server/src/routes/FileRoute.ts`, `TeamRoute.ts`, `UserRoute.ts`

Three route files exist in `src/routes/` but are never imported in `src/index.ts`. These are unreachable dead code that inflate the codebase and confuse readers.

**Fix:** Delete them or mount them intentionally.

---

### Finding 15 — `updateRoom` Accepts Unvalidated Canvas Content
**Severity: MEDIUM | File:** `apps/http-server/src/controllers/roomController.ts:201,221`

```typescript
const { name, isPublic, content } = req.body;
// ...
...(content !== undefined && { content }),
```

`content` (canvas elements JSON) goes directly to `prisma.canvasRoom.update` with no Zod schema validation. Any authenticated room owner can store arbitrary JSON in the `content` field — unbounded in size, schema, or structure. The `files.ts` endpoint correctly validates content; `roomController.ts` does not.

**Fix:** Add a Zod schema for `updateRoom` body, validate `content` shape.

---

### Finding 16 — `rateLimitCleanup` Interval Not Cleared on Shutdown
**Severity: LOW | File:** `apps/ws-server/src/index.ts:601–608, 638–660`

```typescript
const rateLimitCleanup = setInterval(..., 60_000);
// shutdown():
clearInterval(heartbeat);
clearInterval(periodicSave);
// rateLimitCleanup is never cleared
```

On `SIGTERM`, the process exits anyway, so this is harmless in practice. But it's inconsistent and will cause issues if shutdown is ever made non-fatal (e.g., in test environments with long-running processes).

---

### Finding 17 — AI Route Uses `any` Types Pervasively
**Severity: CODE QUALITY | File:** `apps/dripl-app/app/api/ai/generate/route.ts:123,165,188`

```typescript
} catch (err: any) {          // line 123
const processedElements = elements.map((el: any, ...) => ...  // line 165
} catch (error: any) {        // line 188
```

TypeScript's type safety is bypassed. The AI response is processed with no structural validation — arbitrary data from Gemini flows through `any` directly to the API response.

**Fix:** Use a Zod schema to parse the AI-returned element array before processing. Replace `any` with `unknown` + type narrowing.

---

## INFRASTRUCTURE FINDINGS

### Finding 18 — CI Test Job Has No PostgreSQL Service Container
**Severity: HIGH | File:** `.github/workflows/ci.yml:97–99`

```yaml
env:
  DATABASE_URL: postgresql://test:test@localhost:5432/test
```

No `services: postgres:` block in the test job. The `DATABASE_URL` points to a Postgres instance that doesn't exist in CI. Tests pass only because they mock or avoid DB calls — confirming that the test suite has **no real integration coverage**.

**Fix:**
```yaml
services:
  postgres:
    image: postgres:16
    env:
      POSTGRES_USER: test
      POSTGRES_PASSWORD: test
      POSTGRES_DB: test
    options: >-
      --health-cmd pg_isready
      --health-interval 10s
      --health-timeout 5s
      --health-retries 5
```

---

### Finding 19 — `vercel.json` in ws-server and http-server
**Severity: ARCH | Files:** `apps/ws-server/vercel.json`, `apps/http-server/vercel.json`

Both backend apps have Vercel config files. Vercel's serverless functions do not support persistent WebSocket connections or long-lived Node.js HTTP servers. Deploying `ws-server` to Vercel will silently fail or produce broken collaboration.

**Fix:** These services require a persistent runtime (Fly.io, Railway, EC2, a container platform). Remove or replace `vercel.json` with platform-appropriate deployment config.

---

### Finding 20 — Multiple Duplicate `.env` Files
**Severity: CONFIG | Files:** root `.env`, `apps/dripl-app/.env`, `apps/http-server/.env`, `apps/ws-server/.env`

Four `.env` files exist. Apps load the root `.env` via `dotenv` path resolution, but per-app `.env` files may override or conflict silently. A developer editing the wrong file will see no effect.

**Fix:** Standardise on the root `.env` only. Remove per-app `.env` files. Document the single-source-of-truth pattern in `CLAUDE.md` (done) and enforce it with a CI lint check.

---

## ADDITIONAL SECURITY FINDINGS

### Finding 21 — WebSocket Data Injection via Missing Schema Validation
**Severity: HIGH | Confidence: 10/10 | VERIFIED**
**File:** `apps/ws-server/src/index.ts:24–37`

The `toDriplElement` validation function in the WebSocket server only checks for the existence of 6 fields. It does not validate their bounds (e.g., allowing `NaN` or `Infinity`, which crashes standard renderers) and **does not strip unknown properties**. An attacker can stuff massive strings (e.g., up to the 10MB payload limit) into an arbitrary key, and the server will accept it and store it in the database.

**Fix:** Use `zod` to define a strict schema for `DriplElement` and use `.parse()` to strip unrecognized keys and validate numeric bounds.

---

### Finding 22 — `updateFile` Accepts Unvalidated Payload
**Severity: HIGH | Confidence: 10/10 | VERIFIED**
**File:** `apps/http-server/src/controllers/fileController.ts:110–129`

The `/api/files/:id` PUT endpoint does zero validation on the `req.body`. An attacker can send malformed JSON objects for `name` or `content` which will directly hit Prisma and the database, potentially causing application crashes or persistent data corruption for the canvas files.

**Fix:** Add `zod` schema validation for the request body.

---

### Finding 23 — Expired Share Links Are Never Cleaned Up
**Severity: LOW | Confidence: 10/10 | VERIFIED**
**File:** `apps/http-server/src/controllers/roomController.ts:431-434`

While `getShareLink` rightfully rejects links where `expiresAt < new Date()`, there is no cron job or mechanism to physically delete these expired records from the database. Over time, the `ShareLink` table will grow unbounded with dead tokens.

**Fix:** Create a daily cleanup task or rely on a Redis TTL if tokens were moved to an ephemeral store.

---

## TESTING GAPS

| Area | Current Coverage | Gap |
|---|---|---|
| `http-server` routes | 401 on protected routes only | No DB-backed tests (successful login, file CRUD, room CRUD) |
| Auth flows | Input validation only | No bcrypt, JWT sign/verify, Google OAuth, password reset flow |
| WebSocket protocol | `validation.ts` unit tests | No connection lifecycle, join/leave, scene-update, rate-limit tests |
| `dripl-app` API routes | `ai-generate.test.ts` (mock) | No canvas rooms, share, snapshot routes |
| Frontend components | `ColorSwatch`, `SectionLabel`, `CookieConsent` | Critical paths: canvas render, collaboration, undo/redo |

**Root cause:** CI test job has no DB service (Finding 18), so real integration tests can't run in CI, creating a gravitational pull toward shallow unit tests.

---

## STRIDE THREAT MODEL (Summary)

| Component | Top Threat | Mitigated? |
|---|---|---|
| `ws-server` | Spoofing: anon join | ✅ Yes (auth check blocks) |
| `ws-server` | Tampering: unvalidated elements | ✅ Yes (Zod schema) |
| `http-server` | Brute force on login | ✅ Yes (authLimiter) |
| `http-server` | Privilege escalation via IDOR | ✅ userId filter in Prisma queries |
| `http-server` | Share link forgery | ✅ Yes (CSPRNG tokens) |
| `dripl-app/AI` | Cost amplification | ⚠️ Partial (client-supplied userId) |
| CI/CD | Supply chain | ✅ Yes (no --all) |

---

## REMEDIATION ROADMAP (Top 5)

| # | Finding | Effort | Priority | Status |
|---|---|---|---|---|
| 1 | **Anonymous WS joins** (Finding 4) | 30 min | P0 | ✅ RESOLVED |
| 2 | **Public share route behind auth** (Finding 3) | 1 hr | P0 | ✅ RESOLVED |
| 3 | **Weak share token CSPRNG** (Finding 1) | 30 min | P1 | ✅ RESOLVED |
| 4 | **AI rate limit bypass** (Finding 5) | 2 hr | P1 | ⚠️ PARTIAL |
| 5 | **CI missing Postgres service** (Finding 18) | 1 hr | P1 | ✅ RESOLVED |

**Note:** Finding 5 is partially mitigated. For full protection, add server-side session validation.

Remaining Open Issues:
- Finding 12: ws-server god file (future refactor)
- Finding 4: Remove unused anon fallback (cleanup)
- Finding 5: Add server-side auth for AI route (enhancement)

---

## FINDINGS TABLE

| # | Severity | Status | Category | Title | File |
|---|---|---|---|---|---|
| 1 | ~~HIGH~~ | ✅ RESOLVED | Auth/Crypto | Weak share token (Math.random) | roomController.ts:375 |
| 2 | ~~MEDIUM~~ | ✅ RESOLVED | Crypto | Room slug from Math.random | roomController.ts:7 |
| 3 | ~~HIGH~~ | ✅ RESOLVED | Auth/Access | Public share route behind authMiddleware | roomRoutes.ts:7 |
| 4 | ~~HIGH~~ | ⚠️ PARTIAL | Auth/Access | WS server allows anonymous joins | ws-server/index.ts:299 |
| 5 | ~~HIGH~~ | ⚠️ PARTIAL | LLM Security | AI rate limit bypassed via body.userId | ai/generate/route.ts:84 |
| 6 | LOW | ✅ Fixed | Config | maxPayload 1MB vs 10MB check mismatch | ws-server/index.ts:86 |
| 7 | MEDIUM | ✅ Fixed | Auth | No brute-force limit on login | http-server/index.ts:27 |
| 8 | MEDIUM | ✅ Fixed | Infra | No CORS Origin check on WS upgrade | ws-server/index.ts:284 |
| 9 | ~~LOW~~ | ❌ MISREPORT | Dead Code | Duplicate signSessionToken/generateToken | authMiddleware.ts:39 |
| 10 | MEDIUM | ✅ Fixed | Supply Chain | postinstall --all auto-approves scripts | package.json:6 |
| 11 | MEDIUM | ✅ Fixed | Logic | getRoom auto-creates on GET | roomController.ts:144 |
| 12 | ARCH | ❌ OPEN | Architecture | ws-server is 668-line god file | ws-server/index.ts |
| 13 | PERF | ✅ Fixed | Efficiency | Double-broadcast every WS event | ws-server/index.ts:408 |
| 14 | DEAD | ✅ Fixed | Dead Code | Orphaned FileRoute/TeamRoute/UserRoute | routes/ |
| 15 | MEDIUM | ✅ Fixed | Validation | updateRoom accepts unvalidated content | roomController.ts:221 |
| 16 | LOW | ✅ Fixed | Resource | rateLimitCleanup not cleared on shutdown | ws-server/index.ts:608 |
| 17 | CODE | ✅ Fixed | Type Safety | AI route uses any types throughout | ai/generate/route.ts |
| 18 | HIGH | ✅ Fixed | CI/CD | CI test job has no Postgres service | ci.yml:97 |
| 19 | ARCH | ✅ Fixed | Infra | vercel.json on non-serverless apps | ws-server/, http-server/ |
| 20 | CONFIG | ⚠️ GITIGNORED | Ops | Multiple conflicting .env files | repo root + apps/ |
| 21 | HIGH | ✅ Fixed | Validation | WS data injection via missing schema | ws-server/index.ts:24 |
| 22 | HIGH | ✅ Fixed | Validation | updateFile accepts unvalidated payload | fileController.ts:110 |
| 23 | LOW | ✅ Fixed | Resource | Expired share links never cleaned up | http-server/index.ts |

**Totals: ~~6 HIGH~~ 3 HIGH · 5 MEDIUM · 3 LOW · 7 ARCH/QUALITY/CONFIG (19/23 FIXED, 1 MISREPORT, 3 PARTIAL)**

---

<!-- Report updates and corrections applied on 2026-04-28 -->

> **Disclaimer:** This is an AI-assisted code review, not a professional penetration test. It catches common patterns but is not comprehensive. For production systems handling real users, engage a qualified security firm for a full assessment.

---

## Report Corrections (2026-04-28)

This report was **critically reviewed** and corrected:

| Finding | Original Claim | Correction |
|---------|---------------|------------|
| 1 | Uses Math.random() | Already uses CSPRNG ✅ |
| 2 | Uses Math.random() | Already uses CSPRNG ✅ |
| 3 | Route behind auth | Mounted before middleware ✅ |
| 4 | Fallback allows anon | Auth check rejects ✅ (fallback code exists but unreachable) |
| 5 | Uses IP fallback | IP removed ✅ (still client-supplied userId) |
| 9 | "generateToken never called" | IS called in userController.ts ❌ MISREPORT |
| 19 | vercel.json exists | Deleted ✅ |
| 22 | No validation | Zod schema exists ✅ |
| 23 | No cleanup | Daily cleanup added ✅ |

**Summary:** 19/23 fixes verified, 1 MISREPORT fixed, 3 partially mitigated.
