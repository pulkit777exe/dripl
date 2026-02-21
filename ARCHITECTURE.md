# Dripl Application Architecture

## Overview

Dripl is a modern, real-time collaborative whiteboard application built with Next.js, TypeScript, and WebSockets. This document provides a comprehensive overview of the codebase structure, design patterns, and architecture decisions.

## Project Structure

```
dripl/
├── apps/dripl-app/          # Next.js application
│   ├── app/                 # App Router pages and routes
│   ├── components/          # React components
│   ├── actions/             # Server actions
│   ├── hooks/               # Custom React hooks
│   ├── utils/               # Utility functions
│   ├── types/               # TypeScript type definitions
│   ├── lib/                 # Core libraries
│   ├── eraser/              # Eraser functionality
│   └── public/              # Static assets
├── packages/                # Monorepo packages
│   ├── common/              # Shared types and constants
│   ├── db/                  # Prisma database schema
│   ├── dripl/               # UI components library
│   ├── element/             # Canvas element definitions
│   ├── math/                # Geometric calculations
│   └── utils/               # Shared utilities
└── turbo.json               # Turbo configuration
```

## Technology Stack

### Frontend

- **Framework**: Next.js 16 with App Router
- **Styling**: Tailwind CSS 4
- **State Management**: Zustand (main app), TanStack Store (component library)
- **Authentication**: Clerk
- **UI Components**: Lucide icons, Sonner toasts, Framer Motion
- **Canvas Rendering**: HTML5 Canvas with custom renderer
- **Real-time Communication**: WebSockets

### Backend

- **Database**: PostgreSQL with Prisma ORM
- **ORM**: Prisma
- **WebSockets**: Next.js API routes with WebSocket support

### Shared Packages

- **Type Definitions**: packages/common
- **Database Schema**: packages/db
- **UI Library**: packages/dripl
- **Canvas Elements**: packages/element
- **Geometry**: packages/math
- **Utilities**: packages/utils

## Core Features

### Canvas System

The canvas is the heart of Dripl, built as a modular system with multiple layers:

#### Canvas Components

- **Canvas.tsx** - Main canvas component managing tools, state, and rendering
- **InteractiveCanvas.tsx** - Handles pointer events and tool interactions
- **CanvasRenderer.tsx** - Handles actual canvas drawing
- **StaticCanvas.tsx** - For non-interactive canvas display
- **RoughCanvas.tsx** - Implements rough drawing style
- **DualCanvas.tsx** - Handles layered canvas rendering

#### Canvas Store

**File**: `apps/dripl-app/lib/canvas-store.ts`

Uses Zustand for state management with:
- Canvas state (zoom, pan, theme)
- Element management
- Tool state
- Collaboration state (remote users, cursors)
- History tracking
- Theme management

#### Canvas Controls

**File**: `apps/dripl-app/components/canvas/CanvasControls.tsx`

Provides UI controls for:
- Tool selection
- Color picker
- Stroke width
- Fill style
- Canvas settings

#### Rendering System

**File**: `packages/element/src/renderer.ts`

Multiple rendering engines:
- **HTML5 Canvas Renderer** - Standard rendering
- **Rough Renderer** - Hand-drawn style (roughjs)
- **Vector Renderer** - SVG-based rendering

### Elements and Shapes

**File**: `packages/common/src/types/element.ts`

Supported element types:
- Rectangle
- Ellipse
- Diamond
- Arrow
- Line
- FreeDraw
- Text
- Image
- Frame

Each element type has:
- Properties (x, y, width, height, rotation, opacity)
- Styling (stroke color, background color, stroke width, roughness)
- Serialization schema

#### Shape Registry

**File**: `apps/dripl-app/utils/shapes/ShapeRegistry.ts`

Dynamic shape registration system allowing custom shapes to be added without modifying core code.

### Tools

**File**: `apps/dripl-app/hooks/useDrawingTools.ts`

