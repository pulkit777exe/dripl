# Contributing to Dripl

Thank you for your interest in contributing to Dripl!

## Development Setup

1. Clone the repository
2. Install dependencies: `pnpm install`
3. Start the development servers:
   ```bash
   pnpm dev
   ```

## Project Structure

```
dripl/
├── apps/
│   ├── dripl-app/     # Next.js frontend
│   ├── http-server/   # Express API server
│   └── ws-server/     # WebSocket server
├── packages/
│   ├── common/        # Shared types and schemas
│   ├── db/           # Database layer
│   ├── dripl/        # Core library
│   ├── element/       # Element factory
│   ├── math/         # Math utilities
│   ├── runtime/      # State management
│   └── utils/        # Utility functions
└── tooling/
    └── typescript-config/
```

## Coding Standards

- Use TypeScript with strict mode
- Run `pnpm lint` before committing
- Run `pnpm build` to verify type checking

## Commit Messages

We use [Conventional Commits](https://www.conventionalcommits.org/). Please use the following format:

```
<type>(<scope>): <description>

[optional body]
```

Types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`

## Testing

Run tests with:

```bash
pnpm test
```

## Submitting a Pull Request

1. Create a feature branch
2. Make your changes
3. Ensure tests pass
4. Submit a PR with a clear description
