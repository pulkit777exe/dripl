# ws-server — WebSocket Collaboration Server

> Part of the Dripl monorepo. Read the root `CLAUDE.md` first.

---

## What This App Does

`ws-server` is the real-time WebSocket server for Dripl's collaboration feature. It:

- Manages **rooms** — groups of users editing the same canvas
- Syncs **canvas elements** between all users in a room
- Broadcasts **cursor positions** (~30 fps)
- Tracks **user presence** (join/leave events)
- Enforces **rate limiting** per connection
- Validates all incoming **message payloads** with Zod
- Persists the **current room element state** for new joiners

Runs on **port 3001** in development.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Language | TypeScript 5 (ESM) |
| Runtime | Node.js (tsx for dev, compiled JS for prod) |
| WebSocket | `ws` library (RFC 6455) |
| Auth | JWT verification (`jsonwebtoken`) on connect |
| Validation | Zod v4 (all message payloads) |
| Rate Limiting | Token-bucket per connection |
| Testing | Vitest |

---

## Directory Structure

```
apps/ws-server/
├── src/
│   ├── index.ts           # Entry point — WS server, message dispatch, lifecycle
│   ├── types.ts           # Shared interfaces (RoomState, UserConnection, Cursor)
│   ├── auth.ts            # JWT verification (resolveTokenFromUrl, resolveUserFromToken)
│   ├── broadcast.ts       # send(), broadcast(), roomUsersPayload(), roomCursorsPayload()
│   ├── rooms.ts           # Room state Map, element Map ops, DB load/save, scheduleSave
│   ├── rateLimiter.ts     # Token-bucket rate limiting, cleanup interval
│   └── validation.ts      # Zod schemas for all incoming messages
├── tests/
│   └── validation.test.ts # Zod schema unit tests
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

All messages are JSON with a `type` field. The client sends; the server receives, validates, and broadcasts.

### Client → Server

| `type` | Payload | Description |
|---|---|---|
| `join` / `join_room` | `{ roomId, displayName, color }` | Join a collaboration room |
| `leave` / `leave_room` | — | Leave current room |
| `scene-update` | `{ subtype, elements[] }` | Full element array replacement |
| `scene-delta` | `{ added[], updated[], deleted[] }` | Differential element changes |
| `add_element` | `{ element }` | Add a single element |
| `update_element` | `{ element }` | Update a single element |
| `delete_element` | `{ elementId }` | Delete a single element |
| `element-update` | `{ element/elements[] }` | Batch or single element update |
| `cursor-move` / `cursor_move` | `{ x, y, displayName, color }` | Cursor position update |
| `ping` | — | Keepalive ping |

### Server → Client

| `type` | Payload | Description |
|---|---|---|
| `sync_room_state` | `{ roomId, elements[], users[], cursors[] }` | Full room state on join |
| `room-state` | `{ roomId, elements[], users[], cursors[] }` | Full room state (legacy) |
| `scene-update` | `{ subtype, elements[] }` | Broadcasted element array |
| `scene-delta` | `{ added[], updated[], deleted[] }` | Broadcasted delta |
| `user-join` | `{ userId, displayName, color }` | User joined room |
| `user-leave` | `{ userId }` | User left room |
| `cursor_move` | `{ userId, x, y, displayName, color }` | Broadcasted cursor |
| `pong` | `{ timestamp }` | Keepalive response |
| `error` | `{ message }` | Server-side error |

---

## Room State

Each room is stored in a `Map<roomId, RoomState>`:

```typescript
interface RoomState {
  roomId: string;
  elements: Map<string, DriplElement>;  // O(1) element lookups by ID
  users: Map<string, UserConnection>;    // Connected users by userId
  cursors: Map<string, Cursor>;          // Cursor positions by userId
  loadedFromDb: boolean;                 // Lazy DB load flag
  saving: boolean;                       // Prevents overlapping saves
}
```

### Reverse Indexes

Two reverse indexes avoid O(n) scans:

- **`userToRoomMap: Map<userId, roomId>`** — fast room lookup for any userId (heartbeat, diagnostics)
- **`wsToRoomMap: Map<WebSocket, roomId>`** — fast room lookup per WebSocket connection

### Lifecycle

When a new user joins:
1. Server loads elements from DB (lazy, once per room lifetime)
2. Server sends `sync_room_state` + `room-state` with full element array
3. Server broadcasts `user-join` to all existing room members

When a user disconnects (clean or ungraceful):
1. Stale user is removed from `room.users` and reverse indexes updated
2. `user-leave` is broadcast to remaining members
3. Empty rooms tracked via `roomLastEmptyAt` for TTL-based garbage collection

---

## Authentication

Authentication happens at the **WebSocket upgrade** phase (before the connection is established):

```
Client sends WS upgrade request with Authorization: Bearer <JWT>
  └─► auth.ts verifies JWT signature with JWT_SECRET
        └─► attaches userId to the socket context
              └─► invalid token → upgrade rejected (4001)
