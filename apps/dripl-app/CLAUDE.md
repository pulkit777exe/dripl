# dripl-app — Next.js Frontend

> **Partially archived app guide.** Several package paths, line counts, auth
> details, and protocol examples below are historical. Current source and the
> root `CLAUDE.md` take precedence; see `docs/codebase-audit.md` for open
> browser/runtime evidence gaps.

---

## What This App Does

`dripl-app` is the Next.js 16 frontend for the Dripl collaborative canvas. It handles:

- **Authentication** — session-based login/signup, Google OAuth
- **Dashboard** — file/folder management, recent canvases
- **Canvas** — the full hand-drawn canvas editor with real-time collaboration
- **Server Actions/BFF routes** — file mutations, auth/API adapters, and integration endpoints

Runs on **port 3000** in development.

---

## Tech Stack

| Layer              | Technology                         |
| ------------------ | ---------------------------------- |
| Framework          | Next.js 16 (App Router, Turbopack) |
| Language           | TypeScript 5                       |
| Styling            | Tailwind CSS v4 + tw-animate-css   |
| State              | Zustand (global + canvas)          |
| Canvas             | Custom renderer on top of RoughJS  |
| Animation          | Framer Motion / Motion             |
| UI Primitives      | Radix UI                           |
| Forms / Validation | Zod v4                             |
| Testing            | Vitest + Testing Library           |

---

## Directory Structure

```
apps/dripl-app/
├── app/                   # Next.js App Router pages & layouts
│   ├── auth/              # Login/register pages
│   ├── dashboard/         # Dashboard, folders, and settings routes
│   ├── canvas/[fileId]/   # Canvas editor route
│   ├── file/[id]/         # File route
│   ├── room/[roomSlug]/   # Room editor/view/presentation routes
│   ├── board/[token]/     # Public room capability preview
│   ├── share/[token]/     # Public file-share page
│   ├── api/               # BFF route handlers (share, snapshots, auth, AI)
│   ├── context/           # Auth context
│   ├── error.tsx          # React Error Boundary
│   └── layout.tsx         # Root layout
├── components/
│   ├── canvas/            # Toolbar, modals, panels, collaborators
│   ├── dashboard/         # Sidebar, file cards, folders
│   └── ui/                # Generic design-system components
├── hooks/
│   ├── useCollaboration.ts # WebSocket transport lifecycle (thin; logic in lib/collab/)
│   ├── useDrawingTools.ts  # Per-tool element creation (geometry in lib/draw/)
│   ├── useModalAnimation.ts # Shared modal open/close lifecycle
│   ├── useTheme.ts         # next-themes + canvas theme bridge
│   └── canvas/             # Focused canvas hooks: pointer events, keyboard,
│                           # clipboard, sync, hit testing, coordinates, actions,
│                           # spatial index, persistence, viewport, render loop
├── lib/
│   ├── store/              # Zustand slices: canvas composition root +
│   │                       # elementActions / arrangeActions / history /
│   │                       # collab / ui + pure selection helpers
│   ├── collab/             # Protocol types, scene-delta, message router,
│   │                       # socket lifecycle, reconnect backoff, offline queue,
│   │                       # tombstones, healing tick, connection/tickets
│   ├── canvas/             # Pure canvas logic: scene restore + reconcile,
│   │                       # binding sync, rotation, resize/marquee geometry,
│   │                       # hit-free style transfer, keybindings, link normalize,
│   │                       # pointer-sample caps, context menu state shape
│   ├── draw/               # Stroke geometry (RDP simplify, snap) + binding search
│   ├── commands.ts         # Command-palette model (table, fuzzy match, filter)
│   ├── scene.ts            # Frontend scene home: restore/reconcile/app-state
│   ├── export-options.ts   # Pure export scope + option builders
│   ├── api.ts              # HTTP API client; server/ for route helpers
│   └── canvas-db.ts        # IndexedDB scene persistence (elements only)
├── renderer/              # Canvas rendering engine, split by concern:
│   ├── sceneTypes.ts       # Viewport/cursor/options types (public surface)
│   ├── elementStyles.ts    # Stroke/fill/roughness primitives
│   ├── elements.ts         # Per-shape renderers + dispatcher + text cache
│   ├── overlays.ts         # Grid, selection, marquee, cursors, locks, eraser
│   └── interactiveScene.ts # Public composer (transforms, culling, draw order)
├── components/
│   ├── canvas/            # Toolbar, modals, panels, collaborators, overlays
│   │   └── properties/    # PropertiesPanel sections (colors, strokes, arrows…)
│   ├── dashboard/         # Sidebar, file cards, folders
│   └── ui/                # Generic design-system components
├── utils/                 # Local utilities (canvas math, color, export/)
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

This app consumes the following workspace packages. Most are transpiled by
Next.js; `@dripl/db` and `@prisma/client` are server-external dependencies rather
than client-bundled packages:

| Import           | Package            | Purpose                            |
| ---------------- | ------------------ | ---------------------------------- |
| `@dripl/common`  | `packages/common`  | Shared Zod schemas & types         |
| `@dripl/db`      | `packages/db`      | Prisma client (server-only)        |
| `@dripl/element` | `packages/element` | Element factory, rendering helpers |
| `@dripl/math`    | `packages/math`    | Geometry calculations              |
| `@dripl/utils`   | `packages/utils`   | Encryption, throttle, storage      |

> `@dripl/db` and `@prisma/client` are listed in `serverExternalPackages` — they are **never bundled into the client bundle**.
>
> The app uses the local Zustand store under `apps/dripl-app/lib/store/`. The
> removed `@dripl/dripl` TanStack store package is not part of the current
> workspace.

---

## Canvas Architecture

### Rendering Pipeline

```
RoughCanvas.tsx (~430-line composition root: subscriptions + hook wiring + JSX)
  ├─► hooks/canvas/useCanvasSync.ts ──► useCollaboration (transport) +
  │     reconcileScene (lib/scene.ts, version fence + tombstones) + broadcast
  ├─► hooks/canvas/useCanvasPointerEvents.ts (gesture machine; pure geometry
  │     in lib/canvas/: binding-sync, rotation, resize-geometry, marquee)
  ├─► InteractiveCanvas.tsx ──► renderer/interactiveScene.ts (composer only)
  │     ├─► renderer/elements.ts (per-shape renderers + dispatcher)
  │     ├─► renderer/overlays.ts (selection, marquee, cursors, grid, locks)
  │     └─► renderer/elementStyles.ts (stroke/fill/roughness primitives)
  ├─► StaticCanvas.tsx ──► @dripl/element rough renderer + element canvas cache
  └─► LaserCanvas.tsx (dedicated overlay for laser trail)
