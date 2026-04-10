# Dripl

Real-time collaborative whiteboard with hand-drawn rendering, live cursors, and shareable links.

---

## Quick Start

### Prerequisites

- Node.js 20+
- pnpm 10+

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
│  Next.js 16  │  │  Express 5 │  │    ws      │
│  Port 3000   │  │  Port 3002  │  │ Port 3001  │
└──────────────┘  └──────────────┘  └──────────────┘
       │                 │                 │
       └────────────────┼────────────────┘
                        ▼
                 ┌──────────────┐
                 │ PostgreSQL   │
                 │  (Neon)     │
                 └──────────────┘
```

### Tech Stack

- **Frontend**: Next.js 16, React 19, Tailwind CSS 4, Zustand
- **Rendering**: roughjs, HTML5 Canvas
- **Backend**: Express 5, WebSocket (ws), Prisma 7
- **Database**: PostgreSQL (Neon)

---

## Features

- **Canvas Tools**: Rectangle, ellipse, diamond, arrow, line, text, frame, freedraw, eraser
- **Editing**: Selection, resize, rotate, undo/redo (100 steps)
- **Collaboration**: Remote cursors, element sync, presence
- **Sharing**: Public links, view/edit permissions
- **Export**: PNG, SVG, JSON
- **Theme**: Dark/light mode
- **Keyboard Shortcuts**: V, R, E, D, P, L, A, T, F, X, H + Ctrl combos

---

## Scripts

```bash
pnpm dev          # Start all services
pnpm build        # Build for production
pnpm test         # Run tests
pnpm lint         # Lint code
pnpm format      # Format with Prettier
pnpm db:migrate  # Database migrations
pnpm db:studio  # Prisma Studio GUI
```

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

## Resources

- [Next.js](https://nextjs.org)
- [roughjs](https://roughjs.com)
- [Prisma](https://prisma.io)
- [Zustand](https://zustand-demo.pmnd.rs)
