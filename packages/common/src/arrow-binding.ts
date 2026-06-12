import type { DriplElement, LinearElement } from './types/element';

const BINDABLE_TYPES = new Set(['rectangle', 'ellipse', 'diamond', 'image', 'frame']);

/**
 * Whether an element can be bound to by an arrow.
 * Matches Excalidraw's isBindableElement from typeChecks.ts.
 */
export function isBindableElement(el: DriplElement): boolean {
  return BINDABLE_TYPES.has(el.type);
}

/**
 * Validate and repair bindings on load.
 * - Nulls startBinding/endBinding if referenced element doesn't exist
 * - Removes stale boundElements entries
 * - Deduplicates boundElements
 */
export function repairBindings(elements: DriplElement[]): DriplElement[] {
  const elementsById = new Map(elements.map(e => [e.id, e]));

  return elements.map(el => {
    let updated = el;

    // Repair arrow bindings
    if (updated.type === 'arrow' || updated.type === 'line') {
      const arrow = updated as LinearElement;
      if (arrow.startBinding && !elementsById.has(arrow.startBinding.elementId)) {
        updated = { ...updated, startBinding: undefined } as unknown as DriplElement;
      }
      const reupdated = updated as LinearElement;
      if (reupdated.endBinding && !elementsById.has(reupdated.endBinding.elementId)) {
        updated = { ...updated, endBinding: undefined } as unknown as DriplElement;
      }
    }

    // Repair boundElements
    const elWithBounds = updated as DriplElement & { boundElements?: Array<{ id: string; type: string }> };
    if (elWithBounds.boundElements) {
      const bounds = elWithBounds.boundElements;
      const deduped = bounds.filter(
        (b, i) => bounds.findIndex(x => x.id === b.id) === i && elementsById.has(b.id)
      );
      if (deduped.length !== bounds.length) {
        updated = { ...updated, boundElements: deduped } as DriplElement;
      }
    }

    return updated;
  });
}
