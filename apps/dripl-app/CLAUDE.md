# dripl-app — Next.js Frontend

> Part of the Dripl monorepo. Read the root `CLAUDE.md` first.

---

## What This App Does

`dripl-app` is the Next.js 16 frontend for the Dripl collaborative canvas. It handles:

- **Authentication** — session-based login/signup, Google OAuth
- **Dashboard** — file/folder management, recent canvases
- **Canvas** — the full Excalidraw-like editor with real-time collaboration
- **Server Actions** — Next.js Server Actions for all CRUD operations

Runs on **port 3000** in development.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16 (App Router, Turbopack) |
| Language | TypeScript 5 |
| Styling | Tailwind CSS v4 + tw-animate-css |
| State | Zustand (global), TanStack Store (canvas) |
| Canvas | Custom renderer on top of RoughJS |
| Animation | Framer Motion / Motion |
| UI Primitives | Radix UI |
| Forms / Validation | Zod v4 |
| Testing | Vitest + Testing Library |

---

## Directory Structure

```
apps/dripl-app/
├── app/                   # Next.js App Router pages & layouts
│   ├── (auth)/            # Login, signup, verify routes
│   ├── (dashboard)/       # Dashboard and settings
│   ├── canvas/[fileId]/   # Canvas editor route
│   ├── api/               # Route handlers (share, rooms, AI)
│   ├── error.tsx          # React Error Boundary
│   └── layout.tsx         # Root layout
├── actions/               # Next.js Server Actions (auth, files, canvas)
├── components/
│   ├── canvas/            # Toolbar, modals, panels, collaborators
│   ├── dashboard/         # Sidebar, file cards, folders
│   └── ui/                # Generic design-system components
├── hooks/
│   ├── useCollaboration.ts # WebSocket client + element broadcasting
│   └── useCanvas.ts        # Canvas state and event handling
├── lib/                   # Utility wrappers (auth helpers, API clients)
├── renderer/              # Canvas rendering engine
├── eraser/                # Eraser tool logic
├── types/                 # App-level TypeScript types
├── utils/                 # Local utilities (canvas math, color, etc.)
├── public/                # Static assets
├── next.config.mjs
├── tailwind.config.ts
└── turbo.json
```

---

## Running Locally

```bash
# From monorepo root (recommended — starts all services)
pnpm dev

# From this directory only
cd apps/dripl-app
pnpm dev          # Starts Next.js on http://localhost:3000
```

> **Note:** `dripl-app` depends on `http-server` (REST) and `ws-server` (WebSocket) being up. Start all three via root `pnpm dev`.

---

## Key Scripts

```bash
pnpm dev          # Next.js dev server with Turbopack
pnpm build        # Production build
pnpm start        # Serve production build
pnpm lint         # ESLint
pnpm test         # Vitest test suite
pnpm clean        # Remove .next + node_modules cache
```

---

## Internal Package Imports

This app consumes the following workspace packages via `transpilePackages` in `next.config.mjs` (JIT compilation by Next.js/Turbopack):

| Import | Package | Purpose |
|---|---|---|
| `@dripl/common` | `packages/common` | Shared Zod schemas & types |
| `@dripl/db` | `packages/db` | Prisma client (server-only) |
| `@dripl/element` | `packages/element` | Element factory, rendering helpers |
| `@dripl/math` | `packages/math` | Geometry calculations |
| `@dripl/utils` | `packages/utils` | Encryption, throttle, storage |

> `@dripl/db` and `@prisma/client` are listed in `serverExternalPackages` — they are **never bundled into the client bundle**.

---

## Canvas Architecture

### Rendering Pipeline

```
RoughCanvas.tsx (2,332 lines — main orchestrator)
  ├─► InteractiveCanvas.tsx ──► renderer/interactiveScene.ts (overlays only)
  │     ├─► Selection boxes, resize handles
  │     ├─► Marquee selection
  │     ├─► Collaborator cursors
  │     └─► Grid dots
  ├─► StaticCanvas.tsx ──► renderer/staticScene.ts (element rendering)
  │     ├─► @dripl/element/rough-renderer.ts (Rough.js shapes)
  │     ├─► Canvas 2D API (text, images, freehand)
  │     └─► Offscreen element canvas cache (packages/element/src/staticScene.ts)
  └─► LaserCanvas.tsx (dedicated overlay for laser trail)
```

### Spatial Index (RBush)

The canvas uses **RBush** (R-tree) for fast spatial queries:

