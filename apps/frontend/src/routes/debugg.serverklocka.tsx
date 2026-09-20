import { Link, createFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { useServerTime } from '@/lib/server-time';

function formatDuration(milliseconds: number): string {
  return `${Math.round(milliseconds)} ms`;
}

function ServerTimeDebugPage() {
  const { t } = useTranslation();
  const { data: clock, error, isPending } = useServerTime();

  return (
    <section className="space-y-5">
      <div className="space-y-2">
        <p className="text-muted-foreground text-sm">Debugg</p>
        <h1 className="text-2xl font-semibold tracking-tight">{t('serverTime.heading')}</h1>
        <p className="text-muted-foreground text-sm">{t('serverTime.body')}</p>
      </div>

      {isPending ? <p role="status">{t('serverTime.loading')}</p> : null}
      {error ? <p role="alert">{t('serverTime.error')}</p> : null}
      {clock ? (
        <dl className="divide-border divide-y rounded-lg border text-sm">
          <div className="flex items-center justify-between gap-4 p-4">
            <dt className="text-muted-foreground">{t('serverTime.now')}</dt>
            <dd className="font-medium tabular-nums">{clock.nowIso()}</dd>
          </div>
          <div className="flex items-center justify-between gap-4 p-4">
            <dt className="text-muted-foreground">{t('serverTime.offset')}</dt>
            <dd className="font-medium tabular-nums">{formatDuration(clock.offsetMs)}</dd>
          </div>
          <div className="flex items-center justify-between gap-4 p-4">
            <dt className="text-muted-foreground">{t('serverTime.rtt')}</dt>
            <dd className="font-medium tabular-nums">{formatDuration(clock.fastestRoundTripMs)}</dd>
          </div>
          <div className="flex items-center justify-between gap-4 p-4">
            <dt className="text-muted-foreground">{t('serverTime.samples')}</dt>
            <dd className="font-medium tabular-nums">{clock.sampleCount}</dd>
          </div>
        </dl>
      ) : null}

      <Button asChild variant="outline" size="lg" className="min-h-touch w-full">
        <Link to="/">{t('serverTime.back')}</Link>
      </Button>
    </section>
  );
}

export const Route = createFileRoute('/debugg/serverklocka')({
  component: ServerTimeDebugPage,
});
