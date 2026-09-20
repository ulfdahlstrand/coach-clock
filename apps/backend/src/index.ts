import { readEnv } from './env.js';
import { createApiServer } from './server.js';

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