```

No unauthenticated connections are allowed.

---

## Validation

All incoming message payloads are validated with **Zod schemas** in `src/validation.ts` before any handler logic runs.

**Element bounds are validated** — coordinates must be finite numbers within canvas bounds. Invalid messages are silently dropped.

**Max message size**: 10 MB (enforced by `ws` server `maxPayload`). The application-level `MAX_ELEMENTS_PER_SCENE` limit is 5,000 elements.

---

## Rate Limiting

Each WebSocket connection has a **token-bucket** rate limiter:

- Window: 1 second
- Max: 30 messages per window
- Exceeded connections are closed with code 4000

Stale rate limit entries are cleaned up every 60 seconds.

---

## Element Storage

Elements are stored as a `Map<string, DriplElement>` for O(1) lookups:

| Operation | Before (Array) | After (Map) |
|---|---|---|
| Add element | O(n) filter + push | O(1) set |
| Update element | O(n) map | O(1) set |
| Delete element | O(n) filter | O(1) delete |
| Scene delta merge | O(n) array→Map→Array | O(k) set/delete loop |
| Save to DB | Array spread | Array.from(map.values()) |

When serialized for DB storage or client transmission, the Map is converted to an array via `Array.from(elements.values())`.

---

## Periodic Save

Room state is persisted to DB via two mechanisms:

1. **Debounced save** (`scheduleSave`): 2-second debounce after each element change. Uses recursive `setTimeout` with a `saving` flag to prevent overlapping writes.
2. **Periodic save** (`periodicSave`): Every 15 seconds, saves all active rooms (rooms with users) and garbage-collects empty rooms after 5-minute TTL.

---

## Environment Variables

Loaded from the **root** `.env` via `dotenv -e ../../.env`.

| Variable | Required | Purpose |
|---|---|---|
| `JWT_SECRET` | ✅ | Verify client JWTs on upgrade |
| `WS_PORT` | ✅ | WebSocket server port (default `3001`) |
| `FRONTEND_URL` | ✅ | CORS origin check for upgrade requests |
| `DATABASE_URL` | ✅ | Persist room state to DB |
| `PERIODIC_SAVE_INTERVAL_MS` | Optional | Periodic save interval (default `15000`) |

> `JWT_SECRET` **throws at startup** if missing.

---

## Health & Metrics

- `GET /health` — uptime, version, service name
- `GET /metrics` — active rooms, connections, total users, memory usage (MB)

---

## Testing

```bash
pnpm test     # All tests (Vitest)
```

Unit tests in `tests/validation.test.ts` cover every Zod schema with valid and invalid payloads.

---

## Adding a New Message Type

1. Add a Zod schema to `src/validation.ts`
2. Add a handler `case` in the main `switch` statement in `src/index.ts`
3. Write Vitest tests for the new schema in `tests/validation.test.ts`
4. Update the message protocol table in this file

---

## Common Gotchas

- **ESM only** — `"type": "module"`. Never use `require()`.
- **No `tsx watch`** — the dev server does not auto-reload. Restart it manually.
- **Stale user cleanup** — ungraceful disconnects handled via `ws` `close` event. Heartbeat terminates unresponsive clients every 30s.
- **Room memory** — rooms live in process memory. Restarting clears all rooms.
- **No Redis pub/sub** — currently single-process only. See TODOS #9.
- **Coordinate validation** — element coords must be finite and within canvas bounds. Zod enforces this.
- **Map-based elements** — `room.elements` is a `Map<string, DriplElement>`. Always use `.set()` / `.get()` / `.delete()` instead of array operations. Convert to array for serialization.
- **Reverse indexes** — `userToRoomMap` and `wsToRoomMap` must be kept in sync on join/leave/heartbeat-cleanup.
