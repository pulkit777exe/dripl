# Dripl Codebase Directory

Comprehensive documentation of files and their functions.

## Apps

### dripl-app (Next.js Frontend - Port 3000)

#### Pages (`app/`)

| File | Function |
| ---- | -------- |
| app/layout.tsx | Root layout with AuthProvider, ThemeProvider, CookieConsent |  
| app/page.tsx | Landing page |
| app/canvas/page.tsx | Local canvas (no auth required) |
| app/canvas/[fileId]/page.tsx | Canvas file editor with WebSocket for collaboration |
| app/dashboard/page.tsx | File browser with search, pagination |
| app/dashboard/layout.tsx | Dashboard layout with sidebar |
| app/settings/[section]/page.tsx | Profile, password, plan, account settings |
| app/login/page.tsx | Email/Google login |
| app/signup/page.tsx | Registration with email verification |
| app/verify-email/page.tsx | Email verification processor |
| app/verify-pending/page.tsx | Resend verification email |
| app/forgot-password/page.tsx | Password reset request |
| app/reset-password/page.tsx | Password reset with token |
| app/share/[token]/page.tsx | Shared file view |
| app/file/[id]/page.tsx | File details/editor |
| app/share/token/route.ts | Share file API |
| app/api/canvas/rooms/route.ts | Canvas rooms API |
| app/api/ai/generate/route.ts | AI generation (requires GEMINI_API_KEY) |
| app/api/share/route.ts | Share management API |
| app/context/AuthContext.tsx | Auth state and methods |
| app/room/[roomSlug]/view/page.tsx | Collaborative room view |
| app/room/[roomSlug]/present/page.tsx | Presentation mode |
| app/library/page.tsx | Template library |
| app/templates/page.tsx | Template explorer |

#### Components (`components/`)

| File | Function |
| ---- | -------- |
| components/CookieConsent.tsx | Cookie consent banner |
| components/ThemeProvider.tsx | Dark/light theme context |
| components/ThemeToggle.tsx | Theme switch button |
| components/Sidebar.tsx | Navigation sidebar |
| components/auth/AuthShell.tsx | Auth page layout |

#### Canvas Components (`components/canvas/`)

| File | Function |
| ---- | -------- |
| components/canvas/Canvas.tsx | Main canvas component |
| components/canvas/CanvasBootstrap.tsx | Canvas initialization |
| components/canvas/InteractiveCanvas.tsx | Drawing interaction |
| components/canvas/StaticCanvas.tsx | Static rendering |
| components/canvas/RoughCanvas.tsx | RoughJS rendering |
| components/canvas/TopBar.tsx | Top toolbar |
| components/canvas/CanvasToolbar.tsx | Tool selection toolbar |
| components/canvas/Toolbar.tsx | Main toolbar |
| components/canvas/CanvasControls.tsx | Zoom, grid, undo/redo |
| components/canvas/ZoomControls.tsx | Zoom buttons |
| components/canvas/PropertiesPanel.tsx | Element properties |
| components/canvas/TransformationPanel.tsx | Transform handles |
| components/canvas/SelectionOverlay.tsx | Selection box |
| components/canvas/RemoteCursors.tsx | Collaborative cursors |
| components/canvas/ CollaboratorsList.tsx | Active users |
| components/canvas/ShareModal.tsx | Share dialog |
| components/canvas/ExportModal.tsx | Export dialog |
| components/canvas/CommandPalette.tsx | Cmd+K palette |
| components/canvas/ContextMenu.tsx | Right-click menu |
| components/canvas/AIGenerateModal.tsx | AI generation modal |
| components/canvas/HelpModal.tsx | Keyboard shortcuts |
| components/canvas/ColorSwatch.tsx | Color picker |
| components/canvas/WelcomeScreen.tsx | Empty state |
| components/canvas/NameInputModal.tsx | Rename modal |

#### Dashboard Components (`components/dashboard/`)

| File | Function |
| ---- | -------- |
| components/dashboard/DashboardSidebar.tsx | Sidebar navigation |
| components/dashboard/FileBrowser.tsx | File grid/list |

#### Hooks (`hooks/`)

| File | Function |
| ---- | -------- |
| hooks/useCanvas.ts | Canvas state management |
| hooks/useDrawingTools.ts | Tool selection |
| hooks/useTheme.ts | Theme switching |
| hooks/useHistory.ts | Undo/redo |
| hooks/useSelection.ts | Element selection |
| hooks/useKeyboardShortcuts.ts | Keyboard shortcuts |
| hooks/useExport.ts | PNG/SVG export |
| hooks/useEncryption.ts | Content encryption |
| hooks/useClipboard.ts | Copy/paste |
| hooks/useCollaboration.ts | Real-time collab |
| hooks/useCanvasWebSocket.ts | WebSocket connection |
| hooks/useZoom.ts | Zoom controls |

