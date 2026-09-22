import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { deriveMatchState, FORMATIONS, type SequencedMatchEvent } from '@coach-clock/contracts';
import { EyeIcon, UsersIcon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { BenchGrid, MatchPitch } from '@/components/match-pitch';
import { Button } from '@/components/ui/button';
import { apiClient } from '@/lib/api-client';
import { createMatchEventStream } from '@/lib/match-event-stream';
import { deriveVisibleMatchClock, formatClock } from '@/lib/match-clock-view';
import { normalizeJoinCode } from '@/lib/sharing';
import { useServerTime } from '@/lib/server-time';

/**
 * The only screen reached from a parent/viewer link.  It intentionally owns
 * no mutation and supplies the pitch in its non-interactive form: a viewer
 * may receive events in real time, but can never turn an event into a write.
 */
function ViewerPage() {
  const { token } = Route.useParams();
  const matchId = Route.useSearch({ select: (search) => search.matchId });

  return matchId === undefined ? <ViewerJoin token={token} /> : <ViewerLive matchId={matchId} />;
}

function ViewerJoin({ token }: { readonly token: string }) {
  const navigate = useNavigate();
  const [displayName, setDisplayName] = useState('');
  const code = normalizeJoinCode(token);
  const isCode = code.length === 6 && token.length <= 7;
  const join = useMutation({
    mutationFn: () =>
      apiClient.matches.join(
        isCode
          ? { displayName: displayName.trim(), code }
          : { displayName: displayName.trim(), linkToken: token },
      ),
    onSuccess: (joined) =>
      navigate({ to: '/titta/$token', params: { token }, search: { matchId: joined.matchId } }),
  });

  return (
    <section className="space-y-6 pt-4">
      <header className="bg-primary text-primary-foreground rounded-3xl p-6 shadow-sm">
        <EyeIcon aria-hidden="true" className="mb-5 size-7" />
        <p className="text-primary-foreground/75 text-sm font-medium tracking-wide">FÖLJ MATCHEN</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">Följ från sidlinjen</h1>
        <p className="text-primary-foreground/75 mt-3 text-sm">
          Du ser matchen och speltiderna live. Den här länken kan inte ändra något.
        </p>
      </header>
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (displayName.trim().length > 0) join.mutate();
        }}
      >
        <label className="block space-y-2">
          <span className="text-sm font-medium">Vad vill du kallas?</span>
          <input
            autoComplete="name"
            autoFocus
            maxLength={100}
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            placeholder="Till exempel Alex"
            className="border-input bg-background min-h-touch w-full rounded-xl border px-4 text-base"
          />
        </label>
        {join.error ? (
          <p role="alert" className="text-destructive text-sm">
            Kunde inte öppna matchen. Kontrollera länken eller koden och försök igen.
          </p>
        ) : null}
        <Button
          type="submit"
          size="lg"
          className="min-h-touch w-full rounded-xl"
          disabled={join.isPending || displayName.trim().length === 0}
        >
          <UsersIcon aria-hidden="true" />
          {join.isPending ? 'Öppnar…' : 'Följ matchen'}
        </Button>
      </form>
    </section>
  );
}

