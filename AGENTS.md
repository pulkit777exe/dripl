# AGENTS.md — Agent Configuration for Dripl

> This file provides context for AI agents working on the Dripl codebase. It defines the issue tracker, triage workflow, domain terminology, and key architectural decisions.

---

## Issue Tracker

**Platform:** GitHub Issues
**Repository:** `pulkit777exe/dripl` (or local markdown)

### Triage Labels

| Label              | Description                                               |
| ------------------ | --------------------------------------------------------- |
| `triage`           | New issue, not yet reviewed                               |
| `bug`              | Something is broken                                       |
| `feature`          | New functionality                                         |
| `enhancement`      | Improvement to existing functionality                     |
| `performance`      | Performance concern                                       |
| `security`         | Security vulnerability or concern                         |
| `architecture`     | Structural/code organization issue                        |
| `docs`             | Documentation improvement                                 |
| `deps`             | Dependency update or issue                                |
| `dx`               | Developer experience improvement                          |
| `p0`               | Critical — data loss, security, core functionality broken |
| `p1`               | High — significant impact, should fix soon                |
| `p2`               | Medium — improvement, can wait                            |
| `p3`               | Low — nice to have, cleanup                               |
| `good first issue` | Suitable for new contributors                             |
| `help wanted`      | Community contributions welcome                           |

### Triage Workflow

1. New issues get `triage` label
2. Agent or maintainer reviews and assigns priority (`p0`-`p3`) and category labels
3. `triage` label removed once triaged
4. `p0` issues are addressed immediately
5. `p1` issues are scheduled for current or next sprint
6. `p2`/`p3` issues are backlog

---

## Domain Terminology

| Term                     | Definition                                                                                                                           |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| **Canvas**               | The drawing surface where users create and manipulate elements                                                                       |
| **Element**              | Any drawable object on the canvas (rectangle, ellipse, text, arrow, etc.)                                                            |
| **Room**                 | A collaboration session where multiple users edit the same canvas                                                                    |
| **Scene**                | The complete set of elements on a canvas at a point in time                                                                          |
| **Draft Element**        | An element currently being drawn (not yet committed to the scene)                                                                    |
| **Spatial Index**        | RBush R-tree used for fast spatial queries (hit testing, viewport culling)                                                           |
| **Shape Cache**          | Cache of Rough.js `Drawable` objects for each element                                                                                |
| **Element Canvas Cache** | Offscreen `<canvas>` elements used for efficient re-rendering                                                                        |
| **Differential Sync**    | Sending changed elements as deltas after an initial snapshot instead of resending the full array; any recovery path must be explicit |
| **Fractional Index**     | A string-based ordering system that allows insertion between any two elements without re-indexing                                    |
| **Viewport**             | The visible area of the canvas (defined by panX, panY, zoom, width, height)                                                          |
| **Hit Testing**          | Determining which element is at a given (x, y) coordinate                                                                            |
| **Marquee Selection**    | Click-and-drag selection box that selects multiple elements                                                                          |

---

## Key Architectural Decisions

### ADR-001: Three-Server Architecture

**Decision:** Split into dripl-app (Next.js), http-server (Express), ws-server (WebSocket).
**Rationale:** Separates concerns: SSR/CSR frontend, REST API, and real-time collaboration. Allows independent scaling and deployment.
**Status:** Active

### ADR-002: In-Memory Room State

