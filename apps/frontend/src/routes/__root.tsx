import { QueryClientProvider } from '@tanstack/react-query';
import { Link, Outlet, createRootRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { queryClient } from '@/lib/query-client';
import { useIsPhone } from '@/lib/use-is-phone';
import { InstallPrompt } from '@/components/install-prompt';
import { ServiceWorkerUpdate } from '@/components/service-worker-update';

type NavigationProps = { phone: boolean };

function Navigation({ phone }: NavigationProps) {
  const { t } = useTranslation();
  const links = [
    { to: '/', label: t('nav.start') },
    { to: '/lag', label: t('nav.teams') },
    { to: '/om', label: t('nav.about') },
    { to: '/debugg/serverklocka', label: t('nav.debug') },
  ] as const;

  return (
    <nav
      aria-label={phone ? 'Huvudnavigation' : undefined}
      className={phone ? 'phone-nav' : 'desktop-nav'}
    >
      {links.map(({ to, label }) => (
        <Link
          key={to}
          to={to}
          className="text-muted-foreground data-[status=active]:text-foreground flex min-h-touch items-center justify-center rounded-xl px-3 text-sm font-medium"
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}

function RootLayout() {
  const phone = useIsPhone();

  return (
    <QueryClientProvider client={queryClient}>
      <div className="app-shell">
        <header className="app-shell-top">
          {phone ? (
            <span className="app-shell-brand">COACH CLOCK</span>
          ) : (
            <Navigation phone={false} />
          )}
        </header>
        <div className="app-shell-context" aria-label="Appstatus">
          <span>VID SIDLINJEN</span>
          <span className="app-shell-context-dot" aria-hidden="true" />
          <span>REDO FÖR MATCH</span>
        </div>
        <main className="app-shell-content">
          <Outlet />
        </main>
        <InstallPrompt />
        <ServiceWorkerUpdate />
        {phone ? <Navigation phone /> : null}
      </div>
    </QueryClientProvider>
  );
}

function NotFound() {
  const { t } = useTranslation();

  return (
    <div className="mx-auto w-full max-w-md px-4 py-8">
      <h1 className="text-xl font-semibold">{t('error.notFound')}</h1>
      <p className="text-muted-foreground mt-2 text-sm">{t('error.notFoundBody')}</p>
    </div>
  );
}

export const Route = createRootRoute({
  component: RootLayout,
  notFoundComponent: NotFound,
});
