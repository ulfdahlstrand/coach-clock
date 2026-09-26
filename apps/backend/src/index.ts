import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readEnv } from './env.js';
import { createApiServer } from './server.js';

/*
 * Repo-rotens .env läses lokalt, så att t.ex. GOOGLE_CLIENT_ID når servern.
 * Redan satta miljövariabler vinner, och driftsatt finns ingen fil — där sätter
 * Render allt (docs/deployment.md).
 */
const envFile = fileURLToPath(new URL('../../../.env', import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);

const env = readEnv();
const server = createApiServer(env);

server.listen(env.port, () => {
  console.log(`coach-clock API lyssnar på http://localhost:${env.port}`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close(() => {
      process.exit(0);
    });
  });
}