Available tools:
- Select
- Hand (pan)
- Rectangle
- Ellipse
- Diamond
- Arrow
- Line
- FreeDraw (pen)
- Text
- Image
- Frame
- Eraser

Each tool has state management and event handlers.

### Collaboration System

**File**: `apps/dripl-app/hooks/useCanvasWebSocket.ts`

Real-time collaboration via WebSockets:
- User presence detection
- Remote cursor tracking
- Real-time element synchronization
- Conflict resolution
- Full scene sync

WebSocket messages:
- `sync_room_state` - Initial room state
- `user_join` - User joined
- `user_leave` - User left
- `add_element` - Element added
- `update_element` - Element updated
- `delete_element` - Element deleted
- `cursor_move` - Cursor position

### Reconciliation System

**File**: `apps/dripl-app/lib/reconciliation.ts`

Handles conflict resolution between local and remote state changes:
- Version tracking
- Conflict detection
- Automatic resolution
- Manual override

### Storage System

#### Database

**File**: `packages/db/prisma/schema.prisma`

Data models:
- User
- Team
- File
- Folder
- SharedFile
- CanvasRoom
- CanvasRoomMember

#### File Storage

**File**: `apps/dripl-app/lib/canvas-db.ts`

Uses IndexedDB for offline storage and synchronization.

#### Local Storage

**File**: `apps/dripl-app/utils/localCanvasStorage.ts`

Temporary storage for unsaved changes.

### History System

**File**: `apps/dripl-app/utils/canvasHistory.ts`

Undo/Redo functionality with:
- Unlimited history depth
- Grouped actions
- Branching history support

### Action System

**File**: `apps/dripl-app/utils/actionSystem.ts`

Command-based architecture:
- Action registry
- Action execution
- Key bindings
- Event tracking
- View mode support

### Export System

**File**: `apps/dripl-app/utils/export.ts`

Export formats:
- PNG
- JSON
- SVG (planned)
- PDF (planned)

### Accessibility

**File**: `apps/dripl-app/hooks/useAccessibility.ts`

Accessibility features:
- Keyboard navigation
- Screen reader support
- High contrast mode
- Focus management

## Routing and Pages

### Main Pages

**File**: `apps/dripl-app/app/page.tsx` - Landing page

**File**: `apps/dripl-app/app/canvas/[roomSlug]/page.tsx` - Collaborative canvas room

**File**: `apps/dripl-app/app/dashboard/page.tsx` - User dashboard with files

**File**: `apps/dripl-app/app/library/page.tsx` - Shape library

**File**: `apps/dripl-app/app/templates/page.tsx` - Template gallery

**File**: `apps/dripl-app/app/settings/[section]/page.tsx` - User settings

### API Routes

**File**: `apps/dripl-app/app/api/ai/generate/route.ts` - AI generation endpoint

**File**: `apps/dripl-app/app/api/share/route.ts` - Sharing endpoint

## Styling System

**File**: `packages/dripl/src/theme/colors.ts`

Theme system supporting:
- Light mode
- Dark mode
- System theme detection
- Custom themes

**File**: `apps/dripl-app/app/globals.css` - Global styles with CSS variables

## Components

### UI Components (packages/dripl)

**File**: `packages/dripl/src/index.ts`

Reusable components:
- Buttons
- Cards
- Canvas components
- Property panel
- Toolbar
- Sidebar
- Panels

### Canvas Components (apps/dripl-app)

**File**: `apps/dripl-app/components/canvas/`

Canvas-specific components:
- TopBar
- Toolbar
- PropertiesPanel
- TransformationPanel
- ContextMenu
- ExportModal
- ShareModal
- AIGenerateModal
- CommandPalette

## Hooks

**File**: `apps/dripl-app/hooks/`

Custom React hooks:

