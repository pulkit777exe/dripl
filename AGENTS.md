# Dripl — Developer Guide

## Known Issues & Required Fixes

All critical issues have been resolved. The following are either fixed or known limitations.

### ✅ Fixed Issues

| #   | Issue                                                                 | Status |
| --- | --------------------------------------------------------------------- | ------ |
| 1   | WebSocket Server — Duplicate Stale-User Cleanup Code                  | Fixed  |
| 2   | WebSocket Server — Type Mismatch on `currentRoomId` / `currentUserId` | Fixed  |
| 3   | Environment Variables — Security Concerns                             | Fixed  |
| 4   | http-server — Missing .js Extensions on Relative Imports              | Fixed  |
| 5   | Dashboard Auto-Redirect                                               | Fixed  |
| 6   | Share Modal API Endpoint Mismatch                                     | Fixed  |
| 7   | RemoteCanvas.tsx Stub                                                 | Fixed  |
| 8   | Port Conflict Between ws-server and @dripl/ws-server                  | Fixed  |
| 9   | ESLint Configuration Issues                                           | Fixed  |
| 10  | Turbopack Experimental Config Warning                                 | Fixed  |
| 11  | JWT_SECRET Logging (ws-server)                                        | Fixed  |
| 12  | @dripl/dripl PeerDependencies                                         | Fixed  |
| 13  | Dead Code (redis.ts)                                                  | Fixed  |
| 14  | Empty Catch Blocks (share API)                                        | Fixed  |
| 15  | IDOR Vulnerability (fileController.ts)                                | Fixed  |
| 16  | Dead Code (packages/runtime)                                          | Fixed  |
| 17  | Orphaned websocket-server.ts in http-server                           | Fixed  |
| 18  | Console Logging Standardization (58+ statements to JSON)              | Fixed  |
| 19  | ws-server Validation Tests                                            | Fixed  |

### ⚠️ Known Limitations

1. **AI Generation Feature** — Requires valid `GEMINI_API_KEY` in `.env`
2. **Test Coverage** — Partial coverage (dripl-app, math, element have tests; http-server, ws-server have limited tests)
3. **Next.js Dev Lock** — Rare race condition with multiple processes (workaround: `rm -rf .next`)

---

## Infrastructure

### CI/CD & DevOps

| Feature                | Status                  |
| ---------------------- | ----------------------- |
| GitHub Actions CI      | ✅ Lint, build, test    |
| Commitlint             | ✅ Conventional commits |
| Dockerfiles            | ✅ All 3 apps           |
| Docker Compose         | ✅ Local dev            |
| Health Check Endpoints | ✅ Uptime, version      |

### Code Quality

| Feature              | Status                  |
| -------------------- | ----------------------- |
| Prettier             | ✅ `.prettierrc`        |
| ESLint               | ✅ Shared config        |
| Package Metadata     | ✅ Description, license |
| React Error Boundary | ✅ `app/error.tsx`      |

### Security

| Feature                  | Status               |
| ------------------------ | -------------------- |
| JWT Secret Validation    | ✅ Throws if missing |
| CSRF Protection          | ✅ Token endpoints   |
| Security Headers         | ✅ CSP, HSTS         |
| Per-user Rate Limiting   | ✅ userId key        |
| WebSocket Message Limits | ✅ 10MB max          |

---

## Implemented Features

### Canvas Features

- Undo/Redo (100 steps)
- Zoom controls (+/-)
- Grid toggle (Ctrl+G)
- Keyboard shortcuts
- Shape tools: Rectangle, ellipse, diamond, arrow, line, text, frame, freedraw, eraser
- Selection with resize/rotate
- Marquee selection
- Remote cursors
- Collaborator presence
- Export (PNG, SVG, JSON)
- Share links
- Dark/light theme
- Element locking

### Auth & Routing

- Session-based auth (cookie)
- File-based routing (`/canvas/[fileId]`)
- Dashboard with files/folders

---

## Development Workflow

### Running Services

```bash
# All services
pnpm dev

# Individual
cd apps/dripl-app && pnpm dev     # Port 3000
cd apps/http-server && pnpm dev   # Port 3002
cd apps/ws-server && pnpm dev  # Port 3001
```

### Scripts

```bash
pnpm build    # Build all
pnpm test     # Run tests
pnpm lint     # Lint all
pnpm db:migrate
```

### Commit Messages

Uses Conventional Commits. Run `pnpm commitlint` locally.

---

## Keyboard Shortcuts

| Key          | Action                      |
| ------------ | --------------------------- |
| V            | Select                      |
| R            | Rectangle                   |
| E/O          | Ellipse                     |
| D            | Diamond                     |
| P            | Freehand draw               |
| L            | Line                        |
| A            | Arrow                       |
| T            | Text                        |
| F            | Frame                       |
| X            | Eraser                      |
| H            | Hand (pan)                  |
| Space (hold) | Temp hand                   |
| Delete       | Delete                      |
| Ctrl+Z       | Undo                        |
| Ctrl+Shift+Z | Redo                        |
| Ctrl+C/V/A/D | Copy/Paste/Select/Duplicate |
| Ctrl+S       | Save                        |
| Ctrl++/-/0   | Zoom in/out/reset           |
| Ctrl+G       | Toggle grid                 |
