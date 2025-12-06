# Architecture Overview

This document provides a high-level overview of Dripl's architecture.

---

## System Architecture

```
┌─────────────────────────────────────────────────────────┐
│                     Next.js App                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐   │
│  │   UI Layer   │  │    Canvas    │  │   Database   │   │
│  │  (React)     │  │  (Renderer)  │  │   (Prisma)   │   │
│  └──────────────┘  └──────────────┘  └──────────────┘   │
│         │                 │                  │          │
│         └─────────────────┴──────────────────┘          │
│                          │                              │
│                   ┌──────▼──────┐                       │
│                   │    Store    │                       │
│                   │  (TanStack) │                       │
│                   └─────────────┘                       │
└─────────────────────────────────────────────────────────┘
```

---

## Core Packages

### `@dripl/common`

Shared types, constants, and Zod schemas.

**Key Exports:**

- `CanvasElement` - Union type for all element types
- `ElementSchema` - Zod validation schemas
- `THEME_COLORS` - Color palette constants

### `@dripl/store`

Global state management using TanStack Store.

**State:**

- `appState` - App-level settings (zoom, theme, etc.)
- `elements` - Canvas elements array
- `history` - Undo/redo stack

**Actions:**

- `setAppState()` - Update app settings
- `setElements()` - Update canvas elements
- `undo()` / `redo()` - History navigation

### `@dripl/element`

Element creation, selection, and manipulation.

**Key Functions:**

- `createElement()` - Factory for new elements
- `getElementBounds()` - Calculate element bounds
- `isPointInElement()` - Hit testing

### `@dripl/math`

Geometric calculations and utilities.

**Key Functions:**

- `distance()` - Distance between points
- `getBounds()` - Bounding box calculation
- `segmentIntersectsPolygon()` - Intersection testing

---

## Data Flow

### Element Creation

```
User clicks tool → Toolbar updates activeTool
                ↓
User draws on canvas → InteractiveCanvas handles mouse events
                ↓
createElement() called → New element created
                ↓
setElements() called → Store updated
                ↓
Canvas re-renders → Element appears
```

### Element Selection

```
User clicks element → Hit test performed
                ↓
Element ID added to selectedElementIds
                ↓
Sidebar shows properties → User can edit
                ↓
Property change → updateElement action
                ↓
Store updated → Canvas re-renders
```

---

## Rendering Pipeline

### Static Canvas

- Renders all non-selected elements
- Optimized for performance
- Rarely re-renders

### Interactive Canvas

- Renders selected elements
- Handles user interactions
- Shows selection boxes and handles

### Render Flow

```
Store change → React re-render
            ↓
Canvas ref updated → renderInteractiveScene() called
                  ↓
Clear canvas → Draw grid (if enabled)
            ↓
Draw elements → Apply transforms (zoom, pan)
            ↓
Draw selection → Show resize handles
```

---

## State Management

### App State

Global settings that persist across sessions:

- Zoom level
- Scroll position
- Active tool
- Theme preference
- Grid settings

### Element State

Canvas elements stored as array:

- Each element has unique ID
- Properties: position, size, style
- Stored in database as JSON

### History State

Undo/redo functionality:

- Stack of element snapshots
- Current index pointer
- Max 50 states stored

---

## Database Schema

```
User
├── id
├── email
└── files[]

File
├── id
├── name
├── content (JSON)
├── userId
└── folderId

Folder
├── id
├── name
└── userId
```

---

## Authentication Flow

```
User visits app → Clerk checks auth
              ↓
Not authenticated → Redirect to sign-in
              ↓
Sign in with email/OAuth → Clerk creates session
                        ↓
Redirect to dashboard → Load user's files
                      ↓
User opens file → Load content from database
```

---

## Performance Optimizations

### Canvas Rendering

- Use `requestAnimationFrame` for smooth updates
- Batch element updates
- Only re-render changed regions

### State Updates

- Debounce auto-save (1 second)
- Throttle mouse move events
- Use React.memo for expensive components

### Database

- Index on userId and folderId
- Lazy load file content
- Cache frequently accessed data

---

## Future Considerations

- **Real-time Collaboration**: WebSocket integration for multi-user editing
- **Offline Support**: IndexedDB for local storage
- **Export Formats**: SVG, PNG, PDF export
- **Plugin System**: Allow third-party tools and elements
