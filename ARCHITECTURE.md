# Dripl Architecture

> **Partially archived architecture note.** The service boundaries remain
> useful, but several version, line-count, package, and Yjs claims below are
> historical. The current source manifests and
> [`docs/codebase-audit.md`](docs/codebase-audit.md) are authoritative.

---

## 1. Tech Stack

| Layer            | Technology            | Version          | Source                            |
| ---------------- | --------------------- | ---------------- | --------------------------------- |
| Runtime          | Node.js               | 20               | `.nvmrc`                          |
| Package manager  | pnpm                  | 10.33.0          | `package.json`                    |
| Monorepo tool    | Turborepo             | ^2.11.4          | `package.json` devDeps            |
| Language         | TypeScript            | ^5.9.3           | workspace manifests               |
| Frontend         | Next.js (App Router)  | ^16.3.6          | `dripl-app/package.json`          |
| UI framework     | React                 | ^19.3.0          | `dripl-app/package.json`          |
| Styling          | Tailwind CSS          | ^4.3.3           | `dripl-app/package.json`          |
| State management | Zustand               | ^5.0.15          | `dripl-app/package.json`          |
| Canvas rendering | Rough.js              | ^4.6.6           | `element/package.json`            |
| Spatial index    | RBush                 | ^4.0.1           | `dripl-app/package.json`          |
| CRDT adapter     | Yjs                   | ^13.6.33         | dependency present; wire disabled |
| REST API         | Express               | ^5.2.1           | `http-server/package.json`        |
| WebSocket        | ws                    | ^8.21.3          | `ws-server/package.json`          |
| ORM              | Prisma                | ^7.10.0          | `db/package.json`                 |
| Database         | PostgreSQL            | 16               | `docker-compose.yml`              |
| Cache/queue      | Upstash Redis (REST)  | ^1.39.0          | HTTP/WS manifests                 |
| Rate limiting    | @upstash/ratelimit    | ^2.2.0           | HTTP/WS manifests                 |
| Validation       | Zod                   | ^4.6.5           | `common/package.json`             |
| Auth (JWT)       | jsonwebtoken          | ^9.0.3           | `utils/package.json`              |
| Auth (Google)    | google-auth-library   | ^10.9.1          | `http-server/package.json`        |
| Email            | Nodemailer            | ^9.1.1           | `http-server/package.json`        |
| AI               | @google/generative-ai | ^0.24.1          | `dripl-app/package.json`          |
| Error tracking   | @sentry/nextjs        | ^10.75.3         | `dripl-app/package.json`          |
| Logging          | pino                  | via @dripl/utils | `utils/src/logger.ts`             |
| Testing          | Vitest                | ^4.1.11          | workspace manifests               |
| E2E testing      | Playwright            | ^1.63.0          | `dripl-app/package.json` devDeps  |
| CSS animations   | Framer Motion         | ^12.43.0         | `dripl-app/package.json`          |
| UI primitives    | Radix UI              | various          | `dripl-app/package.json`          |

---

## 2. High-Level Architecture

```
                    ┌──────────────────────────────────┐
                    │     dripl-app (Next.js 16)        │
                    │     Port 3000                     │
                    │     SSR + Server Actions + AI     │
                    └────────┬─────────────┬────────────┘
                             │ REST        │ WebSocket
                             ▼             ▼
              ┌──────────────────┐  ┌──────────────────┐
              │  http-server      │  │  ws-server        │
              │  Express 5        │  │  ws library       │
              │  Port 3002        │  │  Port 3001        │
              └────────┬─────────┘  └────────┬─────────┘
                       │                     │
                       └─────────┬───────────┘
                                 ▼
                    ┌──────────────────────┐
                    │  PostgreSQL 16        │
                    │  Prisma ORM           │
                    │  + Upstash Redis      │
                    │    (optional)         │
                    └──────────────────────┘
```

### Services

