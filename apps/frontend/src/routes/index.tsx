import { Link, createFileRoute } from '@tanstack/react-router';
import { TimerIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';

function StartPage() {
  const { t } = useTranslation();

  return (
    <section className="space-y-4">
      <p className="text-muted-foreground text-sm">{t('app.tagline')}</p>
      <h1 className="text-2xl font-semibold tracking-tight">{t('start.heading')}</h1>
      <p className="text-muted-foreground text-sm">{t('start.body')}</p>
      <Button asChild size="lg" className="min-h-touch w-full">
        <Link to="/matches/new">
          <TimerIcon aria-hidden="true" />
          Starta ny match
        </Link>
      </Button>
    </section>
  );
}

export const Route = createFileRoute('/')({
  component: StartPage,
});
