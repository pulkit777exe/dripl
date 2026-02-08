# Contributing to Dripl

Thank you for your interest in contributing to Dripl!

---

## Getting Started

1. Fork the repository
2. Clone your fork: `git clone https://github.com/pulkit777exe/dripl.git`
3. Install dependencies: `pnpm install`
4. Create a branch: `git checkout -b feature/your-feature-name`

---

## Development Workflow

### 1. Make Your Changes

- Write clean, readable code
- Follow existing code style
- Add comments for complex logic
- Update types as needed

### 2. Test Your Changes

```bash
# Run the app locally
pnpm dev

# Check for type errors
pnpm build

# Run linter
pnpm lint
```

### 3. Commit Your Changes

Use clear, descriptive commit messages:

```bash
git commit -m "feat: add circle tool to toolbar"
git commit -m "fix: resolve canvas zoom issue"
git commit -m "docs: update installation guide"
```

**Commit Prefixes:**

- `feat:` - New feature
- `fix:` - Bug fix
- `docs:` - Documentation
- `style:` - Code formatting
- `refactor:` - Code restructuring
- `test:` - Adding tests
- `chore:` - Maintenance tasks

### 4. Push and Create PR

```bash
git push origin feature/your-feature-name
```

Then create a Pull Request on GitHub.

---

## Code Guidelines

### TypeScript

- Use explicit types, avoid `any`
- Define interfaces for props
- Use type inference where obvious

```typescript
// Good
interface ButtonProps {
  label: string;
  onClick: () => void;
}

// Avoid
const props: any = { ... };
```

### React Components

- Use functional components
- Extract reusable logic to hooks
- Keep components focused and small

```typescript
// Good
export function ToolButton({ icon, label, onClick }: ToolButtonProps) {
  return (
    <button onClick={onClick}>
      {icon}
      <span>{label}</span>
    </button>
  );
}
```

### File Organization

- One component per file
- Group related files in folders
- Use index files for exports

```
components/
├── layer-ui/
│   ├── Toolbar.tsx
│   ├── Sidebar.tsx
│   └── index.ts
```

---

## Pull Request Process

1. **Update Documentation** - If you change functionality, update README.md
2. **Keep PRs Focused** - One feature or fix per PR
3. **Write Clear Descriptions** - Explain what and why
4. **Respond to Feedback** - Address review comments promptly

---

## Questions?

- Check existing issues and discussions
- Ask in pull request comments
- Reach out to maintainers

---

Thank you for contributing!