- `useCanvas.ts` - Main canvas hook
- `useDrawingTools.ts` - Drawing tool management
- `useSelection.ts` - Element selection
- `useElementManipulation.ts` - Element transform
- `useDuplication.ts` - Duplication
- `useHistory.ts` - History management
- `useCanvasWebSocket.ts` - WebSocket connection
- `useZoom.ts` - Zoom management
- `useTheme.ts` - Theme management
- `useClipboard.ts` - Clipboard operations
- `useAccessibility.ts` - Accessibility
- `useKeyboardShortcuts.ts` - Keyboard handling
- `useShapeRegistry.ts` - Shape registry
- `useTextBinding.ts` - Text binding
- `useZIndexManagement.ts` - Z-index
- `useExport.ts` - Export functionality

## Utilities

**File**: `apps/dripl-app/utils/`

Utility modules:

- `canvasUtils.ts` - Canvas operations
- `canvasHistory.ts` - History
- `localCanvasStorage.ts` - Storage
- `export.ts` - Export
- `actionSystem.ts` - Actions
- `canvas-coordinates.ts` - Coordinate calculations
- `performance.ts` - Performance optimization
- `renderThrottling.ts` - Render optimization
- `viewport-culling.ts` - Viewport optimization
- `zoomUtils.ts` - Zoom calculations
- `zIndexUtils.ts` - Z-index management
- `bindingUtils.ts` - Data binding
- `arrow-routing.ts` - Arrow pathfinding
- `shapes/defaultShapes.ts` - Shape definitions

## Math and Geometry

**File**: `packages/math/src/`

Geometry operations:
- `geometry.ts` - Basic geometric operations
- `intersection.ts` - Line intersections
- `collision.ts` - Collision detection
- `hit-detection.ts` - Point-in-shape tests
- `performance.ts` - Performance metrics

## Authentication

**File**: `apps/dripl-app/app/context/AuthContext.tsx`

Uses Clerk for authentication:
- Email/password login
- Social login
- User profiles
- Teams management

## Theme System

**File**: `packages/dripl/src/theme/`

Theme context and colors definitions:
- `colors.ts` - Color definitions
- `canvas-colors.ts` - Canvas-specific colors
- `ThemeContext.tsx` - Theme context
- `index.ts` - Theme provider

## Key Design Patterns

### Component Architecture

1. **Atomic Design** - Components are built in a hierarchical manner
2. **Container/Presentational** - Logic and UI separation
3. **HOC (Higher Order Components)** - Reusable component wrappers
4. **Custom Hooks** - Shared logic extraction

### State Management

1. **Zustand** - Main state management
2. **Context API** - Theme and auth state
3. **Local State** - Component-level state

### Data Flow

1. **Unidirectional Data Flow** - State updates flow from store to components
2. **Event-Driven** - Actions trigger state changes
3. **Real-time Sync** - WebSocket-based collaboration

### Performance Optimization

1. **Virtual Rendering** - Only visible elements rendered
2. **Render Throttling** - Batch updates
3. **Debouncing** - Reduce frequent updates
4. **Web Workers** - Background processing
5. **Image Optimization** - Lazy loading and compression

### Security

1. **Input Validation** - Zod schemas
2. **SQL Injection Prevention** - Prisma ORM
3. **XSS Protection** - Next.js built-in protection
4. **Authentication** - Clerk
5. **Authorization** - Role-based access

## Database Architecture

### Prisma Schema

**File**: `packages/db/prisma/schema.prisma`

Main models:

```prisma
model User {
  id        String   @id
  email     String   @unique
  name      String?
  password  String
  image     String?
  teams     TeamMember[]
  files     File[]
  ...
}

model File {
  id        String   @id @default(cuid())
  name      String
  content   String   @default("[]")
  preview   String?
  folderId  String?
  teamId    String?
  userId    String?
  ...
}

model Team {
  id        String   @id @default(cuid())
  name      String
  slug      String   @unique
  members   TeamMember[]
  files     File[]
  ...
}

model CanvasRoom {
  id        String   @id @default(cuid())
  name      String
  slug      String   @unique
  createdAt DateTime @default(now())
  members   CanvasRoomMember[]
  ...
}
```

