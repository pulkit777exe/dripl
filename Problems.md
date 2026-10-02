# Dripl — Security & Engineering Posture Report

> **Status note (2026-09-25):** This document preserves the earlier audit trail. Several statuses below predate the current uncommitted hardening work; use [`docs/codebase-audit.md`](docs/codebase-audit.md) for the current evidence-weighted assessment and explicit blockers.

**Date:** 2026-04-27 | **Updated:** 2026-04-28 | **Mode:** Full Audit | **Confidence gate:** 8/10 (daily)

## Current-tree reconciliation (2026-09-25)

The finding narratives below are retained as the original audit trail. This
overlay is the status to use for the current workspace; it is based on source
and test-file inspection. Separate disposable-PostgreSQL and opt-in runtime
results are recorded in [`docs/codebase-audit.md`](docs/codebase-audit.md).

| Finding(s) | Current status                                          | Evidence / remaining caveat                                                                                                                                                                                                                                                                                                                                                                                     |
| ---------- | ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1–3        | **Resolved**                                            | The room module uses `randomBytes` for slugs/tokens; the public room capability route is mounted before `authMiddleware` (`apps/http-server/src/routes/roomRoutes.ts`). Note `controllers/roomController.ts` no longer exists — the logic lives in `apps/http-server/src/services/roomService.ts` + `routes/roomRoutes.ts`.                                                                                     |
| 4          | **Resolved for arbitrary joins**                        | WS connections now require a one-time ticket and reject missing/invalid tickets (`ws-server/src/index.ts:361-399`); public file-share tickets are separately authorized by file/token/permission (`roomAccess.ts:16-34`). This is capability access, not unrestricted anonymous room access.                                                                                                                    |
| 5          | **Resolved**                                            | The AI route derives the rate-limit identity from a verified session/Bearer token and ignores body `userId` claims (`app/api/ai/generate/route.ts:229-236, 790-826`).                                                                                                                                                                                                                                           |
| 6          | **Historical/obsolete**                                 | The old 1 MB-vs-10 MB mismatch no longer describes the tree. Both `ws` and application checks use `MAX_MESSAGE_BYTES = 200_000` (`packages/common/src/constants.ts:37-40`, `ws-server/src/index.ts:341-343`, `validation.ts:253-262`).                                                                                                                                                                          |
| 7          | **Resolved for the covered auth routes**                | Login, registration, and password/verification flows have a dedicated 10-request/15-minute limiter in addition to the global limiter (`http-server/src/app.ts:26-36, 156-160`); not every auth handler shares the same middleware.                                                                                                                                                                              |
| 8          | **Resolved**                                            | WS upgrade origins are normalized and compared exactly; missing or disallowed origins are rejected (`ws-server/src/index.ts:317-356`).                                                                                                                                                                                                                                                                          |
| 9          | **Obsolete cleanup item**                               | The auth middleware’s `generateToken` export is now only an alias in `authMiddleware.ts`; `signSessionToken` is the used session-signing path (`routes/auth.ts:140,202`). The separate `ShareService` token generator is for share capabilities, not JWT sessions. This is no longer a duplicate active signing flow.                                                                                           |
| 10         | **Resolved**                                            | Root `package.json` has no `postinstall: approve-builds --all`; `pnpm-workspace.yaml:6-10` uses an explicit `allowBuilds` allowlist (`@sentry/cli`, `core-js`, `prisma`, `unrs-resolver`).                                                                                                                                                                                                                      |
| 11         | **Resolved**                                            | `getRoom` returns 404 for a missing room and no longer creates one (`apps/http-server/src/services/roomService.ts:134-157`).                                                                                                                                                                                                                                                                                    |
| 12         | **Historical description; architecture caveat remains** | The old 668/737-line description and “none of these files exist” claim are obsolete. The current `apps/ws-server/src/index.ts` is an 895-line coordinator (measured with `wc -l`), while auth/broadcast/rooms/rate-limit/handler modules exist; the coordinator risk is still valid.                                                                                                                            |
| 13         | **Resolved/obsolete**                                   | Current join, leave, and cursor paths emit one event payload per action; the former snake/kebab double-broadcast is not present in the reviewed handlers.                                                                                                                                                                                                                                                       |
| 14         | **Resolved**                                            | `FileRoute.ts`, `TeamRoute.ts`, and `UserRoute.ts` are absent, and there is no `controllers/` directory at all under `apps/http-server/src/` (only `lib/`, `middlewares/`, `routes/`, `services/`, `__tests__/`). The previously reported unreferenced `controllers/teamController.ts` stub is gone; there is no dead team controller to mistake for a mounted team API.                                        |
| 15         | **Resolved**                                            | Room content is schema/size checked and updates use owner plus optimistic timestamp checks (`apps/http-server/src/services/roomService.ts:160-198`).                                                                                                                                                                                                                                                            |
| 16         | **Obsolete for the reported WS limiter**                | The WS limiter no longer has a periodic cleanup interval; it uses bounded lazy pruning (`rateLimiter.ts:43-53, 85-100`). The HTTP ShareLink cleanup interval is cleared on shutdown; the separate HTTP WS-ticket timer is `unref()`ed but is not explicitly cleared, which is a minor lifecycle caveat.                                                                                                         |
| 17         | **Resolved**                                            | The AI route has no `any` type annotations and normalizes/parses bounded model output through `DriplElementSchema`.                                                                                                                                                                                                                                                                                             |
| 18         | **Resolved**                                            | CI defines a PostgreSQL service and runs migrations (`.github/workflows/ci.yml:102-115` for the service container, `:128-131` for the migration step) and enables the opt-in integration flags. Local DB-backed execution remains opt-in.                                                                                                                                                                       |
| 19         | **Resolved for backend Vercel configs**                 | No `apps/http-server/vercel.json` or `apps/ws-server/vercel.json` exists; the remaining frontend `apps/dripl-app/vercel.json` is expected for the Next app.                                                                                                                                                                                                                                                     |
| 20         | **Resolved**                                            | Only the ignored root `.env` exists in this workspace; per-app `.env` files are absent and the ignore rules cover them.                                                                                                                                                                                                                                                                                         |
| 21         | **Partially resolved**                                  | `toDriplElement` uses the shared bounded schema (`ws-server/src/index.ts:66-71`), but `ws-server/src/validation.ts` still maintains a separate local element schema. The shared element schema bounds numeric/style lengths but does not apply the dedicated cursor-color regex; schema duplication and validation-contract drift remain maintenance/security caveats, not the old unbounded-injection finding. |
| 22         | **Resolved**                                            | File routes and `FileService` validate scene structure/size and return conflicts for stale saves (`files.ts:241-313`, `fileService.ts:255-327`).                                                                                                                                                                                                                                                                |
| 23         | **Resolved for room `ShareLink` records**               | The HTTP server has a daily expired-link cleanup interval (`http-server/src/index.ts:24-40`) and clears it during shutdown. File-share tokens are nulled/revoked by `FileService`; their expiry is checked on access.                                                                                                                                                                                           |

