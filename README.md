# Dripl

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
│  dripl-app  │   │http-server   │  │ ws-server    │
│  Next.js 16 │   │  Express 5   │  │    ws        │
│  Port 3000  │   │  Port 3002   │  │ Port 3001    │
└──────────────┘  └──────────────┘  └──────────────┘
       │                 │               │
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

- **Canvas Tools**: Rectangle, ellipse, diamond, arrow, line, text, frame, freedraw, eraser
- **Editing**: Selection, resize, rotate, undo/redo (100 steps)
- **Collaboration**: Remote cursors, element sync, presence
- **Sharing**: Public links, view/edit permissions
- **Export**: PNG, SVG, JSON
- **Theme**: Dark/light mode
- **Keyboard Shortcuts**: V, R, E, D, P, L, A, T, F, X, H + Ctrl combinations

---

## Scripts

```bash
pnpm dev          # Start all services
pnpm build        # Build for production
pnpm test         # Run tests
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

# Or for development
docker-compose up
```

Dockerfiles are located in `docker/` directory.

---

## Database

8 models: User, Team, TeamMember, Folder, File, SharedFile, CanvasRoom, ShareLink.

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

## Project Structure

```
dripl/
├── apps/
│   ├── dripl-app/       # Next.js frontend
│   ├── http-server/     # Express REST API
│   └── ws-server/       # WebSocket server
├── packages/
│   ├── common/          # Shared types
│   ├── db/              # Prisma schema
│   ├── dripl/           # UI components
│   ├── element/         # Element utilities
│   ├── math/            # Geometry utilities
│   └── utils/           # Shared utilities
├── docker/              # Dockerfiles
└── docker-compose.yml   # Local development
```

---

## License

MIT
