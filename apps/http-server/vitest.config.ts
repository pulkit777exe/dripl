import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    env: {
      JWT_SECRET: process.env.JWT_SECRET ?? 'test-secret-for-vitest',
      NODE_ENV: 'test',
      FRONTEND_URL: process.env.FRONTEND_URL ?? 'http://localhost:3000',
      DATABASE_URL: process.env.DATABASE_URL ?? 'postgres://localhost:5432/test',
    },
  },
});
