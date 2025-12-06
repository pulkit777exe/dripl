# Dripl

A modern, real-time collaborative whiteboard application built with Next.js and WebSockets.

---

## Quick Start

### Prerequisites

- Node.js 18+
- pnpm 10+

### Installation

```bash
# Install dependencies
pnpm install

# Generate Prisma client
pnpm db:generate

# Run development server
pnpm dev
```

The app will be available at `http://localhost:3000`


## Architecture

### Frontend (Next.js)

- **Framework**: Next.js 16 with App Router
- **Styling**: Tailwind CSS 4
- **State**: TanStack Store
- **Auth**: Clerk
- **UI**: Lucide icons, Sonner toasts

### Canvas System

- **Rendering**: HTML5 Canvas with custom renderer
- **Elements**: Rectangle, Circle, Path, Text, Image
- **Tools**: Selection, Draw, Eraser, Pan
- **Features**: Undo/redo, zoom, grid, snap-to-grid

### Database

- **ORM**: Prisma
- **Schema**: User, Team, File, Folder models
- **Storage**: File content stored as JSON

---

## Development

### Available Scripts

```bash
pnpm dev          # Start dev server
pnpm build        # Build for production
pnpm lint         # Run ESLint
pnpm format       # Format code with Prettier
pnpm db:migrate   # Run database migrations
pnpm db:push      # Push schema changes
```

### Key Directories

- `apps/dripl-app/app/` - Next.js pages and routes
- `apps/dripl-app/components/` - React components
- `apps/dripl-app/renderer/` - Canvas rendering logic
- `packages/common/src/` - Shared type definitions

### Adding a New Package

1. Create directory in `packages/`
2. Add `package.json` with name `@dripl/package-name`
3. Add to workspace in root `pnpm-workspace.yaml`
4. Install in app: `pnpm add @dripl/package-name --filter dripl-app`

---

## Code Style

- **TypeScript**: Strict mode enabled
- **Formatting**: Prettier with 2-space indentation
- **Linting**: ESLint with Next.js config
- **Naming**: camelCase for variables, PascalCase for components

---

## Common Tasks

### Adding a New Canvas Tool

1. Add tool type to `packages/common/src/constants.ts`
2. Create tool handler in `apps/dripl-app/components/canvas/InteractiveCanvas.tsx`
3. Add icon to `apps/dripl-app/components/layer-ui/Toolbar.tsx`

### Adding a New Element Type

1. Define schema in `packages/common/src/schemas.ts`
2. Add rendering logic in `apps/dripl-app/renderer/interactiveScene.ts`
3. Update factory in `packages/element/src/factory.ts`

### Modifying Database Schema

1. Edit `packages/db/prisma/schema.prisma`
2. Run `pnpm db:migrate` to create migration
3. Regenerate client with `pnpm db:generate`

---

## Troubleshooting

### Build Errors

- Run `pnpm db:generate` if Prisma types are missing
- Clear `.turbo` cache: `rm -rf .turbo`
- Reinstall: `rm -rf node_modules && pnpm install`

### Type Errors

- Ensure all workspace packages are built
- Check `tsconfig.json` path mappings
- Verify package exports in `package.json`

---

## Resources

- [Next.js Docs](https://nextjs.org/docs)
- [Tailwind CSS](https://tailwindcss.com)
- [Prisma](https://www.prisma.io/docs)
- [TanStack Store](https://tanstack.com/store)
