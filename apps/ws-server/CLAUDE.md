# ws-server — WebSocket Collaboration Server

> Part of the Dripl monorepo. Read the root `CLAUDE.md` first.

---

## What This App Does

`ws-server` is the real-time WebSocket server for Dripl's collaboration feature. It:

- Manages **rooms** — groups of users editing the same canvas
- Syncs **canvas elements** between all users in a room
- Broadcasts **cursor positions** (~30 fps)
- Tracks **user presence** (join/leave events)
- Enforces **rate limiting** per verified user/share identity (with a bounded process-local fallback)
- Validates incoming **JSON message payloads** with Zod (the dormant binary Yjs
  path is disabled)
- Persists the **current room element state** for new joiners

Runs on **port 3001** in development.

---

## Tech Stack

| Layer         | Technology                                        |
| ------------- | ------------------------------------------------- |
| Language      | TypeScript 5 (ESM)                                |
| Runtime       | Node.js (tsx for dev, compiled JS for prod)       |
| WebSocket     | `ws` library (RFC 6455)                           |
| Auth          | Short-lived ticket validation through http-server |
| Validation    | Zod v4 (active JSON message payloads)             |
| Rate Limiting | Token-bucket per verified user/share identity     |
| Testing       | Vitest                                            |

---

## Directory Structure

```
apps/ws-server/
├── src/
│   ├── index.ts           # Entry point — WS server, message dispatch, lifecycle
│   ├── types.ts           # Shared interfaces (RoomState, UserConnection, Cursor)
│   ├── auth.ts            # Ticket extraction and internal http-server validation
│   ├── broadcast.ts       # send(), broadcast(), roomUsersPayload(), roomCursorsPayload()
│   ├── rooms.ts           # Room state Map, element Map ops, DB load/save, scheduleSave
│   ├── roomAccess.ts      # Room access policy
│   ├── sceneMutation.ts   # Element acceptance, capacity, remote-apply
│   ├── handlers/          # cursorMove, locks, presence handlers + types
│   ├── validation.ts      # Zod message schemas (element wire format owned by @dripl/common)
│   ├── rateLimiter.ts     # Upstash-backed or bounded local message limiting
│   ├── env.ts             # Env validation
│   ├── logger.ts          # Structured logger
├── tests/                 # Protocol, auth, persistence, and handler tests
├── tsconfig.json
└── package.json
```

---

## Running Locally

```bash
# From monorepo root (recommended — starts all services)
pnpm dev

# From this directory only
cd apps/ws-server
pnpm dev    # Uses: dotenv -e ../../.env -- tsx src/index.ts
```

> Hot-reload is **not** enabled for ws-server by default (no `tsx watch`). Restart manually or add `watch` to the dev script when needed.

---

## Key Scripts

```bash
pnpm dev      # Start dev server (tsx, loads root .env)
pnpm build    # Compile TypeScript → dist/ (tsc -b --force)
pnpm start    # Run compiled output: node dist/index.js
pnpm test     # Vitest test suite
```

---

## Message Protocol

The active wire messages are JSON with a `type` field. The client sends; the
server receives, validates, and broadcasts. A disabled binary Yjs branch is
retained only for a future protocol decision.

### Client → Server

| `type`                        | Payload                             | Description                                                          |
| ----------------------------- | ----------------------------------- | -------------------------------------------------------------------- |
| `join` / `join_room`          | `{ roomId, displayName, color }`    | Join a collaboration room                                            |
| `leave` / `leave_room`        | —                                   | Leave current room                                                   |
| `scene-update`                | `{ subtype, elements[] }`           | Versioned merge; authoritative full replacement is `sync_room_state` |
| `scene-delta`                 | `{ added[], updated[], deleted[] }` | Differential element changes                                         |
| `add_element`                 | `{ element }`                       | Add a single element                                                 |
| `update_element`              | `{ element }`                       | Update a single element                                              |
| `delete_element`              | `{ elementId }`                     | Delete a single element                                              |
| `element-update`              | `{ element/elements[] }`            | Batch or single element update                                       |
| `cursor-move` / `cursor_move` | `{ x, y, displayName, color }`      | Cursor position update                                               |
| `ping`                        | —                                   | Keepalive ping                                                       |

### Server → Client

