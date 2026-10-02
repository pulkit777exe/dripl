import type { DriplElement } from '@dripl/common';
import type { InteractionState } from '@/hooks/canvas/useCanvasPointerEvents';

/**
 * Gesture teardown — extracted from `useCanvasPointerEvents`.
 *
 * Every transform gesture (resize/rotate/drag) ends the same way: reset the
 * interaction flags, clear the binding index, drop the editing marker, and
 * — critically — release the collaboration locks. A leaked lock freezes the
 * element for every other collaborator, so the unlock protocol is pinned by
 * tests. Resize additionally commits the transient state and clears the
 * binding hover.
 */

export interface TransformTeardownDeps {
  setIsActive: (active: boolean) => void;
  setEditingElementId: (id: string | null) => void;
  unlockElement: (id: string) => void;
  unlockGestureElements: () => void;
}

function resetGestureIndex(interaction: InteractionState): void {
  interaction.boundArrowsByShape.clear();
  interaction.bindingIndexReady = false;
  interaction.historyPushed = false;
}

function releaseLocks(editingId: string | null, deps: TransformTeardownDeps): void {
  deps.setEditingElementId(null);
  if (editingId) deps.unlockElement(editingId);
  deps.unlockGestureElements();
}

export function finalizeResizeGesture(
  interaction: InteractionState,
  options: TransformTeardownDeps & {
    editingId: string | null;
    resizedId: string | undefined;
    clearHoverBinding: () => void;
    commitTransient: (id: string, updates: Partial<DriplElement>) => void;
  }
): void {
  interaction.resizing = false;
  resetGestureIndex(interaction);
  interaction.resizeHandle = null;
  interaction.resizeStartCanvasPos = null;
  interaction.resizeInitialEl = null;
  options.clearHoverBinding();
  options.setIsActive(false);
  if (options.resizedId) options.commitTransient(options.resizedId, {});
  releaseLocks(options.editingId, options);
}

export function finalizeRotateGesture(
  interaction: InteractionState,
  options: TransformTeardownDeps & { editingId: string | null }
): void {
  interaction.rotating = false;
  resetGestureIndex(interaction);
  interaction.rotateInitialEl = null;
  options.setIsActive(false);
  releaseLocks(options.editingId, options);
}

export function finalizeDragGesture(
  interaction: InteractionState,
  options: TransformTeardownDeps & { editingId: string | null }
): void {
  interaction.dragging = false;
  resetGestureIndex(interaction);
  interaction.dragStartCanvasPos = null;
  interaction.dragInitialElements = null;
  options.setIsActive(false);
  releaseLocks(options.editingId, options);
}