Additional current caveat: validation coverage is not uniform across every
auth handler. `auth.ts` still uses manual checks for profile, password-reset,
Google-token, and resend-verification inputs; do not generalize the room/file
Zod fixes into a claim that every HTTP body is schema-validated.

The current evidence-weighted assessment and blockers are maintained in
[`docs/codebase-audit.md`](docs/codebase-audit.md). The totals and prose in the
historical sections below must not be read as a fresh current status.

---

## Architecture Mental Model

```
Browser (dripl-app / Next.js 16)
    │  REST (cookie JWT)         WebSocket (short-lived ticket)
    ▼                            ▼
http-server (Express 5)       ws-server (ws lib)
    │                            │
    └──── @dripl/db (Prisma) ────┘
               │
          PostgreSQL
```

Three trust boundaries:

1. **Browser → http-server** — cookie-scoped JWT, Helmet headers, global rate limit
2. **Browser → ws-server** — short-lived ticket in the connection URL, validated by http-server
3. **http-server / ws-server → DB** — Prisma, same `DATABASE_URL`

---

## Attack Surface Map (Historical Snapshot)

The counts below describe the April report and are not a current endpoint
inventory; use the source/routes and current audit for that.

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

## Historical security findings (not current)

> The individual narratives below preserve the April finding wording and
> remediation suggestions. For the current status, use the reconciliation
> table above; several old exploit descriptions refer to code that no longer
> exists.

### Historical Finding 1 — Cryptographically Weak Room Share Token

**Severity:** ~~HIGH~~ RESOLVED | **Confidence:** 10/10 | **VERIFIED**
**Status:** Already fixed in current codebase
**File:** `apps/http-server/src/services/roomService.ts:294` (the cited `controllers/roomController.ts` no longer exists)

