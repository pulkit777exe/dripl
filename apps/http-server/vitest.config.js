import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    env: {
      JWT_SECRET: 'test-secret-for-vitest',
      PORT: '3002',
      NODE_ENV: 'test',
      FRONTEND_URL: 'http://localhost:3000',
      DATABASE_URL: 'postgres://localhost:5432/test',
    },
  },
});