| Service       | Port | Role                                                      | State                              |
| ------------- | ---- | --------------------------------------------------------- | ---------------------------------- |
| `dripl-app`   | 3000 | Frontend, SSR, Server Actions, AI proxy, image proxy      | Stateless                          |
| `http-server` | 3002 | REST API, auth, file/folder CRUD, rooms, sharing          | Stateless (DB)                     |
| `ws-server`   | 3001 | Real-time collaboration, room state, optional Yjs adapter | In-memory + optional Redis fan-out |

### Shared Packages

| Package             | Purpose                                          | Consumers                               |
| ------------------- | ------------------------------------------------ | --------------------------------------- |
| `@dripl/common`     | Zod schemas, shared types, constants             | All 3 apps                              |
| `@dripl/db`         | Prisma client + migrations                       | http-server, ws-server, dripl-app (SSR) |
| `@dripl/element`    | Element factory, Rough.js rendering, image cache | dripl-app                               |
| `@dripl/math`       | Geometry, intersection, hit detection            | dripl-app                               |
| `@dripl/utils`      | Encryption, JWT auth, env, logging (pino)        | All 3 apps                              |
| `@dripl/test-utils` | Shared test utilities                            | Internal only                           |

---

## 3. Codemap

```
dripl/
├── apps/
│   ├── dripl-app/          # Next.js 16 frontend
│   │   ├── app/            # App Router pages & API routes
│   │   ├── actions/        # Server Actions (auth, files, canvas)
│   │   ├── components/     # React components
│   │   │   └── canvas/     # Canvas UI (RoughCanvas, StaticCanvas, etc.)
│   │   ├── hooks/          # React hooks (useCollaboration, useDrawingTools, etc.)
│   │   ├── lib/store/      # Zustand slices (canvas, history, collab, UI) + helpers
│   │   ├── renderer/       # InteractiveScene rendering
│   │   └── utils/          # Canvas math, export, perf tracing
│   ├── http-server/        # Express 5 REST API
│   │   ├── src/
│   │   │   ├── routes/     # auth, files, folders, rooms, share, images (validation + response mapping)
│   │   │   ├── middlewares/# authMiddleware, csrfMiddleware
│   │   │   └── services/   # AuthService, FileService, etc.
│   │   └── tests/          # Vitest tests
│   └── ws-server/          # WebSocket collaboration server
│       └── src/
│           ├── index.ts    # Entry point: bootstrap, dispatch, sweeps, shutdown
│           ├── sceneMutation.ts # Element acceptance, capacity, remote-apply
│           ├── handlers/   # cursorMove, locks, presence handlers + types
│           ├── auth.ts     # Ticket-based WS auth
│           ├── rooms.ts    # Room state management, DB save
│           ├── roomAccess.ts # Room access policy
│           ├── broadcast.ts# Local broadcast helpers
│           ├── redis.ts    # Upstash Redis pub/sub
│           ├── validation.ts# Zod message schemas (element wire format owned by @dripl/common)
│           ├── rateLimiter.ts# Upstash rate limiter
│           ├── env.ts      # Env validation
│           ├── logger.ts   # Structured logger
│           └── types.ts    # TypeScript interfaces
├── packages/
│   ├── common/             # Shared types, Zod schemas
│   ├── db/                 # Prisma client, schema, migrations
│   ├── element/            # Element rendering (Rough.js, OffscreenCanvas)
│   ├── math/               # Geometry calculations
│   ├── utils/              # Encryption, auth, env, logger
│   └── test-utils/         # Shared test helpers
├── docker/                 # Dockerfiles for each service
├── docker-compose.yml      # Local dev: Postgres + three application services
├── scripts/                # Build & deploy scripts
└── tooling/                # Shared ESLint & TypeScript configs
```

---

## 4. Data Model

Source: `packages/db/prisma/schema.prisma`

**Database:** PostgreSQL 16

### Core Models