```typescript
const token = crypto.randomBytes(24).toString('base64url');
```

Already uses CSPRNG (`crypto.randomBytes`). No changes needed.

Historical claim (not current): the original token embedded predictable
material and could be brute-forced. The current token is a 24-byte CSPRNG
value, so that exploit description no longer applies.

**Fix:**

```typescript
import { randomBytes } from 'crypto';
const token = randomBytes(24).toString('base64url'); // 192 bits, CSPRNG
```

---

### Historical Finding 2 — Room Slug Generated with `Math.random()`

**Severity:** ~~MEDIUM~~ RESOLVED | **Confidence:** 9/10 | **VERIFIED**
**Status:** Already fixed in current codebase
**File:** `apps/http-server/src/services/roomService.ts:8-11` (the cited `controllers/roomController.ts` no longer exists)

```typescript
function generateSlug(): string {
  return crypto.randomBytes(6).toString('hex').slice(0, 8);
}
```

Historical claim: the original slug generator used `Math.random()`. The
current generator uses `crypto.randomBytes`; the old brute-force rationale is
retained only as audit context.

---

### Historical Finding 3 — Public Room Share Route Behind `authMiddleware`

**Severity:** ~~HIGH~~ RESOLVED | **Confidence:** 10/10 | **VERIFIED**
**Status:** Already fixed in current codebase
**File:** `apps/http-server/src/routes/roomRoutes.ts:7-12`

```typescript
router.get('/share/:token', RoomController.getShareLink); // BEFORE authMiddleware

router.use(authMiddleware); // Applied after public routes
```

Share route is mounted BEFORE authMiddleware. No changes needed.

---

### Historical Finding 4 — WebSocket Server Allowed Fully Anonymous Room Joins

**Severity:** ~~HIGH~~ RESOLVED (historical finding) | **Confidence:** 10/10 | **VERIFIED**
**Status:** Resolved for unrestricted joins; capability-scoped public shares remain supported.
**File:** `apps/ws-server/src/index.ts`

The connection handler at `ws-server/src/index.ts:384-399` now rejects a
missing or invalid ticket before room access:

```typescript
const ticketPrincipal = await validateTicket(ticket);
if (!ticketPrincipal) {
  ws.close(4001, 'Authentication required');
  return;
}
```

Historical pre-hardening note (not current behavior): the report observed an
`anon_${uuidv4()}` fallback in an earlier revision. The current connection path
closes missing or invalid tickets before room access.

**Current action:** No anonymous fallback remains in the reviewed tree; public
share access is represented by scoped file-share tickets.

Historical exploit description (not reproducible in the current tree): an
invalid JWT previously fell through to an `anon_<uuid>` identity. The current
server validates a short-lived ticket through http-server and closes the socket
when validation fails.

**Fix (current ticket check):**

```typescript
const ticketPrincipal = await validateTicket(ticket);
if (!ticketPrincipal) {
  ws.close(4001, 'Authentication required');
  return;
}
```

---

### Historical Finding 5 — AI Rate Limit Bypassed via Client-Supplied `userId`

**Severity:** ~~HIGH~~ RESOLVED | **Confidence:** 10/10 | **VERIFIED**
**Status:** Resolved in the current tree; the original body-supplied identity
path is historical.
**File:** `apps/dripl-app/app/api/ai/generate/route.ts:215-236,799-826`

Historical implementation note: the original route accepted a body `userId`.
The current route verifies the `dripl-session` cookie or Bearer token and keys
rate limiting to the verified user ID; body identity is not used.

---

### Historical Finding 6 — `maxPayload` vs. Application-Level Size Check Mismatch

**Severity: LOW | Confidence: 10/10 | HISTORICAL/RECONCILED**
**File:** `packages/common/src/constants.ts`, `apps/ws-server/src/index.ts`, `apps/ws-server/src/validation.ts`

Historical finding: an earlier revision used a 1 MB `maxPayload` and a
separate 10 MB application constant. The current tree uses the shared
`MAX_MESSAGE_BYTES` value (200,000 bytes) for both checks, so this specific
mismatch is obsolete.

The current limit is 200 KB, not 10 MB. Keep the shared constant and its
protocol/application checks aligned if this area changes.

---

### Historical Finding 7 — Auth Endpoint Lacks Dedicated Brute-Force Protection

