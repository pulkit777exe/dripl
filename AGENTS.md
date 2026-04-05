# Dripl — Developer Guide

## Known Issues & Required Fixes

### 1. WebSocket Server — Duplicate Stale-User Cleanup Code ✅ Fixed

### 2. WebSocket Server — Type Mismatch on `currentRoomId` / `currentUserId` ✅ Fixed

### 3. Environment Variables — Security Concerns ✅ Fixed

### 4. http-server — Missing .js Extensions on Relative Imports ✅ Fixed

**Files**: `apps/http-server/src/controllers/*.ts`, `apps/http-server/src/routes/*.ts`, `apps/http-server/src/server.ts`

**Problem**: TypeScript with `moduleResolution: 'node16'` requires explicit `.js` extensions on relative imports. All 13 imports were missing extensions, causing build failures.

**Fix**: Added `.js` extensions to all relative import paths in controllers, routes, and server files.

---

### 5. No Tests for Server Apps or Frontend

**Files**: `apps/dripl-app/`, `apps/http-server/`, `apps/ws-server/`

**Problem**: The package-level tests cover only the infrastructure packages (common, math, element, runtime, utils). The three apps have zero test coverage.

**Fix**: Add tests for:

- **http-server**: API route handlers (signup, login, room CRUD, sharing)
- **ws-server**: Message handlers (join_room, add_element, cursor_move), room management
- **dripl-app**: React component tests (CanvasBootstrap, RoughCanvas), hook tests (useCollaboration)

---

### 6. AI Generation Feature Non-Functional

**File**: `apps/dripl-app/app/api/ai/generate/route.ts`

**Problem**: `GEMINI_API_KEY` is empty in `.env`. The AI diagram generation feature returns an error.

**Fix**: Either obtain a valid Gemini API key or remove the feature if not needed.

---

### 7. Next.js Build Lock Race Condition

**File**: `apps/dripl-app/.next/dev/lock`

**Problem**: Next.js 16 with Turbopack has a known Linux filesystem bug where the dev lock file can't be acquired when multiple processes start simultaneously. This causes `pnpm dev` to occasionally fail for the dripl-app.

**Workaround**: Run `rm -rf .next` before `pnpm dev`, or start services individually:

```bash
# Terminal 1
cd apps/dripl-app && rm -rf .next && npx next dev --turbopack

# Terminal 2
cd apps/ws-server && npx tsx watch src/index.ts

# Terminal 3
cd apps/http-server && npx tsx watch src/server.ts
```

---

### 8. Dashboard Auto-Redirect ✅ Fixed

### 9. Share Modal API Endpoint Mismatch ✅ Fixed

### 10. RemoteCanvas.tsx Stub ✅ Fixed

### 11. Port Conflict Between ws-server and @dripl/ws-server ✅ Fixed

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
