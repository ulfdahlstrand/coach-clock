import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolveTestDatabaseUrl } from './test-database.js';

/*
 * Körs före varje integrationstestfil (vitest.integration.config.ts), innan
 * filen hinner läsa readEnv(). Repo-rotens .env läses om den finns, men redan
 * satta miljövariabler vinner — CI sätter sina egna. Därefter pekas
 * DATABASE_URL om till testdatabasen, eller så stoppas körningen (#78).
 */
const envFile = fileURLToPath(new URL('../../../.env', import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);

process.env['DATABASE_URL'] = resolveTestDatabaseUrl(process.env);
