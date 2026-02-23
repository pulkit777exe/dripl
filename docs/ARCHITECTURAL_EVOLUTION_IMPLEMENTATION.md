# DRIPL Architectural Evolution — Implementation Plan

This document maps the [Architectural Evolution Specification] to the current codebase and outlines concrete implementation steps by phase. It is the working plan for evolving Dripl from a UI-driven canvas editor into a deterministic graphics runtime.

---

## 1. Current State vs. Spec (Gap Analysis)

### 1.1 Layered Dependency Model (Spec §3.1)

**Target:** `common → math → element → runtime → ui/app` (utils isolated).

| Layer   | Current state                                                                                                                                 | Gap                                                                                                                                  |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| common  | `packages/common`: types, Scene, Delta, Actions, Pointer. No dependency on upper layers.                                                      | OK.                                                                                                                                  |
| math    | `packages/math`: imports `@dripl/common` (Point, DriplElement).                                                                               | OK.                                                                                                                                  |
| element | `packages/element`: imports `@dripl/common`.                                                                                                  | OK.                                                                                                                                  |
| runtime | **Missing.** No dedicated runtime package.                                                                                                    | Add a `runtime` (or `core`) package that depends only on common/math/element and exposes Store, Scene engine, History (delta-based). |
| ui/app  | `apps/dripl-app`: imports common (types only), uses Zustand store that holds elements, selection, history, zoom, theme, tools, collaboration. | App contains domain logic (element updates, history, reconciliation); must depend on runtime and only dispatch intent.               |

**Constraint:** Lower layers MUST NOT import upper layers. UI MUST NOT contain domain logic. Renderer MUST remain pure.

---

### 1.2 Scene (Element Collection Engine) — Spec §4.1

**Target:** Dual-map model (`elementsMap`, `nonDeletedElementsMap`), cached `orderedElements`, explicit reindexing, O(1) lookup, ordering stability.

| Current                                                                    | Location                             | Gap                                                                                                                                              |
| -------------------------------------------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Single `Map<string, DriplElement>`; soft delete via `isDeleted`.           | `packages/common/src/scene.ts`       | No dual-map; no cached ordered array; no explicit reindexing. Selection/editing state live on Scene (spec may allow or require moving to Store). |
| App state holds `elements: DriplElement[]` and `selectedIds: Set<string>`. | `apps/dripl-app/lib/canvas-store.ts` | Element storage is in UI store, not in a dedicated Scene engine.                                                                                 |

**Required changes:**

- In `packages/common` (or runtime): introduce dual-map Scene with `elementsMap`, `nonDeletedElementsMap`, cached `orderedElements`, reindexing.
- Migrate element storage from Zustand into this Scene; app store holds reference/snapshot for rendering and passes intent to Store.

---

### 1.3 Store (State Evolution Engine) — Spec §4.2

**Target:** StoreSnapshot, StoreDelta, `commit(update, captureMode)`, maybeClone, diff(snapshotA, snapshotB). Capture modes: IMMEDIATELY, CAPTURE_ONCE, EPHEMERAL, NEVER.

| Current                                                                            | Location                             | Gap                                                                                           |
| ---------------------------------------------------------------------------------- | ------------------------------------ | --------------------------------------------------------------------------------------------- |
| No StoreSnapshot/StoreDelta.                                                       | —                                    | All new.                                                                                      |
| Zustand `set()` with ad-hoc updates (`addElement`, `updateElement`, `undo`, etc.). | `apps/dripl-app/lib/canvas-store.ts` | No single commit contract; no capture mode; UI-driven mutations.                              |
| common has Delta + DeltaManager, Action types + ActionReducer.                     | `packages/common`                    | Not used by app. Reducer returns new Scene and can record deltas but is not wired to a Store. |

**Required changes:**

- Introduce StoreSnapshot (e.g. scene snapshot + selection + viewport/metadata as needed).
- Introduce StoreDelta (reversible delta, e.g. linking to `packages/common` Delta).
- Introduce Store with `commit(update, captureMode)` where `update` produces next snapshot; Store applies update, optionally pushes delta to History based on captureMode.
- maybeClone: clone only when necessary (e.g. when captureMode says capture).
- diff(snapshotA, snapshotB): for debugging, sync, or history.
- Move all scene-evolving logic behind this Store (no direct `setElements`/`updateElement` from UI).

---

### 1.4 History (Delta Engine) — Spec §4.3

**Target:** Delta-only history, reversible deltas, delta inversion, unlimited undo depth, memory stability, multiplayer compatibility.

