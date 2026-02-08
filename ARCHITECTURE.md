# Dripl Architecture

## Overview

Dripl is a collaborative whiteboard application inspired by Excalidraw, built with modern web technologies. This document outlines the architectural components and design decisions.

## Architecture Components

### 1. Scene Management (`Scene`)

The `Scene` class manages the collection of elements on the canvas, including:

- **Element Collection**: Maintains a map of active elements with unique IDs
- **Selection State**: Tracks selected elements and text editing state
- **Element Lifecycle**: Handles adding, updating, deleting, and restoring elements
- **Bounds Calculation**: Computes bounds for all elements or selected elements
- **Cloning & Serialization**: Supports deep cloning and JSON serialization

### 2. Delta System (`DeltaManager`)

The delta system enables efficient change tracking and history management:

- **Delta Operations**: Captures changes as add, update, delete, or restore operations
- **State Reconstruction**: Applies deltas to reconstruct past states
- **Inverse Operations**: Reverts changes by applying inverse deltas
- **History Management**: Maintains a history of operations with configurable size limits
- **Collaboration Support**: Deltas can be serialized and transmitted over the network

### 3. Action System (`ActionCreator`, `ActionReducer`, `ActionDispatcher`)

The action system provides a centralized way to manage state changes:

- **Action Creators**: Factory functions for creating typed actions
- **Action Reducer**: Pure function to apply actions to the scene
- **Action Dispatcher**: Event bus for distributing actions to subscribers
- **Type Safety**: Strongly typed action types and payloads

### 4. Pointer Interaction (`PointerManager`, `DragDetector`)

The pointer interaction system abstracts DOM event handling:

- **Pointer Manager**: Manages pointer events (mouse, touch, pen)
- **Drag Detection**: Detects drag operations with configurable sensitivity
- **Event Subscription**: Allows components to subscribe to pointer events
- **Cross-Browser Support**: Handles different pointer types and browsers

## Architecture Principles

### Separation of Concerns

- **Scene**: Manages data and state
- **Actions**: Define operations
- **Reducer**: Applies operations
- **Delta System**: Tracks changes
- **View**: Renders the scene

### Immutability

All state changes are immutable - each action creates a new scene copy.

### Predictable State Management

Actions provide a predictable way to modify state, making debugging and testing easier.

### Extensibility

Components are designed to be extensible:

- New element types can be added
- New action types can be created
- Custom functionality can be added through subscribers

## Usage Examples

### Basic Usage

```typescript
import {
  Scene,
  ActionCreator,
  ActionReducer,
  ActionDispatcher,
  DeltaManager,
} from "@dripl/common";
import { createElement } from "@dripl/element";
import { SHAPES } from "@dripl/common";

// Create initial scene
const initialElements = [
  createElement(SHAPES.RECTANGLE, 100, 100, 200, 150),
  createElement(SHAPES.ELLIPSE, 400, 100, 150, 150),
];

const scene = new Scene(initialElements);

// Initialize action system
const dispatcher = new ActionDispatcher();
const deltaManager = new DeltaManager();

// Subscribe to actions
dispatcher.subscribe((action) => {
  const newScene = ActionReducer.reduce(scene, action, deltaManager);
  console.log("New scene state:", newScene.getElements());
});

// Dispatch actions
const newElement = createElement(SHAPES.TEXT, 100, 300, 200, 50);
dispatcher.dispatch(ActionCreator.addElement(newElement));
```

### History Management

```typescript
import { SceneHistory } from "@dripl/common";

const history = new SceneHistory(initialScene);

// After state changes
history.pushState(newScene);

// Undo
if (history.canUndo()) {
  const previousState = history.undo();
}

// Redo
if (history.canRedo()) {
  const nextState = history.redo();
}
```

## Comparison with Excalidraw Architecture

While Excalidraw uses Redux for state management and has its own action system, Dripl takes inspiration but implements a more modular approach:

### Key Differences

1. **State Management**: Dripl uses a custom Scene class instead of Redux
2. **Action System**: Actions are typed objects with explicit payloads
3. **Delta System**: Dripl's delta system is designed for collaboration
4. **Component Architecture**: Dripl's components are more loosely coupled

### Similarities

1. **Scene Management**: Both track elements and selection state
2. **Change Tracking**: Both support history and undo/redo operations
3. **Event Handling**: Both abstract DOM event handling
4. **Collaboration**: Both support real-time collaborative editing

## Future Improvements

1. **Real-Time Collaboration**: Enhance delta system for real-time sync
2. **Performance**: Optimize scene updates and rendering
3. **Testing**: Add comprehensive unit and integration tests
4. **Documentation**: Improve JSDoc comments and examples

## Conclusion

Dripl's architecture is designed to be:

- **Scalable**: Can handle large numbers of elements
- **Maintainable**: Clear separation of concerns
- **Extensible**: Easy to add new functionality
- **Collaborative**: Built-in support for real-time collaboration
