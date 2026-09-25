import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.integration.test.ts'],
    // Pekar om DATABASE_URL till TEST_DATABASE_URL och vägrar köra mot
    // utvecklingsdatabasen — testerna droppar alla tabeller (#78).
    setupFiles: ['./src/integration-setup.ts'],
    // En databas, en delad migrationstabell — kör inte filerna parallellt.
    fileParallelism: false,
    // `FileMigrationProvider` laddar migrationsfilerna med en dynamisk import
    // vid körning, utanför vitests transform. Node behöver därför tsx-laddaren
    // i testprocessen för att kunna läsa en migration som är .ts — samma
    // laddare som `npm run migrate` använder.
    execArgv: ['--import', 'tsx/esm'],
  },
});