| Current                                                               | Location                                | Gap                                                                                                          |
| --------------------------------------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Snapshot history: `history: DriplElement[][]`, `historyIndex`.        | `apps/dripl-app/lib/canvas-store.ts`    | Snapshot-heavy; bounded (implicit by array length); not delta-based.                                         |
| `CanvasHistory`: `HistoryState[]` (elements + selectedIds).           | `apps/dripl-app/utils/canvasHistory.ts` | Snapshot-based; used by `useHistory` with setElements/setSelectedIds.                                        |
| common: `SceneHistory` stores `{ scene, delta? }[]` and has max size. | `packages/common/src/delta.ts`          | Still snapshot-per-entry; delta is optional. DeltaManager has apply/revert; good basis for delta-only stack. |

**Required changes:**

- Replace snapshot history with a delta stack: push/pop deltas; current state = apply(deltas) from a baseline (or recompute from initial + deltas).
- Ensure every delta is reversible (invert); implement stack-clearing rules (e.g. on branch).
- Use same delta format for multiplayer sync (spec §8).
- Remove or deprecate `CanvasHistory` and store’s `history: DriplElement[][]` once delta history is in place.

---

### 1.5 Renderer (Projection Engine) — Spec §4.4

**Target:** Pure `Frame = Render(State)`. No Scene/Store mutation. Visibility filtering, derived geometry caching, version-based cache invalidation.

| Current                             | Location                                                                                         | Gap                                                                                                                    |
| ----------------------------------- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| Rendering reads elements and draws. | `packages/element/src/renderer.ts`, `apps/dripl-app/.../RoughCanvas.tsx`, `DualCanvas.tsx`, etc. | Must audit: no mutable writes to Scene/Store. Add visibility filtering and derived-geometry cache with version checks. |
| Viewport culling exists.            | `apps/dripl-app/utils/viewport-culling.ts`                                                       | Keep; integrate with renderer so only visible elements are rendered.                                                   |

**Required changes:**

- Formalize renderer as a pure function of (state, viewport).
- Add visibility filtering and derived geometry caches with version-based invalidation (element version or scene version).
- Forbidden: any code path in renderer that mutates Scene or Store.

---

### 1.6 Action System (Intent Engine) — Spec §4.5

**Target:** Action interface; normalize intent from UI, Keyboard, API, CommandPalette; centralize command logic; predicate & keyTest discipline.

| Current                                                                                            | Location                               | Gap                                                                                                                                                               |
| -------------------------------------------------------------------------------------------------- | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| common: Action types (ADD_ELEMENT, UPDATE_ELEMENT, …), ActionCreator, ActionReducer.               | `packages/common/src/actions.ts`       | Not used by app. Good basis for intent normalization.                                                                                                             |
| App: ActionManager with `perform(elements, appState) → ActionResult`, updater, predicate, keyTest. | `apps/dripl-app/utils/actionSystem.ts` | Intent sources (UI, keyboard, etc.) exist; logic is in perform() which returns elements/appState updates. Not yet “Intent → Action → Store”; Store doesn’t exist. |

**Required changes:**

- Unify on a single Action abstraction: either adopt common’s Action type or define a bridge so app actions produce common-style actions (or deltas).
- All intent (UI, keyboard, API, command palette) goes through this layer and results in Store commits (no direct store mutations).
- Centralize command logic; avoid tool-specific mutation branches in components.

---

### 1.7 Interaction Engine (Pointer System) — Spec §4.6

**Target:** PointerDownState snapshot; freeze originalElements baseline; baseline-derived solver (no incremental drift).

| Current                                                                                      | Location                                         | Gap                                                                                                          |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| PointerManager, DragDetector (down/move/up, positions).                                      | `packages/common/src/pointer.ts`                 | No PointerDownState snapshot of “element state at pointer down”; no baseline.                                |
| useElementManipulation: moveElements(delta), resizeElement(handle, newPoint), rotateElement. | `apps/dripl-app/hooks/useElementManipulation.ts` | Incremental: calls updateElement repeatedly with new coords; no single baseline-derived apply at pointer up. |

**Required changes:**

- On pointer down: capture PointerDownState (elements involved, e.g. selected, and their state at that moment).
- During drag: compute new geometry from baseline + pointer delta (or from current pointer position and constraints), not by accumulating updates.
- On pointer up: commit a single delta (e.g. UPDATE_ELEMENT) from baseline to final state.
- Eliminate incremental drag solvers that apply many small updates.

---

### 1.8 Element Model & Invariants — Spec §5

