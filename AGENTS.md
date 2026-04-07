# Dripl — Developer Guide

## Known Issues & Required Fixes

### 1. WebSocket Server — Duplicate Stale-User Cleanup Code ✅ Fixed

### 2. WebSocket Server — Type Mismatch on `currentRoomId` / `currentUserId` ✅ Fixed

### 3. Environment Variables — Security Concerns ✅ Fixed

### 4. http-server — Missing .js Extensions on Relative Imports ✅ Fixed

**Files**: `apps/http-server/src/controllers/*.ts`, `apps/http-server/src/routes/*.ts`, `apps/http-server/src/server.ts`

**Problem**: TypeScript with `moduleResolution: 'node16'` requires explicit `.js` extensions on relative imports. All 13 imports were missing extensions, causing build failures.

**Fix**: Switched to ESNext module resolution. Removed `.js` extensions from all relative imports.

---

### 5. No Tests for Server Apps or Frontend ⚠️ Partial

**Files**: `apps/dripl-app/`, `apps/http-server/`, `apps/ws-server/`

**Problem**: The package-level tests cover only the infrastructure packages (common, math, element, runtime, utils). The three apps have zero test coverage.

**Status**: Partial - http-server and ws-server now have basic test files in `src/__tests__/`

---

### 6. AI Generation Feature Non-Functional ⚠️ Works with Key

**File**: `apps/dripl-app/app/api/ai/generate/route.ts`

**Problem**: `GEMINI_API_KEY` is empty in `.env`. The AI diagram generation feature returns an error.

**Fix**: Feature works when valid API key is provided. Empty key returns proper error message.

---

### 7. Next.js Build Lock Race Condition ⚠️ Known Limitation

**File**: `apps/dripl-app/.next/dev/lock`

**Problem**: Next.js 16 with Turbopack has a known Linux filesystem bug where the dev lock file can't be acquired when multiple processes start simultaneously. This causes `pnpm dev` to occasionally fail for the dripl-app.

**Workaround**: Run `rm -rf .next` before `pnpm dev`, or start services individually:

```bash
# Terminal 1
cd apps/dripl-app && rm -rf .next && npx next dev --turbopack

# Terminal 2
cd apps/ws-server && npx tsx watch src/index.ts

# Terminal 3
cd apps/http-server && npx tsx watch src/index.ts
```

---

### 8. Dashboard Auto-Redirect ✅ Fixed

### 9. Share Modal API Endpoint Mismatch ✅ Fixed

### 10. RemoteCanvas.tsx Stub ✅ Fixed

### 11. Port Conflict Between ws-server and @dripl/ws-server ✅ Fixed

---

## Infrastructure Improvements (April 2026)

### CI/CD & DevOps

| Feature                   | Status         | Notes                        |
| ------------------------- | -------------- | ---------------------------- |
| GitHub Actions CI         | ✅ Implemented | Lint, typecheck, test jobs   |
| Commitlint                | ✅ Implemented | Conventional commits         |
| GitHub Issue/PR Templates | ✅ Implemented | Bug report, feature request  |
| Dockerfiles               | ✅ Implemented | For all 3 apps               |
| Docker Compose            | ✅ Implemented | Local development            |
| Health Check Endpoints    | ✅ Enhanced    | Now includes uptime, version |

### Code Quality

| Feature              | Status         | Notes                                  |
| -------------------- | -------------- | -------------------------------------- |
| Prettier config      | ✅ Implemented | `.prettierrc` at root                  |
| Shared ESLint config | ✅ Implemented | `tooling/eslint-config/`               |
| Package metadata     | ✅ Implemented | All packages have description, license |
| React Error Boundary | ✅ Implemented | `app/error.tsx`                        |

### Security Improvements

| Feature                   | Status         | Notes                         |
| ------------------------- | -------------- | ----------------------------- |
| JWT Secret Validation     | ✅ Fixed       | Now throws if env var missing |
| CSRF Protection           | ✅ Implemented | Token endpoint + headers      |
| Enhanced Security Headers | ✅ Implemented | CSP, HSTS, referrer-policy    |
| Per-user Rate Limiting    | ✅ Implemented | Key includes userId           |
| WebSocket Message Limits  | ✅ Implemented | 10MB max payload              |
| Cookie Security           | ✅ Fixed       | Uses isProduction constant    |

