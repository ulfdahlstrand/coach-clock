import { contract } from '@coach-clock/contracts';
import type { ContractRouterClient } from '@orpc/contract';
import { createORPCClient } from '@orpc/client';
import { OpenAPILink } from '@orpc/openapi-client/fetch';

/** API:t kör separat i utveckling men kan få en annan adress vid driftsättning. */
const configuredApiBaseUrl: unknown = import.meta.env.VITE_API_URL;
export const apiBaseUrl =
  typeof configuredApiBaseUrl === 'string' && configuredApiBaseUrl.length > 0
    ? configuredApiBaseUrl
    : 'http://localhost:4002';

export type ApiFetch = typeof fetch;

/**
 * Skapar den kontraktstypade OpenAPI-klienten. Cookies följer alltid med så att
 * framtida deltagar- och administratörssessioner fungerar över origin-gränsen.
 */
export function createApiClient(url = apiBaseUrl, fetchImpl: ApiFetch = fetch) {
  const link = new OpenAPILink(contract, {
    url,
    fetch: (request, init) => fetchImpl(request, { ...init, credentials: 'include' }),
  });

  const client: ContractRouterClient<typeof contract> = createORPCClient(link);
  return client;
}

export const apiClient = createApiClient();
