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

### ADR-002: In-Memory Room State, One Authoritative Writer per Room

**Decision:** ws-server keeps `RoomState` in process memory (`Map<string, RoomState>`). Exactly one instance is the authoritative writer for a room at a time, enforced by a TTL'd Redis lease at `dripl:room-owner:<roomId>` (`src/roomOwnership.ts`); a join to a room another instance holds is refused with close code 4010 before any room state is loaded. PostgreSQL remains the durable authority through the existing `updatedAt` fence and merge-retry. Redis pub/sub stays fan-out only, now as the backstop for the lease-handover window rather than the steady-state mechanism.
**Rationale:** Lowest latency for a single instance, and the lease makes that assumption safe for many. `docs/collaboration-crdt-e2ee-decision.md` §5.1 admits exactly two routes to multi-instance correctness — a durable operation ledger, or a single authoritative room owner — and the ledger was rejected on measured grounds: this client is REST-only, so a per-mutation shared read-modify-write would add a network round-trip to a path that sustains ~30 mutations/second/room, and it would require reimplementing the admission funnel (capacity, tombstone, freshness fence) inside Lua, where it could not share the `@dripl/common` reducers that define the semantics elsewhere. Single-writer ownership reaches the same mutual exclusion with zero shared state on the mutation path, because mutual exclusion is only hard when two writers exist.
**Status:** Active. Room state is now safely shardable across instances by room, and this is demonstrated rather than asserted: `apps/ws-server/scripts/two-instance-proof.mjs` runs two real ws-server processes against one real Redis and one real Postgres and checks that only one serves a room, that the other refuses with 4010 and creates no `RoomState`, and that a `SIGKILL`ed owner hands the room over after the lease expires with the persisted scene intact. A control run in the same script shows that with `WS_ROOM_OWNERSHIP=off` both instances serve the same room.

**What stays process-local, and why it cannot be otherwise.** Two of these are structural, not policy. `wsToRoomMap` is keyed by a live `WebSocket` object and `saveTimeouts` by a live `NodeJS.Timeout` handle; a socket handle and a pending callback in another process's event loop are neither serialisable nor meaningful, so sharing them was not attempted. The rest are local _because_ ownership makes the local copy complete and authoritative for its room, which is also what buys three real fixes: a joiner is served from the owner's warm `RoomState` rather than re-reading Postgres (closing the join-time staleness window), element locks are room-wide instead of instance-wide, and scene capacity is counted once.

**Concurrent writers and the available primitives.** `@upstash/redis@1.39.0` exposes `EVAL`/`EVALSHA` (atomic), `client.multi()` as a real `MULTI`/`EXEC` via `/multi-exec`, `SET NX/XX PX`, and `pipeline()`. It does **not** expose `WATCH`/`UNWATCH`/`DISCARD` at all, and Upstash's REST API does not support them either, so no optimistic-locking retry is available by any route. `/multi-exec` is atomic but blind: Redis queues the block and returns every result only at `EXEC`, so a read-modify-write is not expressible inside it. `/pipeline` is documented by Upstash as explicitly non-atomic. `EVAL` is therefore the only primitive here that could make a shared read-modify-write safe, which is why it was not used for the hot path and instead only for lease compare-and-set — where the script is small enough to be obviously correct. Renew and release are `EVAL` compare-and-set rather than `SET XX PX` / `DEL` because `XX` asserts only that the key _exists_, not that it is _ours_: a lapsed owner would overwrite the new owner's value and TTL through the very command meant to prevent that.

**Failure mode when Redis is unavailable.** The lease layer reports three outcomes rather than a boolean, because two different failures must not be conflated. A demonstrably held lease **fails closed** (refuse the join). A transport error **fails open** with a loud `room_ownership_unavailable` log, because turning a Redis outage into a product outage is a worse failure than the divergence it risks; fail-open degrades to the pre-ADR-002 behaviour, not to a new partial-shared-state mode, since there is nothing half-authoritative here to observe. With no `UPSTASH_REDIS_REST_URL`/`TOKEN`, ownership is disabled entirely and the single-instance path is unchanged — verified from a dist-free tree via `pnpm dev`.

**What this does not fix.** The room lease is not zero-data-loss across a crash: a killed owner loses whatever its save debounce/period had not yet persisted, bounded by `SAVE_DEBOUNCE_MS`/`PERIODIC_SAVE_INTERVAL_MS` and the same class of loss a restart already had. A Redis outage re-opens divergence (fail-open, logged). A join landing on a non-owner is refused rather than proxied, so a load balancer needs retries or affinity to avoid user-visible refusals. http-server's own process-local ticket state is untouched, so the _system_ still needs ticket sharing before the whole stack scales horizontally; ws-server delegates ticket validation over HTTP and holds no ticket store of its own. And this is still not CRDT convergence — the transport remains versioned JSON deltas with an LWW freshness fence (ADR-003).

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

<!-- BEGIN:turborepo-agent-rules -->

# This is NOT the Turborepo you know

Turborepo configuration, task behavior, and CLI commands can vary between installed versions and may differ from your training data. Resolve the `turbo` package from this file's directory or relevant workspace; in monorepos, it may not be visible from the repository root. For example, run `node -p "require.resolve('turbo/package.json')"` from a workspace that depends on `turbo`.

Read `docs/README.md` inside that installed package first, then read the relevant pages from its `docs/` directory before changing Turborepo configuration or commands. Heed deprecation notices. These bundled docs match the installed package version and are available without network access.

This block is written and re-added by `turbo` before repository-scoped commands when an AI agent is detected. In the Turborepo source repository, its template is defined in `crates/turborepo-cli/src/cli/agent_guidance.rs`. Removing the managed block while updates are enabled means a later qualifying invocation will add it again. Set `"agentGuidance": false` in the root `turbo.json` or `turbo.jsonc` to opt out; this does not remove an existing block. Keep the block committed with your work to avoid an uncommitted change on the next agent invocation.
<!-- END:turborepo-agent-rules -->