## API Design

### RESTful Endpoints

**File**: `apps/dripl-app/app/api/`

Available endpoints:

- `/api/ai/generate` - AI image generation
- `/api/share` - File sharing
- Database operations via Prisma

### WebSocket API

**File**: `apps/dripl-app/hooks/useCanvasWebSocket.ts`

Real-time communication:
- Room synchronization
- User presence
- Cursor tracking
- Element updates

## Development Workflow

### Scripts

```json
{
  "build": "pnpm run db:generate && turbo run build",
  "db:generate": "prisma generate --schema=./packages/db/prisma/schema.prisma",
  "db:migrate": "prisma migrate dev --schema=./packages/db/prisma/schema.prisma",
  "db:push": "prisma db push --schema=./packages/db/prisma/schema.prisma",
  "dev": "pnpm run db:generate && turbo run dev",
  "lint": "turbo run lint",
  "test": "turbo run test",
  "format": "prettier --write \"**/*.{ts,tsx,md}\""
}
```

### Code Style

- **TypeScript**: Strict mode enabled
- **Formatting**: Prettier with 2-space indentation
- **Linting**: ESLint with Next.js config
- **Naming**: camelCase for variables, PascalCase for components

## Architectural Evolution

Dripl is evolving from a UI-driven canvas editor into a **deterministic graphics runtime**. The target model is:

- **Layered dependencies:** `common → math → element → runtime → ui/app` (utils isolated). Lower layers must not import upper layers; UI must not contain domain logic.
- **State flow:** `Intent → Action → Store → Delta → Scene → Renderer → Canvas`. State transitions are purely defined, reversible, and multiplayer-safe.
- **Mutation discipline:** Elements are immutable; all mutations go through the Store. The renderer is a pure projection of state.

### Dependency rules

- **Layer order:** `common → math → element → runtime → ui/app`. `packages/utils` is isolated.
- **Lower layers MUST NOT import upper layers.** `@dripl/runtime` may only depend on `@dripl/common`, `@dripl/math`, `@dripl/element`. The app must not put domain logic (scene evolution, delta history) in UI; it uses the runtime Store via a single bridge.

### Hard invariants

- **Element immutability:** No in-place mutation of elements held in Scene or Store; updates replace with new object references.
- **State transitions only via Store:** Scene-evolving operations go through `Store.commit(action, captureMode)` (or the app bridge); no direct `setElements`/`updateElement` for scene changes when using the runtime path.
- **Renderer purity:** The renderer does not mutate Scene or Store; it is a pure function of state (and viewport).

The **DRIPL Architectural Evolution Specification** (change proposal document) defines constraints, invariants, and subsystem restructure. The **implementation plan** is in `docs/ARCHITECTURAL_EVOLUTION_IMPLEMENTATION.md`, with gap analysis and phased tasks (Phase 1: structural stability; Phase 2: state evolution; Phase 3: interaction; Phase 4: constraints; Phase 5: projection).

## Future Improvements

1. **Performance**: Web Workers for rendering, canvas partitioning
2. **Scalability**: Redis for caching, load balancing
3. **Features**: SVG export, PDF export, shape libraries
4. **Collaboration**: Conflict resolution improvements
5. **Testing**: End-to-end tests, integration tests
6. **Documentation**: Storybook for components

## Key Challenges and Solutions

### Canvas Performance

**Challenge**: Rendering thousands of elements

**Solution**: Viewport culling, render throttling, virtual rendering

### Real-time Sync

**Challenge**: Conflict resolution in collaborative editing

**Solution**: Operational transformation, version tracking, reconciliation

### Browser Compatibility

**Challenge**: Cross-browser canvas support

**Solution**: Fallback rendering, feature detection

### Data Persistence

**Challenge**: Offline support and synchronization

**Solution**: IndexedDB, local storage, background sync

---

This architecture document provides a comprehensive overview of the Dripl application. For detailed implementation guides, refer to the respective files and folders.
