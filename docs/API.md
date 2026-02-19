# API Reference

Quick reference for commonly used functions and types.

---

## Canvas Elements

### Creating Elements

```typescript
import { createElement } from "@dripl/element";

// Create a rectangle
const rect = createElement("rectangle", {
  x: 100,
  y: 100,
  width: 200,
  height: 150,
  fill: "#ffffff",
  stroke: "#000000",
  strokeWidth: 2,
});

// Create an ellipse
const ellipse = createElement("ellipse", {
  x: 300,
  y: 300,
  width: 100,
  height: 50,
  fill: "#ff0000",
});

// Create a path (freehand drawing)
const path = createElement("path", {
  points: [
    [0, 0],
    [10, 10],
    [20, 5],
  ],
  stroke: "#0000ff",
  strokeWidth: 3,
});
```

### Element Types

```typescript
type DriplElement =
  | RectangleElement
  | EllipseElement
  | DiamondElement
  | LinearElement
  | FreeDrawElement
  | TextElement
  | ImageElement
  | FrameElement;

interface BaseElement {
  id: string;
  type: ElementType;
  x: number;
  y: number;
  width?: number;
  height?: number;
  rotation: number;
  opacity: number;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  roughness?: number;
  strokeSharpness?: "round" | "sharp";
}
```

---

## State Management

### Reading State

```typescript
import { appStore } from "@dripl/store";

// Get current state
const state = appStore.state;
console.log(state.appState.zoom);
console.log(state.elements);

// Subscribe to changes
const unsubscribe = appStore.subscribe(() => {
  const newState = appStore.state;
  console.log("State updated:", newState);
});
```

### Updating State

```typescript
import { setAppState, setElements } from "@dripl/store";

// Update app state
setAppState((prev) => ({
  ...prev,
  zoom: 1.5,
  activeTool: "rectangle",
}));

// Update elements
setElements((prev) => [...prev, newElement]);

// Replace all elements
setElements([element1, element2]);
```

### History

```typescript
import { undo, redo, pushToHistory } from "@dripl/store";

// Undo last action
undo();

// Redo
redo();

// Save current state to history
pushToHistory(elements);
```

---

## Geometry Utilities

### Distance Calculations

```typescript
import { distance, distanceToSegment } from "@dripl/math";

// Distance between two points
const d = distance({ x: 0, y: 0 }, { x: 3, y: 4 });
// Returns: 5

// Distance from point to line segment
const dist = distanceToSegment(
  { x: 5, y: 5 },
  { start: { x: 0, y: 0 }, end: { x: 10, y: 0 } },
);
```

### Bounds Calculations

```typescript
import { getBounds, boundsIntersect } from "@dripl/math";

// Get bounding box of points
const bounds = getBounds([
  { x: 0, y: 0 },
  { x: 10, y: 10 },
  { x: 5, y: 15 },
]);
// Returns: { x: 0, y: 0, width: 10, height: 15 }

// Check if two bounds intersect
const intersects = boundsIntersect(
  { x: 0, y: 0, width: 10, height: 10 },
  { x: 5, y: 5, width: 10, height: 10 },
);
// Returns: true
```

---

## Element Operations

### Hit Testing

```typescript
import { isPointInElement, getElementBounds } from "@dripl/element";

// Check if point is inside element
const isInside = isPointInElement({ x: 150, y: 150 }, element);

// Get element bounds
const bounds = getElementBounds(element);
```

### Selection

```typescript
import { getCommonBounds } from "@dripl/element";

// Get bounds of multiple selected elements
const selectionBounds = getCommonBounds(selectedElements);
```

---

## React Hooks

### Using App Context

```typescript
import { useApp, useElements, useActionManager } from '@/context/AppContext';

function MyComponent() {
  const { appState, setAppState, history } = useApp();
  const { elements, setElements } = useElements();
  const { actionManager } = useActionManager();

  const handleZoomIn = () => {
    actionManager.executeAction(
      'zoomIn',
      elements,
      appState,
      undefined,
      setElements,
      setAppState,
      history.pushToHistory
    );
  };

  return <button onClick={handleZoomIn}>Zoom In</button>;
}
```

---

## Database Operations

### File Operations

```typescript
import { createFile, updateFile, deleteFile } from "@/actions/files";

// Create new file
const file = await createFile({
  name: "My Drawing",
  folderId: "folder-123",
});

// Update file content
await updateFile(fileId, JSON.stringify(elements));

// Delete file
await deleteFile(fileId);
```

### Folder Operations

```typescript
import { createFolder, getFolders } from "@/actions/folders";

// Create folder
const folder = await createFolder({ name: "Projects" });

// Get user's folders
const folders = await getFolders();
```

---

## Validation

### Using Zod Schemas

```typescript
import { ElementSchema, CanvasContentSchema } from "@dripl/common";

// Validate single element
const result = ElementSchema.safeParse(data);
if (result.success) {
  const element = result.data;
}

// Validate array of elements
const contentResult = CanvasContentSchema.safeParse(jsonData);
```

---

## Constants

### Colors

```typescript
import { THEME_COLORS } from "@dripl/common";

const strokeColors = THEME_COLORS.stroke;
const fillColors = THEME_COLORS.fill;
```

### Tools

```typescript
const TOOLS = [
  "select",
  "hand",
  "rectangle",
  "ellipse",
  "diamond",
  "arrow",
  "line",
  "draw",
  "text",
  "image",
  "frame",
  "eraser",
] as const;
```

---

## TypeScript Tips

### Type Guards

```typescript
function isRectangle(element: DriplElement): element is RectangleElement {
  return element.type === "rectangle";
}

if (isRectangle(element)) {
  // TypeScript knows element is RectangleElement
  console.log(element.cornerRadius);
}
```

### Utility Types

```typescript
// Partial element update
type ElementUpdate = Partial<DriplElement> & { id: string };

// Pick specific properties
type ElementPosition = Pick<DriplElement, "x" | "y">;

// Omit properties
type ElementWithoutId = Omit<DriplElement, "id">;
```
