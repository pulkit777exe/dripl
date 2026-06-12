import type { DriplElement } from './types/element';

/**
 * Collect all element IDs that should be deleted when seedIds are deleted.
 * Handles cascade: arrows with labels, text bound to containers.
 * Returns deduplicated array of IDs.
 */
export function collectCascadeDeleteIds(
  seedIds: Iterable<string>,
  elements: readonly DriplElement[]
): string[] {
  const toDelete = new Set<string>(seedIds);
  if (toDelete.size === 0) return [];

  let changed = true;
  while (changed) {
    changed = false;
    for (const element of elements) {
      if (toDelete.has(element.id)) {
        if (
          (element.type === 'arrow' || element.type === 'line') &&
          'labelId' in element &&
          element.labelId &&
          !toDelete.has(element.labelId)
        ) {
          toDelete.add(element.labelId);
          changed = true;
        }
        continue;
      }

      if (element.type !== 'text') continue;
      const boundTargetId =
        ('boundElementId' in element ? element.boundElementId : undefined) ??
        ('containerId' in element ? element.containerId : undefined);
      if (boundTargetId && toDelete.has(boundTargetId)) {
        toDelete.add(element.id);
        changed = true;
      }
    }
  }

  return Array.from(toDelete);
}