#### Utils (`utils/`)

| File | Function |
| ---- | -------- |
| utils/analytics.ts | Event tracking (canvas, auth, export) |
| utils/localCanvasStorage.ts | LocalStorage persistence |
| utils/export.ts | PNG/SVG/JSON export |
| utils/canvas-store.ts | Zustand canvas state |
| utils/actionSystem.ts | Action definitions |
| utils/shapes/*.ts | Shape renderers |
| utils/tools/*.ts | Tool implementations |
| utils/viewport-culling.ts | Render optimization |
| utils/canvas-coordinates.ts | Coordinate transforms |
| utils/canvasHistory.ts | History management |

#### API (`lib/`)

| File | Function |
| ---- | -------- |
| lib/api.ts | API client (register, login, files, etc) |
| lib/client.ts | WebSocket client |
| lib/canvas-db.ts | Database sync |

### http-server (Express API - Port 3002)

| File | Function |
| ---- | -------- |
| src/routes/auth.ts | register, login, logout, verify, reset, profile, change-password |
| src/routes/files.ts | File CRUD |
| src/routes/folders.ts | Folder CRUD |
| src/routes/UserRoute.ts | Legacy user routes |
| src/routes/TeamRoute.ts | Team routes |
| src/routes/FileRoute.ts | Legacy file routes |
| src/controllers/userController.ts | User signup/login |
| src/controllers/fileController.ts | File operations |
| src/controllers/roomController.ts | Canvas rooms |
| src/controllers/teamController.ts | Teams |
| src/middlewares/authMiddleware.ts | JWT auth |
| src/middlewares/validateMiddleware.ts | Input validation |
| src/lib/mailer.ts | Password/verification emails |

### ws-server (WebSocket - Port 3001)

| File | Function |
| ---- | -------- |
| src/index.ts | WebSocket server, room management, cursor sync, element sync |

## Packages

### packages/db (`packages/db/`)

| File | Function |
| ---- | -------- |
| prisma/schema.prisma | User, File, Folder, Team, CanvasRoom, ShareLink, PasswordResetToken, EmailVerificationToken |
| prisma/migrations/ | Database migrations |

### packages/common (`packages/common/`)

| File | Function |
| ---- | -------- |
| index.ts | Shared types (DriplElement, AppState, etc) |

### packages/dripl (`packages/dripl/`)

| File | Function |
| ---- | -------- |
| src/button.tsx | Button component |
| src/card.tsx | Card component |
| src/code.tsx | Code component |
| src/canvas/*.tsx | Re-export canvas components |
| src/toolbar/*.tsx | Toolbar components |
| src/sidebar/*.tsx | Sidebar components |
| src/layout/*.tsx | Layout components |
| src/theme/*.tsx | Theme provider |

### packages/element (`packages/element/`)

| File | Function |
| ---- | -------- |
| index.ts | Element utilities |

## Configuration

| File | Function |
| ---- | -------- |
| pnpm-workspace.yaml | Monorepo workspace |
| turbo.json | Build pipelines |
| tailwind.config.ts | Tailwind theme (Dripl colors) |
| vitest.config.ts | Test configuration |
| .eslintrc.js | Linting rules |
| .prettierrc | Code formatting |

## Database Schema

```
User (id, email, name, password?, image?, emailVerified, createdAt)
File (id, name, content, preview?, shareToken?, folderId?, teamId?, userId?)
Folder (id, name, parentId?, teamId?, userId?)
Team (id, name, slug)
TeamMember (id, role, userId, teamId)
CanvasRoom (id, slug, name, ownerId, content, isPublic)
CanvasRoomMember (id, roomId, userId, role)
ShareLink (id, token, roomId, permission, expiresAt, createdById)
PasswordResetToken (id, token, email, expiresAt)
EmailVerificationToken (id, token, email, expiresAt)
```

## Key Flows

```
Registration:
  signup → create user → sendVerificationEmail → pendingVerification 
  → verify-email → emailVerified=true → login

Canvas:
  canvas/page → CanvasBootstrap → loadLocalCanvas 
  → InteractiveCanvas → renderLoop → saveLocalCanvasToStorage

Collaboration:
  WebSocket connect → room join → cursor broadcast 
  → element sync → periodic save to DB

Settings:
  updateProfile → /auth/profile PUT
  changePassword → /auth/change-password POST (validates current)
```