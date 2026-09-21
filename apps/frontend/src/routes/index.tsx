import { Link, createFileRoute } from '@tanstack/react-router';
import { LogInIcon, TimerIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';

function StartPage() {
  const { t } = useTranslation();
  const [joinCode, setJoinCode] = useState('');

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
      <form
        className="bg-card space-y-3 rounded-2xl border p-4"
        onSubmit={(event) => {
          event.preventDefault();
          const code = joinCode.replace(/[^0-9a-z]/gi, '').toUpperCase();
          if (code.length === 6) window.location.assign(`/join/${code}`);
        }}
      >
        <label className="block space-y-2">
          <span className="font-medium">Gå med med kod</span>
          <input
            aria-label="Anslutningskod"
            inputMode="text"
            autoCapitalize="characters"
            maxLength={7}
            value={joinCode}
            onChange={(event) => setJoinCode(event.target.value)}
            placeholder="K7M-2QX"
            className="border-input bg-background min-h-touch w-full rounded-xl border px-4 font-mono text-lg tracking-[0.14em]"
          />
        </label>
        <Button
          type="submit"
          variant="outline"
          size="lg"
          className="min-h-touch w-full rounded-xl"
          disabled={joinCode.replace(/[^0-9a-z]/gi, '').length !== 6}
        >
          <LogInIcon aria-hidden="true" /> Gå till matchen
        </Button>
      </form>
    </section>
  );
}

export const Route = createFileRoute('/')({
  component: StartPage,
});