**Severity: MEDIUM | Confidence: 9/10 | HISTORICAL/RESOLVED**
**File:** `apps/http-server/src/app.ts:32-36,156-160`

Historical finding: the original server had only the 250-request global
limiter. The current app also applies a dedicated 10-request/15-minute limiter
to the covered auth endpoints (`app.ts:32-36, 156-160`); this is not a claim
that every auth handler has identical middleware.

**Fix:** Add a tighter limiter specifically on auth routes:

```typescript
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10 });
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/forgot-password', authLimiter);
```

---

### Historical Finding 8 — WebSocket CORS: No Origin Validation on Upgrade

**Severity: MEDIUM | Confidence: 9/10 | HISTORICAL/RESOLVED**
**File:** `apps/ws-server/src/index.ts:317-356`

Historical finding: the original upgrade path did not validate `Origin`.
The current `WebSocketServer` normalizes allowed origins and rejects missing or
non-exact origins before accepting a connection (`ws-server/src/index.ts:317-356`).

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

### Historical Finding 9 — Duplicate `signSessionToken` / `generateToken` Functions

**Severity:** ~~LOW~~ OBSOLETE CLEANUP | **Confidence:** 10/10 | **VERIFIED**
**Status:** Obsolete cleanup item; no active duplicate signing path

Historical note: the original report described two active signing paths and
referenced a now-removed user controller. In the current tree,
`signSessionToken` is used by auth routes and `generateToken` remains an
unused compatibility alias in `authMiddleware.ts`. This is cleanup debt, not
an active duplicate-token vulnerability.

**Conclusion:** The historical duplicate-signing finding does not describe the
current tree; only the unused alias remains to clean up.

---

### Historical Finding 10 — `pnpm postinstall` Auto-Approves All Build Scripts

**Severity: MEDIUM | Confidence: 9/10 | HISTORICAL/RESOLVED**
**File:** `package.json` (no current `postinstall` entry)

Historical code shown in the original report:

```json
"postinstall": "pnpm approve-builds --all"
```

The current root `package.json` has no such script. `pnpm-workspace.yaml:6-10`
uses an explicit `allowBuilds` allowlist instead (`@sentry/cli`, `core-js`,
`prisma`, `unrs-resolver`).

**Fix:** Remove `--all`. Enumerate only the known-safe build-script packages in `pnpm-workspace.yaml` `allowBuilds` (you already have `@sentry/cli`, `core-js`, `prisma`, `unrs-resolver` — that list is the correct approach).

---

### Historical Finding 11 — `getRoom` Auto-Creates Rooms on GET

**Severity: MEDIUM | Confidence: 9/10 | HISTORICAL/RESOLVED**
**File:** `apps/http-server/src/services/roomService.ts:134-157` (the cited `controllers/roomController.ts` no longer exists)

Historical code shown in the original report:

```typescript
if (!room) {
  room = await prisma.canvasRoom.create({ data: { slug, ownerId: req.userId!, ... } });
}
```

The current `getRoom` returns 404 when the slug is absent and does not create a
room. Room creation is explicit through `POST /api/rooms`.

---

## Historical code-quality findings (not current)

### Historical Finding 12 — ws-server Is a 668-Line God File

**Severity: ARCH | Current description is historical | File:** `apps/ws-server/src/index.ts`

Historical finding: the original report described a 668-line monolith and said
none of the documented modules existed. The current tree has `auth.ts`,
`broadcast.ts`, `rooms.ts`, `rateLimiter.ts`, `types.ts`, and a `handlers/`
directory, but `index.ts` remains a large (895-line) coordinator. The
architectural risk is still valid; the old file inventory and line count are
obsolete.

---

### Historical Finding 13 — Double-Broadcast on Every Event

**Severity: PERF | Historical/obsolete | File:** `apps/ws-server/src/index.ts`

Historical finding: the original implementation emitted both snake_case and
kebab-case variants for presence/cursor events. The current reviewed paths
broadcast one payload per event; the old duplicate-broadcast claim is not
present.

---

### Historical Finding 14 — Orphaned Route Files Never Mounted

**Severity: DEAD CODE | Historical/resolved for the named files**

The named `FileRoute.ts`, `TeamRoute.ts`, and `UserRoute.ts` files are absent
from the current tree, as is the `controllers/teamController.ts` stub — the
whole `controllers/` directory is gone. There is no remaining dead-code
cleanup item here.

---