| Item                            | Current                                                                      | Gap                                                                                                                            |
| ------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Immutability                    | Elements are replaced with new objects in Scene/store; no in-place mutation. | Enforce strictly: no mutable updates to element references held in Scene/Store.                                                |
| Version / versionNonce          | ElementBase has `version`, `versionNonce`, `updated`.                        | Ensure versionNonce regenerated on each update; use for cache invalidation and multiplayer.                                    |
| LinearElement.points[0] = [0,0] | Not enforced.                                                                | Normalize linear elements to local coords; origin at first point.                                                              |
| Frame / binding                 | frameId, bindings exist in types.                                            | Enforce frameId unidirectional refs, ordering; replace coordinate-based bindings with Binding { elementId, fixedPoint, mode }. |

---

### 1.9 Update Classification — Spec §6

**Target:** Capture modes per update type (e.g. Hover → NEVER, Dragging → EPHEMERAL, Drop → CAPTURE_ONCE, Explicit Edit → IMMEDIATELY).

| Current                                                                                                   | Gap                                                                                                                                                        |
| --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No formal capture mode. pushHistory() is called explicitly in places; store undo/redo use full snapshots. | Introduce captureMode on commit; history only records when mode says so. Ephemeral for drag preview; capture once on drop; immediately for explicit edits. |

---

## 2. Phase 1 — Structural Stability (Spec §11)

Goal: Enforce dependency rules, introduce invariants, separate Scene & Store.

### 2.1 Dependency Rules

- [x] **Document** the layer rule in `ARCHITECTURE.md`: `common → math → element → runtime → ui/app`; utils isolated; no lower→upper imports; UI no domain logic.
- [x] **Add** a `runtime` (or `core`) package: depends only on `@dripl/common`, `@dripl/math`, `@dripl/element`. No dependency on `apps/dripl-app` or `packages/dripl`.
- [ ] **Lint/CI:** Enforce that `apps/dripl-app` does not import domain logic from paths that should live in runtime (e.g. no direct element mutation helpers in app except via a single Store facade).

### 2.2 Scene Separation

- [ ] **Extend** `packages/common` (or move to runtime) Scene to dual-map model:
  - `elementsMap`: all elements (including deleted).
  - `nonDeletedElementsMap`: active only; or derive from elementsMap + isDeleted.
  - Cached `orderedElements` array, invalidated on add/delete/order change; reindexing function.
- [ ] **O(1)** getElement(id); ordering guarantees for frames (e.g. children index < frame index).
- [ ] **Decision:** Keep selection/editingTextId on Scene or move to Store snapshot. Spec says “Extract element storage from UI store”; selection can live in StoreSnapshot.

### 2.3 Store Abstraction (Minimal for Phase 1)

- [x] **Define** in runtime (or common):
  - `StoreSnapshot`: at minimum scene (or scene state: elements + ordering), selection, and any view state that must round-trip (e.g. editingTextId).
  - `CaptureMode`: `IMMEDIATELY` | `CAPTURE_ONCE` | `EPHEMERAL` | `NEVER`.
  - `StoreDelta`: reversible delta (can wrap or align with `packages/common` Delta).
  - `Store.commit(action, captureMode)`: apply action via ActionReducer; if captureMode says capture, push delta to History. maybeClone when capturing.
- [x] **Single path:** First migrated path: add element (e.g. rectangle) via Store.commit; rest of app can still use existing store until Phase 2.

### 2.4 Invariants (Documented and Enforced)

- [x] **Document** in ARCHITECTURE.md: Element immutability; state transitions only via Store; renderer does not mutate Scene/Store.
- [ ] **Add** runtime checks in dev: e.g. Object.freeze of snapshot or elements in dev mode; or immutable data structures for Scene.

### 2.5 App Wiring (Minimal)

- [ ] **Introduce** a small “bridge” in app: a Store instance (from runtime) that owns Scene and (later) delta History. App Zustand store can hold: view state only (zoom, pan, theme, activeTool, remoteCursors, etc.) and a reference to “current snapshot” or subscribe to Store for current snapshot.
- [x] **First migration step:** One use case (e.g. “add rectangle”) goes through Store.commit + common Action type; rest of app can still use existing store until Phase 2.

---

## 3. Phase 2 — State Evolution Stability (Summary)

- **Done:** Delta-only history in runtime Store; undo/redo delegate from canvas-store to Store when runtime is in use; single source of truth for history when using runtime.
- **Remaining:** maybeClone and diff(snapshotA, snapshotB) for efficiency and debugging.

## 4. Phase 3 — Interaction Stability (Summary)

