import { Link, createFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';

function AboutPage() {
  const { t } = useTranslation();

  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">{t('about.heading')}</h1>
      <p className="text-muted-foreground text-sm">{t('about.body')}</p>
      <Button asChild variant="outline" size="lg" className="min-h-touch w-full">
        <Link to="/">{t('about.back')}</Link>
      </Button>
    </section>
  );
}

export const Route = createFileRoute('/om')({
  component: AboutPage,
});