| Model                    | Purpose                      | Key Fields                                                                                           |
| ------------------------ | ---------------------------- | ---------------------------------------------------------------------------------------------------- |
| `User`                   | Authenticated user           | id, email (unique), name, password (bcrypt), image, emailVerified                                    |
| `Team`                   | Multi-user workspace         | id, name, slug (unique)                                                                              |
| `TeamMember`             | Team membership              | userId, teamId, role (MEMBER/ADMIN). Unique: [userId, teamId]                                        |
| `Folder`                 | Canvas folder                | id, name, parentId (self-ref), teamId, userId                                                        |
| `File`                   | Canvas file with elements    | id, name, content (JSON string, default "[]"), shareToken, sharePermission, folderId, teamId, userId |
| `CanvasRoom`             | Real-time collaboration room | id, slug (unique), name, ownerId, content (JSON string), isPublic                                    |
| `CanvasRoomMember`       | Room membership              | roomId, userId, role (EDITOR/VIEWER). Unique: [roomId, userId]                                       |
| `ShareLink`              | Time-limited share link      | token (unique), roomId, permission, expiresAt, createdById                                           |
| `SharedFile`             | File sharing                 | fileId, userId. Unique: [fileId, userId]                                                             |
| `PasswordResetToken`     | Password reset flow          | token (unique), email, expiresAt                                                                     |
| `EmailVerificationToken` | Email verification           | token (unique), email, expiresAt                                                                     |

### Key Relationships

```
User ──1:N──► File, Folder, CanvasRoom, TeamMember
Team ──1:N──► TeamMember, File, Folder
CanvasRoom ──1:N──► CanvasRoomMember, ShareLink
File ──1:N──► SharedFile
Folder ──self-ref──► Folder (parent/children)
```

### Storage Pattern

Canvas elements are stored as **JSON strings** in `File.content` and `CanvasRoom.content` columns (PostgreSQL `String` type). Each save serializes the full `DriplElement[]` array. No element-level table exists.

---

## 5. Request / Data Flow

### Flow 1: User Draws an Element

```
1. PointerDown → createDraftElement() in canvas store
2. PointerMove → updateDraftElement() (60fps via RAF)
3. PointerUp → commitDraft()
   ├─► Adds element to Zustand store (elements[], elementsById Map)
   ├─► pushHistory() for undo (full snapshot, max 100)
   ├─► invalidateElementCache() for Rough.js canvas cache
   └─► broadcastElements() in useCollaboration hook
       ├─► Updates local state; the Yjs adapter is currently disabled on the wire
       └─► Sends JSON scene-delta { added, updated, deleted }
4. ws-server receives message
   ├─► Zod validates payload (validation.ts)
   ├─► Rate limit check (Upstash when configured, bounded local fallback)
   ├─► Applies to room.elements Map
   ├─► Broadcasts to other clients in room
   ├─► Publishes to Redis when configured (fan-out, not shared state)
   └─► Schedules debounced DB save (2s)
5. Periodic save (every 15s) writes full elements array to PostgreSQL
```

### Flow 2: WebSocket Authentication

```
1. Client calls POST /api/auth/ws-ticket (with session cookie)
   ├─► http-server generates UUID, stores in wsTicketStore (in-memory Map)
   ├─► TTL: 30 seconds
   └─► Returns { ticket }
2. Client opens WebSocket: ws://...?ticket=<uuid>
3. ws-server resolveTicketFromUrl() extracts ticket from query string
4. ws-server validateTicket() → POST http://<HTTP_SERVER_URL>/internal/validate-ticket
   ├─► Sends X-Internal-Secret header
   ├─► http-server verifies INTERNAL_SECRET, looks up ticket
   ├─► Deletes ticket from wsTicketStore (one-time use)
   └─► Returns a user principal or a scoped file-share principal
5. ws-server attaches the verified principal, and the client joins a room
```

