# AGENTS.md — Agent Configuration for Dripl

> This file provides context for AI agents working on the Dripl codebase. It defines the issue tracker, triage workflow, domain terminology, and key architectural decisions.

---

## Issue Tracker

**Platform:** GitHub Issues
**Repository:** `anomalyco/opencode` (or local markdown)

### Triage Labels

| Label | Description |
|-------|-------------|
| `triage` | New issue, not yet reviewed |
| `bug` | Something is broken |
| `feature` | New functionality |
| `enhancement` | Improvement to existing functionality |
| `performance` | Performance concern |
| `security` | Security vulnerability or concern |
| `architecture` | Structural/code organization issue |
| `docs` | Documentation improvement |
| `deps` | Dependency update or issue |
| `dx` | Developer experience improvement |
| `p0` | Critical — data loss, security, core functionality broken |
| `p1` | High — significant impact, should fix soon |
| `p2` | Medium — improvement, can wait |
| `p3` | Low — nice to have, cleanup |
| `good first issue` | Suitable for new contributors |
| `help wanted` | Community contributions welcome |

### Triage Workflow

1. New issues get `triage` label
2. Agent or maintainer reviews and assigns priority (`p0`-`p3`) and category labels
3. `triage` label removed once triaged
4. `p0` issues are addressed immediately
5. `p1` issues are scheduled for current or next sprint
6. `p2`/`p3` issues are backlog

---

## Domain Terminology

| Term | Definition |
|------|------------|
| **Canvas** | The drawing surface where users create and manipulate elements |
| **Element** | Any drawable object on the canvas (rectangle, ellipse, text, arrow, etc.) |
| **Room** | A collaboration session where multiple users edit the same canvas |
| **Scene** | The complete set of elements on a canvas at a point in time |
| **Draft Element** | An element currently being drawn (not yet committed to the scene) |
| **Spatial Index** | RBush R-tree used for fast spatial queries (hit testing, viewport culling) |
| **Shape Cache** | Cache of Rough.js `Drawable` objects for each element |
| **Element Canvas Cache** | Offscreen `<canvas>` elements used for efficient re-rendering |
| **Differential Sync** | Broadcasting only changes (deltas) instead of the full element array |
| **Fractional Index** | A string-based ordering system that allows insertion between any two elements without re-indexing |
| **Viewport** | The visible area of the canvas (defined by panX, panY, zoom, width, height) |
| **Hit Testing** | Determining which element is at a given (x, y) coordinate |
| **Marquee Selection** | Click-and-drag selection box that selects multiple elements |

---

## Key Architectural Decisions

### ADR-001: Three-Server Architecture
**Decision:** Split into dripl-app (Next.js), http-server (Express), ws-server (WebSocket).
**Rationale:** Separates concerns: SSR/CSR frontend, REST API, and real-time collaboration. Allows independent scaling and deployment.
**Status:** Active

### ADR-002: In-Memory Room State
**Decision:** ws-server stores room state in process memory (`Map<string, RoomState>`).
**Rationale:** Lowest latency for real-time collaboration. Tradeoff: single-process only, state lost on restart.
**Status:** Active — planned upgrade to Redis pub/sub (TODOS #9)

### ADR-003: Full-State Broadcast
**Decision:** On element changes, broadcast the full element array to all clients.
**Rationale:** Simpler implementation, guaranteed consistency. Tradeoff: high bandwidth usage.
**Status:** Active — planned upgrade to diff-based broadcasting (TODOS #7)

### ADR-004: JSON String Storage for Canvas Content
**Decision:** Store canvas elements as a JSON-serialized string in a PostgreSQL `String` column.
**Rationale:** Simple implementation, no schema migrations needed for element property changes. Tradeoff: no queryability, no partial updates.
**Status:** Active — considered migration to JSONB or element table (TODOS #26)

### ADR-005: Zustand for State Management
**Decision:** Use Zustand for canvas state management.
**Rationale:** Lightweight, no boilerplate, good React integration. Single store pattern.
**Status:** Active — considered splitting into focused stores (TODOS not yet created)

### ADR-006: Rough.js for Hand-Drawn Rendering
**Decision:** Use Rough.js for shape rendering to achieve hand-drawn aesthetic.
**Rationale:** Matches product design principle "hand-drawn humanity." Provides the sketch-like visual style.
**Status:** Active

---

## File Map (Quick Reference)

```
CLAUDE.md                    # Root monorepo guide (read first)
AGENTS.md                    # This file — agent configuration
TODOS.md                     # Engineering roadmap (36 items)
Problems.md                  # Security audit report (23 findings)
DESIGN.md                    # Visual design system
PRODUCT.md                   # Product definition
CHANGELOG.md                 # Version history
CONTRIBUTING.md              # Contributor guidelines

apps/dripl-app/              # Next.js 16 frontend (port 3000)
  CLAUDE.md                  # App-specific guide
  components/canvas/         # Canvas UI components
  renderer/                  # Canvas rendering engine
  hooks/                     # React hooks (useCollaboration, etc.)
  lib/canvas-store.ts        # Zustand store (803 lines)

apps/http-server/            # Express 5 REST API (port 3002)
  CLAUDE.md                  # App-specific guide
  src/routes/                # API route handlers
  src/controllers/           # Business logic
  src/middlewares/            # Auth, CSRF, rate limiting

apps/ws-server/              # WebSocket collaboration server (port 3001)
  CLAUDE.md                  # App-specific guide
  src/index.ts               # Monolith entry point (737 lines)
  src/validation.ts          # Zod schemas for WS messages

packages/common/             # Shared types, Zod schemas
packages/db/                 # Prisma ORM client + migrations
packages/dripl/              # Core canvas lib, hooks, state
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
2. **Check `TODOS.md`** for existing plans and priorities
3. **Check `Problems.md`** for known security issues
4. **Follow the package manager rule:** use `pnpm` for all operations
5. **Never install deps at root** unless they are repo-level tools
6. **Use `workspace:*`** for all internal package deps
7. **Follow Conventional Commits** enforced by commitlint
8. **Run `pnpm lint` and `pnpm build`** before submitting changes
9. **Never commit `.env` files**
10. **Never import across package boundaries via relative paths**