### Historical Finding 15 — `updateRoom` Accepts Unvalidated Canvas Content

**Severity: MEDIUM | Historical/resolved | File:** `apps/http-server/src/services/roomService.ts` (the cited `controllers/roomController.ts` no longer exists)

Historical code shown in the original report:

```typescript
const { name, isPublic, content } = req.body;
// ...
...(content !== undefined && { content }),
```

The current handler parses `content` with `roomContentSchema`, validates every
stored element, checks ownership, and uses an optimistic timestamp fence.

---

### Historical Finding 16 — `rateLimitCleanup` Interval Not Cleared on Shutdown

**Severity: LOW | Historical/obsolete | File:** `apps/ws-server/src/rateLimiter.ts`

Historical code shown in the original report used a periodic cleanup interval.
The current WS limiter has no such interval: it prunes expired/old identities
lazily and bounds the in-memory map. The HTTP ShareLink cleanup interval is
cleared during shutdown. The separate HTTP WS-ticket cleanup timer is
`unref()`ed, but the current source does not explicitly clear that timer; treat
that as a minor lifecycle caveat rather than the old WS-limiter finding.

---

### Historical Finding 17 — AI Route Uses `any` Types Pervasively

**Severity: CODE QUALITY | Historical/resolved | File:** `apps/dripl-app/app/api/ai/generate/route.ts`

Historical finding: the original route used `any`-typed model elements and
directly returned normalized data. The current route uses `unknown`, bounds,
normalization, and `DriplElementSchema.safeParse`; model output is not passed
through unchecked `any` data.

---

## INFRASTRUCTURE FINDINGS

### Historical Finding 18 — CI Test Job Has No PostgreSQL Service Container

**Severity: HIGH | Historical/resolved | File:** `.github/workflows/ci.yml`

Historical finding: the original CI test job supplied a PostgreSQL URL without
starting a database. The current workflow defines a `postgres:16` service,
waits for health, runs Prisma migrations, and enables the opt-in integration
flags. This does not by itself prove that every route is exercised against a
live database.

---

### Historical Finding 19 — `vercel.json` in ws-server and http-server

**Severity: ARCH | Historical/resolved for the named files | Files:** `apps/ws-server/vercel.json`, `apps/http-server/vercel.json`

Historical finding: the original report found backend Vercel configs that would
not provide persistent WebSocket/HTTP runtimes. Those backend config files are
absent now; the remaining `apps/dripl-app/vercel.json` is a frontend config,
not a claim that ws-server is serverless-compatible.

---

### Historical Finding 20 — Multiple Duplicate `.env` Files

**Severity: CONFIG | Historical/resolved | Files:** root `.env`, app-level `.env` paths

Historical finding: four app/root env files were previously present. The
current workspace has only the ignored root `.env`; app-level duplicates are
absent and ignore rules cover those paths. The root `.env` remains a local
secret and must never be committed.

---

## ADDITIONAL SECURITY FINDINGS

### Historical Finding 21 — WebSocket Data Injection via Missing Schema Validation

**Severity: HIGH | Confidence: 10/10 | HISTORICAL/PARTIALLY RESOLVED**
**File:** `apps/ws-server/src/index.ts`, `apps/ws-server/src/validation.ts`

Historical finding: the original `toDriplElement` path only checked a small
field set. The current `toDriplElement` uses the shared bounded
`DriplElementSchema`, and the WS server also caps scenes and message bytes.
However, `validation.ts` still has a separate local element schema, so
contract duplication remains a maintenance caveat.

---

### Historical Finding 22 — `updateFile` Accepts Unvalidated Payload

**Severity: HIGH | Confidence: 10/10 | HISTORICAL/RESOLVED**
**File:** `apps/http-server/src/routes/files.ts`, `apps/http-server/src/services/fileService.ts`

Historical finding: the original file controller accepted an unchecked body.
The current PATCH route parses a Zod schema, size-checks content, validates the
scene, and `FileService.updateFile` returns a conflict instead of overwriting
an unvalidated/stale scene.

---

### Historical Finding 23 — Expired Share Links Are Never Cleaned Up

**Severity: LOW | Confidence: 10/10 | HISTORICAL/RESOLVED for ShareLink rows**
**File:** `apps/http-server/src/index.ts`, `apps/http-server/src/services/fileService.ts`