| `type`            | Payload                                           | Description                                                                                                       |
| ----------------- | ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `sync_room_state` | `{ roomId, elements[], users[], cursors[], ... }` | Full room state on join; also carries additive `sceneVersion` (monotonic mutation counter) and `protocolEpoch: 2` |
| `room-state`      | `{ roomId, elements[], users[], cursors[] }`      | Legacy client-compatibility alias; current server sends `sync_room_state`                                         |
| `scene-update`    | `{ subtype, elements[] }`                         | Legacy shape; current server never emits it — all scene mutations relay as `scene-delta`                          |
| `scene-delta`     | `{ added[], updated[], deleted[] }`               | The uniform scene relay (per-id semantics: add→added, update→updated, delete→deleted)                             |
| `user-join`       | `{ userId, displayName, color }`                  | User joined room                                                                                                  |
| `user-leave`      | `{ userId }`                                      | User left room                                                                                                    |
| `cursor_move`     | `{ userId, x, y, displayName, color }`            | Broadcasted cursor                                                                                                |
| `pong`            | `{ timestamp }`                                   | Keepalive response                                                                                                |
| `error`           | `{ message }`                                     | Server-side error                                                                                                 |

---

## Room State

Each room is stored in a `Map<roomId, RoomState>`:

```typescript
interface RoomState {
  roomId: string;
  elements: Map<string, DriplElement>; // O(1) element lookups by ID
  users: Map<string, UserConnection>; // Connected users by userId
  cursors: Map<string, Cursor>; // Cursor positions by userId
  loadedFromDb: boolean; // Lazy DB load flag
  saving: boolean; // Prevents overlapping saves
  // plus dirty/mutationVersion, persistence fencing, locks, and Yjs adapter state
}
```

### Reverse Indexes

Two reverse indexes avoid O(n) scans:

- **`userToRoomMap: Map<userId, roomId>`** — fast room lookup for any userId (heartbeat, diagnostics)
- **`wsToRoomMap: Map<WebSocket, roomId>`** — fast room lookup per WebSocket connection

### Lifecycle

When a new user joins:

1. Server loads elements from DB (lazy, once per room lifetime)
2. Server sends `sync_room_state` with full element array (the client also accepts legacy `room-state`)
3. Server broadcasts `user-join` to all existing room members

When a user disconnects (clean or ungraceful):

1. Stale user is removed from `room.users` and reverse indexes updated
2. `user-leave` is broadcast to remaining members
3. Empty rooms tracked via `roomLastEmptyAt` for TTL-based garbage collection

---

## Authentication

Authentication happens during the connection callback using a short-lived,
one-time ticket:

```
Client obtains POST /api/auth/ws-ticket with its session cookie
  └─► http-server stores a 30-second ticket in its process-local map
        └─► client opens ws://...?ticket=<uuid>
              └─► ws-server calls POST /internal/validate-ticket
                    with X-Internal-Secret
                    └─► http-server consumes the ticket and returns a user
                        or scoped file-share principal
```

Missing or invalid tickets close the socket with code 4001. There is no
unrestricted anonymous room join path. Ticket storage is process-local, so a
multi-instance HTTP deployment needs shared durable state.

---

## Validation

All active JSON message payloads are validated with **Zod schemas** in
`src/validation.ts` before handler logic runs. A binary branch exists for a
future Yjs transport, but it is disabled and is not part of the current wire
contract.

**Element bounds are validated** — coordinates must be finite numbers within canvas bounds. Invalid messages are silently dropped.

**Max message size**: 200 KB (`MAX_MESSAGE_BYTES`, enforced by both `ws` and application validation). The application-level `MAX_ELEMENTS_PER_SCENE` limit is 5,000 elements.

---

## Rate Limiting

Each verified user/share identity has a 1-second, 30-message limit. Upstash
Redis is used when configured; otherwise a bounded process-local token bucket
is used. Exceeded connections close with code 4000. Local identities are
pruned lazily, not by a long-lived cleanup interval.

---

## Element Storage

Elements are stored as a `Map<string, DriplElement>` for O(1) lookups:

| Operation         | Before (Array)       | After (Map)              |
| ----------------- | -------------------- | ------------------------ |
| Add element       | O(n) filter + push   | O(1) set                 |
| Update element    | O(n) map             | O(1) set                 |
| Delete element    | O(n) filter          | O(1) delete              |
| Scene delta merge | O(n) array→Map→Array | O(k) set/delete loop     |
| Save to DB        | Array spread         | Array.from(map.values()) |

When serialized for DB storage or client transmission, the Map is converted to an array via `Array.from(elements.values())`.

---

## Periodic Save

Room state is persisted to DB via two mechanisms:

1. **Debounced save** (`scheduleSave`): 2-second debounce after each element change. Uses recursive `setTimeout` with a `saving` flag to prevent overlapping writes.
2. **Periodic save** (`periodicSave`): Every 15 seconds, saves dirty active
   rooms and garbage-collects empty rooms after the 5-minute TTL.

---

## Environment Variables

Loaded from the **root** `.env` via `dotenv -e ../../.env`.

