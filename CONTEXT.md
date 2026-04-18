# Dripl — Context

## Project

Real-time collaborative whiteboard (Excalidraw-like) with hand-drawn rendering, live cursors, and shareable links.

**Stack**: Next.js 16, Express 5, WebSocket, Prisma 7, PostgreSQL, React 19, TypeScript, Tailwind CSS 4, roughjs.

## Structure

```
apps/
├── dripl-app/      # Next.js frontend (port 3000)
├── http-server/    # Express REST API (port 3002)
└── ws-server/      # WebSocket server (port 3001)

packages/
├── common/        # Types, schemas
├── db/            # Prisma ORM
├── element/       # Element factory & rendering
├── math/          # Geometry & collision
├── utils/         # Storage, encryption
└── dripl/        # React components

tooling/
├── eslint-config  # Shared ESLint config
└── typescript-config # Shared TS config
```

## Key Files

| File                                               | Purpose              |
| -------------------------------------------------- | -------------------- |
| `apps/dripl-app/app/canvas/[fileId]/page.tsx`      | Collaborative canvas |
| `apps/dripl-app/components/canvas/InteractiveCanvas.tsx` | Interactive drawing |
| `apps/dripl-app/lib/canvas-store.ts`               | Canvas state         |
| `apps/ws-server/src/index.ts`                    | Room management     |
| `apps/ws-server/src/validation.ts`               | Message validation  |
| `packages/db/prisma/schema.prisma`               | 11 database models  |

## Database

11 models: User, Team, TeamMember, Folder, File, SharedFile, CanvasRoom, CanvasRoomMember, ShareLink, PasswordResetToken, EmailVerificationToken.

## Setup

```bash
pnpm install
pnpm db:generate
pnpm db:migrate
pnpm dev
```

## Scripts

| Script | Purpose |
| ------ | ------- |
| `pnpm build` | Build all packages |
| `pnpm dev` | Run all services |
| `pnpm lint` | Lint all packages |
| `pnpm check-types` | TypeScript check |
| `pnpm test` | Run tests |
| `pnpm db:generate` | Generate Prisma client |
| `pnpm db:migrate` | Run migrations |

## WebSocket Protocol

| Message          | Direction | Purpose         |
| ---------------- | --------- | --------------- |
| `join`           | C→S       | Join room       |
| `element-update` | C→S       | Batch elements  |
| `cursor-move`    | C→S       | Cursor position |
| `room-state`     | S→C       | Full sync       |
| `user_join`      | S→C       | Presence        |

## Stack Details

- **Frontend**: Next.js 16 (App Router), React 19, Tailwind CSS 4
- **Backend**: Express 5, ws (WebSocket)
- **Database**: PostgreSQL (Neon), Prisma 7
- **State**: Zustand, TanStack Store, framer-motion
- **Rendering**: roughjs (hand-drawn), HTML5 Canvas

## Services

| Service     | Port | Protocol  |
| ----------- | ---- | --------- |
| dripl-app   | 3000 | HTTP      |
| ws-server   | 3001 | WebSocket |
| http-server | 3002 | REST      |
