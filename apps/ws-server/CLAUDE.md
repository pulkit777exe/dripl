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
│   ├── index.ts           # Entry point — HTTP upgrade → WebSocket server
│   ├── rooms.ts           # Room state management (Map of roomId → RoomState)
│   ├── handlers.ts        # Message dispatch — routes by message type
│   ├── broadcast.ts       # Room-level broadcast helpers
│   ├── validation.ts      # Zod schemas for all incoming messages
│   ├── rateLimiter.ts     # Per-connection token-bucket rate limiter
│   └── auth.ts            # JWT verification on WebSocket upgrade
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

| `type` | `subtype` | Payload | Description |
|---|---|---|---|
| `scene-update` | `update` | `{ elements: Element[] }` | Incremental element changes |
| `cursor-move` | — | `{ x, y, roomId }` | Cursor position update |
| `user-join` | — | `{ roomId, userId, displayName }` | Announce presence |
| `user-leave` | — | `{ roomId, userId }` | Leave room |

### Server → Client

| `type` | `subtype` | Payload | Description |
|---|---|---|---|
| `scene-update` | `init` | `{ elements: Element[] }` | Full element state on join |
| `scene-update` | `update` | `{ elements: Element[], userId }` | Broadcasted element delta |
| `cursor-move` | — | `{ x, y, userId, displayName }` | Broadcasted cursor |
| `user-join` | — | `{ userId, displayName, users: User[] }` | User joined room |
| `user-leave` | — | `{ userId, users: User[] }` | User left room |
| `error` | — | `{ code, message }` | Server-side error response |

### Message Flow

```
Client A sends scene-update (subtype: update)
  └─► ws-server validates payload (Zod)
        └─► rate limiter check (token bucket per connection)
              └─► update room element state in memory
                    └─► broadcast to all clients in room (except sender)
                          └─► Client B, C… receive scene-update (subtype: update)
```

---

## Room State

Each room is stored in a `Map<roomId, RoomState>`:

```typescript
interface RoomState {
  elements: Element[];         // Current canvas element snapshot
  users: Map<userId, UserInfo>; // Connected users
}
```

When a new user joins:
1. Server sends `scene-update` with `subtype: 'init'` containing `room.elements`
2. Server broadcasts `user-join` to all existing room members

When a user disconnects (clean or ungraceful):
1. Stale user is removed from `room.users`
2. `user-leave` is broadcast to remaining members
3. Empty rooms are garbage-collected

---

## Authentication

Authentication happens at the **WebSocket upgrade** phase (before the connection is established):

```
Client sends WS upgrade request with Authorization: Bearer <JWT>
  └─► auth.ts verifies JWT signature with JWT_SECRET
        └─► attaches userId to the socket context
              └─► invalid token → upgrade rejected (401)
```

No unauthenticated connections are allowed.

---

## Validation

All incoming message payloads are validated with **Zod schemas** in `src/validation.ts` before any handler logic runs.

```typescript
// Example
const SceneUpdateSchema = z.object({
  type: z.literal('scene-update'),
  subtype: z.enum(['init', 'update']),
  elements: z.array(ElementSchema).max(10_000),
  roomId: z.string().uuid(),
});
```

**Element bounds are validated** — coordinates must be finite numbers within canvas bounds. Invalid messages are silently dropped with an error response to the sender.

**Max message size**: 10 MB (enforced by the `ws` server options).

---

## Rate Limiting

Each WebSocket connection has its own **token-bucket** rate limiter:

- Refill rate: configurable tokens/second
- Burst capacity: configurable max tokens
- Exceeded connections receive an `error` message and may be disconnected

This prevents a single client from flooding the room with updates.

---

## Environment Variables

Loaded from the **root** `.env` via `dotenv -e ../../.env`.

| Variable | Required | Purpose |
|---|---|---|
| `JWT_SECRET` | ✅ | Verify client JWTs on upgrade |
| `WS_PORT` | ✅ | WebSocket server port (default `3001`) |
| `FRONTEND_URL` | ✅ | CORS origin check for upgrade requests |
| `DATABASE_URL` | Optional | Persist room state to DB (if enabled) |

> `JWT_SECRET` **throws at startup** if missing.

---

## Testing

```bash
pnpm test     # All tests (Vitest)
```

Unit tests in `tests/validation.test.ts` cover every Zod schema with valid and invalid payloads. There are 42+ passing tests.

**Pattern for adding validation tests:**

```typescript
import { describe, it, expect } from 'vitest';
import { SceneUpdateSchema } from '../src/validation';

describe('SceneUpdateSchema', () => {
  it('accepts valid update', () => {
    const result = SceneUpdateSchema.safeParse({
      type: 'scene-update',
      subtype: 'update',
      elements: [],
      roomId: '123e4567-e89b-12d3-a456-426614174000',
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing subtype', () => {
    const result = SceneUpdateSchema.safeParse({ type: 'scene-update' });
    expect(result.success).toBe(false);
  });
});
```

---

## Adding a New Message Type

1. Add a Zod schema to `src/validation.ts`
2. Add a handler function in `src/handlers.ts`
3. Register the handler in the main dispatch `switch` in `src/index.ts`
4. Add broadcast helper in `src/broadcast.ts` if needed
5. Write Vitest tests for the new schema in `tests/validation.test.ts`
6. Update the message protocol table in this file

---

## Common Gotchas

- **ESM only** — `"type": "module"`. Never use `require()`.
- **No `tsx watch`** — the dev server does not auto-reload. Restart it manually after code changes or add `watch` to the dev script.
- **Stale user cleanup** — ungraceful disconnects (network drop) are handled via the `ws` `close` event. The dedup logic runs once; do not add a second cleanup call.
- **Room memory** — rooms live entirely in process memory. Restarting the server clears all rooms. If persistent room state is needed, it must be saved to DB via `@dripl/db`.
- **No Redis pub/sub** — currently single-process only. For horizontal scaling, add Redis pub/sub in `broadcast.ts`.
- **Coordinate validation** — element `x`, `y`, `width`, `height` must all be finite and within the defined canvas bounds. The Zod schemas enforce this; do not skip validation.
- **Type mismatch guard** — `currentRoomId` and `currentUserId` stored on the socket are strings. Compare with strict equality (`===`), never loose (`==`).
