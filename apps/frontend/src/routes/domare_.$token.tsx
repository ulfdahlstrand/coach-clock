import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import type { MatchEvent, SequencedMatchEvent } from '@coach-clock/contracts';
import { PauseIcon, PlayIcon, SquareIcon, TimerIcon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { apiClient } from '@/lib/api-client';
import { createMatchEventStream } from '@/lib/match-event-stream';
import { deriveVisibleMatchClock, formatClock } from '@/lib/match-clock-view';
import { useServerTime } from '@/lib/server-time';

type RefereeEvent = Extract<
  MatchEvent,
  { type: 'period_started' | 'period_ended' | 'clock_paused' | 'clock_resumed' }
>;
type RefereeEventInput =
  | { readonly type: 'period_started'; readonly periodNumber: number }
  | { readonly type: 'period_ended'; readonly periodNumber: number }
  | { readonly type: 'clock_paused'; readonly reason: string }
  | { readonly type: 'clock_resumed' };

function RefereeJoinPage() {
  const { token } = Route.useParams();
  const navigate = useNavigate();
  const [displayName, setDisplayName] = useState('');
  const join = useMutation({
    mutationFn: () =>
      apiClient.matches.refereeJoin({ displayName: displayName.trim(), linkToken: token }),
    onSuccess: ({ matchId }) =>
      navigate({ to: '/domare/$token', params: { token }, search: { matchId } }),
  });
  const matchId = Route.useSearch({ select: (search) => search.matchId });
  if (matchId !== undefined) return <RefereeClock matchId={matchId} />;

  return (
    <section className="dark -mx-4 -my-8 min-h-[calc(100dvh-4.5rem)] bg-background px-4 py-8 text-foreground">
      <div className="mx-auto flex w-full max-w-md flex-col gap-6">
        <header className="rounded-[2rem] bg-primary p-6 text-primary-foreground shadow-xl">
          <TimerIcon aria-hidden="true" className="mb-5 size-8" />
          <p className="text-primary-foreground/70 text-xs font-semibold tracking-[0.16em]">
            DOMARLÄGE
          </p>
          <h1 className="mt-2 text-3xl font-semibold">Styr matchklockan</h1>
          <p className="text-primary-foreground/75 mt-3 text-sm">
            Du kan bara starta, pausa och avsluta perioder.
          </p>
        </header>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (displayName.trim()) join.mutate();
          }}
        >
          <label className="block space-y-2">
            <span className="text-sm font-medium">Ditt namn</span>
            <input
              autoFocus
              autoComplete="name"
              value={displayName}
              maxLength={100}
              onChange={(event) => setDisplayName(event.target.value)}
              className="border-input bg-background min-h-touch w-full rounded-xl border px-4 text-base"
              placeholder="Till exempel Kim"
            />
          </label>
          {join.error ? (
            <p role="alert" className="text-destructive text-sm">
              Länken är ogiltig eller har återkallats.
            </p>
          ) : null}
          <Button
            type="submit"
            size="lg"
            className="min-h-[4rem] w-full rounded-2xl text-base"
            disabled={join.isPending || !displayName.trim()}
          >
            {join.isPending ? 'Ansluter…' : 'Öppna domarklockan'}
          </Button>
        </form>
      </div>
    </section>
  );
}

