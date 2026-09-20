import { describe, expect, test } from 'vitest';
import { createApiClient, type ApiFetch } from './api-client';

describe('createApiClient', () => {
  test('includes credentials on OpenAPI requests', async () => {
    let credentials: RequestCredentials | undefined;
    const fetchMock: ApiFetch = (_request, init) => {
      credentials = init?.credentials;
      return Promise.resolve(
        new Response(JSON.stringify({ now: '2026-09-20T12:00:00.000Z' }), {
          headers: { 'content-type': 'application/json' },
        }),
      );
    };
    const client = createApiClient('https://api.example.test', fetchMock);

    await client.time();

    expect(credentials).toBe('include');
  });
});
