import { QueryClientProvider } from '@tanstack/react-query';
import { Link, Outlet, createRootRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { queryClient } from '@/lib/query-client';

function RootLayout() {
  const { t } = useTranslation();

  return (
    <QueryClientProvider client={queryClient}>
      <div className="flex min-h-dvh flex-col">
        <header className="border-b">
          <nav className="mx-auto flex w-full max-w-md items-center gap-1 px-4 py-2">
            {/* min-h-touch: 44 px träffyta, se --spacing-touch i globals.css. */}
            <Link
              to="/"
              className="text-muted-foreground data-[status=active]:text-foreground flex min-h-touch items-center rounded-md px-3 text-sm font-medium"
            >
              {t('nav.start')}
            </Link>
            <Link
              to="/om"
              className="text-muted-foreground data-[status=active]:text-foreground flex min-h-touch items-center rounded-md px-3 text-sm font-medium"
            >
              {t('nav.about')}
            </Link>
          </nav>
        </header>

        <main className="mx-auto w-full max-w-md flex-1 px-4 py-8">
          <Outlet />
        </main>
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
