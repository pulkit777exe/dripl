import type { DriplElement, LinearElement } from '@dripl/common';
import { logError } from '@dripl/common';
import { isPointNearElement } from '@dripl/math/intersection';
import { resizeSingleElement } from '@dripl/element/resizeElements';
import type { ActiveTool } from '@/lib/store';
import type { ToolType } from '@/hooks/useDrawingTools';
import type { ToolStartOptions, ToolUpdateOptions } from '@/lib/draw/tool-state';
import type { ResizeHandle } from '@/components/canvas/SelectionOverlay';
import { buildBoundArrowsByShape, resolveGestureUpdates } from '@/lib/canvas/binding-sync';
import {
  groupResizeMapping,
  groupRotateMapping,
  normalizeRotationDelta,
  unionFrame,
} from '@/lib/canvas/group-transform';
import { computeRotationAngle } from '@/lib/canvas/rotation';
import {
  computeBoxResize,
  dragLinearPoint,
  insertLinearMidpoint,
  shouldPushHistory,
} from '@/lib/canvas/resize-geometry';
import { handleDoubleClick } from '@/lib/canvas/double-click';
import {
  finalizeDragGesture,
  finalizeResizeGesture,
  finalizeRotateGesture,
} from '@/lib/canvas/gesture-teardown';
import { matchMarqueeElements, normalizeMarquee } from '@/lib/canvas/marquee';
import { dropImageFiles } from '@/lib/canvas/image-drop';
import { pinchDistance, pinchMidpoint, pinchZoomTransform } from '@/lib/canvas/pinch';
import {
  findBindableElementAtPoint,
  bindArrowToElement,
  unbindArrowFromElement,
} from '@/utils/arrow-binding';
import { calculateArrowBinding } from '@/utils/arrow-routing';

/**
 * Screen-space press-then-move threshold before a press becomes a drag or a
 * marquee. Below it the gesture is a click: selection still applies on
 * pointer-down, but nothing else arms.
 */
export const CLICK_DRAG_THRESHOLD_PX = 4;

export function clickDragThresholdWorld(zoom: number): number {
  return CLICK_DRAG_THRESHOLD_PX / Math.max(zoom, 0.1);
}

export interface InteractionState {
  panning: boolean;
  panStartClient: { x: number; y: number } | null;
  isSpacePressed: boolean;
  dragStartCanvasPos: { x: number; y: number } | null;
  dragInitialElements: Map<string, DriplElement> | null;
  dragging: boolean;
  /**
   * Press recorded but not yet a drag: selection is applied on pointer-down,
   * but locks, history and `isDragging` wait until the pointer travels past
   * CLICK_DRAG_THRESHOLD_PX (screen). A plain click therefore never churns
   * collaboration locks or writes an undo step.
   */
  pendingDrag: {
    startPos: { x: number; y: number };
    snapshot: Map<string, DriplElement>;
  } | null;
  /** Empty-press recorded but not yet a marquee (same threshold gating). */
  pendingMarqueeStart: { x: number; y: number } | null;
  historyPushed: boolean;
  resizing: boolean;
  resizeHandle: string | null;
  resizeStartCanvasPos: { x: number; y: number } | null;
  resizeInitialEl: DriplElement | null;
  /** Multi-selection resize baseline: one frozen clone per selected element. */
  resizeInitialEls: Map<string, DriplElement> | null;
  /** Union frame of the multi-selection at gesture start. */
  resizeGroupFrame: { x: number; y: number; width: number; height: number } | null;
  rotating: boolean;
  rotateInitialEl: DriplElement | null;
  /** Multi-selection rotate baseline + center/angle at gesture start. */
  rotateInitialEls: Map<string, DriplElement> | null;
  rotateCenter: { x: number; y: number } | null;
  rotateStartAngle: number;
  touchPointers: Map<number, { x: number; y: number }>;
  pinchStartDistance: number;
  pinchStartMid: { x: number; y: number } | null;
  pinchStartZoom: number;
  pinchStartPan: { x: number; y: number };
  boundArrowsByShape: Map<string, Set<string>>;
  bindingIndexReady: boolean;
}

export function createInteractionState(): InteractionState {
  return {
    panning: false,
    panStartClient: null,
    isSpacePressed: false,
    dragStartCanvasPos: null,
    dragInitialElements: null,
    dragging: false,
    pendingDrag: null,
    pendingMarqueeStart: null,
    historyPushed: false,
    resizing: false,
    resizeHandle: null,
    resizeStartCanvasPos: null,
    resizeInitialEl: null,
    resizeInitialEls: null,
    resizeGroupFrame: null,
    rotating: false,
    rotateInitialEl: null,
    rotateInitialEls: null,
    rotateCenter: null,
    rotateStartAngle: 0,
    touchPointers: new Map(),
    pinchStartDistance: 0,
    pinchStartMid: null,
    pinchStartZoom: 1,
    pinchStartPan: { x: 0, y: 0 },
    boundArrowsByShape: new Map(),
    bindingIndexReady: false,
  };
}

export interface CanvasInteractionViewState {
  hoveredBindingId: string | null;
  startPointBindingId: string | null;
}

export interface CanvasInteractionHandlers {
  handlePointerDown: (e: React.PointerEvent<HTMLCanvasElement>) => void;
  handlePointerMove: (e: React.PointerEvent<HTMLCanvasElement>) => void;
  handlePointerUp: (e?: React.PointerEvent) => void;
  handlePointerCancel: () => void;
  handleDragOver: (e: React.DragEvent) => void;
  handleDrop: (e: React.DragEvent) => Promise<void>;
}

export interface CanvasInteractionSnapshot {
  elements: readonly DriplElement[];
  elementsById: ReadonlyMap<string, DriplElement>;
  selectedIds: ReadonlySet<string>;
  activeTool: ActiveTool;
  isDrawing: boolean;
  zoom: number;
  panX: number;
  panY: number;
  marqueeSelection: {
    start: { x: number; y: number };
    end: { x: number; y: number };
    active: boolean;
  } | null;
  marqueeSelectionMode: 'intersecting' | 'enclosing';
  elementLocks: ReadonlyMap<string, string>;
  userId: string;
  gridEnabled: boolean;
  gridSize: number;
  isEditingElementId: string | null;
  draftElement: DriplElement | null;
  /** Current style/drawing defaults for new shapes. */
  currentStrokeColor: string;
  currentBackgroundColor: string;
  currentStrokeWidth: number;
  currentRoughness: number;
  currentStrokeStyle: 'solid' | 'dashed' | 'dotted';
  currentFillStyle:
    | 'hachure'
    | 'solid'
    | 'zigzag'
    | 'cross-hatch'
    | 'dots'
    | 'dashed'
    | 'zigzag-line';
  currentArrowStyle?: 'straight' | 'curved' | 'elbow';
}

export interface CanvasInteractionStorePort {
  getSnapshot(): CanvasInteractionSnapshot;
  setSelectedIds(ids: Set<string>): void;
  clearSelection(): void;
  setIsDragging(active: boolean): void;
  setIsPanning(active: boolean): void;
  setIsResizing(active: boolean): void;
  setIsRotating(active: boolean): void;
  setIsDrawing(active: boolean): void;
  setTextInput(
    state: { x: number; y: number; id: string; value?: string; existingElementId?: string } | null
  ): void;
  setCursorPosition(pos: { x: number; y: number } | null): void;
  setMarqueeSelection(
    selection: {
      start: { x: number; y: number };
      end: { x: number; y: number };
      active: boolean;
    } | null
  ): void;
  setEraserPath(path: Array<{ x: number; y: number }> | ((prev: Array<{ x: number; y: number }>) => Array<{ x: number; y: number }>)): void;
  setPan(x: number, y: number): void;
  setViewport(zoom: number, panX: number, panY: number): void;
  setActiveTool(tool: ActiveTool): void;
  setEditingElementId(id: string | null): void;
  expandSelectionWithGroups(ids: Set<string>, elements: readonly DriplElement[]): Set<string>;
  getSelectionBounds(
    selectedIds: ReadonlySet<string>,
    elements: readonly DriplElement[]
  ): { minX: number; minY: number; maxX: number; maxY: number } | null;
  collectCascadeDeleteIds(ids: Iterable<string>): string[];
  deleteElements(ids: string[], options?: { skipHistory?: boolean }): void;
  pushHistory(): void;
  clearPendingEmbed(): void;
}

