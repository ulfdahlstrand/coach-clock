import { contract } from '@coach-clock/contracts';
import type { ContractRouterClient } from '@orpc/contract';
import { createORPCClient } from '@orpc/client';
import { OpenAPILink } from '@orpc/openapi-client/fetch';

/** Adressen till API:t när ingen VITE_API_URL är satt — den lokala dev-servern. */
const DEV_API_BASE_URL = 'http://localhost:4002';

/**
 * Löser VITE_API_URL mot sidans origin, så att värdet får vara antingen absolut
 * (`http://localhost:4002` i utveckling) eller en sökväg. Driftsatt är det
 * sökvägen `/api`, som den statiska sajten skriver om till API-tjänsten — det
 * håller deltagarcookien förstaparts. Absolut är också vad oRPC:s `OpenAPILink`
 * behöver; den matar basadressen rakt in i `new URL()`.
 */
export function resolveApiBaseUrl(configured: unknown, origin: string): string {
  const raw =
    typeof configured === 'string' && configured.length > 0 ? configured : DEV_API_BASE_URL;

  // Utan avslutande snedstreck sväljer new URL() sista segmentet när sökvägar
  // läggs på basen längre fram.
  return new URL(raw, origin).href.replace(/\/$/, '');
}

/** API:t kör separat i utveckling men kan få en annan adress vid driftsättning. */
export const apiBaseUrl = resolveApiBaseUrl(
  import.meta.env.VITE_API_URL,
  globalThis.location.origin,
);

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
