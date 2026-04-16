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
| 20  | Auth Middleware — Inconsistent imports                                | Fixed  |
| 21  | ws-server — Missing element coordinate bounds validation              | Fixed  |
| 22  | ws-server — No rate limiting                                          | Fixed  |
| 23  | Database — Missing query indexes                                      | Fixed  |
| 24  | http-server — Test imports don't match route files                    | Fixed  |

### ⚠️ Known Limitations

1. **AI Generation Feature** — Requires valid `GEMINI_API_KEY` in `.env`
2. **Next.js Dev Lock** — Rare race condition with multiple processes (workaround: `rm -rf .next`)

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
| Per-user Rate Limiting   | ✅ HTTP + WebSocket  |
| WebSocket Message Limits | ✅ 10MB max          |
| Element Validation       | ✅ Bounds checking   |

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

---

## User Experience: Multiple User Types

### 1. Existing User

- **Session-based authentication** via cookie ensures seamless return
- **Dashboard** displays their files/folders with quick access
- **Canvas state persistence** allows continuation from last session
- **Collaboration features** enable real-time co-editing with other users
- **Undo/redo history** (100 steps) supports complex workflows
- **Workspace preferences** (dark/light theme, grid toggle) are remembered
- **Recent files** and quick navigation

### 2. New User

- **Onboarding flow** with guided shortcuts display (Ctrl+G to toggle)
- **Template options** or blank canvas creation
- **Real-time collaborator presence** shows who else is in the workspace
- **Export/share links** enable easy sharing of initial creations
- **Freehand drawing tools** for immediate creative expression
- **Responsive grid and zoom** for precise placement

### 3. Guest/Anonymous User (Limited Access)

- **View-only mode** for shared links without account
- **Restricted export** capabilities
- **No persistent state** — session ends on close

### 4. Administrator/Team Lead

- **File/folder management** across team workspaces
- **User activity monitoring** through collaboration presence
- **Export analytics** for project usage insights
- **Team preference synchronization** via shared settings

### 5. Power User

- **Keyboard shortcuts** for all tools (V, R, E, D, P, L, A, T, F, X, H)
- **Batch operations** via selection and transform handles
- **Advanced export options** (PNG, SVG, JSON)
- **Custom workspace layouts** with drag-and-drop zones

---

## Ongoing Maintenance Recommendations

### CI/CD: Add parallel test execution, artifact publishing, deployment gates

### Testing: Expand unit/integration tests, implement E2E with Playwright

### Performance: Add bundle analysis, runtime metrics, error tracking (Sentry)

### Security: Implement npm audit, secret detection, CSP headers

### Type Safety: Strict TypeScript mode, type-only imports, branded types

### Workflow: Pre-commit hooks (Husky + lint-staged), conventional commits

---

## Success Metrics

- Build success rate: >95%
- Test coverage: >80%
- Security vulnerabilities: 0 critical
- Performance regression: <5%
- Type errors in production: 0
- Code review turnaround: <24 hours
- Deployment frequency: Daily
- Mean time to recovery: <1 hour

---

## Maintenance Schedule

### Daily

- Run security scans
- Execute unit tests
- Monitor build health

### Weekly

- Review performance metrics
- Update dependencies
- Code quality analysis

### Monthly

- Full security audit
- Performance benchmark comparison
- Technical debt review
- Process improvement assessment

### Quarterly

- Architecture review
- Tooling evaluation
- Team skill assessment
- Strategic planning update

---

## Emergency Procedures

### Build/Deployment Failure

1. Immediately rollback to last stable version
2. Create incident ticket
3. Root cause analysis
4. Implement fix
5. Resume deployment

### Security Vulnerability

1. Immediately patch critical vulnerabilities
2. Rotate all credentials/secrets
3. Conduct full security audit
4. Implement preventive measures
5. Document and report

### Performance Degradation

1. Activate monitoring alerts
2. Identify bottleneck
3. Implement quick fixes
4. Long-term optimization plan
5. Post-mortem analysis

---

## Continuous Improvement Loop

1. **Measure**: Collect metrics from all tools
2. **Analyze**: Identify trends and issues
3. **Plan**: Prioritize improvements
4. **Implement**: Execute changes
5. **Review**: Assess impact and adjust
