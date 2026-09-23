import { describe, expect, test } from 'vitest';
import { createApiClient, resolveApiBaseUrl, type ApiFetch } from './api-client';

describe('resolveApiBaseUrl', () => {
  test('resolves the deployed /api path against the page origin', () => {
    expect(resolveApiBaseUrl('/api', 'https://coach-clock-web.onrender.com')).toBe(
      'https://coach-clock-web.onrender.com/api',
    );
  });

  test('keeps an absolute URL as it is', () => {
    expect(resolveApiBaseUrl('http://localhost:4002', 'http://localhost:5174')).toBe(
      'http://localhost:4002',
    );
  });

  test('falls back to the local dev API when nothing is configured', () => {
    expect(resolveApiBaseUrl(undefined, 'http://localhost:5174')).toBe('http://localhost:4002');
    expect(resolveApiBaseUrl('', 'http://localhost:5174')).toBe('http://localhost:4002');
  });

  test('strips a trailing slash so appended paths keep the prefix', () => {
    expect(resolveApiBaseUrl('/api/', 'https://coach-clock-web.onrender.com')).toBe(
      'https://coach-clock-web.onrender.com/api',
    );
  });
});

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
