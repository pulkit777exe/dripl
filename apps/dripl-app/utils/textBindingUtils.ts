import type { DriplElement, TextElement } from "@dripl/common";
import { getBounds } from "@dripl/math";

/**
 * Check if an element has bound text
 */
export function hasBoundText(
  element: DriplElement,
  elements: DriplElement[],
): boolean {
  return elements.some(
    (el) => el.type === "text" && el.boundElementId === element.id,
  );
}

/**
 * Get bound text for an element
 */
export function getBoundText(
  element: DriplElement,
  elements: DriplElement[],
): TextElement | null {
  return elements.find(
    (el) => el.type === "text" && el.boundElementId === element.id,
  ) as TextElement | null;
}

/**
 * Create bound text for an element
 */
export function createBoundText(
  text: string,
  boundElement: DriplElement,
  baseProps: Partial<TextElement> = {},
): TextElement {
  const bounds = getBounds([
    { x: boundElement.x, y: boundElement.y },
    {
      x: boundElement.x + boundElement.width,
      y: boundElement.y + boundElement.height,
    },
  ]);

  return {
    id: crypto.randomUUID(),
    type: "text",
    text,
    fontSize: baseProps.fontSize ?? 16,
    fontFamily: baseProps.fontFamily ?? "Arial",
    textAlign: baseProps.textAlign ?? "center",
    verticalAlign: baseProps.verticalAlign ?? "bottom",
    strokeColor: baseProps.strokeColor ?? "#000000",
    x: bounds.x + bounds.width / 2,
    y: bounds.y + bounds.height + 5,
    width: bounds.width,
    height: 20,
    boundElementId: boundElement.id,
    ...baseProps,
  };
}

/**
 * Update bound text position when bound element is moved
 */
export function updateBoundTextPosition(
  boundElement: DriplElement,
  textElement: TextElement,
): TextElement {
  const bounds = getBounds([
    { x: boundElement.x, y: boundElement.y },
    {
      x: boundElement.x + boundElement.width,
      y: boundElement.y + boundElement.height,
    },
  ]);

  return {
    ...textElement,
    x: bounds.x + bounds.width / 2,
    y: bounds.y + bounds.height + 5,
    width: bounds.width,
  };
}

/**
 * Update all bound text positions when elements are moved
 */
export function updateAllBoundTextPositions(
  elements: DriplElement[],
): DriplElement[] {
  const textElements = elements.filter(
    (el) => el.type === "text" && el.boundElementId,
  ) as TextElement[];
  const otherElements = elements.filter(
    (el) => el.type !== "text" || !el.boundElementId,
  );

  const updatedTextElements = textElements.map((textEl) => {
    const boundElement = otherElements.find(
      (el) => el.id === textEl.boundElementId,
    );
    return boundElement
      ? updateBoundTextPosition(boundElement, textEl)
      : textEl;
  });

  return otherElements.map((el) => {
    if (el.type === "text" && el.boundElementId) {
      const updated = updatedTextElements.find((textEl) => textEl.id === el.id);
      return updated ?? el;
    }
    return el;
  });
}

/**
 * Delete bound text when bound element is deleted
 */
export function deleteBoundText(
  elementId: string,
  elements: DriplElement[],
): DriplElement[] {
  return elements.filter(
    (el) => el.type !== "text" || el.boundElementId !== elementId,
  );
}

/**
 * Get all elements with their bound text
 */
export function getElementsWithBoundText(elements: DriplElement[]): Array<{
  element: DriplElement;
  boundText: TextElement | null;
}> {
  const nonTextElements = elements.filter((el) => el.type !== "text");
  return nonTextElements.map((element) => ({
    element,
    boundText: getBoundText(element, elements),
  }));
}

/**
 * Create text with proper bounds and formatting
 */
export function createTextElement(
  text: string,
  point: { x: number; y: number },
  baseProps: Partial<TextElement> = {},
): TextElement {
  return {
    id: crypto.randomUUID(),
    type: "text",
    text,
    fontSize: baseProps.fontSize ?? 16,
    fontFamily: baseProps.fontFamily ?? "Arial",
    textAlign: baseProps.textAlign ?? "left",
    verticalAlign: baseProps.verticalAlign ?? "top",
    strokeColor: baseProps.strokeColor ?? "#000000",
    x: point.x,
    y: point.y,
    width: 200,
    height: 20,
    ...baseProps,
  };
}