export interface CanvasInteractionDrawingPort {
  startDrawing(
    point: { x: number; y: number },
    tool: ToolType,
    options: ToolStartOptions,
    baseProps: {
      strokeColor: string;
      backgroundColor: string;
      strokeWidth: number;
      opacity: number;
      roughness: number;
      strokeStyle: 'solid' | 'dashed' | 'dotted';
      fillStyle:
        | 'hachure'
        | 'solid'
        | 'zigzag'
        | 'cross-hatch'
        | 'dots'
        | 'dashed'
        | 'zigzag-line';
      arrowStyle?: 'straight' | 'curved' | 'elbow';
    },
    elements?: DriplElement[]
  ): void;
  updateDrawing(
    point: { x: number; y: number },
    options: ToolUpdateOptions,
    elements: DriplElement[]
  ): void;
  finishDrawing(): DriplElement | null;
  cancelDrawing(): void;
}

export interface CanvasInteractionCollabPort {
  broadcastCursor(x: number, y: number): void;
  lockElementsForGesture(ids: Iterable<string>): void;
  unlockElement(id: string): void;
  unlockGestureElements(): void;
}

export interface CanvasInteractionAssetPort {
  uploadImage(file: File): Promise<string>;
  loadImageDims(src: string, maxSize?: number): Promise<{ displayWidth: number; displayHeight: number }>;
  makeId(): string;
}

export interface CanvasInteractionEnvPort {
  now(): number;
  requestFrame(cb: FrameRequestCallback): number;
  cancelFrame(id: number): void;
  hasAnimationFrame(): boolean;
  dispatchEvent(event: Event): void;
}

export interface CanvasInteractionHitTestPort {
  getElementAtPosition(x: number, y: number): DriplElement | null | undefined;
  getElementsAtPosition(x: number, y: number): DriplElement[];
  spatialIndex: {
    tree: {
      search: (bbox: {
        minX: number;
        minY: number;
        maxX: number;
        maxY: number;
      }) => Array<{ id: string }>;
    };
    byId: Map<string, DriplElement>;
  };
}

export interface CanvasInteractionControllerDeps {
  readOnly: boolean;
  containerRef?: React.RefObject<HTMLDivElement | null>;
  getCanvasCoordinates: (e: React.PointerEvent | React.DragEvent) => { x: number; y: number };
  snapPointToGrid: (point: { x: number; y: number }) => { x: number; y: number };
  store: CanvasInteractionStorePort;
  drawing: CanvasInteractionDrawingPort;
  collab: CanvasInteractionCollabPort;
  assets: CanvasInteractionAssetPort;
  env: CanvasInteractionEnvPort;
  hitTest: CanvasInteractionHitTestPort;
  addElement: (element: DriplElement) => void;
  updateElementTransient: (id: string, element: DriplElement) => void;
  updateElementsTransient: (updates: ReadonlyMap<string, Partial<DriplElement>>) => void;
  updateElement: (id: string, updates: Partial<DriplElement>) => void;
  maybeRevertToSelectTool: (tool: ActiveTool) => void;
  applyFrameGrouping: (frameElement: DriplElement) => void;
}

export interface CanvasInteractionController {
  readonly handlers: CanvasInteractionHandlers;
  getViewState(): CanvasInteractionViewState;
  subscribeViewState(listener: () => void): () => void;
  cancelActiveGesture(): boolean;
  setSpacePressed(pressed: boolean): void;
  beginResize(handle: ResizeHandle, e: React.PointerEvent): void;
  beginRotate(e: React.PointerEvent): void;
  dispose(): void;
  /** Compatibility: mutable interaction state for legacy hooks/tests. */
  readonly state: InteractionState;
  /** Compatibility: legacy ref-style access used by characterization tests. */
  readonly interactionRef: { current: InteractionState };
  /** Compatibility: exposed for characterization tests. */
  readonly eraserHitIdsRef: { current: Set<string> };
  readonly lastToolBeforeSpaceRef: { current: string | null };
}

export class CanvasInteractionControllerImpl implements CanvasInteractionController {
  readonly state: InteractionState = createInteractionState();
  readonly interactionRef: { current: InteractionState };
  readonly eraserHitIdsRef = { current: new Set<string>() };
  readonly lastToolBeforeSpaceRef = { current: null as string | null };

  private hoveredBindingId: string | null = null;
  private startPointBindingId: string | null = null;
  private viewListeners = new Set<() => void>();
  private viewState: CanvasInteractionViewState = {
    hoveredBindingId: null,
    startPointBindingId: null,
  };

  private eraserPending: Array<{ x: number; y: number }> = [];
  private eraserFlushId: number | null = null;
  private eraserHistoryPushed = false;
  private disposed = false;

  readonly handlers: CanvasInteractionHandlers;

  constructor(private deps: CanvasInteractionControllerDeps) {
    this.interactionRef = { current: this.state };
    this.handlers = {
      handlePointerDown: this.handlePointerDown,
      handlePointerMove: this.handlePointerMove,
      handlePointerUp: this.handlePointerUp,
      handlePointerCancel: this.handlePointerCancel,
      handleDragOver: this.handleDragOver,
      handleDrop: this.handleDrop,
    };
  }

  updateDeps(deps: CanvasInteractionControllerDeps): void {
    this.deps = deps;
  }

  getViewState(): CanvasInteractionViewState {
    return this.viewState;
  }

  subscribeViewState(listener: () => void): () => void {
    this.viewListeners.add(listener);
    return () => {
      this.viewListeners.delete(listener);
    };
  }

  private emitViewState(): void {
    const next: CanvasInteractionViewState = {
      hoveredBindingId: this.hoveredBindingId,
      startPointBindingId: this.startPointBindingId,
    };
    if (
      next.hoveredBindingId === this.viewState.hoveredBindingId &&
      next.startPointBindingId === this.viewState.startPointBindingId
    ) {
      return;
    }
    this.viewState = next;
    for (const listener of this.viewListeners) listener();
  }

  private updateHoveredBindingId = (id: string | null): void => {
    this.hoveredBindingId = id;
    this.emitViewState();
  };

  private updateStartPointBindingId = (id: string | null): void => {
    this.startPointBindingId = id;
    this.emitViewState();
  };

  setSpacePressed(pressed: boolean): void {
    this.state.isSpacePressed = pressed;
  }

  private toContainerPoint(client: { x: number; y: number }): { x: number; y: number } {
    const rect = this.deps.containerRef?.current?.getBoundingClientRect();
    if (!rect) return { x: client.x, y: client.y };
    return { x: client.x - rect.left, y: client.y - rect.top };
  }

  private getGestureBoundArrows(): ReadonlyMap<string, ReadonlySet<string>> {
    if (!this.state.bindingIndexReady) {
      this.state.boundArrowsByShape.clear();
      const nextIndex = buildBoundArrowsByShape(this.deps.store.getSnapshot().elements);
      this.state.boundArrowsByShape = nextIndex;
      this.state.bindingIndexReady = true;
    }
    return this.state.boundArrowsByShape;
  }

