# Dripl — Repository Context

## Purpose

Dripl is a **real-time collaborative whiteboard application** (similar to Excalidraw) built as a Turborepo monorepo. It allows users to draw, design, and collaborate on shared canvases with live cursors, element synchronization, and shareable links.

**Tech stack**: Next.js 16, Express 5, WebSocket (ws), Prisma 7, PostgreSQL (Neon), Redis (optional), React 19, TypeScript, Tailwind CSS, roughjs (hand-drawn rendering), Zustand (client state).

## Directory Structure

```
dripl/
├── .env                          # Root env file (single source of truth)
├── .env.example                  # Template for new developers
├── package.json                  # Root workspace config + scripts
├── pnpm-workspace.yaml           # pnpm workspace definition
├── turbo.json                    # Turborepo task orchestration
├── tsconfig.json                 # Root TypeScript config
│
├── apps/
│   ├── dripl-app/                # Next.js frontend (port 3000)
│   │   ├── app/                  # Next.js App Router pages
│   │   │   ├── canvas/           # Canvas pages (local + room modes)
│   │   │   ├── dashboard/        # File management dashboard
│   │   │   ├── board/[token]/    # Shared canvas view (public links)
│   │   │   ├── login/            # Auth pages
│   │   │   ├── signup/
│   │   │   ├── api/              # API routes (AI generation, sharing)
│   │   │   └── context/          # Auth context provider
│   │   ├── components/           # React components
│   │   │   ├── canvas/           # Canvas UI (toolbar, topbar, share modal)
│   │   │   └── dashboard/        # File browser component
│   │   ├── hooks/                # Custom React hooks (useCollaboration, useDrawingTools, etc.)
│   │   ├── lib/                  # API client, canvas store, reconciliation
│   │   └── utils/                # Tool handlers, shape utilities
│   │
│   ├── http-server/              # Express REST API (port 3002)
│   │   └── src/
│   │       ├── controllers/      # User, File, Room, Team controllers
│   │       ├── routes/           # Route definitions
│   │       ├── middlewares/      # Auth middleware, validation
│   │       └── server.ts         # Express app entry point
│   │
│   └── ws-server/                # WebSocket server (port 3003)
│       └── src/
│           ├── index.ts          # WebSocket server + room management
│           ├── redis.ts          # Redis pub/sub for multi-instance
│           └── validation.ts     # Zod message schemas
│
├── packages/
│   ├── common/                   # @dripl/common — shared types & schemas
│   │   └── src/
│   │       ├── types/            # DriplElement, User type definitions
│   │       ├── schemas.ts        # Zod validation schemas
│   │       ├── constants.ts      # Shape definitions, defaults
│   │       └── actions.ts        # Canvas action types
│   │
│   ├── db/                       # @dripl/db — Prisma ORM
│   │   ├── src/index.ts          # PrismaClient singleton (with pg adapter)
│   │   └── prisma/
│   │       ├── schema.prisma     # Database schema (8 models)
│   │       └── migrations/       # 4 migration sets
│   │
│   ├── dripl/                    # @dripl/dripl — shared React component library
│   │   └── src/                  # Canvas components, hooks, panels, toolbar
│   │
│   ├── element/                  # @dripl/element — element factory & rendering
│   │   └── src/
│   │       ├── factory.ts        # createElement() for all shape types
│   │       ├── renderer.ts       # Canvas 2D rendering
│   │       ├── rough-renderer.ts # roughjs hand-drawn rendering
│   │       └── ShapeCache.ts     # Shape caching for performance
│   │
│   ├── math/                     # @dripl/math — geometry & collision
│   │   └── src/
│   │       ├── geometry.ts       # Bounds, distance, rotation
│   │       ├── intersection.ts   # Point-in-element, element-segment
│   │       ├── hit-detection.ts  # Spatial indexing (RBush)
│   │       └── collision.ts      # Element-element collision
│   │
│   ├── runtime/                  # @dripl/runtime — state management
│   │   └── src/
│   │       ├── store.ts          # TanStack Store-based canvas state
│   │       ├── snapshot.ts       # Snapshot creation/cloning
│   │       ├── capture.ts        # History capture logic
│   │       └── store-delta.ts    # Delta operations for sync
│   │
│   └── utils/                    # @dripl/utils — encryption, storage, URL
│       └── src/
│           ├── storage/          # LocalStorage/IndexedDB adapters
│           └── encryption/       # Crypto utilities, URL encoding
│
└── tooling/
    └── typescript-config/        # Shared TS configs (base, nextjs, react-library)
```

