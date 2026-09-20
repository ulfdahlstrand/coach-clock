import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.integration.test.ts'],
    // En databas, en delad migrationstabell — kör inte filerna parallellt.
    fileParallelism: false,
    // `FileMigrationProvider` laddar migrationsfilerna med en dynamisk import
    // vid körning, utanför vitests transform. Node behöver därför tsx-laddaren
    // i testprocessen för att kunna läsa en migration som är .ts — samma
    // laddare som `npm run migrate` använder.
    execArgv: ['--import', 'tsx/esm'],
  },
});
