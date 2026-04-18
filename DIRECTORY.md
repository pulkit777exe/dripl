# Dripl Codebase Directory

Documentation of key files and their functions (10 lines max per file).

## Apps

### dripl-app (Next.js Frontend)

| File | Function |
| ---- | -------- |
| app/layout.tsx | Root layout with auth, theme, cookie consent |
| app/canvas/page.tsx | Main canvas page with toolbar, controls |
| app/canvas/[fileId]/page.tsx | Canvas file editor with WebSocket |
| app/dashboard/page.tsx | File browser and management |
| app/settings/[section]/page.tsx | Profile, password, plan, account settings |
| app/login/page.tsx | Email/Google login page |
| app/signup/page.tsx | Registration with verification flow |
| app/verify-email/page.tsx | Email verification processor |
| app/verify-pending/page.tsx | Pending verification resend |
| app/forgot-password/page.tsx | Password reset request |
| app/reset-password/page.tsx | Password reset with token |
| lib/api.ts | API client for HTTP endpoints |
| lib/canvas-store.ts | Zustand store for canvas state |
| lib/canvas-db.ts | Canvas persistence layer |
| components/CookieConsent.tsx | Cookie consent banner |
| components/canvas/Canvas.tsx | Main canvas rendering |
| components/canvas/TopBar.tsx | Top toolbar with actions |
| components/canvas/CanvasToolbar.tsx | Drawing tools toolbar |
| components/canvas/CanvasControls.tsx | Zoom, grid, undo/redo |
| hooks/useCanvas.ts | Canvas state and operations |
| hooks/useDrawingTools.ts | Tool selection logic |
| hooks/useTheme.ts | Dark/light theme |
| utils/analytics.ts | Event tracking (canvas, auth, export) |
| utils/localCanvasStorage.ts | LocalStorage persistence |
| utils/export.ts | PNG/SVG/JSON export |
| utils/viewport-culling.ts | Viewport optimization |

### http-server (Express API)

| File | Function |
| ---- | -------- |
| src/routes/auth.ts | Auth: register, login, logout, verify, reset, profile |
| src/routes/files.ts | File CRUD operations |
| src/routes/folders.ts | Folder CRUD operations |
| src/controllers/userController.ts | User signup/login logic |
| src/controllers/fileController.ts | File management logic |
| src/middlewares/authMiddleware.ts | JWT session auth |
| src/lib/mailer.ts | Password/verification emails |

### ws-server (WebSocket)

| File | Function |
| ---- | -------- |
| src/index.ts | WebSocket server for real-time collab |

## Packages

| File | Function |
| ---- | -------- |
| packages/db/prisma/schema.prisma | Database schema (User, File, Folder, CanvasRoom) |
| packages/common/index.ts | Shared types |
| packages/element/index.ts | Element utilities |
| packages/dripl/index.ts | UI components |

## Configuration

| File | Function |
| ---- | -------- |
| pnpm-workspace.yaml | Monorepo config |
| turbo.json | Turborepo pipeline |
| tailwind.config.ts | Tailwind theme |
| vitest.config.ts | Test config |
| eslint.config.js | ESLint rules |
| prettier.config | Code formatting |

## Key Flows

```
User Registration:
  signup → sendVerificationEmail → pendingVerification → verify-email → login

Canvas:
  canvas/page → CanvasBootstrap → interactiveCanvas → renderLoop → saveLocalCanvasToStorage

Real-time Collab:
  WebSocket connect → room join → cursor sync → element sync → periodic save
```