### Flow 3: File Share Link

```
1. Owner creates share: POST /api/files/:id/share
   ├─► Requires authMiddleware + CSRF token
   ├─► Generates crypto.randomBytes(24) token
   ├─► Stores in File.shareToken, sets expiry
   └─► Returns { shareUrl: /share/<token> }

2. Recipient visits: GET /api/share/:token
   ├─► No auth required (public route)
   ├─► Rate limited (30 req/15m per IP via Upstash when configured, bounded local fallback)
   ├─► ShareService.resolveShare() validates token + expiry
   └─► Returns file content + permission level

3. Expired link cleanup: runs every 24 hours (http-server/src/index.ts)
   └─► Deletes ShareLink records where expiresAt < now
```

---

## 6. Authentication & Authorization

### Session-Based Auth (http-server)

- **Session cookie:** `dripl-session`, httpOnly, with environment-dependent `secure`/`sameSite` settings and a 7-day expiry
- **JWT signing:** `jsonwebtoken` with `JWT_SECRET`
- **JWT payload:** `{ userId }`
- **Middleware:** `authMiddleware` reads from cookie or `Authorization: Bearer` header, calls `verifyToken()` from `@dripl/utils/auth`
- **CSRF protection:** Double-submit cookie pattern. `csrf-token` cookie (not httpOnly) compared with `x-csrf-token` header via `crypto.timingSafeEqual`. Safe methods (GET/HEAD/OPTIONS) exempted.

### Ticket-Based WebSocket Auth

The WS server does **not** use JWT. Instead:

1. Client gets a one-time ticket from http-server (requires session cookie)
2. Client connects to WS with ticket in query string
3. WS server validates ticket via internal HTTP call to http-server
4. Both services share `INTERNAL_SECRET` for server-to-server auth

This is implemented in `ws-server/src/auth.ts` and
`http-server/src/routes/auth.ts:354-379` (`createInternalRouter()`). Ticket
storage remains process-local.

### Google OAuth

- **Initiation:** `GET /api/auth/google` sets `oauth_state` cookie (httpOnly, 10min), redirects to Google consent screen
- **Callback:** `GET /api/auth/google/callback` validates state, exchanges code for tokens, verifies ID token via `google-auth-library`, creates/finds user
- **Client-side:** `@react-oauth/google` for button rendering

### Authorization Patterns

- **IDOR protection:** File operations check `file.userId === req.userId`
- **Room members:** `CanvasRoomMember` table controls access to collaboration rooms
- **Share links:** Separate public read route vs. authenticated write routes

---

## 7. External Dependencies & Integrations

| Service          | Purpose                                                      | Where Configured                                                                                 |
| ---------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| Google OAuth     | User authentication                                          | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` in http-server                                        |
| Google Gemini AI | Canvas generation from prompts                               | `GEMINI_API_KEY` in dripl-app (`app/api/ai/generate/route.ts`)                                   |
| Upstash Redis    | Rate limiting (sliding window) + WS pub/sub                  | `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`                                             |
| Nodemailer       | Email verification + password reset                          | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` in http-server                                |
| Sentry           | Error monitoring (frontend and optional server integrations) | `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN` in app env; HTTP/WS manifests also include `@sentry/node` |
| Vercel           | Frontend hosting + serverless                                | dripl-app deployed there                                                                         |
| Render           | Backend hosting (http-server + ws-server)                    | `render.yaml` blueprint                                                                          |

---

## 8. Infrastructure & Deployment

### Local Development

```bash
# Start all services via docker compose
docker compose up
# Postgres: localhost:5432
# App: localhost:3000, http-server: localhost:3002, ws-server: localhost:3001
```

`docker-compose.yml` currently defines 4 services: `postgres` (16-alpine),
`ws-server`, `http-server`, and `dripl-app`. Upstash Redis is optional
external configuration, not a local Compose service.

### Production Deployment

