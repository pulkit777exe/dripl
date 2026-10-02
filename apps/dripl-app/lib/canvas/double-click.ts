import { v4 as uuidv4 } from 'uuid';
import type { DriplElement, LinearElement, TextElement } from '@dripl/common';
import type { CanvasTextInput } from '@/lib/store/types';
import { createArrowLabel } from '@/utils/tools/arrow';

export interface DoubleClickDeps {
  getElementAtPosition: (x: number, y: number) => DriplElement | null | undefined;
  setTextInput: (state: CanvasTextInput | null) => void;
  addElement: (element: DriplElement) => void;
  updateElement: (id: string, updates: Partial<DriplElement>) => void;
}

/**
 * Double-click handling — extracted from `useCanvasPointerEvents`.
 *
 * Text opens the editor in place; arrows create-or-open their bound label.
 * Returns `true` when the gesture was consumed, `false` when the caller
 * should fall through to the normal select flow (miss or other types).
 */
export function handleDoubleClick(
  point: { x: number; y: number },
  elements: DriplElement[],
  deps: DoubleClickDeps
): boolean {
  const doubleClicked = deps.getElementAtPosition(point.x, point.y);
  if (doubleClicked?.type === 'text') {
    const existingText =
      'text' in doubleClicked && typeof doubleClicked.text === 'string' ? doubleClicked.text : '';
    deps.setTextInput({
      x: doubleClicked.x,
      y: doubleClicked.y,
      id: uuidv4(),
      existingElementId: doubleClicked.id,
      value: existingText,
    });
    return true;
  }

  // Handle double-click on arrows to create/edit labels
  if (doubleClicked?.type === 'arrow') {
    const arrow = doubleClicked as LinearElement;

    // Check if arrow already has a label
    if (arrow.labelId) {
      // Find the existing label text element
      const labelElement = elements.find(el => el.id === arrow.labelId) as TextElement | undefined;
      if (labelElement) {
        // Open text editor for existing label
        deps.setTextInput({
          x: labelElement.x,
          y: labelElement.y,
          id: uuidv4(),
          existingElementId: labelElement.id,
          value: labelElement.text,
        });
        return true;
      }
    }

    // Create a new label for the arrow
    const label = createArrowLabel(arrow, '');

    // Update the arrow to have the label
    const updatedArrow: LinearElement = {
      ...arrow,
      labelId: label.id,
    };

    // Add the label to the elements array
    deps.addElement(label);
    deps.updateElement(arrow.id, updatedArrow);

    // Open text editor for the new label
    deps.setTextInput({
      x: label.x,
      y: label.y,
      id: uuidv4(),
      existingElementId: label.id,
      value: '',
    });
    return true;
  }

  return false;
}
