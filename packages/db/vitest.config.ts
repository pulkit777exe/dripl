import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // `src/generated/**` is Prisma's output. It is not tracked in git, nobody
      // writes it by hand, and it cannot be meaningfully tested — but v8's
      // `all` default still reported it, so the package's headline number was
      // diluted by hundreds of statements this repo does not own. Without this
      // block, coverage ran on defaults and counted them.
      exclude: ['src/**/*.test.ts', 'src/generated/**'],
    },
  },
});