function RefereeClock({ matchId }: { readonly matchId: string }) {
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
    const id = window.setInterval(() => setTick((value) => value + 1), 250);
    return () => window.clearInterval(id);
  }, []);
  useEffect(() => {
    const stream = createMatchEventStream({
      matchId,
      initialSeq: events.data?.at(-1)?.seq ?? 0,
      onEvent: (item) =>
        queryClient.setQueryData<readonly SequencedMatchEvent[]>(
          ['match-events', matchId],
          (old = []) => (old.some((event) => event.seq === item.seq) ? old : [...old, item]),
        ),
    });
    stream.start();
    return () => stream.stop();
  }, [events.data?.length, matchId, queryClient]);
  const eventLog = useMemo(() => events.data?.map((item) => item.event) ?? [], [events.data]);
  const clock = deriveVisibleMatchClock(eventLog, serverTime.data?.now());
  void tick;
  const period = clock?.periodNumber;
  const ended =
    period !== null &&
    period !== undefined &&
    eventLog.some((event) => event.type === 'period_ended' && event.periodNumber === period);
  const finalPeriod = match.data !== undefined && (period ?? 0) >= match.data.periodCount;
  const append = useMutation({
    mutationFn: (event: RefereeEvent) => apiClient.matches.events(event),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['match-events', matchId] }),
  });
  function write(event: RefereeEventInput): void {
    const at = serverTime.data?.nowIso();
    if (at === undefined) return;
    append.mutate({
      ...event,
      eventId: crypto.randomUUID(),
      matchId,
      at,
      v: 1,
      by: 'referee',
    });
  }
  const start = () => {
    if (period === null || period === undefined) write({ type: 'period_started', periodNumber: 1 });
    else if (!clock?.running && ended) write({ type: 'period_started', periodNumber: period + 1 });
    else if (!clock?.running) write({ type: 'clock_resumed' });
  };

  return (
    <section className="dark -mx-4 -my-8 min-h-[calc(100dvh-4.5rem)] bg-background px-4 py-7 text-foreground">
      <div className="mx-auto flex w-full max-w-md flex-col gap-5">
        <header className="text-center">
          <p className="text-muted-foreground text-xs font-semibold tracking-[0.16em]">DOMARLÄGE</p>
          <h1 className="mt-2 text-xl font-semibold">
            Period {period ?? 1}
            {match.data ? ` av ${match.data.periodCount}` : ''}
          </h1>
        </header>
        <div className="rounded-[2rem] border border-white/10 bg-card px-5 py-10 text-center shadow-2xl">
          <p className="text-muted-foreground text-sm">Matchklocka</p>
          <output
            aria-label="Matchklocka"
            className="mt-3 block text-8xl font-semibold tracking-tight tabular-nums"
          >
            {clock === undefined ? '—:——' : formatClock(clock.periodElapsedMs)}
          </output>
          <p className="text-muted-foreground mt-4 text-sm">{clock?.running ? 'PÅGÅR' : 'PAUS'}</p>
        </div>
        {append.error || match.error || events.error || serverTime.error ? (
          <p role="alert" className="text-destructive text-center text-sm">
            Kunde inte synka klockan. Försök igen.
          </p>
        ) : null}
        <Button
          size="lg"
          className="min-h-[5.5rem] rounded-2xl text-lg"
          disabled={
            append.isPending || serverTime.data === undefined || (finalPeriod && !clock?.running)
          }
          onClick={start}
        >
          <PlayIcon aria-hidden="true" />
          {clock?.running
            ? 'Spelar'
            : period === null || period === undefined
              ? 'Starta period 1'
              : ended
                ? 'Starta nästa period'
                : 'Fortsätt'}
        </Button>
        <Button
          size="lg"
          variant="secondary"
          className="min-h-[5.5rem] rounded-2xl text-lg"
          disabled={append.isPending || !clock?.running || serverTime.data === undefined}
          onClick={() => write({ type: 'clock_paused', reason: 'Domarens paus' })}
        >
          <PauseIcon aria-hidden="true" />
          Pausa
        </Button>
        <Button
          size="lg"
          variant="outline"
          className="min-h-[4.5rem] rounded-2xl"
          disabled={append.isPending || !clock?.running || serverTime.data === undefined}
          onClick={() =>
            period !== null &&
            period !== undefined &&
            write({ type: 'period_ended', periodNumber: period })
          }
        >
          <SquareIcon aria-hidden="true" />
          Avsluta period
        </Button>
      </div>
    </section>
  );
}

export const Route = createFileRoute('/domare_/$token')({
  validateSearch: (search: Record<string, unknown>): { matchId?: string } =>
    typeof search.matchId === 'string' ? { matchId: search.matchId } : {},
  component: RefereeJoinPage,
});