## Key Files & Responsibilities

### Entry Points

| File                                            | Purpose                                                                                            |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `apps/dripl-app/app/layout.tsx`                 | Next.js root layout — fonts (DM Serif Display, Source Sans 3, Caveat), ThemeProvider, AuthProvider |
| `apps/dripl-app/app/canvas/[roomSlug]/page.tsx` | Collaborative canvas page — initializes CanvasBootstrap in room mode                               |
| `apps/dripl-app/app/canvas/page.tsx`            | Local canvas page — initializes CanvasBootstrap in local mode                                      |
| `apps/dripl-app/app/dashboard/page.tsx`         | File management dashboard — lists rooms, create/delete/rename                                      |
| `apps/dripl-app/app/board/[token]/page.tsx`     | Public shared canvas view — loads from share token, respects permissions                           |
| `apps/http-server/src/server.ts`                | Express REST API — auth, CRUD for users/files/rooms                                                |
| `apps/ws-server/src/index.ts`                   | WebSocket collaboration server — room management, real-time sync, Redis pub/sub                    |

### Core Libraries

| File                                                   | Purpose                                                                                    |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| `apps/dripl-app/hooks/useCollaboration.ts`             | WebSocket connection hook — joins rooms, broadcasts elements/cursors, handles reconnection |
| `apps/dripl-app/hooks/useDrawingTools.ts`              | Drawing tool hook — handles pointer events for all shape types                             |
| `apps/dripl-app/lib/canvas-store.ts`                   | Canvas state store — elements, selection, zoom, pan, history                               |
| `apps/dripl-app/components/canvas/CanvasBootstrap.tsx` | Canvas initializer — local (localStorage) vs room (WebSocket) mode                         |
| `apps/dripl-app/components/canvas/RoughCanvas.tsx`     | Main canvas renderer — roughjs rendering, selection, resize, rotate, eraser                |
| `packages/common/src/schemas.ts`                       | Zod schemas for all element types (validation)                                             |
| `packages/db/prisma/schema.prisma`                     | Database schema — User, Team, File, CanvasRoom, ShareLink models                           |
| `packages/element/src/factory.ts`                      | Element factory — creates typed DriplElement instances                                     |
| `packages/runtime/src/store.ts`                        | TanStack Store — reactive canvas state with history                                        |

### Configuration

| File                                  | Purpose                                                                |
| ------------------------------------- | ---------------------------------------------------------------------- |
| `package.json`                        | Root workspace definition, pnpm scripts (dev, build, test, db:migrate) |
| `turbo.json`                          | Turborepo task config — build ordering, dev persistence, test caching  |
| `tooling/typescript-config/base.json` | Base TS config — NodeNext module, strict mode                          |
| `.env`                                | Root environment variables (single source of truth)                    |

## Database Schema

**8 models** in PostgreSQL:

| Model              | Purpose                                                   |
| ------------------ | --------------------------------------------------------- |
| `User`             | Authenticated users (email, password, name)               |
| `Team`             | Collaborative teams with slug                             |
| `TeamMember`       | User-team membership (OWNER/ADMIN/MEMBER)                 |
| `Folder`           | Hierarchical folder structure                             |
| `File`             | Canvas files with content (JSON), sharing fields          |
| `SharedFile`       | File sharing junction table                               |
| `CanvasRoom`       | Real-time collaborative rooms (slug, content, isPublic)   |
| `CanvasRoomMember` | Room membership junction                                  |
| `ShareLink`        | Time-limited share tokens (VIEW/EDIT permissions, expiry) |

