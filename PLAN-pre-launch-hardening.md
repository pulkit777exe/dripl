# Dripl Pre-Launch Hardening Plan

> 7 fixes across P0/P1/P2, each as an independent atomic commit. Verified against codebase as of 2026-07-04.

---

## Fix 1: Element/Room Size Caps (DoS Prevention) — P0

**Problem:** `scene-delta`, `add_element`, and `element-update` have no element count or byte-size limits. `files.ts` content field is unvalidated. A malicious client can grow rooms unboundedly.

**Current State:**
- `scene-update` has 5000-element limit in Zod schema + handler
- `scene-delta` has NO count limit, NO byte-size limit
- `add_element` has NO count limit (single element, but no room-size check)
- `element-update` has NO array length limit
- `packages/common/src/constants.ts` has no size constants
- http-server Express body parser: 5MB limit (but `files.ts` content is `z.unknown()`)
- ws-server WebSocket maxPayload: 10MB (transport level only)

**Implementation:**

### Step 1: Add constants to `packages/common/src/constants.ts`
```typescript
export const MAX_ELEMENTS_PER_ROOM = 10_000;
export const MAX_ELEMENT_PAYLOAD_BYTES = 50_000;
export const MAX_MESSAGE_BYTES = 200_000;
export const ROOM_SIZE_WARNING_THRESHOLD = 0.8; // 80% of max
```

### Step 2: Add byte-size validation in `apps/ws-server/src/validation.ts`
- Add a `MAX_MESSAGE_BYTES` pre-parse check before Zod validation
- Add `.max()` to `sceneDeltaSchema.added` and `sceneDeltaSchema.updated` arrays
- Add `.max()` to `elementUpdateSchema.elements` array

### Step 3: Add room element count check in `apps/ws-server/src/index.ts`
- Before `add_element` mutation: check `room.elements.size >= MAX_ELEMENTS_PER_ROOM`
- Before `scene-delta` added elements: check count won't exceed limit
- Log warning when room crosses 80% threshold

### Step 4: Add file content size validation in `apps/http-server/src/routes/files.ts`
- Add byte-size check on `File.content` before DB write
- Reject with structured error if content exceeds limit

**Files to change:**
- `packages/common/src/constants.ts`
- `apps/ws-server/src/validation.ts`
- `apps/ws-server/src/index.ts`
- `apps/http-server/src/routes/files.ts`

**Do not touch:** `yjsManager.ts`, `redis.ts`, `broadcast.ts`

---

## Fix 2: SSRF Guard (Defensive) — P0

**Problem:** No SSRF protection exists. Currently no server-side URL fetching of user-controlled data, but future features may add it.

**Current State:**
- AI route only accepts text prompts (no URLs)
- No image proxy routes
- All fetch() calls target hardcoded endpoints
- No `ssrfGuard.ts` utility exists

**Implementation:**

### Step 1: Create `packages/utils/src/ssrfGuard.ts`
```typescript
export function isSafeUrl(url: string): { safe: boolean; reason?: string }
```
- Resolve hostname via `dns.lookup()`
- Reject if resolves to: 127.0.0.0/8, 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 169.254.0.0/16, ::1, fc00::/7
- Reject non-http/https schemes
- Export from `packages/utils/src/index.ts`

### Step 2: Add guard to `apps/dripl-app/app/api/ai/generate/route.ts`
- Call `isSafeUrl()` before any future fetch (currently N/A, but defensive)

**Files to change:**
- `packages/utils/src/ssrfGuard.ts` (new)
- `packages/utils/src/index.ts` (export)
- `apps/dripl-app/app/api/ai/generate/route.ts` (add check for future-proofing)

---

## Fix 3: Per-User AI Rate Limiting — P0

**Problem:** AI route uses in-memory fixed-window rate limit (10 req/min), not Upstash. Not keyed by authenticated userId. 4 other rate limiters use Upstash.

**Current State:**
- In-memory `Map<string, RateLimitEntry>` with fixed-window algorithm
- Keyed by session cookie or IP fallback
- 4 Upstash `Ratelimit` instances exist in http-server and ws-server

**Implementation:**

### Step 1: Create Upstash ratelimit instance for AI route
- In `apps/dripl-app/app/api/ai/generate/route.ts`:
  ```typescript
  const aiRateLimit = new Ratelimit({
    redis: Redis.fromEnv(),
    limiter: Ratelimit.slidingWindow(10, '1 h'),
    prefix: 'dripl:ai:ratelimit',
  });
  ```

### Step 2: Extract authenticated userId
- Use session cookie to get userId from DB (existing auth pattern)
- Fall back to `anon:<IP>` if not authenticated

### Step 3: Replace in-memory rate limit
- Remove `rateLimitMap`, `checkRateLimit()`, `RateLimitEntry` interface
- Use Upstash sliding window: `const result = await aiRateLimit.limit(userId)`
- Return 429 with `retryAfter` in response headers

