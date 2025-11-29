# Dripl - Collaborative Whiteboard

A modern, real-time collaborative whiteboard application.

## Getting Started

1. Install dependencies:

   ```bash
   pnpm install
   ```

2. Start the development environment:

   ```bash
   pnpm dev
   ```

   This will start:
   - Next.js app at http://localhost:3000
   - WebSocket server at ws://localhost:3001

## Architecture

- **apps/dripl-app**: Main Next.js application
- **apps/server**: WebSocket server
- **packages/common**: Shared types and constants
- **packages/element**: Element logic and rendering
- **packages/math**: Geometric utilities
- **packages/state**: State management
- **packages/sync**: Synchronization logic
- **packages/utils**: General utilities
