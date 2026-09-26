import type { MeOutput } from '@coach-clock/contracts';
import { queryOptions } from '@tanstack/react-query';
import { redirect } from '@tanstack/react-router';
import { apiBaseUrl, apiClient } from '@/lib/api-client';
import { queryClient } from '@/lib/query-client';

/**
 * Tränarinloggningen (ADR-001). Bara tränaren loggar in — domare och åskådare
 * går med via länk utan konto (#16), och deras vyer har inga vakter.
 */
export const meQueryKey = ['auth', 'me'] as const;

export const meQueryOptions = queryOptions({
  queryKey: meQueryKey,
  queryFn: (): Promise<MeOutput> => apiClient.auth.me({}),
  // Ett misslyckat anrop betyder "vet inte", inte "utloggad" — se requireSignedIn.
  retry: false,
  staleTime: 5 * 60_000,
});

/**
 * Bara en sökväg i appen godtas som mål efter inloggningen. Servern gör samma
 * kontroll; den här gör att en konstig adress aldrig ens skickas dit.
 */
export function safeReturnTo(raw: unknown): string {
  return typeof raw === 'string' &&
    raw.startsWith('/') &&
    !raw.startsWith('//') &&
    !raw.includes('\\')
    ? raw
    : '/';
}

/** Startar Google-flödet. En vanlig navigering — inloggning är en omdirigering, inte ett API-anrop. */
export function googleSignInUrl(returnTo: string): string {
  return `${apiBaseUrl}/auth/google?${new URLSearchParams({ returnTo: safeReturnTo(returnTo) }).toString()}`;
}

/** Bara i utveckling: visas när VITE_ENABLE_DEV_LOGIN=true (backend måste också slå på den). */
export function isDevLoginEnabled(): boolean {
  return import.meta.env.VITE_ENABLE_DEV_LOGIN === 'true';
}

export function devSignInUrl(returnTo: string): string {
  return `${apiBaseUrl}/auth/dev-login?${new URLSearchParams({ returnTo: safeReturnTo(returnTo) }).toString()}`;
}

/**
 * beforeLoad-vakt för tränarens sidor. Omdirigerar bara när servern faktiskt
 * svarat "utloggad". Ett nätverksfel släpps igenom: vid sidlinjen utan täckning
 * ska appen inte kasta ut tränaren, och servern kräver ändå inloggning för
 * allt som vakten skyddar.
 */
export async function requireSignedIn(location: { readonly href: string }): Promise<void> {
  let me: MeOutput;
  try {
    me = await queryClient.ensureQueryData(meQueryOptions);
  } catch {
    return;
  }
  if (me.user === null) {
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- TanStack Routers redirect kastas, inte returneras
    throw redirect({ to: '/logga-in', search: { returnTo: location.href } });
  }
}

/**
 * Avslutar sessionen och glömmer allt som hörde till tränaren, så att nästa
 * person på samma telefon inte ser föregående tränares lag ur cachen.
 */
export async function logout(): Promise<void> {
  await apiClient.auth.logout({});
  queryClient.clear();
  queryClient.setQueryData(meQueryKey, { user: null });
}
