import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
    const document = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(document['openapi']).toMatch(/^3\.\d+\.\d+$/);
    expect(document['info']).toMatchObject({ title: 'coach-clock API', version: '0.0.0' });
    expect(Object.keys(document['paths'] ?? {}).sort()).toEqual([
      '/matches/events',
      '/players',
      '/players/update',
      '/teams',
    ]);
  });
});

describe('okänd route', () => {
  it('svarar 404 istället för att hänga', async () => {
    const response = await fetch(`${baseUrl}/finns-inte`);

    expect(response.status).toBe(404);
  });
});
