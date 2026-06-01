# Engineering Review — Dripl Application

**Date**: 2026-04-13  
**Mode**: BIG CHANGE (Full Review)  
**Reviewer**: Kilo (Eng Plan Review Mode)

---

## Step 0: Scope Challenge

### What Existing Code Already Solves

| Sub-problem        | Existing Code            | Location                                             |
| ------------------ | ------------------------ | ---------------------------------------------------- |
| State management   | Zustand store (complete) | `apps/dripl-app/lib/canvas-store.ts`                 |
| Element rendering  | packages/element         | `packages/element/src/renderElement.ts`              |
| History/undo       | Zustand 100-step         | `apps/dripl-app/lib/canvas-store.ts`                 |
| Real-time sync     | ws-server debounced      | `apps/ws-server/src/index.ts`                        |
| Auth               | JWT + cookie sessions    | `apps/http-server/src/middlewares/authMiddleware.ts` |
| File storage       | Prisma + IndexedDB       | `packages/db/src/index.ts`                           |
| Element validation | Zod schemas              | `packages/common/src/schemas.ts`                     |

### Minimum Changes Required

The codebase is functional with no critical issues. Review found:

- 0 authorization gaps in the reviewed routes
- 1 logging standardization item (low effort, high value)
- 1 coverage refresh item (medium priority)

### Complexity Check

- Files touched by typical feature: 2-4
- New classes/services needed: 1-2
- **Smell level**: LOW

---

## Section 1: Architecture Review

### 1A: Ownership Checks Already Present

**Issue**: The earlier auth gap is resolved. File, folder, and room routes already scope queries by `req.userId` or `ownerId`.

**Location**: `apps/http-server/src/routes/files.ts`, `apps/http-server/src/routes/folders.ts`, `apps/http-server/src/controllers/roomController.ts`

**Risk**: Low, unless new routes are added without the same ownership scoping.

**Recommended**: Keep the existing ownership checks in sync as new endpoints are added.

---

### 1B: WebSocket Single Point of Failure

**Issue**: No horizontal scaling for ws-server. All rooms stored in single process memory.

**Location**: `apps/ws-server/src/index.ts` (rooms Map, line 80)

**Risk**: Process crash = all active room state lost (though disk backup exists).

**Options**:

- **A) Keep single instance** — Document limitation, graceful shutdown saves (effort: 0)
- **B) Add Redis pub/sub** — Scale horizontally with shared state (effort: L)
- **C) Add PM2 clustering** — Simple process clustering (effort: S)

**Recommended**: **A** — Current architecture is fine for MVP. Document limitation.

---

### 1C: Historical Runtime Package Was Removed

**Note**: `packages/runtime` was deleted in commit `68224ee`; shared test helpers now live in `packages/test-utils`, and app state lives in `apps/dripl-app/lib/canvas-store.ts`.

**Status**: Resolved

---

## Section 2: Code Quality Review

### 2A: Inconsistent Logging (~100 console statements)

**Issue**: Mix of formats across codebase.

**Examples**:

```typescript
// ws-server (JSON)
console.log(JSON.stringify({ level: 'info', event: 'save_room_success', ... }));

// server code mostly uses JSON, but app/utilities still have plain console calls
console.error('Failed to save canvas to IndexedDB:', error);
```

**Impact**: Hard to parse in production, inconsistent debugging.

**Options**:

- **A) Add pino** — Full structured logging (effort: M)
- **B) Standardize JSON** — Use JSON format everywhere (effort: S)
- **C) Keep as-is** — Works for dev (effort: 0)

**Recommended**: **B** — Quick win for consistency without new dependencies.

---

### 2B: Large Component File (RoughCanvas.tsx - 2091 lines)

**Issue**: Main canvas component is 2091 lines, difficult to maintain.

**Location**: `apps/dripl-app/components/canvas/RoughCanvas.tsx`

**Already extracted**: SelectionOverlay, NameInputModal, CollaboratorsList, RemoteCursors, PropertiesPanel, ContextMenu, DualCanvas

**Could extract**: Tool handlers, keyboard shortcuts, gesture handling

**Options**:

- **A) Keep as-is** — Works, team familiar
- **B) Extract by feature** — Group tool/gesture logic (effort: M)
- **C) Split by responsibility** — Separate canvas logic from UI (effort: L)

**Recommended**: **B** — Component already has extracted sub-components, could extract more feature groups.

---

### 2C: DRY Violation - History Logic

**Issue**: History logic exists in multiple layers:

| Location                                 | Lines | Role |
| ---------------------------------------- | ----- | ---- |
| `apps/dripl-app/lib/canvas-store.ts`     | 777   | Canonical app canvas history |
| `apps/dripl-app/hooks/useHistory.ts`     | ~50   | Local hook wrapper |
| `apps/dripl-app/utils/canvasHistory.ts`  | ~60   | Local history helper |
| `packages/dripl/src/store/index.ts`      | ~400  | Library store history |
| `packages/dripl/src/utils/history.ts`    | ~70   | Library history helper |

