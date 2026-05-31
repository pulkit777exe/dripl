# Contributing to Dripl

Thank you for your interest in contributing to Dripl! This guide will help you get started.

---

## Prerequisites

- **Node.js** 20+ (`node --version`)
- **pnpm** 10+ (`pnpm --version`)
- **PostgreSQL** (for local development)
- **Redis** (optional, for production features)

---

## Development Setup

### 1. Clone & Install

```bash
git clone <repo-url>
cd dripl
pnpm install
```

### 2. Environment Variables

```bash
cp .env.example .env
# Edit .env with your local values
```

Required variables:
- `DATABASE_URL` — PostgreSQL connection string
- `JWT_SECRET` — Minimum 32 characters
- `FRONTEND_URL` — Usually `http://localhost:3000`

### 3. Database Setup

```bash
# Generate Prisma client
pnpm db:generate

# Run migrations
pnpm db:migrate
```

### 4. Start Development

```bash
# Start all services
pnpm dev

# Or start individually
cd apps/dripl-app && pnpm dev    # Port 3000
cd apps/http-server && pnpm dev  # Port 3002
cd apps/ws-server && pnpm dev    # Port 3001
```

---

## Project Structure

```
dripl/
├── apps/
│   ├── dripl-app/       # Next.js 16 frontend
│   ├── http-server/     # Express 5 REST API
│   └── ws-server/       # WebSocket collaboration server
├── packages/
│   ├── common/          # Shared types & Zod schemas
│   ├── db/              # Prisma ORM client
│   ├── dripl/           # Core canvas library
│   ├── element/         # Element factory & rendering
│   ├── math/            # Geometry utilities
│   ├── utils/           # Shared utilities
│   └── test-utils/      # Shared test factories
├── tooling/
│   ├── eslint-config/   # Shared ESLint rules
│   └── typescript-config/ # Shared tsconfigs
└── docker/              # Dockerfiles
```

---

## Coding Standards

### TypeScript

- **Strict mode** is enabled across all packages
- **ESM only** — use `import`/`export`, never `require()`
- **No `any` types** — use `unknown` + type narrowing
- **No barrel files** in packages — use granular `exports` in `package.json`

### Code Style

- **Prettier** for formatting (runs on save)
- **ESLint** for linting (run `pnpm lint` before committing)
- **100 char line width** max
- **Single quotes**, **trailing commas**, **2-space indent**

### Commit Messages

We use [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <description>

[optional body]
```

**Types:** `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`

**Examples:**
```
feat(canvas): add multi-select with marquee
fix(ws-server): prevent overlapping periodic saves
docs: update architecture diagram in README
test(element): add resize tests for diamond shapes
```

### Package Manager

- **Always use `pnpm`** for package management
- **Use `workspace:*`** for all internal package dependencies
- **Never install deps at root** unless they are repo-level tools

---

## Testing

### Running Tests

```bash
pnpm test              # All suites
pnpm test -- --watch   # Watch mode

# Single package
turbo run test --filter=@dripl/element
turbo run test --filter=http-server
```

### Writing Tests

- Tests live alongside source files or in `__tests__/` directories
- Use **Vitest** as the test framework
- Use `@dripl/test-utils` for element/user factories
- Integration tests for `http-server` use **Supertest**

### Test Patterns

```typescript
// Unit test
import { describe, it, expect } from 'vitest';
import { getElementBounds } from '../src';

describe('getElementBounds', () => {
  it('returns correct bounds for rectangle', () => {
    const element = createTestElement({ type: 'rectangle', x: 0, y: 0, width: 100, height: 50 });
    const bounds = getElementBounds(element);
    expect(bounds).toEqual({ x: 0, y: 0, width: 100, height: 50 });
  });
});
```

---

## Pull Request Process

### 1. Create a Branch

```bash
git checkout -b feat/my-feature
# or
git checkout -b fix/my-bugfix
```

### 2. Make Changes

- Follow the coding standards above
- Add tests for new functionality
- Update documentation if needed

### 3. Validate

```bash
pnpm lint         # Fix lint errors
pnpm build        # Verify TypeScript compiles
pnpm test         # Ensure tests pass
```

### 4. Submit PR

- Use a clear, descriptive title
- Reference any related issues
- Fill out the PR template checklist

### 5. Code Review

- At least one approval required
- All CI checks must pass
- Address review feedback

---

## Architecture Decisions

For major architectural decisions, see:
- `TODOS.md` — Engineering roadmap and active work
- `Problems.md` — Security audit findings
- `AGENTS.md` — Domain terminology and decisions

---

## Common Tasks

### Adding a New Package

1. Create `packages/<name>/`
2. Add `package.json` with `"name": "@dripl/<name>"`
3. Add `tsconfig.json` extending `@dripl/typescript-config/base.json`
4. Add to root `tsconfig.json` `references`
5. Run `pnpm install`

### Adding a New API Route

1. Create route file in `apps/http-server/src/routes/`
2. Add Zod schema for request validation
3. Add `authMiddleware` for protected routes
4. Mount router in `apps/http-server/src/index.ts`
5. Add tests

### Adding a New Canvas Element

1. Add type to `@dripl/common` element types
2. Add factory in `@dripl/element`
3. Add rendering in `@dripl/element/rough-renderer.ts`
4. Add hit detection in `@dripl/math`
5. Add tests

---

## Getting Help

- Check existing issues and discussions
- Read the codebase documentation (`CLAUDE.md` files)
- Ask questions in PRs or issues

---

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