Historical finding: room share records previously had no physical cleanup.
The current HTTP server deletes expired `ShareLink` rows on a daily interval
and rejects expired links on access. File-share tokens have separate nullable
share state and are checked/revoked through `FileService`; they are not the
same table or lifecycle.

---

## TESTING GAPS (Historical Snapshot)

The original table below predates the added route/service, collaboration,
snapshot, image, and persistence-fencing tests. Current test-file inventory is
listed in `docs/codebase-audit.md`; live database, Redis, browser, and
production deployment execution remain unverified in this documentation pass.

| Area                   | Historical coverage          | Current caveat                                                                                                |
| ---------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `http-server` routes   | 401 on protected routes only | Route/service tests now exist, including capability routes and owner scoping; live DB execution is opt-in.    |
| Auth flows             | Input validation only        | Auth-service and middleware tests exist; live Google/email delivery is not exercised here.                    |
| WebSocket protocol     | `validation.ts` unit tests   | Protocol/access/reconciliation/persistence tests exist; the process test mocks ticket/DB seams and is opt-in. |
| `dripl-app` API routes | `ai-generate.test.ts` (mock) | AI, snapshot, share, and route tests exist; no real Gemini or browser run is claimed.                         |
| Frontend components    | A few component tests        | Store, collaboration, render-loop, export, and canvas tests exist; no browser QA.                             |

The old root-cause statement that CI had no database service is obsolete;
CI now defines a PostgreSQL service and migration step.

---

## STRIDE THREAT MODEL (Summary)

| Component      | Top Threat                      | Mitigated?                                                                      |
| -------------- | ------------------------------- | ------------------------------------------------------------------------------- |
| `ws-server`    | Spoofing: arbitrary anon join   | ✅ Yes (ticket validation + room/file authorization)                            |
| `ws-server`    | Tampering: unvalidated elements | ✅ Yes (shared bounded schema; local duplicate remains)                         |
| `http-server`  | Brute force on login            | ✅ Yes (dedicated auth limiter)                                                 |
| `http-server`  | Privilege escalation via IDOR   | ✅ owner/team/member/share scoping in current services; retain regression tests |
| `http-server`  | Share link forgery              | ✅ Yes (CSPRNG tokens)                                                          |
| `dripl-app/AI` | Cost amplification              | ✅ Verified session identity + bounded rate limiting                            |
| CI/CD          | Supply chain                    | ✅ Explicit build allowlist; no `postinstall --all`                             |

---

## REMEDIATION ROADMAP (Historical Top 5)

| #   | Finding                                        | Effort | Priority | Historical status           |
| --- | ---------------------------------------------- | ------ | -------- | --------------------------- |
| 1   | **Anonymous WS joins** (Finding 4)             | 30 min | P0       | ✅ RESOLVED                 |
| 2   | **Public share route behind auth** (Finding 3) | 1 hr   | P0       | ✅ RESOLVED                 |
| 3   | **Weak share token CSPRNG** (Finding 1)        | 30 min | P1       | ✅ RESOLVED                 |
| 4   | **AI rate limit bypass** (Finding 5)           | 2 hr   | P1       | ✅ RESOLVED in current tree |
| 5   | **CI missing Postgres service** (Finding 18)   | 1 hr   | P1       | ✅ RESOLVED                 |

The remaining architecture/evidence work is not an open anonymous-join or AI
identity hole: the current caveats are the large WS coordinator, process-local
state/tickets, schema duplication, and the lack of live deployment/browser
verification. See `docs/codebase-audit.md`.

---

## FINDINGS TABLE