function ViewerLive({ matchId }: { readonly matchId: string }) {
  const queryClient = useQueryClient();
  const [tick, setTick] = useState(0);

  const match = useQuery({
    queryKey: ['match', matchId],
    queryFn: () => apiClient.matches.get({ matchId }),
  });
  const events = useQuery({
    queryKey: ['match-events', matchId],
    queryFn: () => apiClient.matches.listEvents({ matchId, sinceSeq: 0 }),
  });
  const serverTime = useServerTime();

  useEffect(() => {
    const interval = window.setInterval(() => setTick((current) => current + 1), 250);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    const initialSeq = events.data?.at(-1)?.seq ?? 0;
    const stream = createMatchEventStream({
      matchId,
      initialSeq,
      onEvent: (item) => {
        queryClient.setQueryData<readonly SequencedMatchEvent[]>(
          ['match-events', matchId],
          (old = []) => (old.some((existing) => existing.seq === item.seq) ? old : [...old, item]),
        );
      },
    });
    stream.start();
    return () => stream.stop();
  }, [events.data?.length, matchId, queryClient]);

  const eventLog = useMemo(() => events.data?.map((item) => item.event) ?? [], [events.data]);
  const clock = deriveVisibleMatchClock(eventLog, serverTime.data?.now());
  const matchState = useMemo(
    () => deriveMatchState(eventLog, serverTime.data?.now() ?? new Date(0)),
    [eventLog, serverTime.data],
  );
  const formation = FORMATIONS.find((item) => item.id === matchState.formationId);
  void tick;

  return (
    <section className="match-surface dark -mx-4 -my-8 min-h-[calc(100dvh-4.5rem)] bg-background px-4 py-7 text-foreground">
      <div className="mx-auto flex w-full max-w-md flex-col gap-6">
        <header className="flex items-start justify-between gap-4">
          <div>
            <p className="text-muted-foreground text-xs font-semibold tracking-[0.16em] uppercase">
              FÖLJER LIVE
            </p>
            <h1 className="mt-1 text-xl font-semibold">{match.data?.opponent ?? 'Match'}</h1>
          </div>
          <span className="rounded-full bg-sky-400/15 px-3 py-1 text-xs font-semibold text-sky-200">
            ENDAST LÄSNING
          </span>
        </header>

        <div className="rounded-[2rem] border border-white/10 bg-card px-5 py-9 text-center shadow-2xl">
          <p className="text-muted-foreground text-sm">Speltid i perioden</p>
          <output
            aria-label="Matchklocka"
            className="mt-2 block text-7xl font-semibold tracking-tight tabular-nums sm:text-8xl"
          >
            {clock === undefined ? '—:——' : formatClock(clock.periodElapsedMs)}
          </output>
          <p className="text-muted-foreground mt-4 text-sm tabular-nums">
            Totalt {clock === undefined ? '—:——' : formatClock(clock.elapsedMs)}
          </p>
        </div>

        {formation === undefined ? null : (
          <div className="space-y-4">
            <div>
              <h2 className="text-lg font-semibold">Planen</h2>
              <p className="text-muted-foreground text-sm">Aktuell uppställning och speltid.</p>
            </div>
            <MatchPitch
              formation={formation}
              state={matchState}
              selectedSlotId={undefined}
              readOnly
            />
            <BenchGrid state={matchState} />
          </div>
        )}

        <section aria-labelledby="playing-time-heading" className="space-y-3">
          <h2 id="playing-time-heading" className="text-lg font-semibold">
            Speltid per spelare
          </h2>
          <ul className="divide-y divide-white/10 rounded-2xl border border-white/10 bg-card px-4">
            {Object.values(matchState.players)
              .sort((left, right) => left.name.localeCompare(right.name, 'sv'))
              .map((player) => (
                <li
                  key={player.playerId}
                  className="flex min-h-touch items-center justify-between gap-3 py-2"
                >
                  <span className="min-w-0 truncate font-medium">
                    {player.number === null ? '' : `${player.number} · `}
                    {player.name}
                  </span>
                  <time className="text-muted-foreground shrink-0 font-medium tabular-nums">
                    {formatClock(player.playedMs)}
                  </time>
                </li>
              ))}
          </ul>
        </section>

        {match.isPending || events.isPending || serverTime.isPending ? (
          <p role="status" className="text-muted-foreground text-center text-sm">
            Synkar matchen…
          </p>
        ) : null}
        {match.error || events.error || serverTime.error ? (
          <p role="alert" className="text-destructive text-center text-sm">
            Kunde inte synka matchen. Försök igen när anslutningen är tillbaka.
          </p>
        ) : null}
      </div>
    </section>
  );
}

export const Route = createFileRoute('/titta_/$token')({
  validateSearch: (search: Record<string, unknown>): { matchId?: string } =>
    typeof search.matchId === 'string' ? { matchId: search.matchId } : {},
  component: ViewerPage,
});