---

## Implemented Features (Excalidraw-like)

### Canvas Features

| Feature                      | Status         | Files                                                                   |
| ---------------------------- | -------------- | ----------------------------------------------------------------------- |
| Undo/Redo (100 steps)        | ✅ Implemented | `lib/canvas-store.ts`                                                   |
| Zoom controls (+/-)          | ✅ Implemented | `components/canvas/CanvasControls.tsx`                                  |
| Grid toggle (Ctrl+G)         | ✅ Implemented | `RoughCanvas.tsx:1745`, `canvas-store.ts`                               |
| Keyboard shortcuts           | ✅ Implemented | `CanvasToolbar.tsx`, `HelpModal.tsx`                                    |
| Shape tools                  | ✅ Implemented | Rectangle, ellipse, diamond, arrow, line, text, frame, freedraw, eraser |
| Selection with resize/rotate | ✅ Implemented | `SelectionOverlay.tsx`, `RoughCanvas.tsx`                               |
| Marquee selection            | ✅ Implemented | `RoughCanvas.tsx`                                                       |
| Remote cursors               | ✅ Implemented | `RemoteCursors.tsx`                                                     |
| Collaborator presence        | ✅ Implemented | `CollaboratorsList.tsx`                                                 |
| Export (PNG, SVG, JSON)      | ✅ Implemented | `ExportModal.tsx`, `utils/export.ts`                                    |
| Share links                  | ✅ Implemented | `app/share/[token]/page.tsx`                                            |
| Dark/light theme             | ✅ Implemented | `TopBar.tsx`, `Menu.tsx`, `CommandPalette.tsx`                          |
| Element locking              | ✅ Implemented | `canvas-store.ts`, `RoughCanvas.tsx`                                    |

### Auth & Routing

| Feature            | Status         | Notes                                    |
| ------------------ | -------------- | ---------------------------------------- |
| Session-based auth | ✅ Implemented | Cookie-based auth (replaced Clerk)       |
| File-based routing | ✅ Implemented | `/canvas/[fileId]` instead of room-based |
| Dashboard          | ✅ Implemented | Files and folders API                    |

---

## Proposed Improvements

### Priority 1: Core Canvas Experience

#### 1.1 Better Touch/Trackpad Support

- **Files**: `apps/dripl-app/components/canvas/RoughCanvas.tsx`
- **Problem**: Touch gestures are basic; pinch-to-zoom and two-finger pan need improvement
- **Fix**: Implement proper trackpad gesture handling with momentum scrolling

#### 1.2 Improved Selection UX

- **Files**: `apps/dripl-app/components/canvas/SelectionOverlay.tsx`, `RoughCanvas.tsx`
- **Problem**: Marquee selection doesn't work well with existing elements
- **Fix**: Add "select contained" vs "select intersecting" toggle (Excalidraw feature)

### Priority 2: Editor Features

#### 2.1 Multi-element Copy/Paste

- **Files**: `apps/dripl-app/components/canvas/RoughCanvas.tsx`, `canvas-store.ts`
- **Problem**: Only single element copy/paste works; no clipboard history
- **Fix**: Implement internal clipboard with Ctrl+C/V/D for duplicate

#### 2.2 Better Keyboard Shortcuts

- **Files**: `apps/dripl-app/components/canvas/CanvasToolbar.tsx`
- **Problem**: Some shortcuts conflict (D is both diamond and draw)
- **Fix**: Resolve conflicts, add shortcuts like Ctrl+G (group), Ctrl+Shift+G (ungroup)

#### 2.3 Element Groups

- **Files**: `packages/common/src/types/`, `packages/element/src/`
- **Problem**: No grouping support
- **Fix**: Add group element type and group/ungroup operations

### Priority 3: Collaboration

#### 3.1 Element Locking (Visual Indicator)

- **Files**: `apps/dripl-app/components/canvas/RoughCanvas.tsx`, `RemoteCursors.tsx`
- **Problem**: Element locking exists in store but no visual feedback
- **Fix**: Show lock icon on elements being edited by remote users

#### 3.2 Presence Avatars

- **Files**: `apps/dripl-app/components/canvas/CollaboratorsList.tsx`
- **Problem**: Simple list, no avatars
- **Fix**: Show user avatar circles like Excalidraw