| #   | Severity   | Current status                  | Category     | Current interpretation                                                                                                                        |
| --- | ---------- | ------------------------------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | ~~HIGH~~   | ✅ RESOLVED                     | Auth/Crypto  | Share tokens use `randomBytes`; the old `Math.random` claim is historical.                                                                    |
| 2   | ~~MEDIUM~~ | ✅ RESOLVED                     | Crypto       | Room slugs use `randomBytes`; the old claim is historical.                                                                                    |
| 3   | ~~HIGH~~   | ✅ RESOLVED                     | Auth/Access  | Capability route is mounted before auth middleware.                                                                                           |
| 4   | ~~HIGH~~   | ✅ RESOLVED                     | Auth/Access  | Ticket validation + file/room authorization replace the old anon path.                                                                        |
| 5   | ~~HIGH~~   | ✅ RESOLVED                     | LLM Security | Verified session identity replaces body `userId`; local/distributed limits remain.                                                            |
| 6   | LOW        | ✅ RECONCILED                   | Config       | Old 1 MB/10 MB mismatch is obsolete; current shared cap is 200 KB.                                                                            |
| 7   | MEDIUM     | ✅ RESOLVED for covered routes  | Auth         | Dedicated auth limiter exists for login/registration and selected verification/password flows; validation/middleware coverage is not uniform. |
| 8   | MEDIUM     | ✅ RESOLVED                     | Infra        | Exact WS origin validation exists.                                                                                                            |
| 9   | ~~LOW~~    | ⚠️ CLEANUP                      | Dead Code    | `generateToken` is an unused alias; no active duplicate signing path.                                                                         |
| 10  | MEDIUM     | ✅ RESOLVED                     | Supply Chain | No `postinstall --all`; explicit build allowlist.                                                                                             |
| 11  | MEDIUM     | ✅ RESOLVED                     | Logic        | GET no longer creates rooms.                                                                                                                  |
| 12  | ARCH       | ⚠️ OPEN/REVISED                 | Architecture | Old line count/module claim is obsolete; coordinator remains large.                                                                           |
| 13  | PERF       | ✅ RESOLVED                     | Efficiency   | Current reviewed event paths do not double-broadcast.                                                                                         |
| 14  | DEAD       | ✅ RESOLVED                     | Dead Code    | Named orphan route files are absent; the `teamController.ts` stub and the whole `controllers/` directory are gone.                            |
| 15  | MEDIUM     | ✅ RESOLVED                     | Validation   | Room content is bounded/schema checked with owner conflict fencing.                                                                           |
| 16  | LOW        | ✅ RECONCILED for the old claim | Resource     | No WS cleanup interval remains; fallback maps are bounded/lazy-pruned. The separate HTTP ticket timer is unref'd, not explicitly cleared.     |
| 17  | CODE       | ✅ RESOLVED                     | Type Safety  | AI route uses `unknown` and schema normalization.                                                                                             |
| 18  | HIGH       | ✅ RESOLVED                     | CI/CD        | CI has Postgres service, migration step, and opt-in integration flags.                                                                        |
| 19  | ARCH       | ✅ RESOLVED                     | Infra        | Backend Vercel configs are absent; frontend Vercel config remains.                                                                            |
| 20  | CONFIG     | ✅ RESOLVED                     | Ops          | Only ignored root `.env` is present; app duplicates are absent.                                                                               |
| 21  | HIGH       | ⚠️ PARTIAL                      | Validation   | Shared bounded schema is used, but local WS schema duplication remains.                                                                       |
| 22  | HIGH       | ✅ RESOLVED                     | Validation   | File writes validate scenes and handle stale saves.                                                                                           |
| 23  | LOW        | ✅ RESOLVED                     | Resource     | Expired ShareLink cleanup runs daily; file shares have separate lifecycle.                                                                    |

**The old 19/23 total is not a current total; use the reconciliation table above.**

---

<!-- Report updates and corrections applied on 2026-04-28 -->

> **Disclaimer:** This is an AI-assisted code review, not a professional penetration test. It catches common patterns but is not comprehensive. For production systems handling real users, engage a qualified security firm for a full assessment.

---

## Report Corrections (2026-04-28)

This report was **critically reviewed** and corrected:

| Finding | Original Claim               | Correction                                                                         |
| ------- | ---------------------------- | ---------------------------------------------------------------------------------- |
| 1       | Uses Math.random()           | Already uses CSPRNG ✅                                                             |
| 2       | Uses Math.random()           | Already uses CSPRNG ✅                                                             |
| 3       | Route behind auth            | Mounted before middleware ✅                                                       |
| 4       | Fallback allows anon         | Historical: current code rejects missing/invalid tickets; no arbitrary anon join   |
| 5       | Uses IP/body identity        | Historical: current AI rate-limit identity comes from verified session/Bearer auth |
| 9       | "generateToken never called" | Historical: `signSessionToken` is active; `generateToken` is now an unused alias   |
| 19      | vercel.json exists           | Deleted ✅                                                                         |
| 22      | No validation                | Zod schema exists ✅                                                               |
| 23      | No cleanup                   | Daily cleanup added ✅                                                             |

**Summary (historical):** 19/23 fixes were recorded in the April report. The
current status is the reconciliation table at the top of this file; it is not
reproduced by this historical total.