**Recommended**: Keep the app and package layers separate unless `@dripl/dripl` becomes the canonical runtime state library for the app.

---

## Section 3: Test Review

### Test Diagram

| Codepath             | Test Type   | Exists       | Happy Path | Failure | Edge Case  |
| -------------------- | ----------- | ------------ | ---------- | ------- | ---------- |
| WebSocket validation | Unit        | ✅ 221 lines | ✅         | ✅      | ✅         |
| Element schemas      | Unit        | ✅           | ✅         | ✅      | ⚠️ Limited |
| Common element types | Unit        | ✅           | ✅         | ❌      | ❌         |
| Math geometry        | Unit        | ✅           | ✅         | ⚠️      | ❌         |
| Utils storage        | Unit        | ✅           | ✅         | ✅      | ✅         |
| HTTP routes          | Integration | ✅           | ✅         | ✅      | ⚠️ Limited |
| Dripl store          | Unit        | ✅           | ✅         | ⚠️      | ❌         |
| Element factory      | Unit        | ✅           | ✅         | ❌      | ❌         |

---

### 3A: element Package Has Tests

**Issue**: `packages/element` now has resize and helper tests, but render-path coverage is still limited.

**Critical files**: `resizeElements.ts`, `rough-renderer.ts`, `staticScene.ts`

**Recommended**: Expand coverage only where rendering regressions are likely.

---

### 3B: math Package Has Tests

**Issue**: `packages/math` now has geometry and hit-detection suites, but edge-case coverage can still grow.

**Critical functions**: intersection, collision, hit-detection

**Recommended**: Add targeted edge-case tests where geometry bugs are most likely.

---

### 3C: Common Package - Limited Failure Tests

**Issue**: Only happy path tests exist in `element.test.ts`.

**Missing**: Invalid element types, malformed data, boundary conditions

**Options**:

- **A) Add invalid input tests** — Test schema rejection (effort: S)
- **B) Add boundary tests** — Zero, negative, extreme values (effort: S)
- **C) Keep current** — (effort: 0)

**Recommended**: **A** — Schema validation is critical for security.

---

## Section 4: Performance Review

### 4A: Database Indexes

**Finding**: Prisma automatically adds indexes on `@relation` fields. No explicit indexes needed.

**Schema review**:

```prisma
model File {
  userId    String?
  folderId  String?
  teamId    String?
  // Relations automatically indexed
}
```

**Status**: ✅ OK - Prisma handles this.

---

### 4B: N+1 Queries

**Finding**: No obvious N+1 patterns in reviewed code.

**Status**: ✅ OK

---

### 4C: Memory Usage

**Finding**: Room state stored in-memory in ws-server (`rooms` Map).

**Risk**: High for very active rooms with many elements.

**Status**: ⚠️ Known limitation - acceptable for MVP.

---

## Completion Summary

```
+====================================================================+
|            ENGINEERING REVIEW — COMPLETION SUMMARY                 |
+====================================================================+
| Mode selected        | BIG CHANGE (Full Review)                    |
| Step 0               | Scope: clean, minimal changes needed        |
| Section 1 (Arch)     | 1 issue (WS scaling)                        |
| Section 2 (Quality)  | 3 issues (logging, large file, DRY)         |
| Section 3 (Tests)    | 3 issues (element coverage, math edge cases, common input validation) |
| Section 4 (Perf)     | OK - indexes, N+1, memory acceptable       |
+--------------------------------------------------------------------+
| NOT in scope         | CRDT, horizontal scaling, full metrics     |
| What already exists  | History, validation, rate limit, health    |
| TODOS.md updates     | 0 items (user selections captured)         |
| Diagrams produced    | Architecture, Test table                   |
+====================================================================+
```

---

## Recommendations Summary

| Section | Issue                      | Selected | Rationale                            |
| ------- | -------------------------- | -------- | ------------------------------------ |
| 1A      | Ownership checks present   | N/A      | Already enforced on reviewed routes  |
| 1B      | WS single instance         | A        | Fine for MVP, document limitation    |
| 1C      | Runtime package removed     | N/A      | Historical note                      |
| 2A      | Inconsistent logging       | B        | Standardize JSON - quick win         |
| 2B      | Large RoughCanvas          | B        | Extract by feature - maintainable    |
| 2C      | DRY history                | B        | Remove duplicate - simplify          |
| 3A      | element coverage           | B        | Rendering tests exist, expand if needed |
| 3B      | math edge cases            | A        | Low effort, catches bugs             |
| 3C      | common invalid input       | A        | Schema validation critical           |
| 4A-4C   | Performance                | OK       | No issues found                      |

---

## Action Items

| Priority | Item                                      | Owner | Effort |
| -------- | ----------------------------------------- | ----- | ------ |
| P2       | Standardize JSON logging format           | Dev   | S      |
| P2       | Add math edge case tests                  | Dev   | S      |
| P2       | Add schema rejection tests                | Dev   | S      |
| P3       | Document canvas store boundaries          | Dev   | S      |
| P3       | Refresh coverage report                   | Dev   | S      |