### Step 4: Log rejections
- Log userId, IP, and timestamp for abuse pattern review

**Files to change:**
- `apps/dripl-app/app/api/ai/generate/route.ts`

---

## Fix 4: Offline Queue with Idempotent Replay — P1

**Problem:** No offline queue exists. Messages silently dropped when disconnected. No `clientMsgId` for dedup.

**Current State:**
- `send()` silently drops messages when `ws.readyState !== OPEN`
- No `clientMsgId` field in `ClientMessage` type
- No server-side dedup logic
- Reconnect sends full `scene-update` init

**Implementation:**

### Step 1: Add `clientMsgId` to client message types
- In `apps/dripl-app/hooks/useCollaboration.ts`:
  - Add `clientMsgId: string` to all `ClientMessage` types
  - Generate via `crypto.randomUUID()` when sending

### Step 2: Build offline queue
- Add `offlineQueueRef = useRef<Array<{ msg: ClientMessage; timestamp: number }>>([])`
- When `ws.readyState !== OPEN`, queue the message instead of dropping
- On reconnect, replay queue in order, then clear
- Cap queue at 100 messages (drop oldest if exceeded)

### Step 3: Add server-side dedup
- In `apps/ws-server/src/types.ts`: add `recentMsgIds: Set<string>` to `RoomState`
- In `apps/ws-server/src/index.ts`:
  - Before applying mutation, check `clientMsgId` against `recentMsgIds`
  - If seen, ack silently but do not reapply
  - After successful processing, add to `recentMsgIds`
  - Evict entries older than 60s or when Set exceeds 500

**Files to change:**
- `apps/dripl-app/hooks/useCollaboration.ts`
- `apps/ws-server/src/types.ts`
- `apps/ws-server/src/index.ts`
- `apps/ws-server/src/validation.ts` (add `clientMsgId` to schemas)

---

## Fix 5: Element Lock Heartbeat — P1

**Problem:** `lockElement`/`unlockElement` are NO-OPs. Lock state is client-side only. Server has NO lock awareness. No TTL, no sweep loop.

**Current State:**
- `lockElement`/`unlockElement` in `useCollaboration.ts` are empty functions
- `elementLocks: Map<string, string>` in Zustand store (client-only)
- Server `RoomState` has no `elementLocks` field
- No lock-related message types in validation.ts

**Implementation:**

### Step 1: Add server-side lock state
- In `apps/ws-server/src/types.ts`: add to `RoomState`:
  ```typescript
  elementLocks: Map<string, { userId: string; lastHeartbeat: number }>;
  ```

### Step 2: Add lock message types
- In `apps/ws-server/src/validation.ts`: add schemas for:
  - `element-lock`: `{ type: 'element-lock'; elementId: string }`
  - `element-unlock`: `{ type: 'element-unlock'; elementId: string }`
  - `element-lock-heartbeat`: `{ type: 'element-lock-heartbeat'; elementId: string }`

### Step 3: Handle lock messages in ws-server
- In `apps/ws-server/src/index.ts`:
  - `element-lock`: Add to `room.elementLocks`, broadcast to room
  - `element-unlock`: Remove from `room.elementLocks`, broadcast to room
  - `element-lock-heartbeat`: Refresh `lastHeartbeat` timestamp

### Step 4: Add lock sweep loop
- Every 5s, expire locks where `Date.now() - lastHeartbeat > 10_000`
- Broadcast expired locks to room

### Step 5: Wire client-side lock functions
- In `apps/dripl-app/hooks/useCollaboration.ts`:
  - `lockElement`: Send `element-lock` message via WS
  - `unlockElement`: Send `element-unlock` message via WS
  - On pointerdown on locked element: send heartbeat every 3s
  - On pointerup: send unlock + clear heartbeat

### Step 6: Broadcast lock state on join
- When a new user joins, send current `elementLocks` state

**Files to change:**
- `apps/ws-server/src/types.ts`
- `apps/ws-server/src/validation.ts`
- `apps/ws-server/src/index.ts`
- `apps/dripl-app/hooks/useCollaboration.ts`
- `apps/dripl-app/hooks/canvas/useCanvasPointerEvents.ts`

---

## Fix 6: Follow Mode with Throttled Viewport Updates — P1

**Problem:** No viewport-update broadcast exists. No Follow Mode. Cursor is throttled client-side at 50ms. No server-side broadcast throttle.

**Current State:**
- No `viewport-update` message type
- No Follow Mode UI
- Cursor throttled at 50ms client-side (~20fps)
- `useInterpolatedCursors.ts` provides lerp smoothing (0.15 factor)
- No server-side broadcast throttling

**Implementation:**