- **Done:**
  - `PointerDownState` in `packages/common/src/pointer.ts`.
  - **Baseline-derived move:** `apps/dripl-app/utils/dragBaseline.ts` — `captureDragBaseline`, `getDragTargetIds`, `applyDeltaToBaseline`, `mergeDragPreview`.
  - **RoughCanvas:** On pointer down (select + on element) capture baseline; on move only update `dragTotalDelta` (no store writes); on pointer up apply `applyDeltaToBaseline` once and `Store.commitBatch(actions, "CAPTURE_ONCE")` or legacy path. Single undo step for whole drag.
  - **Store:** `commitBatch(actions, captureMode)` so one undo reverts an entire batch.
- **Remaining:** Resize/rotate could use the same baseline pattern (capture on start, commit on end).

## 5. Phase 4 — Constraint Stability (Summary)

- **Done:**
  - `NormalizedBinding` and `BindingMode` in `packages/common/src/types/element.ts` (elementId, fixedPoint, mode).
  - **Constraint helpers in `@dripl/math`:** `packages/math/src/constraints.ts` — `deriveBindingEndpoint(element, fixedPoint)`, `getBindingEndpoint(binding, elements)`, `boundsContain`, `isElementInFrame`, `getOrderedElementsWithFrames`. Endpoints derived from fixedPoint + element bounds; linear elements use fixedPoint.x as t along the path. Frame ordering: children before frame when `frameId` is present.
- **Remaining:** Wire `getBindingEndpoint` into arrow/connector rendering when migrating to NormalizedBinding.

## 6. Phase 5 — Projection Stability (Summary)

- **Done:**
  - **Viewport culling in main canvas path:** `StaticCanvas` and `InteractiveCanvas` use `getVisibleElements(elements, viewport)` (via `useMemo`) and render only visible elements.
  - **Cache by version/hash:** `getVisibleElements(elements, viewport, sceneVersion?)` — cache key is optional `sceneVersion` or a cheap hash (`length` + first/last element id); no `JSON.stringify` for invalidation. `CanvasRenderer` passes `sceneNonce` as `sceneVersion`.
- **Remaining:** Document or enforce renderer purity; RAF-throttled updates if needed.

---

## 7. File-Level Checklist (Phase 1)

| Task                                     | Files to create/modify                                                                                                                                              |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Document dependency rules                | `ARCHITECTURE.md`                                                                                                                                                   |
| Add runtime package                      | `packages/runtime/` (or `packages/core/`): package.json, tsconfig, index, store, scene-adapter, types.                                                              |
| Scene dual-map                           | `packages/common/src/scene.ts` (or runtime): dual-map, orderedElements cache, reindex.                                                                              |
| StoreSnapshot / StoreDelta / CaptureMode | New in runtime: e.g. `store/snapshot.ts`, `store/delta.ts`, `store/capture.ts`.                                                                                     |
| Store.commit + maybeClone                | Runtime: `store/store.ts`.                                                                                                                                          |
| Bridge in app                            | `apps/dripl-app/lib/` or `apps/dripl-app/store/`: create store instance, subscribe to snapshot; optionally migrate one flow (e.g. add element) to use Store.commit. |
| Lint / no domain logic in UI             | ESLint rule or module boundaries (e.g. nx or turbo boundaries): app cannot import from runtime’s store implementation except via a single facade.                   |

---

## 8. Maintainability

- **Single responsibility:** Drag math lives in `utils/dragBaseline.ts`; Store and history in `@dripl/runtime`; bridge in `lib/runtime-store-bridge.ts`.
- **Single path for scene changes:** When the runtime store is used, all scene-evolving actions go through `Store.commit` or `Store.commitBatch`; UI only dispatches intent.
- **Clear data flow:** Pointer down → capture baseline; move → ephemeral preview (mergeDragPreview); pointer up → one commit batch.
- **Types:** `PointerDownState`, `StoreSnapshot`, `CaptureMode`, `NormalizedBinding` are in `@dripl/common` / `@dripl/runtime` for reuse and tests.

## 9. References

- **Spec:** DRIPL Architectural Evolution Specification (change proposal document).
- **Current architecture:** `ARCHITECTURE.md` (project root).
- **Key modules:** `packages/common` (Scene, Delta, Actions, Pointer, PointerDownState, NormalizedBinding); `packages/runtime` (Store, commit, commitBatch, replaceSnapshot); `apps/dripl-app/utils/dragBaseline.ts`; `apps/dripl-app/lib/runtime-store-bridge.ts`; `apps/dripl-app/lib/canvas-store.ts`.

[Architectural Evolution Specification]: See the change proposal document (DRIPL ARCHITECTURAL EVOLUTION SPECIFICATION) in project docs or repo root.