  private flushEraserAccumulator = (): void => {
    if (this.eraserFlushId !== null) {
      if (this.deps.env.hasAnimationFrame()) {
        this.deps.env.cancelFrame(this.eraserFlushId);
      }
      this.eraserFlushId = null;
    }
    const batch = this.eraserPending;
    if (batch.length === 0) return;
    this.eraserPending = [];
    this.deps.store.setEraserPath(prev => [...prev, ...batch]);
    const state = this.deps.store.getSnapshot();
    // Screen-space constant radius: a fixed world radius is a 2px needle at
    // zoom 0.1 and an 80px bomb at zoom 4 (Excalidraw parity).
    const radius = 20 / Math.max(state.zoom, 0.1);
    for (const point of batch) {
      const candidates = this.deps.hitTest.spatialIndex.tree.search({
        minX: point.x - radius,
        minY: point.y - radius,
        maxX: point.x + radius,
        maxY: point.y + radius,
      });
      candidates.forEach(candidate => {
        const element = this.deps.hitTest.spatialIndex.byId.get(candidate.id);
        if (!element) return;
        const lockOwner = state.elementLocks.get(element.id);
        if (lockOwner && lockOwner !== state.userId) return;
        if (isPointNearElement(point, element, radius)) {
          this.eraserHitIdsRef.current.add(element.id);
        }
      });
    }
    // Delete on contact, not on release (Excalidraw parity): the stroke
    // erases as it touches. History is pushed once at the first hitting
    // batch and each batch deletes with skipHistory, so the whole stroke
    // stays one undo step — and a stroke that hits nothing writes none.
    if (this.eraserHitIdsRef.current.size > 0) {
      const live = this.deps.store.getSnapshot();
      if (!this.eraserHistoryPushed) {
        this.deps.store.pushHistory();
        this.eraserHistoryPushed = true;
      }
      const doomed = this.deps.store.collectCascadeDeleteIds(this.eraserHitIdsRef.current);
      this.eraserHitIdsRef.current.clear();
      if (doomed.length > 0) this.deps.store.deleteElements(doomed, { skipHistory: true });
    }
  };

  private scheduleEraserFlush(): void {
    if (this.eraserFlushId !== null) return;
    if (!this.deps.env.hasAnimationFrame()) {
      this.flushEraserAccumulator();
      return;
    }
    this.eraserFlushId = this.deps.env.requestFrame(() => {
      this.eraserFlushId = null;
      this.flushEraserAccumulator();
    });
  }

  handleDragOver = (e: React.DragEvent): void => {
    if (!this.deps.readOnly) e.preventDefault();
  };

  handleDrop = async (e: React.DragEvent): Promise<void> => {
    e.preventDefault();
    if (this.deps.readOnly) return;
    const { x, y } = this.deps.getCanvasCoordinates(e);
    const files = Array.from(e.dataTransfer.files);

    await dropImageFiles(files, { x, y }, {
      uploadImage: (file) => this.deps.assets.uploadImage(file),
      loadImageDims: (src, maxSize) => this.deps.assets.loadImageDims(src, maxSize),
      makeId: () => this.deps.assets.makeId(),
      onElement: this.deps.addElement,
      onError: (error) => {
        logError('Failed to add image to canvas:', error);
      },
    });
  };

  handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>): void => {
    const target = e.target as HTMLElement;
    if (target.classList.contains('pointer-events-auto')) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    this.state.boundArrowsByShape.clear();
    this.state.bindingIndexReady = false;

    if (e.pointerType === 'touch') {
      this.state.touchPointers.set(e.pointerId, {
        x: e.clientX,
        y: e.clientY,
      });
      if (this.state.touchPointers.size === 2) {
        // A second finger preempts any pending press: the gesture is a
        // pinch now, not a drag or marquee in waiting.
        this.state.pendingDrag = null;
        this.state.pendingMarqueeStart = null;
        const points = Array.from(this.state.touchPointers.values());
        const first = points[0];
        const second = points[1];
        if (first && second) {
          this.state.pinchStartDistance = pinchDistance(first, second);
          this.state.pinchStartMid = this.toContainerPoint(pinchMidpoint(first, second));
          const state = this.deps.store.getSnapshot();
          this.state.pinchStartZoom = state.zoom;
          this.state.pinchStartPan = {
            x: state.panX,
            y: state.panY,
          };
          this.state.panning = true;
          this.deps.store.setIsPanning(true);
        }
      }
    }

    const rawPoint = this.deps.getCanvasCoordinates(e);
    const point = this.deps.snapPointToGrid(rawPoint);
    const { x, y } = point;
    const currentTool = this.deps.store.getSnapshot().activeTool;

    this.deps.collab.broadcastCursor(x, y);

    const isTemporaryPan = this.state.isSpacePressed || e.button === 1;
    if (currentTool === 'hand' || isTemporaryPan) {
      e.preventDefault();
      // The tool itself never changes for a temporary pan (Space or middle
      // button), so there is nothing to restore — the flag alone drives it.
      // Recording the tool here would leave a stale restore behind.
      this.lastToolBeforeSpaceRef.current = null;
      this.state.panning = true;
      this.state.panStartClient = { x: e.clientX, y: e.clientY };
      this.deps.store.setIsPanning(true);
      return;
    }

    if (currentTool === 'laser') {
      this.deps.store.setIsDrawing(true);
      this.deps.env.dispatchEvent(new CustomEvent('dripl:laser-start', { detail: { x, y } }));
      return;
    }

    if (this.deps.readOnly) {
      return;
    }

    if (currentTool === 'select') {
      if (e.detail === 2) {
        if (
          handleDoubleClick({ x, y }, this.deps.store.getSnapshot().elements as DriplElement[], {
            getElementAtPosition: this.deps.hitTest.getElementAtPosition,
            setTextInput: this.deps.store.setTextInput,
            addElement: this.deps.addElement,
            updateElement: this.deps.updateElement,
          })
        ) {
          return;
        }
      }

      // Get all elements at this point for overlap resolution
      const allHitElements = this.deps.hitTest.getElementsAtPosition(x, y);
      // `getElementsAtPosition` returns hits from top z-order to bottom.
      // Prefer an already-selected hit so a selected object can be dragged
      // through an overlapping object; otherwise select the first (topmost)
      // hit rather than the bottom-most one.
      let element: DriplElement | null = null;
      if (allHitElements.length > 0) {
        const state = this.deps.store.getSnapshot();
        const selectedHit = allHitElements.find(el => state.selectedIds.has(el.id));
        element = selectedHit ?? allHitElements[0]!;
      }
      if (element && element.id) {
        const state = this.deps.store.getSnapshot();
        const clickedSet = this.deps.store.expandSelectionWithGroups(
          new Set([element.id]),
          state.elements
        );
        const nextSelection = e.shiftKey
          ? this.deps.store.expandSelectionWithGroups(
              new Set([...state.selectedIds, ...clickedSet]),
              state.elements
            )
          : clickedSet;
        this.deps.store.setSelectedIds(nextSelection);

        const idsToTrack = nextSelection;

        const snapshot = new Map<string, DriplElement>();
        state.elements.forEach(el => {
          if (idsToTrack.has(el.id)) snapshot.set(el.id, JSON.parse(JSON.stringify(el)));
        });

        // Record the press; the drag (locks, history, isDragging) arms on
        // the first supra-threshold move, so a click never churns them.
        this.state.pendingDrag = { startPos: { x, y }, snapshot };
        this.state.pendingMarqueeStart = null;
      } else {
        const state = this.deps.store.getSnapshot();
        const selectionBounds = this.deps.store.getSelectionBounds(
          state.selectedIds,
          state.elements
        );
        if (
          selectionBounds &&
          x >= selectionBounds.minX &&
          x <= selectionBounds.maxX &&
          y >= selectionBounds.minY &&
          y <= selectionBounds.maxY
        ) {
          const snapshot = new Map<string, DriplElement>();
          state.elements.forEach(candidate => {
            if (!state.selectedIds.has(candidate.id)) return;
            const lockOwner = state.elementLocks.get(candidate.id);
            if (lockOwner && lockOwner !== state.userId) return;
            snapshot.set(candidate.id, JSON.parse(JSON.stringify(candidate)));
          });

          if (snapshot.size > 0) {
            this.state.pendingDrag = { startPos: { x, y }, snapshot };
            this.state.pendingMarqueeStart = null;
            return;
          }
        }

        if (!e.shiftKey) {
          this.deps.store.clearSelection();
        }
        this.state.pendingDrag = null;
        this.state.pendingMarqueeStart = { x, y };
      }
      return;
    }

    if (currentTool === 'text') {
      this.deps.store.setTextInput({ x, y, id: this.deps.assets.makeId(), value: '' });
      return;
    }

    if (currentTool === 'image') {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.hidden = true;
      document.body.appendChild(input);
      const detach = () => input.remove();
      input.onchange = async event => {
        const file = (event.target as HTMLInputElement).files?.[0];
        detach();
        if (file) {
          try {
            const imageUrl = await this.deps.assets.uploadImage(file);
            const dims = await this.deps.assets.loadImageDims(imageUrl, 500);
            const element: DriplElement = {
              id: this.deps.assets.makeId(),
              type: 'image',
              x: x - dims.displayWidth / 2,
              y: y - dims.displayHeight / 2,
              width: dims.displayWidth,
              height: dims.displayHeight,
              strokeColor: 'transparent',
              backgroundColor: 'transparent',
              strokeWidth: 0,
              opacity: 1,
              src: imageUrl,
            } as DriplElement;
            this.deps.addElement(element);
            if (this.deps.store.getSnapshot().activeTool === 'image') {
              this.deps.maybeRevertToSelectTool('image');
            }
          } catch (error) {
            logError('Failed to upload image:', error);
          }
        }
      };
      // Dismissing the picker fires `cancel` (no `change`), which would
      // otherwise strand the hidden input in the DOM for the session.
      input.addEventListener('cancel', detach, { once: true });
      input.click();
      return;
    }

    if (currentTool === 'eraser') {
      this.deps.store.setIsDrawing(true);
      this.eraserHitIdsRef.current.clear();
      this.eraserHistoryPushed = false;
      // Drop a batch stranded by an interrupted stroke; flushing here would
      // append stale points ahead of the new stroke.
      if (this.eraserFlushId !== null) {
        if (this.deps.env.hasAnimationFrame()) {
          this.deps.env.cancelFrame(this.eraserFlushId);
        }
        this.eraserFlushId = null;
      }
      this.eraserPending = [];
      this.deps.store.setEraserPath([{ x, y }]);
      return;
    }

    if (
      currentTool === 'rectangle' ||
      currentTool === 'ellipse' ||
      currentTool === 'diamond' ||
      currentTool === 'arrow' ||
      currentTool === 'line' ||
      currentTool === 'freedraw' ||
      currentTool === 'frame' ||
      currentTool === 'embed'
    ) {
      const state = this.deps.store.getSnapshot();
      this.deps.drawing.startDrawing(
        { x, y },
        currentTool,
        {
          shiftKey: e.shiftKey,
          altKey: e.altKey,
          pressure: e.pressure,
          pointerType: e.pointerType,
        },
        {
          strokeColor: state.currentStrokeColor,
          backgroundColor: state.currentBackgroundColor,
          strokeWidth: state.currentStrokeWidth,
          opacity: 1,
          roughness: state.currentRoughness,
          strokeStyle: state.currentStrokeStyle,
          fillStyle: state.currentFillStyle,
          arrowStyle: state.currentArrowStyle,
        },
        state.elements as DriplElement[]
      );
      this.deps.store.setIsDrawing(true);
      return;
    }
  };

  handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>): void => {
    const { x, y } = this.deps.getCanvasCoordinates(e);
    const currentTool = this.deps.store.getSnapshot().activeTool;

    if (e.pointerType === 'touch' && this.state.touchPointers.has(e.pointerId)) {
      this.state.touchPointers.set(e.pointerId, {
        x: e.clientX,
        y: e.clientY,
      });

      if (this.state.touchPointers.size === 2 && this.state.pinchStartMid) {
        const points = Array.from(this.state.touchPointers.values());
        const first = points[0];
        const second = points[1];
        if (first && second) {
          const mid = this.toContainerPoint(pinchMidpoint(first, second));
          const { zoom, panX, panY } = pinchZoomTransform(
            {
              mid: this.state.pinchStartMid,
              zoom: this.state.pinchStartZoom,
              pan: this.state.pinchStartPan,
              distance: this.state.pinchStartDistance,
            },
            mid,
            pinchDistance(first, second)
          );

          this.deps.store.setViewport(zoom, panX, panY);
          return;
        }
      }
    }

    this.deps.store.setCursorPosition({ x, y });
    this.deps.collab.broadcastCursor(x, y);

    if (this.state.panning && this.state.panStartClient) {
      const dx = e.clientX - this.state.panStartClient.x;
      const dy = e.clientY - this.state.panStartClient.y;
      const state = this.deps.store.getSnapshot();
      this.deps.store.setPan(state.panX + dx, state.panY + dy);
      this.state.panStartClient = { x: e.clientX, y: e.clientY };
      return;
    }

    const state = this.deps.store.getSnapshot();
    if (state.marqueeSelection?.active) {
      this.deps.store.setMarqueeSelection({ ...state.marqueeSelection, end: { x, y } });
      return;
    }

    // Arm a pending press once it travels past the click threshold. Locks,
    // history and isDragging all start here — never on pointer-down — so a
    // click is side-effect-free beyond the selection itself.
    const pendingDrag = this.state.pendingDrag;
    if (pendingDrag && !this.state.dragging) {
      const threshold = clickDragThresholdWorld(this.deps.store.getSnapshot().zoom);
      if (Math.hypot(x - pendingDrag.startPos.x, y - pendingDrag.startPos.y) >= threshold) {
        this.state.dragging = true;
        this.state.historyPushed = false;
        this.state.dragStartCanvasPos = pendingDrag.startPos;
        this.state.dragInitialElements = pendingDrag.snapshot;
        this.state.pendingDrag = null;
        this.deps.store.setIsDragging(true);
        const ids = Array.from(pendingDrag.snapshot.keys());
        this.deps.store.setEditingElementId(ids.length === 1 ? (ids[0] ?? null) : null);
        if (ids.length > 0) this.deps.collab.lockElementsForGesture(pendingDrag.snapshot.keys());
      }
    }

    const pendingMarquee = this.state.pendingMarqueeStart;
    if (pendingMarquee) {
      const threshold = clickDragThresholdWorld(this.deps.store.getSnapshot().zoom);
      if (Math.hypot(x - pendingMarquee.x, y - pendingMarquee.y) >= threshold) {
        this.state.pendingMarqueeStart = null;
        this.deps.store.setMarqueeSelection({ start: pendingMarquee, end: { x, y }, active: true });
      }
    }

    if (currentTool === 'laser' && this.deps.store.getSnapshot().isDrawing) {
      this.deps.env.dispatchEvent(new CustomEvent('dripl:laser-move', { detail: { x, y } }));
      return;
    }

    if (this.deps.readOnly) return;

    if (
      this.state.resizing &&
      this.state.resizeInitialEls &&
      this.state.resizeGroupFrame &&
      this.state.resizeStartCanvasPos
    ) {
      const dx = x - this.state.resizeStartCanvasPos.x;
      const dy = y - this.state.resizeStartCanvasPos.y;
      if (shouldPushHistory(this.state.historyPushed, dx, dy)) {
        this.deps.store.pushHistory();
        this.state.historyPushed = true;
      }
      const updates = groupResizeMapping(
        this.state.resizeInitialEls,
        this.state.resizeGroupFrame,
        this.state.resizeHandle ?? 'se',
        dx,
        dy,
        { shiftKey: e.shiftKey, altKey: e.altKey }
      );
      // Bound arrows outside the selection follow via the gesture index,
      // exactly like the single-element path.
      this.deps.updateElementsTransient(
        resolveGestureUpdates(
          this.deps.store.getSnapshot().elementsById as ReadonlyMap<string, DriplElement>,
          updates,
          this.getGestureBoundArrows()
        )
      );
      return;
    }

    if (
      this.state.resizing &&
      this.state.resizeInitialEl &&
      this.state.resizeStartCanvasPos
    ) {
      const el = this.state.resizeInitialEl;
      const handle = this.state.resizeHandle!;
      const dx = x - this.state.resizeStartCanvasPos.x;
      const dy = y - this.state.resizeStartCanvasPos.y;
      if (shouldPushHistory(this.state.historyPushed, dx, dy)) {
        this.deps.store.pushHistory();
        this.state.historyPushed = true;
      }

      const isArrowEndpoint = handle === 'arrow-start' || handle === 'arrow-end';
      const arrowPointMatch =
        typeof handle === 'string' && handle.startsWith('arrow-point-')
          ? parseInt(handle.slice('arrow-point-'.length), 10)
          : -1;
      const arrowInsertMatch =
        typeof handle === 'string' && handle.startsWith('arrow-insert-')
          ? parseInt(handle.slice('arrow-insert-'.length), 10)
          : -1;

      // Handle midpoint insertion - insert a new point at the midpoint of the segment
      if (arrowInsertMatch >= 0) {
        const updatedElement = insertLinearMidpoint(el, arrowInsertMatch);
        if (!updatedElement) return;

        if (el.id) this.deps.updateElementTransient(el.id, updatedElement);

        // Set up for dragging the newly inserted point
        this.state.resizeHandle = `arrow-point-${arrowInsertMatch}` as string;
        this.state.resizeInitialEl = updatedElement;
        this.state.resizeStartCanvasPos = { x, y };
        this.state.historyPushed = true;
        return;
      }

      if (isArrowEndpoint || arrowPointMatch >= 0) {
        // Point count validation lives in dragLinearPoint (null → return).
        const pointCount =
          'points' in el && Array.isArray((el as { points?: unknown }).points)
            ? (el as { points: unknown[] }).points.length
            : 0;
        const idx =
          handle === 'arrow-start'
            ? 0
            : handle === 'arrow-end'
              ? pointCount - 1
              : arrowPointMatch;
        const dragged = dragLinearPoint(el, idx, dx, dy);
        if (!dragged) return;
        const target = dragged.movedPoint;
        let updatedElement: DriplElement = dragged.element;

        // Dynamic binding detection for arrow endpoints
        const allElements = this.deps.store.getSnapshot().elements as DriplElement[];
        const arrowEl = updatedElement as LinearElement;
        const startOrEnd =
          handle === 'arrow-start' ? 'start' : handle === 'arrow-end' ? 'end' : null;

        /**
         * Apply the shape-side half of a bind or unbind.
         *
         * `bindArrowToElement` / `unbindArrowFromElement` return a whole element list
         * because they update two rows: the arrow, and the target's `boundElements`
         * reverse index. Taking only the arrow out of that list — which is what this
         * handler used to do — silently dropped the target's half, and since
         * `buildBoundArrowsByShape` is what `updateBoundArrows` reads when a *shape*
         * later moves, an arrow bound by dragging an endpoint never followed the shape.
         * Only `finishDrawing` -> `bindCommittedArrow` populated it, so only a *drawn*
         * arrow behaved.
         *
         * Applied transiently, like the arrow itself: this is pointer-move feedback, not
         * a commit.
         */
        const applyShapeSideBindingUpdates = (
          before: readonly DriplElement[],
          after: readonly DriplElement[],
          excludeId: string
        ): void => {
          const previous = new Map(before.map(e => [e.id, e]));
          const updates = new Map<string, Partial<DriplElement>>();
          for (const element of after) {
            if (element.id === excludeId) continue;
            if (previous.get(element.id) === element) continue;
            updates.set(element.id, element);
          }
          if (updates.size > 0) this.deps.updateElementsTransient(updates);
        };

        if (startOrEnd) {
          // Geometry comes from `arrowEl`, which derives from the gesture-start
          // snapshot on purpose, so repeated moves cannot accumulate drift. A
          // *binding*, though, is state this very gesture mutates — and the
          // snapshot never learns about one written on the previous move.
          //
          // Reading `currentBinding` from the snapshot therefore made it
          // permanently the pre-gesture value: after one move bound the endpoint
          // to a shape, the next move still saw no binding, so the unbind branch
          // below could never fire and dragging away left the arrow stuck to the
          // shape until the pointer was released. Composing the dragged geometry
          // with the live binding state fixes that without giving up the
          // snapshot the geometry depends on.
          const liveArrow = allElements.find(e => e.id === el.id) as LinearElement | undefined;
          const arrowWithLiveBinding = {
            ...arrowEl,
            startBinding: liveArrow?.startBinding ?? arrowEl.startBinding,
            endBinding: liveArrow?.endBinding ?? arrowEl.endBinding,
          } as LinearElement;
          const currentBinding =
            startOrEnd === 'start'
              ? arrowWithLiveBinding.startBinding
              : arrowWithLiveBinding.endBinding;
          const nearbyShape = findBindableElementAtPoint(target, allElements, el.id, 20);

          if (nearbyShape) {
            // Bind to the nearby shape
            this.updateHoveredBindingId(nearbyShape.id);
            if (!currentBinding || currentBinding.elementId !== nearbyShape.id) {
              // Unbind from current target if different
              let newElements = currentBinding
                ? unbindArrowFromElement(arrowWithLiveBinding, startOrEnd, allElements)
                : allElements;
              // Bind to new target
              const binding = calculateArrowBinding(target, nearbyShape);
              if (binding) {
                newElements = bindArrowToElement(
                  arrowWithLiveBinding,
                  nearbyShape.id,
                  startOrEnd,
                  { x: binding.focus, y: 0.5 },
                  'orbit',
                  newElements
                );
                // Update the arrow in the store, and the target's reverse
                // index with it -- see applyShapeSideBindingUpdates.
                const boundArrow = newElements.find(e => e.id === el.id) as LinearElement;
                if (boundArrow) {
                  updatedElement = boundArrow;
                  applyShapeSideBindingUpdates(allElements, newElements, el.id);
                }
              }
            }
          } else {
            // No nearby shape - unbind if currently bound
            this.updateHoveredBindingId(null);
            if (currentBinding) {
              const newElements = unbindArrowFromElement(
                arrowWithLiveBinding,
                startOrEnd,
                allElements
              );
              applyShapeSideBindingUpdates(allElements, newElements, el.id);
              const unboundArrow = newElements.find(e => e.id === el.id) as LinearElement;
              if (unboundArrow) {
                updatedElement = unboundArrow;
              }
            }
          }
        }

        if (el.id) this.deps.updateElementTransient(el.id, updatedElement);
        return;
      }

      const storeState = this.deps.store.getSnapshot();
      const frame = computeBoxResize(el, handle, dx, dy, {
        shiftKey: e.shiftKey,
        gridEnabled: storeState.gridEnabled,
        gridSize: storeState.gridSize,
        snapPoint: this.deps.snapPointToGrid,
      });
      let newX = frame.x;
      let newY = frame.y;
      const newWidth = frame.width;
      const newHeight = frame.height;

      const origEl = this.state.resizeInitialEl || el;
      const resizeHandle = handle as 'n' | 'e' | 's' | 'w' | 'ne' | 'se' | 'sw' | 'nw';
      const resizeFlags = {
        shouldMaintainAspectRatio: e.shiftKey,
        shouldResizeFromCenter: e.altKey,
      };

      const isLinearElement =
        (el.type === 'arrow' || el.type === 'line' || el.type === 'freedraw') &&
        el.points &&
        el.points.length > 0;
      let packageResize: Partial<DriplElement> | null = null;
      if (el.type !== 'text') {
        packageResize = resizeSingleElement(
          newWidth,
          newHeight,
          el,
          origEl,
          resizeHandle,
          resizeFlags
        );
        if ((el.angle || 0) !== 0) {
          if (typeof packageResize.x === 'number') newX = packageResize.x;
          if (typeof packageResize.y === 'number') newY = packageResize.y;
        }
      }

      const updatedElement: DriplElement = {
        ...el,
        x: newX,
        y: newY,
        width: newWidth,
        height: newHeight,
      };

      if (el.type === 'text') {
        const resizedProps = resizeSingleElement(
          newWidth,
          newHeight,
          el,
          this.state.resizeInitialEl || el,
          handle as 'n' | 'e' | 's' | 'w' | 'ne' | 'se' | 'sw' | 'nw',
          { shouldMaintainAspectRatio: e.shiftKey, shouldResizeFromCenter: e.altKey }
        );
        Object.assign(updatedElement, resizedProps);
      } else if (isLinearElement && packageResize?.points) {
        updatedElement.points = packageResize.points;
      }

      if (el.id) {
        // Primary plus binding follow-ups in one commit, as the drag path.
        this.deps.updateElementsTransient(
          resolveGestureUpdates(
            this.deps.store.getSnapshot().elementsById as ReadonlyMap<string, DriplElement>,
            new Map([[el.id, updatedElement]]),
            this.getGestureBoundArrows()
          )
        );
      }
      return;
    }

    if (
      this.state.rotating &&
      this.state.rotateInitialEls &&
      this.state.rotateCenter
    ) {
      const center = this.state.rotateCenter;
      const pointerAngle = Math.atan2(y - center.y, x - center.x);
      // Snap the relative delta (the single path snaps the absolute angle;
      // groups have no absolute angle, only this delta).
      const rawDelta = normalizeRotationDelta(
        pointerAngle - this.state.rotateStartAngle
      );
      const delta = e.shiftKey
        ? Math.round(rawDelta / (Math.PI / 12)) * (Math.PI / 12)
        : rawDelta;
      if (!this.state.historyPushed) {
        this.deps.store.pushHistory();
        this.state.historyPushed = true;
      }
      this.deps.updateElementsTransient(
        resolveGestureUpdates(
          this.deps.store.getSnapshot().elementsById as ReadonlyMap<string, DriplElement>,
          groupRotateMapping(this.state.rotateInitialEls, center, delta),
          this.getGestureBoundArrows(),
          { includeBoundArrows: false }
        )
      );
      return;
    }

    if (this.state.rotating && this.state.rotateInitialEl) {
      const el = this.state.rotateInitialEl;
      // Shift snaps to 15° increments (Excalidraw parity).
      const rawAngle = computeRotationAngle(el, x, y);
      const angle = e.shiftKey
        ? Math.round(rawAngle / (Math.PI / 12)) * (Math.PI / 12)
        : rawAngle;
      if (!this.state.historyPushed) {
        this.deps.store.pushHistory();
        this.state.historyPushed = true;
      }
      const updatedElement: DriplElement = { ...el, angle };
      if (el.id) {
        // Labels only: rebinding arrow endpoints mid-rotate would be a
        // behavior change of its own, not batching.
        this.deps.updateElementsTransient(
          resolveGestureUpdates(
            this.deps.store.getSnapshot().elementsById as ReadonlyMap<string, DriplElement>,
            new Map([[el.id, updatedElement]]),
            this.getGestureBoundArrows(),
            { includeBoundArrows: false }
          )
        );
      }
      return;
    }

    if (
      this.state.dragging &&
      this.state.dragInitialElements &&
      this.state.dragStartCanvasPos
    ) {
      const totalDeltaX = x - this.state.dragStartCanvasPos.x;
      const totalDeltaY = y - this.state.dragStartCanvasPos.y;

      if (shouldPushHistory(this.state.historyPushed, totalDeltaX, totalDeltaY)) {
        this.deps.store.pushHistory();
        this.state.historyPushed = true;
      }

      // Shift constrains the move to the dominant axis (Excalidraw parity).
      const moveX = e.shiftKey && Math.abs(totalDeltaY) > Math.abs(totalDeltaX) ? 0 : totalDeltaX;
      const moveY =
        e.shiftKey && Math.abs(totalDeltaX) >= Math.abs(totalDeltaY) ? 0 : totalDeltaY;

      const primaryUpdates = new Map<string, Partial<DriplElement>>();
      this.state.dragInitialElements.forEach((initialEl, id) => {
        const updatedEl: DriplElement = {
          ...initialEl,
          x: initialEl.x + moveX,
          y: initialEl.y + moveY,
        };

        primaryUpdates.set(id, updatedEl);
      });
      // Primary geometry plus binding follow-ups (bound arrows, labels) in
      // one commit: two commits re-render the canvas subtree twice per frame
      // for a single visible frame.
      this.deps.updateElementsTransient(
        resolveGestureUpdates(
          this.deps.store.getSnapshot().elementsById as ReadonlyMap<string, DriplElement>,
          primaryUpdates,
          this.getGestureBoundArrows()
        )
      );

      return;
    }

    if (!this.deps.store.getSnapshot().isDrawing) return;

    if (currentTool === 'eraser') {
      // Accumulate the sample; the scheduled flush appends the frame's
      // batch in one commit (see flushEraserAccumulator).
      this.eraserPending.push({ x, y });
      this.scheduleEraserFlush();
      return;
    }

    if (
      currentTool === 'rectangle' ||
      currentTool === 'ellipse' ||
      currentTool === 'diamond' ||
      currentTool === 'arrow' ||
      currentTool === 'line' ||
      currentTool === 'freedraw' ||
      currentTool === 'frame' ||
      currentTool === 'embed'
    ) {
      const snapped = this.deps.snapPointToGrid({ x, y });
      this.deps.drawing.updateDrawing(
        snapped,
        {
          shiftKey: e.shiftKey || false,
          altKey: e.altKey,
          pressure: e.pressure,
          pointerType: e.pointerType,
          // Only pen pressure is real; mouse/touch report a constant 0.5,
          // which would render every stroke flat. Derive it from velocity.
          simulatePressure: e.pointerType !== 'pen',
        },
        this.deps.store.getSnapshot().elements as DriplElement[]
      );

      // Detect nearby shapes for binding visual feedback during arrow drawing
      if (currentTool === 'arrow') {
        const allElements = this.deps.store.getSnapshot().elements as DriplElement[];
        const draftEl = this.deps.store.getSnapshot().draftElement;

        if (
          draftEl &&
          'points' in draftEl &&
          Array.isArray(draftEl.points) &&
          draftEl.points.length >= 2
        ) {
          // Get the current endpoint position (last point)
          const points = draftEl.points as Array<{ x: number; y: number }>;
          const endPoint = points[points.length - 1];
          const startPoint = points[0];

          if (endPoint) {
            const globalEndPoint = { x: draftEl.x + endPoint.x, y: draftEl.y + endPoint.y };
            const nearbyShape = findBindableElementAtPoint(
              globalEndPoint,
              allElements,
              draftEl.id,
              20
            );

            if (nearbyShape) {
              this.updateHoveredBindingId(nearbyShape.id);
            } else {
              this.updateHoveredBindingId(null);
            }
          }

          // Also detect binding at start point
          if (startPoint) {
            const globalStartPoint = { x: draftEl.x + startPoint.x, y: draftEl.y + startPoint.y };
            const nearbyStartShape = findBindableElementAtPoint(
              globalStartPoint,
              allElements,
              draftEl.id,
              20
            );

            if (nearbyStartShape) {
              this.updateStartPointBindingId(nearbyStartShape.id);
            } else {
              this.updateStartPointBindingId(null);
            }
          }
        } else {
          this.updateHoveredBindingId(null);
          this.updateStartPointBindingId(null);
        }
      }

      return;
    }
  };

  handlePointerUp = (e?: React.PointerEvent): void => {
    const currentTool = this.deps.store.getSnapshot().activeTool;
    if (e?.pointerType === 'touch') {
      this.state.touchPointers.delete(e.pointerId);
      if (this.state.touchPointers.size < 2) {
        this.state.pinchStartDistance = 0;
        this.state.pinchStartMid = null;
      }
    }
    this.deps.store.setCursorPosition(null);

    if (this.state.panning) {
      this.state.panning = false;
      this.state.panStartClient = null;
      this.deps.store.setIsPanning(false);
      if (
        !this.state.isSpacePressed &&
        currentTool === 'hand' &&
        this.lastToolBeforeSpaceRef.current &&
        this.lastToolBeforeSpaceRef.current !== 'hand'
      ) {
        this.deps.store.setActiveTool(this.lastToolBeforeSpaceRef.current as ActiveTool);
      }
      return;
    }

    const state = this.deps.store.getSnapshot();
    if (state.marqueeSelection?.active) {
      const rect = normalizeMarquee(state.marqueeSelection.start, state.marqueeSelection.end);
      // Use spatial index to narrow candidates, then check intersection
      const candidates = this.deps.hitTest.spatialIndex.tree.search(rect);
      const candidateIds = new Set(candidates.map(c => c.id));
      const hitIds = matchMarqueeElements(
        state.elements as DriplElement[],
        rect,
        state.marqueeSelectionMode,
        candidateIds
      );
      const expandedHitIds = this.deps.store.expandSelectionWithGroups(
        hitIds,
        state.elements
      );

      if (e?.shiftKey) {
        this.deps.store.setSelectedIds(
          this.deps.store.expandSelectionWithGroups(
            new Set([...state.selectedIds, ...expandedHitIds]),
            state.elements
          )
        );
      } else {
        this.deps.store.setSelectedIds(expandedHitIds);
      }
      this.deps.store.setMarqueeSelection(null);
      return;
    }

    // A press that never travelled past the click threshold commits
    // nothing: a click on empty space (selection was already cleared on
    // pointer-down) or a click on an element (selection already applied).
    if (this.state.pendingMarqueeStart) {
      this.state.pendingMarqueeStart = null;
      return;
    }
    this.state.pendingDrag = null;

    if (this.state.resizing) {
      const state = this.deps.store.getSnapshot();
      // Group path: commit every member the same way the single path
      // commits its one element (version bump + broadcast + cache
      // invalidation through updateElement).
      const groupIds = this.state.resizeInitialEls
        ? Array.from(this.state.resizeInitialEls.keys())
        : null;
      if (groupIds) {
        for (const id of groupIds) this.deps.updateElement(id, {});
      }
      finalizeResizeGesture(this.state, {
        editingId: state.isEditingElementId,
        resizedId: groupIds ? undefined : this.state.resizeInitialEl?.id,
        clearHoverBinding: () => this.updateHoveredBindingId(null),
        commitTransient: (id, updates) => this.deps.updateElement(id, updates),
        setIsActive: this.deps.store.setIsResizing,
        setEditingElementId: this.deps.store.setEditingElementId,
        unlockElement: this.deps.collab.unlockElement,
        unlockGestureElements: this.deps.collab.unlockGestureElements,
      });
      return;
    }

    if (this.state.rotating) {
      finalizeRotateGesture(this.state, {
        editingId: this.deps.store.getSnapshot().isEditingElementId,
        setIsActive: this.deps.store.setIsRotating,
        setEditingElementId: this.deps.store.setEditingElementId,
        unlockElement: this.deps.collab.unlockElement,
        unlockGestureElements: this.deps.collab.unlockGestureElements,
      });
      return;
    }

    if (this.state.dragging) {
      finalizeDragGesture(this.state, {
        editingId: this.deps.store.getSnapshot().isEditingElementId,
        setIsActive: this.deps.store.setIsDragging,
        setEditingElementId: this.deps.store.setEditingElementId,
        unlockElement: this.deps.collab.unlockElement,
        unlockGestureElements: this.deps.collab.unlockGestureElements,
      });
      return;
    }

    if (this.deps.store.getSnapshot().isDrawing) {
      if (currentTool === 'laser') {
        this.deps.store.setIsDrawing(false);
        this.deps.env.dispatchEvent(new CustomEvent('dripl:laser-end'));
        return;
      }

      if (currentTool === 'eraser') {
        // Drain samples that never reached a frame. Hits were already
        // deleted live per batch (single undo step from stroke start), so
        // this only completes a tap with no frame in between.
        this.flushEraserAccumulator();

        this.deps.store.setEraserPath([]);
        this.eraserHitIdsRef.current.clear();
        this.deps.store.setIsDrawing(false);
        this.deps.maybeRevertToSelectTool('eraser');
        return;
      }

      if (
        currentTool === 'rectangle' ||
        currentTool === 'ellipse' ||
        currentTool === 'diamond' ||
        currentTool === 'arrow' ||
        currentTool === 'line' ||
        currentTool === 'freedraw' ||
        currentTool === 'frame' ||
        currentTool === 'embed'
      ) {
        if (currentTool === 'embed') {
          // An embed without a captured URL cannot commit: the schema
          // requires one, so finishing would store an unrenderable element.
          // Discard the draft instead of leaving it stuck (the old fallthrough
          // armed neither finish nor cancel) and drop the stale pending URL
          // so the next embed does not reuse it.
          const draft = this.deps.store.getSnapshot().draftElement;
          const url = draft && 'url' in draft && typeof draft.url === 'string' ? draft.url : '';
          this.deps.store.clearPendingEmbed();
          if (!url) {
            this.deps.drawing.cancelDrawing();
            this.deps.store.setIsDrawing(false);
            this.deps.maybeRevertToSelectTool(currentTool);
            return;
          }
        }
        const finishedElement = this.deps.drawing.finishDrawing();
        if (finishedElement) {
          if (finishedElement.type === 'frame') {
            this.deps.applyFrameGrouping(finishedElement);
          }
          if (finishedElement.type === 'embed') {
            this.deps.store.clearPendingEmbed();
          }
        }
        this.deps.store.setIsDrawing(false);
        this.deps.maybeRevertToSelectTool(currentTool);
        return;
      }

      this.deps.store.setIsDrawing(false);
    }
  };

  handlePointerCancel = (): void => {
    this.cancelActiveGesture();
  };

  /**
   * Roll back the armed gesture to its start snapshot and tear it down,
   * without committing anything. Returns whether a gesture was armed.
   *
   * Escape calls this first (a second Escape clears the selection), and
   * pointer-cancel calls it instead of the commit path in `handlePointerUp`.
   * Snapshots are restored through the transient updater so no history entry
   * is written; the matching finalize releases the collaboration locks.
   */
  cancelActiveGesture = (): boolean => {
    const interaction = this.state;
    const state = this.deps.store.getSnapshot();
    let cancelled = false;

    // Presses that never travelled past the click threshold evaporate: there
    // is nothing visible to roll back, so they do not count as armed.
    interaction.pendingDrag = null;
    interaction.pendingMarqueeStart = null;

    if (interaction.panning) {
      interaction.panning = false;
      interaction.panStartClient = null;
      this.deps.store.setIsPanning(false);
      cancelled = true;
    }

    if (state.marqueeSelection?.active) {
      this.deps.store.setMarqueeSelection(null);
      cancelled = true;
    }

    if (interaction.dragging && interaction.dragInitialElements) {
      this.deps.updateElementsTransient(
        new Map<string, Partial<DriplElement>>(interaction.dragInitialElements)
      );
      finalizeDragGesture(interaction, {
        editingId: state.isEditingElementId,
        setIsActive: this.deps.store.setIsDragging,
        setEditingElementId: this.deps.store.setEditingElementId,
        unlockElement: this.deps.collab.unlockElement,
        unlockGestureElements: this.deps.collab.unlockGestureElements,
      });
      cancelled = true;
    }

    if (interaction.resizing && (interaction.resizeInitialEl || interaction.resizeInitialEls)) {
      const restore = new Map<string, Partial<DriplElement>>();
      if (interaction.resizeInitialEl) {
        restore.set(interaction.resizeInitialEl.id, interaction.resizeInitialEl);
      }
      interaction.resizeInitialEls?.forEach((element, id) => restore.set(id, element));
      this.deps.updateElementsTransient(restore);
      finalizeResizeGesture(interaction, {
        editingId: state.isEditingElementId,
        resizedId: undefined,
        clearHoverBinding: () => this.updateHoveredBindingId(null),
        commitTransient: () => {},
        setIsActive: this.deps.store.setIsResizing,
        setEditingElementId: this.deps.store.setEditingElementId,
        unlockElement: this.deps.collab.unlockElement,
        unlockGestureElements: this.deps.collab.unlockGestureElements,
      });
      cancelled = true;
    }

    if (interaction.rotating && (interaction.rotateInitialEl || interaction.rotateInitialEls)) {
      const restore = new Map<string, Partial<DriplElement>>();
      if (interaction.rotateInitialEl) {
        restore.set(interaction.rotateInitialEl.id, interaction.rotateInitialEl);
      }
      interaction.rotateInitialEls?.forEach((element, id) => restore.set(id, element));
      this.deps.updateElementsTransient(restore);
      finalizeRotateGesture(interaction, {
        editingId: state.isEditingElementId,
        setIsActive: this.deps.store.setIsRotating,
        setEditingElementId: this.deps.store.setEditingElementId,
        unlockElement: this.deps.collab.unlockElement,
        unlockGestureElements: this.deps.collab.unlockGestureElements,
      });
      cancelled = true;
    }

    if (state.isDrawing) {
      const tool = state.activeTool;
      if (tool === 'laser') {
        this.deps.env.dispatchEvent(new CustomEvent('dripl:laser-end'));
      } else if (tool === 'eraser') {
        // Drop the pending batch and the accumulated hits without deleting:
        // Escape ends the stroke, it does not erase.
        if (this.eraserFlushId !== null && this.deps.env.hasAnimationFrame()) {
          this.deps.env.cancelFrame(this.eraserFlushId);
          this.eraserFlushId = null;
        }
        this.eraserPending = [];
        this.eraserHitIdsRef.current.clear();
        this.deps.store.setEraserPath([]);
      } else {
        this.deps.drawing.cancelDrawing();
      }
      this.deps.store.setIsDrawing(false);
      cancelled = true;
    }

    return cancelled;
  };

  beginResize = (handle: ResizeHandle, e: React.PointerEvent): void => {
    e.stopPropagation();
    if (this.deps.readOnly) return;
    const state = this.deps.store.getSnapshot();
    const selectedIdsArray = Array.from(state.selectedIds);
    if (selectedIdsArray.length === 0) return;

    // Multi-selection: snapshot every unlocked member and arm the group
    // path. The corner/rotate handles the overlay renders for groups were
    // previously inert (silently dropped below); now they scale the sheet.
    if (selectedIdsArray.length > 1) {
      const members = state.elements.filter(
        el =>
          state.selectedIds.has(el.id) &&
          !el.locked &&
          (!state.elementLocks.get(el.id) || state.elementLocks.get(el.id) === state.userId)
      );
      if (members.length === 0) return;
      const frame = unionFrame(members);
      if (!frame) return;
      const snapshot = new Map<string, DriplElement>();
      for (const el of members) snapshot.set(el.id, JSON.parse(JSON.stringify(el)));

      this.state.resizing = true;
      this.state.historyPushed = false;
      this.state.resizeHandle = handle;
      this.state.resizeStartCanvasPos = this.deps.getCanvasCoordinates(e);
      this.state.resizeInitialEl = null;
      this.state.resizeInitialEls = snapshot;
      this.state.resizeGroupFrame = frame;

      this.deps.store.setIsResizing(true);
      this.deps.store.setEditingElementId(null);
      this.deps.collab.lockElementsForGesture(snapshot.keys());

      const canvas = this.deps.containerRef?.current?.querySelector(
        'canvas[data-layer="interactive"]'
      ) as HTMLCanvasElement | null;
      if (canvas) canvas.setPointerCapture(e.pointerId);
      return;
    }

    const element = state.elements.find(el => el.id === selectedIdsArray[0]);
    if (!element) return;
    const lockOwner = state.elementLocks.get(element.id);
    if (lockOwner && lockOwner !== state.userId) return;

    const startPos = this.deps.getCanvasCoordinates(e);

    // Deep clone element to freeze it as the baseline
    const frozenEl: DriplElement = JSON.parse(JSON.stringify(element));

    this.state.resizing = true;
    this.state.historyPushed = false;
    this.state.resizeHandle = handle;
    this.state.resizeStartCanvasPos = startPos;
    this.state.resizeInitialEl = frozenEl;

    this.deps.store.setIsResizing(true);
    // Lock: prevent remote reconciliation from overwriting this element.
    this.deps.store.setEditingElementId(element.id);
    this.deps.collab.lockElementsForGesture([element.id]);

    // Capture pointer on the interactive canvas so we still get events outside
    // it. Selected by layer role, not by DOM order, so reordering the
    // static/interactive stack cannot misdirect the capture.
    const canvas = this.deps.containerRef?.current?.querySelector(
      'canvas[data-layer="interactive"]'
    ) as HTMLCanvasElement | null;
    if (canvas) canvas.setPointerCapture(e.pointerId);
  };

  beginRotate = (e: React.PointerEvent): void => {
    e.stopPropagation();
    if (this.deps.readOnly) return;
    const state = this.deps.store.getSnapshot();
    const selectedIdsArray = Array.from(state.selectedIds);
    if (selectedIdsArray.length === 0) return;

    if (selectedIdsArray.length > 1) {
      const members = state.elements.filter(
        el =>
          state.selectedIds.has(el.id) &&
          !el.locked &&
          (!state.elementLocks.get(el.id) || state.elementLocks.get(el.id) === state.userId)
      );
      if (members.length === 0) return;
      const frame = unionFrame(members);
      if (!frame) return;
      const snapshot = new Map<string, DriplElement>();
      for (const el of members) snapshot.set(el.id, JSON.parse(JSON.stringify(el)));
      const startPos = this.deps.getCanvasCoordinates(e);
      const center = { x: frame.x + frame.width / 2, y: frame.y + frame.height / 2 };

      this.state.rotating = true;
      this.state.historyPushed = false;
      this.state.rotateInitialEl = null;
      this.state.rotateInitialEls = snapshot;
      this.state.rotateCenter = center;
      this.state.rotateStartAngle = Math.atan2(
        startPos.y - center.y,
        startPos.x - center.x
      );

      this.deps.store.setIsRotating(true);
      this.deps.store.setEditingElementId(null);
      this.deps.collab.lockElementsForGesture(snapshot.keys());

      const canvas = this.deps.containerRef?.current?.querySelector(
        'canvas[data-layer="interactive"]'
      ) as HTMLCanvasElement | null;
      if (canvas) canvas.setPointerCapture(e.pointerId);
      return;
    }

    const element = state.elements.find(el => el.id === selectedIdsArray[0]);
    if (!element) return;
    const lockOwner = state.elementLocks.get(element.id);
    if (lockOwner && lockOwner !== state.userId) return;

    const frozenEl: DriplElement = JSON.parse(JSON.stringify(element));

    this.state.rotating = true;
    this.state.historyPushed = false;
    this.state.rotateInitialEl = frozenEl;

    this.deps.store.setIsRotating(true);
    // Lock: prevent remote reconciliation from overwriting this element.
    this.deps.store.setEditingElementId(element.id);
    this.deps.collab.lockElementsForGesture([element.id]);

    const canvas = this.deps.containerRef?.current?.querySelector(
      'canvas[data-layer="interactive"]'
    ) as HTMLCanvasElement | null;
    if (canvas) canvas.setPointerCapture(e.pointerId);
  };

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.eraserFlushId !== null && this.deps.env.hasAnimationFrame()) {
      this.deps.env.cancelFrame(this.eraserFlushId);
    }
    this.eraserFlushId = null;
    this.eraserPending = [];
    this.deps.store.setEraserPath([]);
    this.viewListeners.clear();
  }
}
