# Dripl Architecture

> Collaborative canvas drawing app with real-time multi-user editing. Three-service monorepo: Next.js frontend, Express REST API, WebSocket collaboration server. PostgreSQL for persistence, optional Redis for rate limiting and cross-instance pub/sub.

---

## 1. Tech Stack

| Layer            | Technology            | Version            | Source                                               |
| ---------------- | --------------------- | ------------------ | ---------------------------------------------------- |
| Runtime          | Node.js               | 20                 | `.nvmrc`                                             |
| Package manager  | pnpm                  | 10.33.0            | `package.json`                                       |
| Monorepo tool    | Turborepo             | ^2.9.18            | `package.json` devDeps                               |
| Language         | TypeScript            | ^5.9.3             | `package.json` devDeps                               |
| Frontend         | Next.js (App Router)  | ^16.2.9            | `dripl-app/package.json`                             |
| UI framework     | React                 | ^19.2.7            | `dripl-app/package.json`                             |
| Styling          | Tailwind CSS          | ^4.3.1             | `dripl-app/package.json`                             |
| State management | Zustand               | ^5.0.14            | `dripl-app/package.json`                             |
| Canvas rendering | Rough.js              | ^4.6.6             | `element/package.json`                               |
| Spatial index    | RBush                 | ^4.0.1             | `dripl-app/package.json`                             |
| CRDT sync        | Yjs                   | ^13.6.31           | `dripl-app/package.json`, `ws-server/package.json`   |
| REST API         | Express               | ^5.2.1             | `http-server/package.json`                           |
| WebSocket        | ws                    | ^8.21.0            | `ws-server/package.json`                             |
| ORM              | Prisma                | ^7.8.0             | `db/package.json`                                    |
| Database         | PostgreSQL            | 16                 | `docker-compose.yml`                                 |
| Cache/queue      | Upstash Redis (REST)  | ^1.38.0            | `http-server/package.json`, `ws-server/package.json` |
| Rate limiting    | @upstash/ratelimit    | ^2.0.8             | `http-server/package.json`, `ws-server/package.json` |
| Validation       | Zod                   | ^4.4.3             | `common/package.json`                                |
| Auth (JWT)       | jsonwebtoken          | ^9.0.3             | `utils/package.json`                                 |
| Auth (Google)    | google-auth-library   | ^10.7.0            | `http-server/package.json`                           |
| Email            | Nodemailer            | ^8.0.11            | `http-server/package.json`                           |
| AI               | @google/generative-ai | ^0.24.1            | `dripl-app/package.json`                             |
| Error tracking   | @sentry/nextjs        | ^10.63.0           | `dripl-app/package.json`                             |
| Logging          | pino                  | (via @dripl/utils) | `utils/src/logger.ts`                                |
| Testing          | Vitest                | ^4.1.9             | `package.json` devDeps                               |
| E2E testing      | Playwright            | ^1.61.0            | `dripl-app/package.json` devDeps                     |
| CSS animations   | Framer Motion         | ^12.40.0           | `dripl-app/package.json`                             |
| UI primitives    | Radix UI              | various            | `dripl-app/package.json` (15+ packages)              |

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

| Service       | Port | Role                                                 | State                     |
| ------------- | ---- | ---------------------------------------------------- | ------------------------- |
| `dripl-app`   | 3000 | Frontend, SSR, Server Actions, AI proxy, image proxy | Stateless                 |
| `http-server` | 3002 | REST API, auth, file/folder CRUD, rooms, sharing     | Stateless (DB)            |
| `ws-server`   | 3001 | Real-time collaboration, room state, Yjs sync        | In-memory + Redis pub/sub |

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
│   │   ├── lib/store/      # Zustand store (4 slices + index + helpers)
│   │   ├── renderer/       # InteractiveScene rendering
│   │   ├── workers/        # Web Workers (spatial index, hit testing)
│   │   └── utils/          # Canvas math, export, perf tracing
│   ├── http-server/        # Express 5 REST API
│   │   ├── src/
│   │   │   ├── routes/     # auth, files, folders, rooms, share, images
│   │   │   ├── controllers/# Business logic per resource
│   │   │   ├── middlewares/# authMiddleware, csrfMiddleware
│   │   │   └── services/   # AuthService, FileService, etc.
│   │   └── tests/          # Vitest tests
│   └── ws-server/          # WebSocket collaboration server
│       └── src/
│           ├── index.ts    # Main server: message dispatch, lifecycle
│           ├── auth.ts     # Ticket-based WS auth
│           ├── rooms.ts    # Room state management, DB save
│           ├── broadcast.ts# Local broadcast helpers
│           ├── redis.ts    # Upstash Redis pub/sub
│           ├── validation.ts# Zod schemas for WS messages
│           ├── yjsManager.ts# Yjs document management
│           ├── rateLimiter.ts# Upstash rate limiter
│           └── types.ts    # TypeScript interfaces
├── packages/
│   ├── common/             # Shared types, Zod schemas
│   ├── db/                 # Prisma client, schema, migrations
│   ├── element/            # Element rendering (Rough.js, OffscreenCanvas)
│   ├── math/               # Geometry calculations
│   ├── utils/              # Encryption, auth, env, logger
│   └── test-utils/         # Shared test helpers
├── docker/                 # Dockerfiles for each service
├── docker-compose.yml      # Local dev: Postgres + Redis + all services
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
       ├─► Updates local Y.Doc
       ├─► Sends binary Yjs packet (0x01 prefix + Y.encodeStateAsUpdate)
       └─► Sends JSON scene-delta { added, updated, deleted }