## Installation & Setup

```bash
# 1. Install dependencies
pnpm install

# 2. Set up environment
cp .env.example .env
# Edit .env with your DATABASE_URL, JWT_SECRET, etc.

# 3. Generate Prisma client
pnpm db:generate

# 4. Run database migrations
pnpm db:migrate

# 5. Start all services (3 servers)
pnpm dev
# - dripl-app:    http://localhost:3000
# - http-server:  http://localhost:3002
# - ws-server:    ws://localhost:3003
```

### Required Services

- **PostgreSQL** — configured via `DATABASE_URL` (uses Neon cloud by default)
- **Redis** (optional) — configured via `REDIS_URL`. Without Redis, ws-server runs in single-instance mode (no horizontal scaling).

### Available Scripts

| Command            | Description                                          |
| ------------------ | ---------------------------------------------------- |
| `pnpm dev`         | Start all apps in dev mode (db:generate + turbo dev) |
| `pnpm build`       | Build all packages and apps                          |
| `pnpm test`        | Run all tests (vitest)                               |
| `pnpm lint`        | Lint all packages                                    |
| `pnpm db:generate` | Generate Prisma client                               |
| `pnpm db:migrate`  | Run database migrations                              |
| `pnpm db:studio`   | Open Prisma Studio (database GUI)                    |
| `pnpm db:push`     | Push schema changes to database                      |

## Architecture Overview

### Three-Server Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌──────────────────┐
│   dripl-app     │     │   http-server    │     │    ws-server     │
│   (Next.js 16)  │     │   (Express 5)    │     │   (ws + Redis)   │
│   Port 3000     │     │   Port 3002      │     │   Port 3003      │
├─────────────────┤     ├──────────────────┤     ├──────────────────┤
│ • Canvas UI     │     │ • User auth      │     │ • Room mgmt      │
│ • Drawing tools │◄───►│ • File CRUD      │◄───►│ • Element sync   │
│ • Dashboard     │     │ • Room CRUD      │     │ • Cursor broadcast│
│ • Sharing UI    │     │ • Share links    │     │ • Multi-instance │
└────────┬────────┘     └────────┬─────────┘     └────────┬─────────┘
         │                       │                        │
         └───────────────────────┼────────────────────────┘
                                 │
                    ┌────────────▼────────────┐
                    │    PostgreSQL (Neon)    │
                    │    Redis (optional)     │
                    └─────────────────────────┘
```

### Data Flow

1. **Local canvas** → localStorage → CanvasBootstrap loads on mount
2. **Room canvas** → HTTP API loads room → ws-server joins room → sync_room_state → CanvasBootstrap initializes
3. **Element changes** → canvas-store → broadcastElements → ws-server → Redis pub/sub → other clients
4. **Room persistence** → ws-server debounced save (2s) → PostgreSQL
5. **Sharing** → HTTP API creates ShareLink → public URL `/board/[token]` → CanvasBootstrap loads in readOnly mode

## Background & History

- **Initial development**: November 2025
- **Major canvas rewrite**: March 2026 (productionized canvas parity, collaboration, sharing)
- **Latest fixes**: April 2026 (WebSocket message format alignment, ESM/CJS interop, phantom users, centralized env)
- **Single author**: pulkit777exe
- **Inspiration**: Excalidraw (collaborative whiteboard with hand-drawn aesthetic)

## Package Dependency Graph

```
@dripl/common (base types, schemas)
    ├── @dripl/math (geometry, collision)
    │       ├── @dripl/element (factory, rendering)
    │       │       └── @dripl/runtime (state store)
    │       └── @dripl/dripl (React components)
    ├── @dripl/utils (storage, encryption)
    └── @dripl/db (Prisma client)

Apps:
    dripl-app → ALL @dripl/* packages
    http-server → @dripl/common, @dripl/db
    ws-server → @dripl/common, @dripl/db
```