```typescript
// RoughCanvas.tsx:367-464
const spatialIndex = useMemo(() => {
  // Incremental rebuild: only updates changed elements
  // Falls back to full rebuild when >40% elements changed
  // Used for: hit testing, viewport culling, marquee selection
}, [elements]);
```

- **Hit testing**: `spatialIndex.tree.search(viewportBounds)` → O(log n) instead of O(n)
- **Viewport culling**: Only renders elements visible in the current viewport
- **Marquee selection**: Finds elements within the selection rectangle

### Zustand Store (canvas-store.ts — 803 lines)

Single store managing all canvas state:

```typescript
interface CanvasStore {
  // Elements
  elements: DriplElement[];
  selectedIds: Set<string>;
  draftElement: DriplElement | null;
  
  // Tools
  activeTool: ActiveTool;
  toolLocked: boolean;
  
  // Viewport
  zoom: number;
  panX: number;
  panY: number;
  
  // History (100 snapshots)
  past: DriplElement[][];
  future: DriplElement[][];
  
  // Collaboration
  remoteUsers: Map<string, RemoteUser>;
  remoteCursors: Map<string, RemoteCursor>;
  elementLocks: Map<string, string>;
}
```

> **Note:** The store is a 803-line monolith. Splitting into focused stores (canvas, history, collab, UI) is recommended — see TODOS.

### Collaboration Flow

```
User draws element
  └─► commitDraft() [canvas-store.ts:298]
        ├─► withHistoryBeforeMutation() (saves snapshot for undo)
        ├─► invalidateElementCache() (clears offscreen canvas)
        └─► clearShapeFromCache() (clears Rough.js drawable)
              └─► broadcastElements(prev, next) [useCollaboration.ts:150]
                    └─► flushElementBroadcast() (debounced, ~16ms)
                          └─► WebSocket send({ type:'scene-update', elements })
                                └─► ws-server broadcasts to room
                                      └─► Other clients: onRemoteElements() → setElements()
```

### State Management

- **Canvas elements** — managed in `useCanvas`, synced via `useCollaboration`
- **UI state** (tool selection, theme, modals) — Zustand stores in `lib/store/`
- **Auth/user state** — Next.js session (cookie-based, read in Server Actions)

---

## Authentication

- **Session cookie** set by `http-server` (`/api/auth/*`)
- `actions/auth.ts` wraps login/signup as Server Actions
- Google OAuth via `@react-oauth/google` on the client + `google-auth-library` on the server
- Protected routes check the cookie in `middleware.ts` (or layout-level server checks)

---

## Server Actions vs Route Handlers

| Use | When |
|---|---|
| Server Actions (`actions/`) | Mutations: create/update/delete files, auth |
| Route Handlers (`app/api/`) | Complex REST-like endpoints: share links, room creation, AI generation |

---

## Environment Variables (app-specific)

These are read from the root `.env`. Variables prefixed `NEXT_PUBLIC_` are inlined at build time.

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_WS_URL` | WebSocket server URL for client |
| `NEXT_PUBLIC_API_URL` | HTTP server base URL for client |
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | Google OAuth client ID |
| `GEMINI_API_KEY` | Google Gemini (AI diagram generation) |
| `DATABASE_URL` | Prisma DB connection (server-side only) |
| `JWT_SECRET` | Session token signing |

---

## Testing

Tests live alongside source files or in `__tests__/` directories. Run with:

```bash
pnpm test           # All tests
pnpm test -- --watch  # Watch mode
```

Testing stack: **Vitest** + **@testing-library/react** + **jsdom**.

Configuration: `vitest.config.ts` at the app root.

---

## Turbo Cache Inputs

The `turbo.json` in this directory extends the root pipeline and additionally hashes:

- Root `.env`, `.env.local`, `.env.production`, `.env.production.local`
- `NEXT_PUBLIC_*` env vars

Changes to any of these will bust the Turbo build cache.

---

## Common Gotchas

- **`.next` stale cache** — If the dev server behaves oddly, run `pnpm clean` or `rm -rf .next`
- **Package not updated** — If a workspace package changed but the app doesn't reflect it, the package needs a `pnpm build` first (or `turbo run build --filter=@dripl/<name>`)
- **`serverExternalPackages`** — Any new Node-only package (native addons, Prisma) must be added there or it will error during SSR bundling
- **Turbopack limitations** — Some Webpack plugins don't work with Turbopack; fallback to `next dev` (without `--turbopack`) if you encounter bundling issues
- **AI feature** — Requires a valid `GEMINI_API_KEY`; the route will 500 without it
