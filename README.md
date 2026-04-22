# Dripl

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen.svg)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue.svg)](https://www.typescriptlang.org)
[![Next.js](https://img.shields.io/badge/Next.js-16-black.svg)](https://nextjs.org)
[![Prisma](https://img.shields.io/badge/Prisma-7-purple.svg)](https://prisma.io)

Real-time collaborative whiteboard with hand-drawn rendering, live cursors, and shareable links.

---

## Quick Start

### Prerequisites

- Node.js 20+
- pnpm 10+
- PostgreSQL (for local development)

### Installation

```bash
# Install dependencies
pnpm install

# Generate Prisma client
pnpm db:generate

# Run development
pnpm dev
```

Open `http://localhost:3000`

---

## Architecture

### Three-Server Setup

```
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│  dripl-app   │  │http-server  │  │ ws-server   │
│  Next.js 16  │  │  Express 5   │  │    ws      │
│  Port 3000   │  │  Port 3002   │  │ Port 3001   │
└──────────────┘  └──────────────┘  └──────────────┘
       │                │                │
       └────────────────┼────────────────┘
                        ▼
                 ┌──────────────┐
                 │ PostgreSQL   │
                 └──────────────┘
```

### Tech Stack

| Layer     | Technology                                    |
| --------- | --------------------------------------------- |
| Frontend  | Next.js 16, React 19, Tailwind CSS 4, Zustand |
| Rendering | roughjs, HTML5 Canvas                         |
| Backend   | Express 5, WebSocket (ws), Prisma 7           |
| Database  | PostgreSQL                                    |

---

## Features

### Canvas Tools

- **Shapes**: Rectangle, ellipse, diamond, arrow, line, text, frame, freedraw, eraser
- **Editing**: Selection, resize, rotate, undo/redo (100 steps)
- **View**: Zoom (+/-), grid toggle, dark/light theme

### Collaboration

- **Real-time sync**: Multiple users can draw simultaneously
- **Remote cursors**: See where others are pointing
- **Presence**: Who's in the room
- **Message subtypes**:
  - `scene-update` with `subtype: 'init'` — Full sync on join
  - `scene-update` with `subtype: 'update'` — Live element changes
  - `cursor-move` — Real-time cursor positions
  - `user-join` / `user-leave` — Presence updates

### Sharing

- **Public links**: Share canvas via URL
- **Permissions**: View/edit access
- **Export**: PNG, SVG, JSON

### Keyboard Shortcuts

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
| Ctrl+Z       | Undo                        |
| Ctrl+Shift+Z | Redo                        |
| Ctrl+G       | Toggle grid                 |

---

## Collaboration Flow

```
User A draws element
        │
        ▼
broadcastElements(prev, next)
        │
        ▼
send({ type: 'scene-update', subtype: 'update', elements: [...] })
        │
        ▼
ws-server receives → broadcasts to all clients (except sender)
        │
        ▼
Client B receives → onRemoteElements() → updates canvas
```

**Key Components:**

| Component | File | Purpose |
|-----------|------|---------|
| `useCollaboration` | `hooks/useCollaboration.ts` | WebSocket client |
| `index.ts` | `ws-server/src/index.ts` | Message handling |
| `validation.ts` | `ws-server/src/validation.ts` | Schema validation |
| `CollaboratorsList` | `components/canvas/CollaboratorsList.tsx` | User presence UI |

---

## Scripts

```bash
pnpm dev          # Start all services
pnpm build        # Build for production
pnpm test         # Run tests (42 passing)
pnpm lint         # Lint code
pnpm format       # Format with Prettier
pnpm db:migrate   # Database migrations
```

---

## Development

### Running Individual Services

```bash
cd apps/dripl-app && pnpm dev     # Port 3000
cd apps/http-server && pnpm dev   # Port 3002
cd apps/ws-server && pnpm dev     # Port 3001
```

### Docker

```bash
# Start all services with Docker Compose
docker-compose up --build
```

Dockerfiles are located in `docker/` directory.

---

## Database

8 models: User, Team, TeamMember, Folder, File, SharedFile, CanvasRoom, ShareLink.

---

## Project Structure

```
dripl/
├── apps/
│   ├── dripl-app/       # Next.js frontend (Port 3000)
│   ├── http-server/     # Express REST API (Port 3002)
│   └── ws-server/      # WebSocket server (Port 3001)
├── packages/
│   ├── common/         # Shared types
│   ├── db/             # Prisma schema
│   ├── dripl/          # UI components
│   ├── element/        # Element utilities
│   ├── math/           # Geometry utilities
│   └── utils/          # Shared utilities
├── docker/             # Dockerfiles
└── docker-compose.yml  # Local development
```

---

## Troubleshooting

### Build fails

```bash
pnpm db:generate
rm -rf .turbo && pnpm build
```

### Dev server won't start

```bash
rm -rf .next
pnpm dev
```

### Type errors

```bash
pnpm build    # Regenerates all packages
```

---

## License

MIT