import type { DriplElement, TextElement } from "@dripl/common";
import { v4 as uuidv4 } from "uuid";

// Offset for duplicated elements (pixels)
const DUPLICATION_OFFSET = 20;

/**
 * Create a deep copy of an element with new ID
 */
export function createElementCopy(element: DriplElement): DriplElement {
  const copy = JSON.parse(JSON.stringify(element));
  copy.id = uuidv4();

  // Reset any properties that should not be inherited
  if (copy.isDeleted) {
    copy.isDeleted = false;
  }

  // Clear bound text references if creating a standalone copy
  if (copy.boundElementId) {
    copy.boundElementId = undefined;
  }

  return copy;
}

/**
 * Duplicate a single element with offset
 */
export function duplicateElement(
  element: DriplElement,
  offset = DUPLICATION_OFFSET,
): DriplElement {
  const copy = createElementCopy(element);

  // Offset the duplicate
  copy.x += offset;
  copy.y += offset;

  // If it's a text element bound to another element, duplicate it as standalone
  if (copy.boundElementId) {
    copy.boundElementId = undefined;
  }

  // Offset points for linear elements
  if (copy.points) {
    copy.points = copy.points.map((point: any) => ({
      x: point.x + offset,
      y: point.y + offset,
    }));
  }

  return copy;
}

/**
 * Duplicate multiple elements with offset
 */
export function duplicateElements(
  elements: DriplElement[],
  selectedIds: string[],
  offset = DUPLICATION_OFFSET,
): DriplElement[] {
  const selectedElements = elements.filter((el) => selectedIds.includes(el.id));
  const nonSelectedElements = elements.filter(
    (el) => !selectedIds.includes(el.id),
  );

  const duplicatesMap = new Map<string, string>(); // oldId -> newId
  const duplicatedElements: DriplElement[] = [];

  // First pass: create duplicates without bound text
  selectedElements.forEach((element) => {
    if (element.type === "text" && element.boundElementId) {
      return; // Skip bound text for now - handle after main elements are duplicated
    }

    const duplicate = duplicateElement(element, offset);
    duplicatesMap.set(element.id, duplicate.id);
    duplicatedElements.push(duplicate);
  });

  // Second pass: duplicate bound text with updated references
  selectedElements.forEach((element) => {
    if (element.type === "text" && element.boundElementId) {
      const boundElementNewId = duplicatesMap.get(element.boundElementId);
      if (boundElementNewId) {
        const duplicate = duplicateElement(element, offset);
        duplicate.boundElementId = boundElementNewId;
        duplicatedElements.push(duplicate);
      }
    }
  });

  return [...nonSelectedElements, ...duplicatedElements];
}

/**
 * Duplicate an element with its bound text
 */
export function duplicateElementWithBoundText(
  element: DriplElement,
  elements: DriplElement[],
  offset = DUPLICATION_OFFSET,
): DriplElement[] {
  const elementCopy = duplicateElement(element, offset);
  const boundText = elements.find(
    (el) => el.type === "text" && el.boundElementId === element.id,
  ) as TextElement | undefined;

  if (boundText) {
    const boundTextCopy = duplicateElement(boundText, offset);
    boundTextCopy.boundElementId = elementCopy.id;
    return [elementCopy, boundTextCopy];
  }

  return [elementCopy];
}

/**
 * Duplicate a group of elements with their bound text
 */
export function duplicateGroupWithBoundText(
  elements: DriplElement[],
  groupId: string,
  offset = DUPLICATION_OFFSET,
): DriplElement[] {
  const groupElements = elements.filter((el) => el.groupId === groupId);
  const duplicatesMap = new Map<string, string>(); // oldId -> newId
  const duplicatedElements: DriplElement[] = [];

  // First pass: duplicate main elements
  groupElements.forEach((element) => {
    if (element.type === "text" && element.boundElementId) {
      return; // Skip bound text for now
    }

    const duplicate = duplicateElement(element, offset);
    duplicatesMap.set(element.id, duplicate.id);
    duplicatedElements.push(duplicate);
  });

  // Second pass: duplicate bound text with updated references
  groupElements.forEach((element) => {
    if (element.type === "text" && element.boundElementId) {
      const boundElementNewId = duplicatesMap.get(element.boundElementId);
      if (boundElementNewId) {
        const duplicate = duplicateElement(element, offset);
        duplicate.boundElementId = boundElementNewId;
        duplicatedElements.push(duplicate);
      }
    }
  });

  return duplicatedElements;
}

/**
 * Smart duplication with offset based on previous duplication
 */
export function smartDuplicateElements(
  elements: DriplElement[],
  selectedIds: string[],
  previousOffset: number = DUPLICATION_OFFSET,
): DriplElement[] {
  return duplicateElements(elements, selectedIds, previousOffset);
}

/**
 * Duplicate elements symmetrically (mirror)
 */
export function duplicateSymmetrically(
  elements: DriplElement[],
  selectedIds: string[],
  axis: "horizontal" | "vertical" = "horizontal",
  offset: number = DUPLICATION_OFFSET * 2,
): DriplElement[] {
  const selectedElements = elements.filter((el) => selectedIds.includes(el.id));
  const nonSelectedElements = elements.filter(
    (el) => !selectedIds.includes(el.id),
  );

  // Calculate bounding box of selected elements for symmetric duplication
  const minX = Math.min(...selectedElements.map((el) => el.x));
  const minY = Math.min(...selectedElements.map((el) => el.y));
  const maxX = Math.max(...selectedElements.map((el) => el.x + el.width));
  const maxY = Math.max(...selectedElements.map((el) => el.y + el.height));
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;

  const duplicatedElements: DriplElement[] = [];
  const duplicatesMap = new Map<string, string>();

  // Duplicate elements
  selectedElements.forEach((element) => {
    if (element.type === "text" && element.boundElementId) {
      return;
    }

    const copy = createElementCopy(element);

    // Calculate symmetric position
    if (axis === "horizontal") {
      const distanceFromCenter = element.x - centerX;
      copy.x = centerX - distanceFromCenter + offset;
      copy.y = element.y;
    } else {
      const distanceFromCenter = element.y - centerY;
      copy.y = centerY - distanceFromCenter + offset;
      copy.x = element.x;
    }

    duplicatesMap.set(element.id, copy.id);
    duplicatedElements.push(copy);
  });

  // Handle bound text
  selectedElements.forEach((element) => {
    if (element.type === "text" && element.boundElementId) {
      const boundElementNewId = duplicatesMap.get(element.boundElementId);
      if (boundElementNewId) {
        const copy = createElementCopy(element);

        // Calculate symmetric position
        if (axis === "horizontal") {
          const distanceFromCenter = element.x - centerX;
          copy.x = centerX - distanceFromCenter + offset;
          copy.y = element.y;
        } else {
          const distanceFromCenter = element.y - centerY;
          copy.y = centerY - distanceFromCenter + offset;
          copy.x = element.x;
        }

        copy.boundElementId = boundElementNewId;
        duplicatedElements.push(copy);
      }
    }
  });

  return [...nonSelectedElements, ...duplicatedElements];
}
