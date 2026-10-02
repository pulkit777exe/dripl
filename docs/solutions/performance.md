# Performance Solutions — Dripl

**Historical date:** 2026-06-01 | **Scope:** six issues described in this note | **Historical status:** implementation claimed complete

> **Historical performance/remediation record.** The implementation snippets
> and arithmetic examples below are not benchmark evidence. The current
> evidence-weighted measurement is [`docs/performance-benchmark.md`](../performance-benchmark.md),
> which is explicitly synthetic; browser FPS, database latency, and production
> throughput remain unverified.

---

## Table of Contents

1. [Diff-Based Element Broadcasting](#1-diff-based-element-broadcasting)
2. [O(1) Element Lookups in Zustand](#2-o1-element-lookups-in-zustand)
3. [Redundant deriveHistory Deep-Clone](#3-redundant-derivehistory-deep-clone)
4. [Eager Component Loading](#4-eager-component-loading)
5. [Offset Pagination → Cursor Pagination](#5-offset-pagination--cursor-pagination)
6. [Missing Database Indexes](#6-missing-database-indexes)

---

## 1. Diff-Based Element Broadcasting

### Problem Statement

Historical scenario (illustrative arithmetic, not a measured result): the
original full-array protocol would produce large per-edit payloads. The active
JSON protocol sends `scene-delta` after the initial sync; the exact bandwidth
depends on element size, client count, throttling, and serialization.

### Root Cause

The original protocol used a single `scene-update` message type for both full syncs (on join) and incremental updates (on element change). The client always sent `elements: DriplElement[]`, and the server always broadcast the full array back. No delta computation existed.

### Solution

Added a new `scene-delta` message type with three optional arrays: `added`, `updated`, and `deleted`. The **client** computes the delta by diffing the previous element state against the current state using `version` fields as change markers. The **server** applies the delta to its in-memory room state and forwards the delta to other clients.

**Historical client/server delta snippets** (the current implementation is in
`useCollaboration.ts` and `ws-server/src/index.ts`; the following is retained
to explain the original change):

```typescript
const flushElementBroadcast = useCallback(() => {
  const pending = pendingElementsRef.current;
  if (!pending || !roomId) return;
  if (wsRef.current?.readyState !== WebSocket.OPEN) return;

  if (isFirstSyncRef.current) {
    // First sync: send full state
    send({ type: 'scene-update', subtype: 'init', elements: pending });
    isFirstSyncRef.current = false;
  } else {
    // Subsequent syncs: compute and send delta
    const prev = prevElementsRef.current;
    const prevMap = new Map(prev.map(el => [el.id, el]));
    const nextMap = new Map(pending.map(el => [el.id, el]));

    const added: DriplElement[] = [];
    const updated: DriplElement[] = [];
    const deleted: string[] = [];

    for (const el of pending) {
      const prevEl = prevMap.get(el.id);
      if (!prevEl) {
        added.push(el);
      } else if (prevEl.version !== el.version) {
        updated.push(el);
      }
    }

    for (const el of prev) {
      if (!nextMap.has(el.id)) {
        deleted.push(el.id);
      }
    }

    if (added.length > 0 || updated.length > 0 || deleted.length > 0) {
      send({
        type: 'scene-delta',
        added: added.length > 0 ? added : undefined,
        updated: updated.length > 0 ? updated : undefined,
        deleted: deleted.length > 0 ? deleted : undefined,
      });
    }
  }

  prevElementsRef.current = pending;
  pendingElementsRef.current = null;
}, [roomId, send]);
```

**Historical server delta application snippet** (current code uses a
persistent `Map`, reconciliation, deduplication, authorization, and persistence
fencing):

```typescript
case 'scene-delta': {
  if (!currentRoomId) break;
  const room = rooms.get(currentRoomId);
  if (!room) break;

  const elementMap = new Map(room.elements.map(el => [el.id, el]));

  if (message.added && Array.isArray(message.added)) {
    for (const rawEl of message.added) {
      try {
        const element = toDriplElement(rawEl);
        elementMap.set(element.id, element);
      } catch { /* Skip invalid elements */ }
    }
  }

  if (message.updated && Array.isArray(message.updated)) {
    for (const rawEl of message.updated) {
      try {
        const element = toDriplElement(rawEl);
        elementMap.set(element.id, element);
      } catch { /* Skip invalid elements */ }
    }
  }

  if (message.deleted && Array.isArray(message.deleted)) {
    for (const id of message.deleted) {
      elementMap.delete(id);
    }
  }

  room.elements = Array.from(elementMap.values());
  broadcast(room, message, currentUserId ?? undefined);
  scheduleSave(currentRoomId);
  break;
}
```

**Validation schema** (`apps/ws-server/src/validation.ts:160-165`):

```typescript
export const sceneDeltaSchema = z.object({
  type: z.literal('scene-delta'),
  added: z.array(driplElementSchema).optional(),
  updated: z.array(driplElementSchema).optional(),
  deleted: z.array(z.string()).optional(),
});
```

### Impact

| Metric                 | Before                              | After                                                                               |
| ---------------------- | ----------------------------------- | ----------------------------------------------------------------------------------- |
| Per-edit payload       | Full scene in the historical design | Changed elements in `scene-delta`                                                   |
| Bandwidth              | Scenario-dependent                  | Scenario-dependent; no measured multiplier claimed                                  |
| Message type           | `scene-update` only                 | Initial `sync_room_state` snapshot + `scene-delta`; no guaranteed recovery snapshot |
| Delta computation cost | N/A                                 | O(n) client-side diff (implementation detail)                                       |

The historical note used `scene-update` for the first full sync. The current server
uses `sync_room_state` for the authoritative join snapshot; later edits use
`scene-delta`. No periodic full client recovery snapshot is established by this
note or by the current source.

### Scope note

Dripl's active path uses JSON deltas plus version/nonce reconciliation, which is
not CRDT convergence. The dormant Yjs adapter must not be described as active
traffic.

---

## 2. O(1) Element Lookups in Zustand

### Problem Statement

`updateElement` used `Array.findIndex()` (O(n)) to locate the element by ID, then spread the entire array (O(n)) to produce a new reference. With 5,000 elements, every single-element edit scanned and copied all 5,000 entries. During rapid dragging (60 updates/second), this meant **300,000 array scans per second** — all on the main thread.

### Root Cause

The Zustand store held elements as a flat `DriplElement[]`. There was no secondary index for ID-based lookups. Every mutation required a linear scan to find the target element, then a full array copy to trigger Zustand's shallow equality check.

### Solution

Added a parallel `elementsById: Map<string, DriplElement>` alongside the
array. The current store updates the map incrementally on many mutation paths;
some set/reorder paths still rebuild it. Lookups use `Map.get()` where the
slice supports it.

**Store interface** (`apps/dripl-app/lib/canvas-store.ts:111-112`):

```typescript
elements: DriplElement[];
elementsById: Map<string, DriplElement>;
```

**Builder function** (`apps/dripl-app/lib/canvas-store.ts:57-63`):

```typescript
function buildElementsById(elements: readonly DriplElement[]): Map<string, DriplElement> {
  const map = new Map<string, DriplElement>();
  for (const el of elements) {
    map.set(el.id, el);
  }
  return map;
}
```

**O(1) lookup in updateElement** (`apps/dripl-app/lib/canvas-store.ts:394-422`):

```typescript
updateElement: (id, updates) =>
  set(state => {
    const previous = state.elementsById.get(id);  // O(1) instead of O(n)
    if (!previous) return state;

    invalidateElementCache(id);
    clearShapeFromCache(previous);

    const history = withHistoryBeforeMutation(
      { past: state.past, future: state.future },
      state.elements
    );
    const updated: DriplElement = {
      ...previous,
      ...updates,
      version: (previous.version ?? 0) + 1,
      versionNonce: Math.floor(Math.random() * 2_147_483_647),
      updated: Date.now(),
    } as DriplElement;

    const nextElements = state.elements.map(e => (e.id === id ? updated : e));
    const historyPayload = commitPresentFromHistory(history.past, history.future);
    return {
      elements: nextElements,
      elementsById: buildElementsById(nextElements),
      past: historyPayload.past,
      future: historyPayload.future,
    };
  }),
```

**Deduplication in addElement** (`apps/dripl-app/lib/canvas-store.ts:354-371`):

```typescript
addElement: element =>
  set(state => {
    if (state.elementsById.has(element.id)) {  // O(1) dedup check
      return state;
    }
    // ... proceed with add
  }),
```

### Impact

| Metric                         | Before                                                    | After                                          |
| ------------------------------ | --------------------------------------------------------- | ---------------------------------------------- |
| Element lookup                 | O(n) via `findIndex`                                      | O(1) via `Map.get` on supported paths          |
| Dedup check                    | O(n) via `Array.some`                                     | O(1) via `Map.has` on supported paths          |
| Array copy                     | Still O(n) (Zustand reactivity)                           | Still O(n) where immutable arrays are required |
| Net improvement at 5K elements | Fewer comparisons in lookup paths; not a measured speedup |

The array copy remains necessary for the immutable state model, and some
mutation paths still rebuild the map. No “5,000× faster” claim is supported by
this note.

### Trade-off

Dripl keeps both representations (array for ordering + Map for lookups), which
doubles memory but avoids recomputing the array on every render.

---

## 3. Redundant deriveHistory Deep-Clone

### Problem Statement

A `deriveHistory()` function deep-cloned all past snapshots, the current state, and all future snapshots on every state change. With 100 history snapshots and 5,000 elements, that's **100 × 1.5 MB = 150 MB** of deep-cloned data on every edit. The resulting `history` and `historyIndex` fields were never consumed by any component.

### Root Cause

The store originally had a `deriveHistory()` function that computed a combined history view from `past`, `present`, and `future` arrays. This was called on every state change. The resulting fields (`history`, `historyIndex`) were exposed in the store interface but no component ever selected them — undo/redo operated directly on `past` and `future`.

### Solution

Removed `deriveHistory()`, the `history` field, and the `historyIndex` field entirely. Undo/redo now operates directly on the `past` and `future` arrays without computing a derived view.

**Before (removed)**:

```typescript
function deriveHistory(state: HistoryState): DriplElement[][] {
  return [
    ...state.past.map(snapshot => cloneElements(snapshot)),
    cloneElements(present),
    ...state.future.map(snapshot => cloneElements(snapshot)),
  ];
}
```

**After — undo uses past directly** (`apps/dripl-app/lib/canvas-store.ts:645-664`):

```typescript
undo: () =>
  set(state => {
    if (state.past.length === 0) return state;
    const previous = state.past[state.past.length - 1];
    if (!previous) return state;

    const past = state.past.slice(0, -1);
    const future = [cloneElements(state.elements), ...state.future].slice(0, MAX_HISTORY);
    const elements = cloneElements(previous);
    const historyPayload = commitPresentFromHistory(past, future);

    elements.forEach(element => invalidateElementCache(element.id));

    return {
      elements,
      past: historyPayload.past,
      future: historyPayload.future,
    };
  }),
```

### Impact

| Metric                | Before                                            | After                                        |
| --------------------- | ------------------------------------------------- | -------------------------------------------- |
| Derived-history clone | Derived every state change                        | Derived view removed                         |
| Snapshot retention    | Still full snapshots, with count/byte budget      | Same general model; budget enforcement added |
| GC pressure           | Fewer redundant clones; no measured GC result     | Not benchmarked here                         |
| Undo/redo latency     | Direct slice/history operations; no latency claim | Not benchmarked here                         |

The history slices still retain snapshots; removing the derived view does not
prove a specific memory or latency improvement.

### Scope note

Dripl retains full scene snapshots with an explicit history budget. Treat any
history migration as a separate design and benchmark task rather than assuming
CRDT semantics.

---

## 4. Eager Component Loading

### Problem Statement

Historical `RoughCanvas.tsx` (the old 2,332-line snapshot) eagerly imported
15+ components. The original note estimated ~40 KB of minified payload and a
TTI effect; neither number was measured in this workspace.

### Root Cause

All component imports were static `import` statements at the top of the file. React's bundler (Webpack/Turbopack) included them in the main chunk because they were directly referenced, even though they were conditionally rendered via `{showPanel && <PropertiesPanel />}`.

### Solution

Converted the four largest conditionally-rendered components to `React.lazy()` with `<Suspense>` fallbacks.

**Before**:

```typescript
import { PropertiesPanel } from './PropertiesPanel';
import { ContextMenu } from './ContextMenu';
import { NameInputModal } from './NameInputModal';
import { WelcomeScreen } from './WelcomeScreen';
```

**After** (`apps/dripl-app/components/canvas/RoughCanvas.tsx:21-24`):

```typescript
const PropertiesPanel = lazy(() =>
  import('./PropertiesPanel').then(m => ({ default: m.PropertiesPanel }))
);
const ContextMenu = lazy(() => import('./ContextMenu').then(m => ({ default: m.ContextMenu })));
const NameInputModal = lazy(() =>
  import('./NameInputModal').then(m => ({ default: m.NameInputModal }))
);
const WelcomeScreen = lazy(() =>
  import('./WelcomeScreen').then(m => ({ default: m.WelcomeScreen }))
);
```

Each is wrapped in `<Suspense>` at its render site (code not shown — follows standard React.lazy pattern).

### Impact

| Metric                    | Before                                 | After                           |
| ------------------------- | -------------------------------------- | ------------------------------- |
| Main chunk size           | Historical estimate; not measured here | Baseline not measured here      |
| Components loaded eagerly | Four conditionally rendered components | Four declared with `React.lazy` |
| Time to Interactive       | Potential lazy-chunk tradeoff          | No TTI measurement in this note |

The components are loaded on demand in the current source, but bundle-size and
user-perceived latency claims require a production build/browser measurement.

### Loading policy

Only conditionally-rendered UI gets lazy treatment. Core editor components are
eagerly loaded because they are always visible.

---

## 5. Offset Pagination → Cursor Pagination

### Problem Statement

The historical design used offset pagination (`skip`/`take`). The current route
supports a cursor in addition to page mode and adds a `(userId, updatedAt)`
index. Query latency and the old page-100/page-500 timings were not measured
by this documentation pass.

### Root Cause

Offset pagination requires the database to read and skip all preceding rows. PostgreSQL cannot use an index to skip rows — it must scan them. With the `File` table lacking a composite index on `(userId, updatedAt)`, the query performed a sequential scan.

### Solution

Added cursor-based pagination using `?cursor=<updatedAt>` as a query parameter. The cursor contains the `updatedAt` timestamp of the last item on the previous page. The next page query filters `WHERE updatedAt < cursor` instead of `SKIP n`. Added a composite index `(userId, updatedAt)` to support the filter.

**Schema** (`apps/http-server/src/routes/files.ts:12-18`):

```typescript
const listFilesQuerySchema = z.object({
  search: z.string().trim().min(1).optional(),
  folderId: z.string().trim().min(1).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  cursor: z.string().optional(),
});
```

**Query logic** (`apps/http-server/src/routes/files.ts:92-148`):

```typescript
const { search, folderId, page, limit, cursor } = parsedQuery.data;
const isCursorBased = typeof cursor === 'string' && cursor.length > 0;
const skip = isCursorBased ? 0 : (page - 1) * limit;

const where = {
  userId: req.userId,
  ...(typeof folderId === 'string' ? { folderId } : {}),
  ...(typeof search === 'string'
    ? { name: { contains: search, mode: 'insensitive' as const } }
    : {}),
  ...(isCursorBased ? { updatedAt: { lt: new Date(cursor) } } : {}),
};

const [files, total] = await Promise.all([
  db.file.findMany({
    where,
    orderBy: { updatedAt: 'desc' },
    skip: isCursorBased ? 0 : skip,
    take: limit,
    select: {
      id: true,
      name: true,
      preview: true,
      folderId: true,
      createdAt: true,
      updatedAt: true,
    },
  }),
  // ... count query (omitted for cursor mode)
]);

const nextCursor =
  files.length === limit ? (files[files.length - 1]?.updatedAt?.toISOString() ?? null) : null;

res.json({
  files,
  total: isCursorBased ? undefined : total,
  page: isCursorBased ? undefined : page,
  limit,
  nextCursor,
});
```

**Database index** (`packages/db/prisma/schema.prisma:100`):

```prisma
@@index([userId, updatedAt])
```

### Impact

| Metric          | Before                    | After                                               |
| --------------- | ------------------------- | --------------------------------------------------- |
| Pagination mode | Offset/page               | Cursor available, with page compatibility retained  |
| Query plan      | Workload-dependent        | Index-assisted in principle; plan not verified here |
| Latency         | No benchmark in this note | No benchmark in this note                           |
| Count query     | Offset mode may count     | Cursor mode skips the count in the current service  |

The cursor implementation is a real code path, but constant-time claims require
`EXPLAIN`/production-like measurements.

### Pagination policy

For list views, the standard approach is infinite scroll with cursor pagination,
identical to this implementation.

---

## 6. Missing Database Indexes

### Problem Statement

Several frequently-queried columns lacked indexes, causing sequential scans on cleanup and lookup queries:

- `ShareLink.roomId` — queried when loading room share links
- `ShareLink.expiresAt` — queried by cleanup cron to delete expired tokens
- `PasswordResetToken.email` — queried when verifying a password reset request
- `File` lacked a composite index on `(userId, updatedAt)` for the dashboard query

Without these indexes, every query scanned the full table. As rows accumulated, query times grew linearly.

### Root Cause

The initial Prisma schema defined foreign keys but did not always add corresponding `@@index` annotations. Prisma automatically creates indexes for `@unique` fields and `@@unique` composites, but not for regular columns used in `WHERE` clauses.

### Solution

Added `@@index` annotations to all affected models in the Prisma schema.

**Before** (missing indexes):

```prisma
model ShareLink {
  roomId    String
  expiresAt DateTime
  // No indexes on roomId or expiresAt
}

model PasswordResetToken {
  email     String
  // No index on email
}

model File {
  userId    String?
  updatedAt DateTime
  // No composite index
}
```

**After** (`packages/db/prisma/schema.prisma:150-175`):

```prisma
model ShareLink {
  id          String   @id @default(cuid())
  token       String   @unique
  roomId      String
  permission  String   @default("VIEW")
  expiresAt   DateTime
  createdById String
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  room    CanvasRoom @relation(fields: [roomId], references: [id])
  createdBy User     @relation(fields: [createdById], references: [id])

  @@index([roomId])    // Added
  @@index([expiresAt]) // Added — for cleanup cron
}

model PasswordResetToken {
  id        String   @id @default(cuid())
  token     String   @unique
  email     String
  expiresAt DateTime
  createdAt DateTime @default(now())

  @@index([email])     // Added — for lookup by email
}

model File {
  // ... fields ...
  @@index([userId])
  @@index([folderId])
  @@index([teamId])
  @@index([updatedAt])
  @@index([userId, updatedAt])  // Added — composite for dashboard query
}
```

Also added `EmailVerificationToken.email` index (`packages/db/prisma/schema.prisma:183`):

```prisma
model EmailVerificationToken {
  // ...
  @@index([email])
}
```

### Impact

| Query                       | Potential benefit               | Evidence                                          |
| --------------------------- | ------------------------------- | ------------------------------------------------- |
| ShareLink by roomId         | Index-assisted lookup           | Schema index exists; query plan not measured here |
| ShareLink expired cleanup   | Range-friendly index            | Daily cleanup exists; plan not measured here      |
| PasswordResetToken by email | Index-assisted lookup           | Schema index exists                               |
| File dashboard list         | Composite index candidate       | Index exists; plan/latency not measured here      |
| Write/storage overhead      | Index maintenance and disk cost | Not claimed to be zero                            |

Indexes can improve selected query plans, but they add write/storage costs and
must be validated with database-specific plans and representative data.

### Scope note

Dripl's persistent PostgreSQL design is a product choice and its query plans still
require measurement.

---

## Summary

| #   | Problem                 | Current code change                                | Evidence status                                            |
| --- | ----------------------- | -------------------------------------------------- | ---------------------------------------------------------- |
| 1   | Full-state broadcasting | Initial `sync_room_state` snapshot + `scene-delta` | Implemented; bandwidth/recovery not benchmarked end-to-end |
| 2   | O(n) element lookups    | `Map` index with incremental updates on many paths | Implemented; no 5,000× speed claim                         |
| 3   | Redundant deriveHistory | Derived history removed; snapshots remain          | Implemented; memory/GC not benchmarked here                |
| 4   | Eager component loading | Four components use `React.lazy`                   | Implemented; bundle/TTI not measured here                  |
| 5   | Offset pagination       | Cursor mode plus page compatibility                | Implemented; query plan/latency not measured here          |
| 6   | Missing DB indexes      | Explicit Prisma indexes added                      | Implemented; write cost and plans require measurement      |

---

## References

- `TODOS.md` — Items #7, #10, #12, #14, #16, #18
- `apps/dripl-app/hooks/useCollaboration.ts` — Delta broadcasting client
- `apps/dripl-app/lib/canvas-store.ts` — Zustand store with elementsById
- `apps/dripl-app/components/canvas/RoughCanvas.tsx` — Lazy-loaded components
- `apps/ws-server/src/validation.ts` — scene-delta Zod schema
- `apps/ws-server/src/index.ts` — scene-delta handler
- `apps/http-server/src/routes/files.ts` — Cursor pagination
- `packages/db/prisma/schema.prisma` — Database indexes
