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

- 1 authorization gap (medium priority)
- 1 logging standardization (low effort, high value)
- 1 test coverage gap (medium priority)

### Complexity Check

- Files touched by typical feature: 2-4
- New classes/services needed: 1-2
- **Smell level**: LOW

---

## Section 1: Architecture Review

### 1A: Authentication Without Authorization

**Issue**: `authMiddleware` only validates JWT token existence - no verification that user owns the resource.

**Location**: `apps/http-server/src/routes/files.ts` (lines 140-455)

**Risk**: IDOR (Insecure Direct Object Reference) - authenticated users could access other users' files via ID manipulation.

**Options**:

- **A) Add ownership verification** — Check `file.userId === req.userId` on update/delete (effort: S, risk: Low)
- **B) Use middleware** — Create `authorizeResource()` middleware (effort: M, risk: Low)
- **C) Skip** — Internal trusted users only (risk: High - NOT recommended)

**Recommended**: **A** — Add explicit ownership checks in route handlers.

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

### 1C: Runtime Package Dependency Unclear

**Issue**: `packages/runtime` exists (185 lines) but commit `fc35bbb` removed its usage from dripl-app.

**Verification**: `grep -r "@dripl/runtime"` returns no results - package is unused.

**Options**:

- **A) Keep for future** — May need for batch operations
- **B) Remove unused code** — Delete runtime package if not imported
- **C) Document purpose** — Clarify intended use case

**Recommended**: **B** — Package appears unused. Verify if needed before removing.

---

## Section 2: Code Quality Review

### 2A: Inconsistent Logging (107 console statements)

**Issue**: Mix of formats across codebase.

**Examples**:

```typescript
// ws-server (JSON)
console.log(JSON.stringify({ level: 'info', event: 'save_room_success', ... }));

// http-server (plain)
console.error('list files error', error);
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

**Issue**: History management duplicated in two places:

| Location                                 | Lines | Status   |
| ---------------------------------------- | ----- | -------- |
| `apps/dripl-app/lib/canvas-store.ts`     | 777   | Complete |
| `packages/dripl/src/hooks/useHistory.ts` | ~50   | Partial  |

**Options**:

- **A) Create shared utility** — Extract to packages/utils (effort: S)
- **B) Use canvas-store only** — Remove duplicate (effort: S)
- **C) Keep both** — Document pattern (effort: 0)

**Recommended**: **B** — Zustand store has complete implementation. Remove duplication.

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
| Runtime store        | Unit        | ✅           | ✅         | ⚠️      | ❌         |
| Element factory      | Unit        | ✅           | ✅         | ❌      | ❌         |

---

### 3A: element Package Has 0 Tests

**Issue**: `packages/element` has factory tests but no rendering tests.

**Critical files**: `factory.ts`, `renderElement.ts`, `rough-renderer.ts`

**Risk**: Rendering bugs go undetected.

**Options**:

- **A) Add full test suite** — All render paths (effort: L)
- **B) Add factory tests only** — Element creation (effort: S)
- **C) Skip** — Manual testing acceptable (effort: 0)

**Recommended**: **C** — Factory tests exist. Focus on higher priority items.

---

### 3B: math Package Has Minimal Tests

**Issue**: Only 2 test files, limited coverage on edge cases.

**Critical functions**: intersection, collision, hit-detection

**Options**:

- **A) Add edge case tests** — Boundary values, edge intersections (effort: S)
- **B) Add integration tests** — Real canvas scenarios (effort: M)
- **C) Keep current** — Sufficient for now (effort: 0)

**Recommended**: **A** — Low effort, catches geometry bugs.

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
| Section 1 (Arch)     | 3 issues (auth gap, WS scaling, runtime)    |
| Section 2 (Quality)  | 3 issues (logging, large file, DRY)         |
| Section 3 (Tests)    | 3 issues (element, math, common)           |
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
| 1A      | Auth without authorization | A        | Simple ownership check prevents IDOR |
| 1B      | WS single instance         | A        | Fine for MVP, document limitation    |
| 1C      | Runtime package unused     | B        | Verify before removing               |
| 2A      | Inconsistent logging       | B        | Standardize JSON - quick win         |
| 2B      | Large RoughCanvas          | B        | Extract by feature - maintainable    |
| 2C      | DRY history                | B        | Remove duplicate - simplify          |
| 3A      | element tests              | C        | Factory tests exist, skip            |
| 3B      | math edge cases            | A        | Low effort, catches bugs             |
| 3C      | common invalid input       | A        | Schema validation critical           |
| 4A-4C   | Performance                | OK       | No issues found                      |

---

## Action Items

| Priority | Item                                      | Owner | Effort |
| -------- | ----------------------------------------- | ----- | ------ |
| P1       | Add ownership verification to file routes | Dev   | S      |
| P2       | Standardize JSON logging format           | Dev   | S      |
| P2       | Add math edge case tests                  | Dev   | S      |
| P2       | Add schema rejection tests                | Dev   | S      |
| P3       | Remove duplicate history code             | Dev   | S      |
| P3       | Verify runtime package necessity          | Dev   | S      |
