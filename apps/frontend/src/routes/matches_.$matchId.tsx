import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, Outlet, createFileRoute, useRouterState } from '@tanstack/react-router';
import type { MatchEvent, SequencedMatchEvent } from '@coach-clock/contracts';
import { PauseIcon, PlayIcon, SquareIcon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { apiClient } from '@/lib/api-client';
import { eventOutbox, startOutboxDrainer, withClientEventId } from '@/lib/event-outbox';
import { createMatchEventStream } from '@/lib/match-event-stream';
import { deriveVisibleMatchClock, formatClock } from '@/lib/match-clock-view';
import { useServerTime } from '@/lib/server-time';

type WakeLockSentinelLike = { release(): Promise<void> };
type WakeLockNavigator = Navigator & {
  wakeLock?: { request(type: 'screen'): Promise<WakeLockSentinelLike> };
};
type ClientMatchEvent = MatchEvent extends infer Event
  ? Event extends MatchEvent
    ? Omit<Event, 'eventId' | 'at' | 'matchId' | 'v' | 'by'>
    : never
  : never;

function useScreenWakeLock(shouldKeepAwake: boolean): void {
  useEffect(() => {
    if (!shouldKeepAwake) return;
    let sentinel: WakeLockSentinelLike | undefined;
    const request = async () => {
      try {
        sentinel = await (navigator as WakeLockNavigator).wakeLock?.request('screen');
      } catch {
        // Wake Lock is optional and must never prevent a match from being run.
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void request();
    };
    void request();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      void sentinel?.release();
    };
  }, [shouldKeepAwake]);
}

/** Browsers require a user gesture before AudioContext can later play an alert. */
function unlockAudio(): void {
  const AudioContextConstructor = window.AudioContext;
  if (AudioContextConstructor === undefined) return;
  const context = new AudioContextConstructor();
  void context.resume().finally(() => void context.close());
}

function MatchPage() {
  const isSummaryRoute = useRouterState({
    select: (state) => state.location.pathname.endsWith('/summary'),
  });

  // File-based routing makes /summary a child of the active match route. The
  // parent intentionally stays invisible there so the share card is printable
  // and does not open an unnecessary live SSE connection.
  if (isSummaryRoute) return <Outlet />;
  return <LiveMatchPage />;
}

function LiveMatchPage() {
  const { matchId } = Route.useParams();
  const queryClient = useQueryClient();
  const [tick, setTick] = useState(0);
  const [optimisticEvents, setOptimisticEvents] = useState<readonly MatchEvent[]>([]);
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

  useEffect(() => startOutboxDrainer(eventOutbox, (event) => apiClient.matches.events(event)), []);

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
        setOptimisticEvents((old) => old.filter((event) => event.eventId !== item.event.eventId));
      },
    });
    stream.start();
    return () => stream.stop();
  }, [events.data?.length, matchId, queryClient]);

  const eventLog = useMemo(() => {
    const received = events.data?.map((item) => item.event) ?? [];
    const receivedIds = new Set(received.map((event) => event.eventId));
    return [...received, ...optimisticEvents.filter((event) => !receivedIds.has(event.eventId))];
  }, [events.data, optimisticEvents]);
  // `tick` intentionally only makes React ask the pure clock for a new
  // server-adjusted projection; it is never accumulated as match time.
  const clock = deriveVisibleMatchClock(eventLog, serverTime.data?.now());
  void tick;
  const activePeriod = clock?.periodNumber ?? 0;
  const currentPeriodEnded =
    activePeriod > 0 &&
    eventLog.some((event) => event.type === 'period_ended' && event.periodNumber === activePeriod);
  const isFinalPeriod = match.data !== undefined && activePeriod >= match.data.periodCount;
  useScreenWakeLock(clock?.running === true);

  const append = useMutation({
    mutationFn: async (event: MatchEvent) => {
      await eventOutbox.enqueue(event);
      const result = await eventOutbox.drain((pending) => apiClient.matches.events(pending));
      if (result.failedEventId === event.eventId)
        throw new Error('Kunde inte synka händelsen ännu.');
    },
    onSuccess: (_, event) => {
      setOptimisticEvents((old) => old.filter((candidate) => candidate.eventId !== event.eventId));
      void queryClient.invalidateQueries({ queryKey: ['match-events', matchId] });
      void queryClient.invalidateQueries({ queryKey: ['match', matchId] });
    },
  });

  function appendEvent(event: ClientMatchEvent): void {
    const now = serverTime.data?.nowIso();
    if (now === undefined) return;
    const complete = withClientEventId({ ...event, matchId, v: 1, at: now, by: 'owner' });
    setOptimisticEvents((old) => [...old, complete]);
    append.mutate(complete);
  }

  function startOrResume(): void {
    unlockAudio();
    if (clock?.periodNumber === null || clock?.periodNumber === undefined || !clock.running) {
      if (clock?.periodNumber === null || clock?.periodNumber === undefined) {
        appendEvent({ type: 'period_started', periodNumber: 1 });
      } else if (clock.running === false && currentPeriodEnded) {
        appendEvent({ type: 'period_started', periodNumber: clock.periodNumber + 1 });
      } else {
        appendEvent({ type: 'clock_resumed' });
      }
    }
  }

  function endPeriod(): void {
    if (clock?.periodNumber === null || clock?.periodNumber === undefined) return;
    appendEvent({ type: 'period_ended', periodNumber: clock.periodNumber });
  }

  const periodLabel =
    clock?.periodNumber === null || clock?.periodNumber === undefined
      ? 'Redo att starta'
      : `Period ${clock.periodNumber}${match.data ? ` av ${match.data.periodCount}` : ''}`;

  return (
    <section className="dark -mx-4 -my-8 min-h-[calc(100dvh-4.5rem)] bg-background px-4 py-7 text-foreground">
      <div className="mx-auto flex w-full max-w-md flex-col gap-6">
        <header className="flex items-start justify-between gap-4">
          <div>
            <p className="text-muted-foreground text-xs font-semibold tracking-[0.16em] uppercase">
              {periodLabel}
            </p>
            <h1 className="mt-1 text-xl font-semibold">{match.data?.opponent ?? 'Match'}</h1>
          </div>
          <span
            className={
              clock?.running
                ? 'rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-semibold text-emerald-300'
                : 'rounded-full bg-secondary px-3 py-1 text-xs font-semibold text-muted-foreground'
            }
          >
            {clock?.running ? 'PÅGÅR' : 'PAUS'}
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

        {match.isPending || events.isPending || serverTime.isPending ? (
          <p role="status" className="text-muted-foreground text-center text-sm">
            Synkar matchklockan…
          </p>
        ) : null}
        {match.error || events.error || serverTime.error ? (
          <p role="alert" className="text-destructive text-center text-sm">
            Kunde inte synka matchen. Försök igen när anslutningen är tillbaka.
          </p>
        ) : null}
        {append.error ? (
          <p role="alert" className="text-destructive text-center text-sm">
            Händelsen sparades i kön och skickas igen automatiskt.
          </p>
        ) : null}

        <div className="grid grid-cols-2 gap-3">
          <Button
            size="lg"
            className="min-h-[5.25rem] rounded-2xl text-base"
            disabled={
              append.isPending ||
              serverTime.data === undefined ||
              (isFinalPeriod && clock?.running === false)
            }
            onClick={startOrResume}
          >
            <PlayIcon aria-hidden="true" />
            {clock?.running
              ? 'Spelar'
              : clock?.periodNumber === null || clock?.periodNumber === undefined
                ? 'Starta period 1'
                : 'Fortsätt'}
          </Button>
          <Button
            size="lg"
            variant="secondary"
            className="min-h-[5.25rem] rounded-2xl text-base"
            disabled={append.isPending || !clock?.running || serverTime.data === undefined}
            onClick={() => appendEvent({ type: 'clock_paused', reason: 'Paus' })}
          >
            <PauseIcon aria-hidden="true" /> Pausa
          </Button>
        </div>
        <Button
          size="lg"
          variant="outline"
          className="min-h-touch w-full rounded-2xl border-white/15 bg-transparent text-foreground hover:bg-secondary hover:text-foreground"
          disabled={append.isPending || !clock?.running || serverTime.data === undefined}
          onClick={endPeriod}
        >
          <SquareIcon aria-hidden="true" /> Avsluta period
        </Button>

        <Link
          to="/matches/$matchId/summary"
          params={{ matchId }}
          className="text-muted-foreground py-2 text-center text-sm underline underline-offset-4"
        >
          Visa matchsammantällning
        </Link>
      </div>
    </section>
  );
}

export const Route = createFileRoute('/matches_/$matchId')({ component: MatchPage });