4. ws-server receives message
   ├─► Zod validates payload (validation.ts)
   ├─► Rate limit check (Upstash sliding window)
   ├─► Applies to room.elements Map + Yjs Doc
   ├─► Broadcasts to other clients in room
   ├─► Publishes to Redis (for cross-instance sync)
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
   └─► Returns { userId }
5. ws-server attaches userId to connection, client joins room
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
   ├─► Rate limited (30 req/15m per IP via Upstash)
   ├─► ShareService.resolveShare() validates token + expiry
   └─► Returns file content + permission level

3. Expired link cleanup: runs every 24 hours (http-server/src/index.ts)
   └─► Deletes ShareLink records where expiresAt < now
```

---

## 6. Authentication & Authorization

### Session-Based Auth (http-server)

- **Session cookie:** `dripl-session`, httpOnly, secure, sameSite: `none`, 7-day expiry
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

This is verified in `ws-server/src/auth.ts` (45 lines) and `http-server/src/routes/auth.ts` (lines 470-498, `createInternalRouter()`).

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

| Service          | Purpose                                     | Where Configured                                                  |
| ---------------- | ------------------------------------------- | ----------------------------------------------------------------- |
| Google OAuth     | User authentication                         | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` in http-server         |
| Google Gemini AI | Canvas generation from prompts              | `GEMINI_API_KEY` in dripl-app (`app/api/ai/generate/route.ts`)    |
| Upstash Redis    | Rate limiting (sliding window) + WS pub/sub | `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`              |
| Nodemailer       | Email verification + password reset         | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` in http-server |
| Sentry           | Error monitoring (dripl-app only)           | `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN` in dripl-app `.env.local`  |
| Vercel           | Frontend hosting + serverless               | dripl-app deployed there                                          |
| Render           | Backend hosting (http-server + ws-server)   | `render.yaml` blueprint                                           |

---

## 8. Infrastructure & Deployment

### Local Development

```bash
# Start all services via docker-compose
docker-compose up
# Postgres: localhost:5432, Redis: localhost:6379
# App: localhost:3000, http-server: localhost:3002, ws-server: localhost:3001
```

`docker-compose.yml` defines 5 services: `postgres` (16-alpine), `redis` (7-alpine), `ws-server`, `http-server`, `dripl-app`.

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

`.github/workflows/ci.yml` runs on push to `main` and PRs:

1. **lint** — ESLint across affected packages
2. **build** — TypeScript compilation
3. **test** — Vitest with PostgreSQL service container
4. **type-check** — `tsc --noEmit`

`.github/workflows/keepalive.yml` — Pings both backend `/health` endpoints every 10 minutes to prevent Render spin-down.

### Dockerfiles

4 Dockerfiles in `docker/`:

- `Dockerfile.dripl-app` — Multi-stage, node:20-alpine, port 3000
- `Dockerfile.http-server` — Multi-stage, node:20-alpine, port 3002
- `Dockerfile.ws-server` — Multi-stage, node:20-alpine, port 3001
- `Dockerfile.cloudrun` — Combined http+ws for Cloud Run, port 8080

---

## 9. Key Architectural Decisions

### Dual Data Model in ws-server

The ws-server maintains **two parallel representations** of room state:

1. `Map<string, DriplElement>` — Legacy JSON protocol (used by `scene-update`, `scene-delta`, `element-update` messages)
2. Yjs `Doc` — Binary CRDT protocol (used by binary WebSocket messages)

Both are kept in sync. The server handles both JSON and binary clients simultaneously. This is verified in `ws-server/src/index.ts` lines 248-265 (binary Yjs handling) and the message dispatch switch statement.

### In-Memory Room State

Room state (`elements`, `users`, `cursors`) lives in `Map<string, RoomState>` within a single ws-server process. Redis pub/sub (`redis.ts`) enables cross-instance message forwarding, but room state itself is not shared — it's rebuilt from DB on reconnect.

### Element Canvas Cache

`packages/element/src/staticScene.ts` caches rendered elements in a `WeakMap<DriplElement, CacheEntry>` keyed by element object reference. Cache entries store `OffscreenCanvas` (when available) or `HTMLCanvasElement` with a version number. O(1) invalidation via version comparison. This is the primary rendering performance optimization.

### Zustand Store Slices

The canvas store is split into 4 slices:

- `canvasSlice.ts` (608 lines) — Elements, selection, tools, viewport
- `historySlice.ts` (83 lines) — Undo/redo (full snapshots, max 100)
- `collabSlice.ts` (63 lines) — Room, connection, remote users/cursors
- `uiSlice.ts` (35 lines) — Theme, file metadata, saving status

Plus `helpers.ts` (151 lines), `types.ts` (175 lines), and `index.ts` (20 lines).

### Ticket-Based WS Auth

Chosen over JWT-at-upgrade because:

- http-server owns session state; ws-server doesn't need JWT secret
- One-time tickets prevent replay attacks
- Internal HTTP call allows http-server to control ticket lifecycle

---

## 10. Known Gaps, Tech Debt, and Contradictions

### Active Issues

1. **Full-element serialization on save** — Every DB write serializes the entire `DriplElement[]` array as a JSON string. With 5K elements, this is ~1.5MB per save. No element-level table or partial updates exist.

2. **In-memory room state** — Process restart loses all room state. Redis pub/sub enables message forwarding but not state sharing. Room state is rebuilt from DB on reconnect, but cursor/user presence is lost.

3. **AI rate limit uses client-supplied userId** — The AI generation endpoint (`app/api/ai/generate/route.ts`) accepts userId from the client for rate limiting, which can be bypassed.

4. **`validateMiddleware.ts` is dead code** — `http-server/src/middlewares/validateMiddleware.ts` (42 lines) contains `validateSignup` and `validateLogin` functions that are not imported by any route file. Superseded by Zod schemas in route handlers.

5. **ws-server requires Redis credentials** — `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` are validated at startup (ws-server `index.ts` lines 12-39). Without them, the rate limiter will crash. The graceful fallback only applies to pub/sub, not rate limiting.

6. **CLAUDE.md is stale** — Multiple claims in `CLAUDE.md` are contradicted by the actual code:
   - Claims ws-server uses JWT auth (actually ticket-based)
   - Claims RoughCanvas is 2,332 lines (actually 972)
   - Claims canvas-store.ts is 803 lines (actually a 4-line barrel)
   - Claims `@dripl/dripl` package exists (it doesn't)

### Tech Debt

- **Full-snapshot history** — `historySlice.ts` stores full element arrays for undo. With 5K elements and 100 snapshots, this is ~150MB of JS heap.
- **No binary WS protocol for element data** — JSON serialization for `scene-update`/`scene-delta` messages. Yjs binary protocol is used but runs alongside JSON, not instead of it.
- **Single-file route modules** — `http-server/src/routes/auth.ts` is 498 lines. Could be split by concern (register, login, OAuth, password reset, ticket).

---

## 11. How to Verify This Document

| Claim                            | Verification                                                                                 |
| -------------------------------- | -------------------------------------------------------------------------------------------- |
| Next.js ^16.2.9                  | `apps/dripl-app/package.json` line: `"next": "^16.2.9"`                                      |
| React ^19.2.7                    | `apps/dripl-app/package.json` line: `"react": "^19.2.7"`                                     |
| Express ^5.2.1                   | `apps/http-server/package.json` line: `"express": "^5.2.1"`                                  |
| Prisma ^7.8.0                    | `packages/db/package.json` line: `"@prisma/client": "^7.8.0"`                                |
| WS auth is ticket-based          | `apps/ws-server/src/auth.ts` lines 16-44                                                     |
| CSRF on logout                   | `apps/http-server/src/app.ts` line: `app.use('/api/auth/logout', validateCsrfToken)`         |
| Sentry only in dripl-app         | `apps/dripl-app/sentry.client.config.ts` (9 lines), no sentry files in http-server/ws-server |
| OffscreenCanvas in element cache | `packages/element/src/staticScene.ts` line 291: `typeof OffscreenCanvas !== 'undefined'`     |
| Redis pub/sub implemented        | `apps/ws-server/src/redis.ts` (71 lines)                                                     |
| Pino logger                      | `packages/utils/src/logger.ts` (22 lines)                                                    |
| RoughCanvas is 972 lines         | `wc -l apps/dripl-app/components/canvas/RoughCanvas.tsx` → 972                               |
| staticScene.ts is 358 lines      | `wc -l packages/element/src/staticScene.ts` → 358                                            |
| ws-server index.ts is 950 lines  | `wc -l apps/ws-server/src/index.ts` → 950                                                    |
| No @dripl/dripl package          | `ls packages/` → common, db, element, math, test-utils, utils                                |
| Keepalive cron exists            | `.github/workflows/keepalive.yml` — `*/10 * * * *` schedule                                  |

---

> Last verified: 2026-07-02, against commit `07aadec`