```

### Spatial Index (RBush)

The canvas uses **RBush** (R-tree) for fast spatial queries, owned by
`hooks/canvas/useSpatialIndex.ts` (incremental updates, transient hints,
viewport culling) and consumed via `useHitTesting`:

```typescript
// Hit testing and marquee narrow O(log n) through the index, then apply
// exact geometry (see lib/canvas/marquee.ts, hooks/canvas/useHitTesting.ts).
const candidates = spatialIndex.tree.search(viewportBounds);
```

- **Hit testing**: `spatialIndex.tree.search(viewportBounds)` → O(log n) instead of O(n)
- **Viewport culling**: Only renders elements visible in the current viewport
- **Marquee selection**: Finds elements within the selection rectangle

### Zustand Store (`lib/store/` slices)

Focused Zustand slices manage canvas, history, collaboration, and UI state:

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

  // History (up to 100 snapshots, with a byte budget)
  past: DriplElement[][];
  future: DriplElement[][];

  // Collaboration
  remoteUsers: Map<string, RemoteUser>;
  remoteCursors: Map<string, RemoteCursor>;
  elementLocks: Map<string, string>;
}
```

> **Note:** The store is split into focused slices under `lib/store/`; the
> historical single-file/line-count description is obsolete.

### Collaboration Flow

```
User draws element
  └─► commitDraft() [lib/store/elementActions.ts via canvasSlice.ts]
        ├─► withHistoryBeforeMutation() (saves snapshot for undo)
        ├─► invalidateElementCache() (clears offscreen canvas)
        └─► clearShapeFromCache() (clears Rough.js drawable)
              └─► broadcastElements() [useCanvasSync → useCollaboration]
                    └─► flushElementBroadcast() (coalesced, version-aware delta)
                          └─► WebSocket ticket exchange, then JSON `scene-delta` { added, updated, deleted }
                                └─► ws-server broadcasts to room
                                      └─► Other clients: routeCollabMessage() [lib/collab/messageRouter.ts]
                                          → reconcileScene() [lib/scene.ts: version fence,
                                             gesture-lock + tombstone guards] → setElements()
```

Supporting modules in `lib/collab/`: `protocol.ts` (wire types),
`socket-lifecycle.ts` (open/close, heartbeat + healing tick), `reconnect.ts`
(backoff), `offlineQueue.ts` (bounded replay), `tombstones.ts` (local delete
markers), `connection.ts` (tickets, cursor colors). Remote gestures never
overwrite locally locked elements, and the 15s heartbeat re-queues a diverged
baseline (`healing.ts`) since the server sends no per-message ACK.

### State Management

- **Canvas elements** — managed by the store/canvas hooks, synced via `useCollaboration`
- **UI state** (tool selection, theme, modals) — Zustand stores in `lib/store/`
- **Auth/user state** — session cookie/Bearer checks through the auth context and API layer

---

## Authentication

- **Session cookie** set by `http-server` (`/api/auth/*`)
- Auth pages call the HTTP API and consume the session through the app auth context
- Google OAuth via `@react-oauth/google` on the client + `google-auth-library` on the server
- Protected routes use the session cookie/Bearer token through the current
  auth context and server/API checks; there is no `middleware.ts` in the
  current app tree.

---

## Route Handlers

There are no Server Actions: `actions/` was removed in 3568d4b, so every
mutation goes through a REST route handler.

| Use                         | When                                                          |
| --------------------------- | ------------------------------------------------------------- |
| Route Handlers (`app/api/`) | All mutations, plus share links, room creation, AI generation |

---

## Environment Variables (app-specific)

These are read from the root `.env`. Variables prefixed `NEXT_PUBLIC_` are inlined at build time.

| Variable              | Purpose                                 |
| --------------------- | --------------------------------------- |
| `NEXT_PUBLIC_WS_URL`  | WebSocket server URL for client         |
| `NEXT_PUBLIC_API_URL` | HTTP server base URL for client         |
| `GEMINI_API_KEY`      | Google Gemini (AI diagram generation)   |
| `DATABASE_URL`        | Prisma DB connection (server-side only) |
| `JWT_SECRET`          | Session token signing                   |

---

## Testing

Tests live in `src/__tests__/`, `utils/__tests__/`, and `hooks/canvas/__tests__/`.
Pure canvas/collab modules (`lib/canvas/`, `lib/collab/`, `lib/draw/`,
`lib/store/selection.ts`) carry direct unit tests; hooks are covered with
`renderHook` doubles (pointer gestures, keyboard resolver via
`lib/canvas/keybindings.ts`, modal lifecycle). Run with:

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
- **AI feature** — requires a valid `GEMINI_API_KEY`; the route returns a
  configuration error rather than silently generating output.
