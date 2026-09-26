import { useQuery } from '@tanstack/react-query';
import { createFileRoute, redirect } from '@tanstack/react-router';
import { LogInIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  devSignInUrl,
  googleSignInUrl,
  isDevLoginEnabled,
  meQueryOptions,
  safeReturnTo,
} from '@/lib/auth';
import { queryClient } from '@/lib/query-client';

export interface LoginSearch {
  returnTo?: string;
  error?: 'failed' | 'unavailable';
}

function LoginPage() {
  const { t } = useTranslation();
  const { returnTo = '/', error } = Route.useSearch();
  const me = useQuery(meQueryOptions);

  return (
    <section className="space-y-4">
      <p className="text-muted-foreground text-sm">{t('login.eyebrow')}</p>
      <h1 className="text-2xl font-semibold tracking-tight">{t('login.heading')}</h1>
      <p className="text-muted-foreground text-sm">{t('login.body')}</p>

      {error !== undefined ? (
        <p className="text-destructive text-sm" role="alert">
          {t(error === 'unavailable' ? 'login.unavailable' : 'login.failed')}
        </p>
      ) : null}
      {me.isError ? (
        <p className="text-muted-foreground text-sm" role="status">
          {t('login.offline')}
        </p>
      ) : null}

      <Button asChild size="lg" className="min-h-touch w-full">
        <a href={googleSignInUrl(returnTo)}>
          <LogInIcon aria-hidden="true" />
          {t('login.google')}
        </a>
      </Button>

      {isDevLoginEnabled() ? (
        <Button asChild variant="outline" size="lg" className="min-h-touch w-full">
          <a href={devSignInUrl(returnTo)}>{t('login.dev')}</a>
        </Button>
      ) : null}

      <p className="text-muted-foreground text-sm">{t('login.noAccountNeeded')}</p>
    </section>
  );
}

export const Route = createFileRoute('/logga-in')({
  validateSearch: (search: Record<string, unknown>): LoginSearch => ({
    ...(typeof search['returnTo'] === 'string'
      ? { returnTo: safeReturnTo(search['returnTo']) }
      : {}),
    ...(search['error'] === 'failed' || search['error'] === 'unavailable'
      ? { error: search['error'] }
      : {}),
  }),
  beforeLoad: async ({ search }) => {
    // Redan inloggad: vidare till målet i stället för en meningslös knapp.
    const me = await queryClient.ensureQueryData(meQueryOptions).catch(() => undefined);
    if (me?.user != null) {
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- TanStack Routers redirect kastas, inte returneras
      throw redirect({ href: search.returnTo ?? '/' });
    }
  },
  component: LoginPage,
});