**Decision:** ws-server stores room state in process memory (`Map<string, RoomState>`); Redis fan-out is optional and does not make room state shared.
**Rationale:** Lowest latency for a single instance. Tradeoff: state/presence is process-local, restart loses active state, and horizontal scaling still needs durable shared state and distributed verification.
**Status:** Active with a single-instance caveat; optional Redis fan-out is implemented, but shared room/ticket state remains a gap (TODOS #9).

### ADR-003: Full-State Broadcast

**Decision:** Historical ADR: full element-array broadcasts were the original collaboration design.
**Rationale:** Simpler initial implementation, but high bandwidth usage. The active transport sends a full `sync_room_state` snapshot on initial join and JSON `scene-delta` messages for later changes; this is not a guarantee of full client recovery or CRDT convergence.
**Status:** Superseded by differential JSON sync; retained as design history. This is not a CRDT convergence guarantee.

### ADR-004: JSON String Storage for Canvas Content

**Decision:** Store canvas elements as a JSON-serialized string in a PostgreSQL `String` column.
**Rationale:** Simple implementation, no schema migrations needed for element property changes. Tradeoff: no queryability, no partial updates.
**Status:** Active; current scene writes remain whole-payload saves. Indexes added by TODOS #26 do not change this storage model.

### ADR-005: Zustand for State Management

**Decision:** Use Zustand for canvas state management, composed from focused canvas/history/collaboration/UI slices.
**Rationale:** Lightweight, no boilerplate, good React integration. The slice split reduces the original monolith's blast radius.
**Status:** Active; `apps/dripl-app/lib/store/` is the current store layout.

### ADR-006: Rough.js for Hand-Drawn Rendering

**Decision:** Use Rough.js for shape rendering to achieve hand-drawn aesthetic.
**Rationale:** Matches product design principle "hand-drawn humanity." Provides the sketch-like visual style.
**Status:** Active

---

## File Map (Quick Reference)

```
CLAUDE.md                    # Root monorepo guide (read first)
AGENTS.md                    # This file — agent configuration
TODOS.md                     # Historical engineering roadmap; current overlay above
Problems.md                  # Historical security report; current reconciliation at top
DESIGN.md                    # Visual design system
PRODUCT.md                   # Product definition
CHANGELOG.md                 # Version history
CONTRIBUTING.md              # Contributor guidelines

apps/dripl-app/              # Next.js 16 frontend (port 3000)
  CLAUDE.md                  # App-specific guide
  components/canvas/         # Canvas UI components
  renderer/                  # Canvas rendering engine
  hooks/                     # React hooks (useCollaboration, etc.)
  lib/store/                 # Zustand slices (canvas, history, collab, UI)

apps/http-server/            # Express 5 REST API (port 3002)
  CLAUDE.md                  # App-specific guide
  src/routes/                # API route handlers
  src/controllers/           # Business logic
  src/middlewares/            # Auth, CSRF, rate limiting

apps/ws-server/              # WebSocket collaboration server (port 3001)
  CLAUDE.md                  # App-specific guide
  src/index.ts               # Large protocol coordinator/composition root
  src/validation.ts          # Zod schemas for WS messages
  src/handlers/              # Extracted message handlers

packages/common/             # Shared types, Zod schemas
packages/db/                 # Prisma ORM client + migrations
packages/element/            # Element factory & rendering
packages/math/               # Geometry & intersection utils
packages/utils/              # Encryption, storage, throttle
packages/test-utils/         # Shared test utilities

tooling/eslint-config/       # Shared ESLint rules
tooling/typescript-config/   # Shared tsconfigs
```

---

## Agent Workflow

When working on Dripl:

1. **Read `CLAUDE.md` first** — it contains critical project rules
2. **Check `docs/codebase-audit.md`** for current status and open gates
   (`TODOS.md` and `Problems.md` are frozen historical records — see their
   banners — not the planning source)
3. **Check `docs/collaboration-crdt-e2ee-decision.md`** for the collaboration
   correctness and E2EE posture before touching protocol or sharing code
4. **Follow the package manager rule:** use `pnpm` for all operations
5. **Never install deps at root** unless they are repo-level tools
6. **Use `workspace:*`** for all internal package deps
7. **Follow Conventional Commits** enforced by commitlint
8. **Run `pnpm lint` and `pnpm build`** before submitting changes
9. **Never commit `.env` files**
10. **Never import across package boundaries via relative paths**
