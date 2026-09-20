import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.integration.test.ts'],
    // En databas, en delad migrationstabell — kör inte filerna parallellt.
    fileParallelism: false,
  },
});