**Vercel** (dripl-app):

- Framework: Next.js (auto-detected)
- Root directory: `apps/dripl-app`
- Serverless functions for API routes

**Render** (http-server + ws-server):

- `render.yaml` defines two web services
- Both build from monorepo root with `pnpm install --frozen-lockfile`
- Health check at `/health`
- Auto-deploy on push

**Database:**

- PostgreSQL 16 (Render managed, Supabase, or Neon)
- Prisma migrations via `pnpm db:migrate`

### CI/CD

`.github/workflows/ci.yml` runs four independent jobs on pushes to `main` and pull requests:

1. **lint** — ESLint across affected packages
2. **build** — TypeScript compilation
3. **test** — Vitest with the PostgreSQL service container
4. **type-check** — `tsc --noEmit`

`.github/workflows/keepalive.yml` — Pings both backend `/health` endpoints every 10 minutes to prevent Render spin-down.

### Dockerfiles

4 Dockerfiles in `docker/`:

- `Dockerfile.dripl-app` — Multi-stage, node:20-alpine, port 3000
- `Dockerfile.http-server` — Multi-stage, node:20-alpine, port 3002
- `Dockerfile.ws-server` — Multi-stage, node:20-alpine, port 3001
- `Dockerfile.cloudrun` — Optional/unverified Cloud Run path; no production topology or image-build evidence is claimed

---

## 9. Key Architectural Decisions

### Yjs Adapter Removed from ws-server

The ws-server previously retained a Yjs adapter alongside the active JSON room
map behind `YJS_WIRE_ENABLED = false`. The flag gated only reads while the
write path duplicated every element into a `Y.Doc`, so the adapter was removed
outright (2026-09-28, ~400 lines across server and client, plus the `yjs`,
`y-protocols`, and `y-websocket` dependencies). The server does **not** handle
binary clients or claim CRDT wire convergence. JSON
`scene-update`/`scene-delta` messages are authoritative. Reintroducing Yjs is
a protocol project, not a flag flip.

### In-Memory Room State

Room state (`elements`, `users`, `cursors`) lives in `Map<string, RoomState>` within a single ws-server process. Redis pub/sub (`redis.ts`) enables cross-instance message forwarding, but room state itself is not shared; a new process or a different instance loads persisted elements from the database, while live presence and cursors remain process-local.

### Element Canvas Cache

`packages/element/src/staticScene.ts` caches rendered elements in a `WeakMap<DriplElement, CacheEntry>` keyed by element object reference. Cache entries store `OffscreenCanvas` (when available) or `HTMLCanvasElement` with a version number. O(1) invalidation via version comparison. This is the primary rendering performance optimization.

### Zustand Store Slices

The canvas store is split into 4 slices:

- `canvasSlice.ts` (current ~745 lines) — Elements, selection, tools, viewport
- `historySlice.ts` (current ~85 lines) — Undo/redo (snapshot/byte-budget bounded)
- `collabSlice.ts` (current ~63 lines) — Room, connection, remote users/cursors
- `uiSlice.ts` (current ~35 lines) — Theme, file metadata, saving status

Plus `helpers.ts` (~180 lines), `types.ts` (~203 lines), and `index.ts` (~20 lines).

### Ticket-Based WS Auth

Chosen over JWT-at-upgrade because:

- http-server owns session state; the WS connection uses a ticket, although the
  current WS env schema still validates `JWT_SECRET` for compatibility
- One-time tickets prevent replay attacks
- Internal HTTP call allows http-server to control ticket lifecycle

---

## 10. Known Gaps, Tech Debt, and Contradictions

### Active Issues

1. **Full-element serialization on save** — Every DB write serializes the entire `DriplElement[]` array as a JSON string. A 5K-element payload may be large, but its exact size and write cost are workload-dependent and were not measured here. No element-level table or partial updates exist.

