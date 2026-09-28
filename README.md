# Dripl

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen.svg)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue.svg)](https://www.typescriptlang.org)
[![Next.js](https://img.shields.io/badge/Next.js-16-black.svg)](https://nextjs.org)
[![Prisma](https://img.shields.io/badge/Prisma-7-purple.svg)](https://prisma.io)

Real-time collaborative whiteboard with hand-drawn rendering, live cursors, and shareable links.

The current evidence-weighted parity/security assessment is maintained in
[`docs/codebase-audit.md`](docs/codebase-audit.md). It distinguishes implemented,
integrated, tested, runtime-verified, and production-ready behavior; this project
is not yet an Excalidraw-compatible or production-ready replacement. The pinned
Excalidraw v0.18.1 performance comparison and browser-measurement plan are in
[`docs/excalidraw-performance-research.md`](docs/excalidraw-performance-research.md).

---

## Quick Start

### Prerequisites

- Node.js 20+
- pnpm 10+
- PostgreSQL (for local development)

### Installation

```bash
# Install dependencies
pnpm install

# Generate Prisma client
pnpm db:generate

# Run development
pnpm dev
```

Open `http://localhost:3000`

---

## Architecture

### Three-Server Setup

```
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│  dripl-app   │  │http-server  │  │ ws-server   │
│  Next.js 16  │  │  Express 5   │  │    ws      │
│  Port 3000   │  │  Port 3002   │  │ Port 3001   │
└──────┬───────┘  └──────┬───────┘  └──────┬───────┘
       │  REST (cookie)  │                 │  WebSocket (short-lived ticket)
       └─────────────────┼─────────────────┘
                         ▼
                  ┌──────────────┐
                  │ PostgreSQL   │
                  └──────────────┘
```

### Tech Stack

| Layer     | Technology                                    |
| --------- | --------------------------------------------- |
| Frontend  | Next.js 16, React 19, Tailwind CSS 4, Zustand |
| Rendering | RoughJS, HTML5 Canvas, RBush (spatial index)  |
| Backend   | Express 5, WebSocket (ws), Prisma 7           |
| Database  | PostgreSQL                                    |
| Testing   | Vitest + Supertest + Testing Library          |

### Shared Packages

| Package             | Purpose                        |
| ------------------- | ------------------------------ |
| `@dripl/common`     | Shared types, Zod schemas      |
| `@dripl/db`         | Prisma ORM client + migrations |
| `@dripl/element`    | Element factory & rendering    |
| `@dripl/math`       | Geometry & intersection utils  |
| `@dripl/utils`      | Encryption, storage, throttle  |
| `@dripl/test-utils` | Shared test factories          |

### Dependency Graph

```
dripl-app ──► @dripl/common, @dripl/db, @dripl/element, @dripl/math, @dripl/utils
http-server ──► @dripl/common, @dripl/db, @dripl/utils
ws-server   ──► @dripl/common, @dripl/db, @dripl/utils
```

---

## Features

### Canvas Tools

- **Shapes**: Rectangle, ellipse, diamond, arrow, line, text, frame, freedraw, eraser
- **Editing**: Selection, resize, rotate, undo/redo (up to 100 snapshots, also byte-budget bounded)
- **View**: Zoom (+/-), grid toggle, dark/light theme

### Collaboration

- **Real-time sync**: Multiple users can draw simultaneously
- **Remote cursors**: See where others are pointing
- **Presence**: Who's in the room
- **Message subtypes**:
  - `sync_room_state` — Authenticated initial scene and presence
  - `scene-delta` — Coalesced JSON element additions, updates, and deletes
  - `cursor-move` — Real-time cursor positions
  - `user-join` / `user-leave` — Presence updates
  - Reconnect queues are replayed only after the server acknowledges the room sync. Yjs binary traffic is currently disabled; JSON deltas are not a CRDT guarantee.

### Sharing

- **Public links**: Share a canvas via URL. File shares support owner-scoped view/edit capabilities; room capability pages are read-only previews.
- **Permissions**: View/edit access
- **Export**: PNG, SVG, PDF, JSON, and basic `.excalidraw` interchange

### Keyboard Shortcuts

| Key          | Action        |
| ------------ | ------------- |
| V            | Select        |
| R            | Rectangle     |
| E/O          | Ellipse       |
| D            | Diamond       |
| P            | Freehand draw |
| L            | Line          |
| A            | Arrow         |
| T            | Text          |
| F            | Frame         |
| X            | Eraser        |
| H            | Hand (pan)    |
| 1–0          | Select tools  |
| +/-          | Zoom          |
| Ctrl+Z       | Undo          |
| Ctrl+Shift+Z | Redo          |
| Ctrl+Alt+G   | Toggle grid   |

---

## Collaboration Flow

```
User A draws element
        │
        ▼
broadcastElements(prev, next)
        │
        ▼
send({ type: 'scene-delta', added: [...], updated: [...], deleted: [...] })
        │
        ▼
ws-server receives → broadcasts to all clients (except sender)
        │
        ▼
Client B receives → onRemoteElements() → updates canvas
```

**Key Components:**

| Component           | File                                      | Purpose           |
| ------------------- | ----------------------------------------- | ----------------- |
| `useCollaboration`  | `hooks/useCollaboration.ts`               | WebSocket client  |
| `index.ts`          | `ws-server/src/index.ts`                  | Message handling  |
| `validation.ts`     | `ws-server/src/validation.ts`             | Schema validation |
| `CollaboratorsList` | `components/canvas/CollaboratorsList.tsx` | User presence UI  |

---

## Scripts

```bash
pnpm dev          # Start all services
pnpm build        # Build for production
pnpm test         # Run all unit/component tests (DB integration is opt-in)
# The default WS suite boots the real process with two clients (mocked DB);
# only the real-PostgreSQL suites stay opt-in:
RUN_WS_DB_INTEGRATION=true pnpm --filter ws-server test  # Requires migrated PostgreSQL
RUN_DB_INTEGRATION=true pnpm --filter @dripl/db test   # Requires migrated PostgreSQL
pnpm lint         # Lint code
pnpm format       # Format with Prettier
pnpm db:migrate   # Database migrations
```

---

## Development

### Running Individual Services

```bash
cd apps/dripl-app && pnpm dev     # Port 3000
cd apps/http-server && pnpm dev   # Port 3002
cd apps/ws-server && pnpm dev     # Port 3001
```

### Docker

```bash
# Set the required secrets before starting
export JWT_SECRET="a-long-random-secret-at-least-32-characters"
export INTERNAL_SECRET="a-different-long-random-internal-secret"
export GOOGLE_CLIENT_ID="your-oauth-client-id"
export GOOGLE_CLIENT_SECRET="your-oauth-client-secret"

# Apply migrations once the PostgreSQL service is healthy
docker compose up -d postgres
pnpm --filter @dripl/db exec prisma migrate deploy

# Build and start the three application services
docker compose up --build
```

Dockerfiles are located in `docker/` directory. The Compose stack uses the
canonical ports `3000` (Next), `3001` (WebSocket), and `3002` (HTTP). The
`GEMINI_API_KEY` and Upstash variables are optional for local startup but should
be configured for the corresponding production features. The stack does not
replace a managed secret store, TLS termination, or a multi-instance
collaboration deployment.

---

## Database

11 models: User, Team, TeamMember, Folder, File, SharedFile, CanvasRoom, CanvasRoomMember, ShareLink, PasswordResetToken, EmailVerificationToken.

---

## Project Structure

```
dripl/
├── CLAUDE.md                    # Root monorepo guide
├── AGENTS.md                    # Agent configuration
├── TODOS.md                     # Engineering roadmap
├── Problems.md                  # Security audit report
├── DESIGN.md                    # Visual design system
├── PRODUCT.md                   # Product definition
├── CONTRIBUTING.md              # Contributor guidelines
├── apps/
│   ├── dripl-app/       # Next.js frontend (Port 3000)
│   ├── http-server/     # Express REST API (Port 3002)
│   └── ws-server/      # WebSocket server (Port 3001)
├── packages/
│   ├── common/         # Shared types & schemas
│   ├── db/             # Prisma schema & client
│   ├── element/        # Element factory & rendering
│   ├── math/           # Geometry utilities
│   ├── utils/          # Shared utilities
│   └── test-utils/     # Shared test factories
├── tooling/
│   ├── eslint-config/       # Shared ESLint rules
│   └── typescript-config/   # Shared tsconfigs
├── docker/             # Dockerfiles
└── docker-compose.yml  # Local development
```

---

## Known Limitations

See `TODOS.md` for the full engineering roadmap. Key current limitations:

- **Single-process WebSocket server** — room state, short-lived HTTP tickets, and fallback rate-limit state are process-local; no horizontal scaling yet
- **JSON collaboration is not CRDT convergence** — the active wire path uses versioned JSON deltas; Yjs binary sync remains disabled
- **Image storage is local** — authenticated uploads use the configured filesystem directory and capability URLs; no object storage/CDN or image-capability revocation yet
- **Public snapshots are process-local** — links expire and are bounded in one process, but are not durable across instances/restarts
- **WebSocket payload bound** — the active shared message limit is 200 KB; this is a protocol/application bound, not the historical 10 MB claim
- **Deployment evidence is incomplete** — Docker/CI configuration exists, but image builds, live PostgreSQL/Redis, browser QA, and production-scale tests are not verified here

---

## Troubleshooting

### Build fails

```bash
pnpm db:generate
rm -rf .turbo && pnpm build
```

### Dev server won't start

```bash
rm -rf .next
pnpm dev
```

### Type errors

```bash
pnpm build    # Regenerates all packages
```

---

## License

MIT