### Step 1: Add viewport-update message type
- In `apps/dripl-app/hooks/useCollaboration.ts`: add `ClientMessage` type:
  ```typescript
  | { type: 'viewport-update'; panX: number; panY: number; zoom: number }
  ```
- In `apps/ws-server/src/validation.ts`: add Zod schema

### Step 2: Add follow state to server
- In `apps/ws-server/src/types.ts`: add to `RoomState`:
  ```typescript
  following: Map<string, string>; // followerId → leaderId
  ```
- Add message types: `follow-user`, `unfollow-user`

### Step 3: Handle viewport-update in ws-server
- In `apps/ws-server/src/index.ts`:
  - Store latest viewport per user in `room.users.get(userId).viewport`
  - Throttle broadcast to ~10fps (100ms) using existing throttle utility
  - Only broadcast to users following this user

### Step 4: Add Follow Mode UI
- In `apps/dripl-app/components/canvas/TopBar.tsx`:
  - Add "Follow" button per collaborator avatar
  - Add "Stop Follow" button when following someone
- In `apps/dripl-app/hooks/useCollaboration.ts`:
  - `followUser(userId)`: Send `follow-user` message
  - `unfollowUser()`: Send `unfollow-user` message
  - Receive `viewport-update`: Apply pan/zoom with interpolation

### Step 5: Client-side viewport interpolation
- In `apps/dripl-app/hooks/useCollaboration.ts`:
  - When following, interpolate viewport between received updates
  - Use lerp factor 0.15 (matching cursor interpolation)
  - Stop interpolation on user interaction (break follow)

**Files to change:**
- `apps/dripl-app/hooks/useCollaboration.ts`
- `apps/ws-server/src/validation.ts`
- `apps/ws-server/src/types.ts`
- `apps/ws-server/src/index.ts`
- `apps/dripl-app/components/canvas/TopBar.tsx`

---

## Fix 7: Backend Sentry Parity — P2

**Problem:** Sentry only in dripl-app. http-server and ws-server exceptions only reach pino stdout.

**Current State:**
- dripl-app: Full Sentry integration (`@sentry/nextjs`)
- http-server: No Sentry, `console.error` in error handler
- ws-server: No Sentry, `logger.error` in catch blocks
- Neither has `@sentry/node` dependency

**Implementation:**

### Step 1: Add @sentry/node to both services
```bash
pnpm --filter http-server add @sentry/node
pnpm --filter ws-server add @sentry/node
```

### Step 2: Initialize Sentry in http-server
- In `apps/http-server/src/app.ts`:
  ```typescript
  import * as Sentry from '@sentry/node';
  Sentry.init({ dsn: process.env.SENTRY_DSN, environment: process.env.NODE_ENV });
  ```
- Add Sentry error handler after routes: `Sentry.setupExpressErrorHandler(app);`

### Step 3: Initialize Sentry in ws-server
- In `apps/ws-server/src/index.ts`:
  ```typescript
  import * as Sentry from '@sentry/node';
  Sentry.init({ dsn: process.env.SENTRY_DSN, environment: process.env.NODE_ENV });
  ```
- Add `Sentry.captureException(err)` in outer catch blocks (line 687, 847)

### Step 4: Add SENTRY_DNS to env files
- Add to `.env` (root): `SENTRY_DSN=`
- Add to Render Blueprint or dashboard

**Files to change:**
- `apps/http-server/package.json`
- `apps/http-server/src/app.ts`
- `apps/ws-server/package.json`
- `apps/ws-server/src/index.ts`

---

## Execution Order

```
P0 (before any public traffic):
  Fix 1: Element/room size caps        [1-2 hours]
  Fix 2: SSRF guard                    [1 hour]
  Fix 3: Per-user AI rate limit        [1 hour]

P1 (before wide rollout):
  Fix 4: Offline queue idempotency     [2 hours]
  Fix 5: Lock heartbeat                [2 hours]
  Fix 6: Full Follow Mode              [3-4 hours]

P2 (parallel, ops):
  Fix 7: Backend Sentry parity         [1 hour]

Total: ~10-12 hours
```

## Test Strategy

For each fix:
1. Run `pnpm lint` and `pnpm build` after changes
2. Run existing tests: `pnpm --filter ws-server run test`, `pnpm --filter http-server run test`, `pnpm --filter dripl-app run test`
3. Manual verification where automated tests don't cover (e.g., WS message flow)
4. Typecheck: `pnpm --filter <package> run check-types`

## Notes

- Fix 2 (SSRF) is defensive — no active risk, but future-proofs the codebase
- Fix 4 (Offline Queue) is a new feature, not just a bug fix
- Fix 5 (Lock Heartbeat) requires server-side lock state (new concept)
- Fix 6 (Follow Mode) is the largest change — full viewport sync protocol
- All fixes are independent and can be committed separately
