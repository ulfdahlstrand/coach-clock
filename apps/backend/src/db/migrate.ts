import { destroyDb, getDb } from './client.js';
import { migrateDown, migrateToLatest, reportMigrationResults } from './migrator.js';

const direction = process.argv[2] === 'down' ? 'down' : 'latest';

const resultSet = await (direction === 'down' ? migrateDown(getDb()) : migrateToLatest(getDb()));
const ok = reportMigrationResults(resultSet);

await destroyDb();

if (!ok) {
  console.error('Migreringen misslyckades:', resultSet.error);
  process.exit(1);
}