2. **In-memory room state** — Process restart loses all room state. Redis pub/sub enables message forwarding but not state sharing. A new process or different instance loads persisted elements from the database, while cursor/user presence is lost.

3. **Documentation drift remains** — this file and the app-level guides retain
   archived line counts and package references. Current source facts
   (verified 2026-09-27 with `wc -l`):
   - `RoughCanvas.tsx` is 923 lines after extracting `useSpatialIndex`, and remains an orchestrator
   - `packages/element/src/staticScene.ts` is 918 lines
   - the canvas store is split under `apps/dripl-app/lib/store/`
   - `@dripl/dripl` does not exist
   - `ws-server/src/index.ts` is an 895-line composition root (re-verified
     2026-10-02, replacing the ~1,600 figure recorded in this block on
     2026-09-27), not the historical 668/737-line monolith description. It
     delegates per-message cases to `apps/ws-server/src/handlers/`, but
     registration, join/leave, and scene sync remain inline.

### Resolved Issues (Fixed)

4. ~~**AI rate limit uses client-supplied userId**~~ — Fixed. Now reads `dripl-session` cookie (commit `d70b145`).

5. ~~**`validateMiddleware.ts` is dead code**~~ — Removed (commit `974751f`).

6. ~~**ws-server requires Redis credentials**~~ — Redis now optional. Rate limiter falls back to in-memory token bucket (commit `07a9733`).

### Tech Debt

- **Full-snapshot history** — `historySlice.ts` stores full element arrays for undo. It has a count limit and a coarse 10 MB byte budget; actual serialized/object memory is not measured here.
- **Yjs binary protocol is not active** — JSON `scene-update`/`scene-delta` is the wire path; a dormant adapter remains for future work.
- **Large auth route module** — `http-server/src/routes/auth.ts` is currently about 380 lines. Could be split by concern (register, login, OAuth, password reset, ticket).

---

## 11. How to Verify This Document

| Claim                            | Verification                                                                                                      |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Next.js ^16.3.6                  | `apps/dripl-app/package.json`                                                                                     |
| React ^19.3.0                    | `apps/dripl-app/package.json`                                                                                     |
| Express ^5.2.1                   | `apps/http-server/package.json`                                                                                   |
| Prisma ^7.10.0                   | `packages/db/package.json`                                                                                        |
| WS auth is ticket-based          | `apps/ws-server/src/auth.ts` lines 16-44                                                                          |
| CSRF on logout                   | `apps/http-server/src/app.ts` line: `app.use('/api/auth/logout', validateCsrfToken)`                              |
| Sentry configuration             | `apps/dripl-app/sentry.client.config.ts` plus optional server initialization in `app.ts`/`ws-server/src/index.ts` |
| OffscreenCanvas in element cache | `packages/element/src/staticScene.ts:320-323` (`typeof OffscreenCanvas !== 'undefined'`)                          |
| Redis pub/sub implemented        | `apps/ws-server/src/redis.ts` (current ~83 lines)                                                                 |
| Pino logger                      | `packages/utils/src/logger.ts` (22 lines)                                                                         |
| RoughCanvas is 923 lines         | `wc -l apps/dripl-app/components/canvas/RoughCanvas.tsx` (verified 2026-09-27)                                    |
| staticScene.ts is 918 lines      | `wc -l packages/element/src/staticScene.ts` (verified 2026-09-27)                                                 |
| ws-server index.ts is 895 lines  | `wc -l apps/ws-server/src/index.ts` (verified 2026-10-02; supersedes the ~1,600 figure recorded here 2026-09-27)  |
| No @dripl/dripl package          | `ls packages/` → common, db, element, math, test-utils, utils                                                     |
| Keepalive cron exists            | `.github/workflows/keepalive.yml` — `*/10 * * * *` schedule                                                       |

---

> Last static source reconciliation: 2026-09-25. Runtime/build claims in
> older review material are historical unless explicitly marked as unverified.