| Variable                                              | Required                 | Purpose                                                                         |
| ----------------------------------------------------- | ------------------------ | ------------------------------------------------------------------------------- |
| `JWT_SECRET`                                          | ✅ in current env schema | Session/config compatibility; WS auth uses tickets, not client JWT verification |
| `WS_PORT`                                             | ✅                       | WebSocket server port (default `3001`)                                          |
| `FRONTEND_URL`                                        | ✅                       | CORS origin check for upgrade requests                                          |
| `DATABASE_URL`                                        | ✅                       | Persist room state to DB                                                        |
| `HTTP_SERVER_URL`                                     | ✅                       | Internal ticket validation endpoint                                             |
| `INTERNAL_SECRET`                                     | ✅ in production         | Server-to-server ticket validation                                              |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | Optional                 | Distributed limiter and fan-out                                                 |
| `PERIODIC_SAVE_INTERVAL_MS`                           | Optional                 | Periodic save interval (default `15000`)                                        |

> `JWT_SECRET` **throws at startup** if missing.

---

## Health & Metrics

| Method | Path       | Purpose                                                                            |
| ------ | ---------- | ---------------------------------------------------------------------------------- |
| `GET`  | `/live`    | **Liveness.** Process-up only, no I/O. Never 5xx for a reason a restart would fix. |
| `GET`  | `/health`  | **Readiness.** `SELECT 1` against Postgres; 503 when unreachable                   |
| `GET`  | `/metrics` | Active rooms, connections, users, memory                                           |

Point a supervisor's _restart_ policy at `/live` and a load balancer's at
`/health`. They are not interchangeable: `render.yaml` restarts an instance that
fails `/health` for 60 seconds, and on this server a restart discards the
authoritative in-memory `RoomState` for every live room (ADR-002) and drops
every connected client — so a 60-second Postgres blip becomes data loss rather
than degraded service.

## Process-level error handling

- Every `ws` socket gets an `'error'` listener at connect time. `WebSocket` is an
  `EventEmitter` and `emit('error')` with no listener **throws**, so a single
  unparseable frame from one client (e.g. a text frame that is not valid UTF-8,
  which `receiverOnError` reports) would otherwise end the process.
- The `connection` listener is registered synchronously and floats an async
  `handleConnection`, which owns its own `catch`. `ws` is not constructed with
  `{ captureRejections: true }`, so an `async` listener that rejected would
  become an unhandled rejection — the same fatal outcome.
- `http.Server`'s `'error'` is handled explicitly: a bind failure logs
  `ws_http_server_error` and exits 1, which is the only error on this process
  that is meant to be fatal.
- All five sweeps (`heartbeat`, `authorizationSweep`, `periodicSave`,
  `lockSweep`, `reconciliation`) are `unref()`ed. The listening socket keeps the
  process alive; the timers must not be the reason it does.

---

## Testing

```bash
pnpm test     # All tests (Vitest)
```

Protocol, auth, access, reconciliation, persistence, and handler tests live
under `src/__tests__/` and `tests/handlers/`. The default
`src/__tests__/integration.test.ts` is a protocol-model fixture that still
includes legacy `room-state`; the opt-in `production-integration.test.ts` is
the closer current-process seam, but its DB and ticket dependencies are mocked.

---

## Adding a New Message Type

1. Add a Zod schema to `src/validation.ts`
2. Add a handler `case` in the main `switch` statement in `src/index.ts`
3. Write Vitest tests for the new schema under `src/__tests__/` (the current
   suite is not a single `tests/validation.test.ts` file)
4. Update the message protocol table in this file

---

## Common Gotchas

- **ESM only** — `"type": "module"`. Never use `require()`.
- **No `tsx watch`** — the dev server does not auto-reload. Restart it manually.
- **Stale user cleanup** — ungraceful disconnects handled via `ws` `close` event. Heartbeat terminates unresponsive clients every 30s.
- **Room memory** — rooms live in process memory. Restarting clears all rooms.
- **Redis is optional** — pub/sub and the rate limiter fall back to bounded
  process-local state when Redis variables are missing. Redis alone does not
  make room state, tickets, or presence shared; multi-instance operation still
  needs durable shared state and distributed verification.
- **Yjs adapter removed (2026-09-28)** — the dormant adapter gated only reads while writes duplicated every element; ~400 lines deleted across server and client plus the `yjs`/`y-protocols`/`y-websocket` deps. JSON deltas are the only wire protocol; no binary traffic exists.
- **Coordinate validation** — element coords must be finite and within canvas bounds. Zod enforces this.
- **Map-based elements** — `room.elements` is a `Map<string, DriplElement>`. Always use `.set()` / `.get()` / `.delete()` instead of array operations. Convert to array for serialization.
- **Reverse indexes** — `userToRoomMap` and `wsToRoomMap` must be kept in sync on join/leave/heartbeat-cleanup.