### Priority 4: Export & Sharing

#### 4.1 Native Export Options

- **Files**: `apps/dripl-app/components/canvas/ExportModal.tsx`
- **Problem**: Export is limited
- **Fix**: Add custom resolution, PNG/SVG/JSON export options

#### 4.2 Share Dialog Improvements

- **Files**: `apps/dripl-app/components/canvas/ShareModal.tsx`
- **Problem**: Basic sharing
- **Fix**: Add invite via email, expiration options, password protection

### Priority 5: Polish

#### 5.1 Welcome Screen / Quick Start

- **Files**: `apps/dripl-app/app/canvas/page.tsx`
- **Problem**: No landing page for empty canvas
- **Fix**: Show welcome overlay with tooltips and sample shapes

#### 5.2 Command Palette Improvements

- **Files**: `apps/dripl-app/components/canvas/CommandPalette.tsx`
- **Problem**: Basic command palette
- **Fix**: Add fuzzy search, recent commands, categories

---

## Development Workflow

### Adding a New Feature

1. **Types first**: Add types to `packages/common/src/types/`
2. **Schemas**: Add Zod validation to `packages/common/src/schemas.ts`
3. **Package code**: Implement in the appropriate `packages/*` (math, element, runtime, utils)
4. **Server code**: Add routes/controllers to `apps/http-server` or `apps/ws-server`
5. **Frontend**: Add components/hooks to `apps/dripl-app`
6. **Database**: Update `packages/db/prisma/schema.prisma` and run `pnpm db:migrate`

### Testing

```bash
# Run all tests
pnpm test

# Run tests for a specific package
cd packages/math && pnpm test

# Run with watch mode
cd packages/math && pnpm vitest
```

### Database Changes

```bash
# Edit schema
vim packages/db/prisma/schema.prisma

# Generate migration
cd packages/db && npx prisma migrate dev --name describe_change

# Generate client
pnpm db:generate

# View database
pnpm db:studio
```

### Adding Environment Variables

1. Add to root `.env` and `.env.example`
2. If it's a `NEXT_PUBLIC_*` var, it's available in client code
3. If it's server-only, only http-server and ws-server can access it
4. Add to `turbo.json` `env` array for build cache invalidation

### Running Services

```bash
# Start all services
pnpm dev

# Start individual services
cd apps/dripl-app && pnpm dev    # Port 3000
cd apps/http-server && pnpm dev  # Port 3002
cd apps/ws-server && pnpm dev    # Port 3001
```

### Docker Development

```bash
# Start all services with Docker Compose
docker-compose up --build

# Run specific service
docker-compose up dripl-app
```

### CI/CD

GitHub Actions runs on every push to `main` and PRs:

- **Lint**: `pnpm lint`
- **Type Check**: `pnpm build`
- **Test**: `pnpm test`

### Commit Messages

Uses Conventional Commits. Run `pnpm commitlint` locally before committing.

---

## Keyboard Shortcuts Reference

| Key                    | Action                   |
| ---------------------- | ------------------------ |
| `V`                    | Select tool              |
| `R`                    | Rectangle tool           |
| `E` / `O`              | Ellipse tool             |
| `D`                    | Diamond tool             |
| `P`                    | Freehand draw tool       |
| `L`                    | Line tool                |
| `A`                    | Arrow tool               |
| `T`                    | Text tool                |
| `F`                    | Frame tool               |
| `X`                    | Eraser tool              |
| `H`                    | Hand (pan) tool          |
| `Space` (hold)         | Temporary hand tool      |
| `Delete` / `Backspace` | Delete selected elements |
| `Ctrl/Cmd + Z`         | Undo                     |
| `Ctrl/Cmd + Shift + Z` | Redo                     |
| `Ctrl/Cmd + C`         | Copy                     |
| `Ctrl/Cmd + V`         | Paste                    |
| `Ctrl/Cmd + A`         | Select all               |
| `Ctrl/Cmd + D`         | Duplicate                |
| `Ctrl/Cmd + S`         | Save to cloud            |
| `Ctrl/Cmd + +`         | Zoom in                  |
| `Ctrl/Cmd + -`         | Zoom out                 |
| `Ctrl/Cmd + 0`         | Reset zoom               |
| `Ctrl/Cmd + G`         | Toggle grid              |
