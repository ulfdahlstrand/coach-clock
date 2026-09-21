import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createApiServer } from './server.js';

let baseUrl: string;
const server = createApiServer({
  port: 0,
  corsOrigins: ['http://localhost:5174'],
  databaseUrl: 'postgres://coach_clock:coach_clock@localhost:5434/coach_clock',
});

beforeAll(async () => {
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });

  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

describe('GET /health', () => {
  it('svarar 200 med status ok', async () => {
    const response = await fetch(`${baseUrl}/health`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ status: 'ok' });
  });
});

describe('GET /openapi.json', () => {
  it('svarar med ett giltigt OpenAPI-dokument genererat ur kontraktet', async () => {
    const response = await fetch(`${baseUrl}/openapi.json`);
    const document = z
      .object({
        openapi: z.string().regex(/^3\.\d+\.\d+$/),
        info: z.object({ title: z.literal('coach-clock API'), version: z.literal('0.0.0') }),
        paths: z.object({
          '/matches': z.object({ get: z.object({}).passthrough() }).passthrough(),
          '/matches/share': z.object({ post: z.object({}).passthrough() }).passthrough(),
          '/matches/join': z.object({ post: z.object({}).passthrough() }).passthrough(),
          '/matches/participants': z.object({ get: z.object({}).passthrough() }).passthrough(),
          '/matches/events': z
            .object({ get: z.object({}).passthrough(), post: z.object({}).passthrough() })
            .passthrough(),
          '/players': z
            .object({ get: z.object({}).passthrough(), post: z.object({}).passthrough() })
            .passthrough(),
          '/players/update': z.object({ post: z.object({}).passthrough() }).passthrough(),
          '/teams': z
            .object({ get: z.object({}).passthrough(), post: z.object({}).passthrough() })
            .passthrough(),
          '/time': z.object({ get: z.object({}).passthrough() }).passthrough(),
        }),
      })
      .passthrough()
      .safeParse(await response.json());

    expect(response.status).toBe(200);
    expect(document.success).toBe(true);
  });
});

describe('okänd route', () => {
  it('svarar 404 istället för att hänga', async () => {
    const response = await fetch(`${baseUrl}/finns-inte`);

    expect(response.status).toBe(404);
  });
});
