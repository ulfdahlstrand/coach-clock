import { useQuery } from '@tanstack/react-query';
import { Link, createFileRoute } from '@tanstack/react-router';
import { LogInIcon, PlayIcon, TimerIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { apiClient } from '@/lib/api-client';
import { meQueryOptions } from '@/lib/auth';

/**
 * Tränarens pågående matcher. Kontot ger skrivrätt i matchen på vilken
 * inloggad enhet som helst, så härifrån kan en match tas över från en annan
 * telefon. Visas bara för inloggade.
 */
function ActiveMatches() {
  const { t } = useTranslation();
  const me = useQuery(meQueryOptions);
  const signedIn = (me.data?.user ?? null) !== null;
  const matches = useQuery({
    queryKey: ['matches', 'active'],
    queryFn: () => apiClient.matches.listActive({}),
    enabled: signedIn,
  });

  if (!signedIn) return null;
  if (matches.error) {
    return (
      <p className="text-muted-foreground text-sm" role="alert">
        {t('start.activeMatchesError')}
      </p>
    );
  }
  if (matches.data === undefined || matches.data.length === 0) return null;

  return (
    <div className="space-y-2">
      <h2 className="font-semibold">{t('start.activeMatches')}</h2>
      <ul className="space-y-2">
        {matches.data.map((match) => (
          <li key={match.id}>
            <Button
              asChild
              variant="secondary"
              size="lg"
              className="min-h-touch w-full justify-between"
            >
              <Link to="/matches/$matchId" params={{ matchId: match.id }}>
                <span className="truncate">
                  {t('start.activeMatch', { team: match.teamName, opponent: match.opponent })}
                </span>
                <span className="flex items-center gap-1">
                  <PlayIcon aria-hidden="true" />
                  {t('start.continueMatch')}
                </span>
              </Link>
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function StartPage() {
  const { t } = useTranslation();
  const [joinCode, setJoinCode] = useState('');

  return (
    <section className="space-y-4">
      <p className="text-muted-foreground text-sm">{t('app.tagline')}</p>
      <h1 className="text-2xl font-semibold tracking-tight">{t('start.heading')}</h1>
      <p className="text-muted-foreground text-sm">{t('start.body')}</p>
      <ActiveMatches />
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
