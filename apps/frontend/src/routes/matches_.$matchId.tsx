import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, Outlet, createFileRoute, useRouterState } from '@tanstack/react-router';
import {
  deriveMatchState,
  deriveFairnessState,
  FORMATIONS,
  type MatchEvent,
  type SequencedMatchEvent,
  type SubstitutionSwap,
} from '@coach-clock/contracts';
import { PauseIcon, PlayIcon, SquareIcon } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { BenchGrid, formationAssignments, MatchPitch } from '@/components/match-pitch';
import { apiClient } from '@/lib/api-client';
import { eventOutbox, startOutboxDrainer, withClientEventId } from '@/lib/event-outbox';
import { createMatchEventStream } from '@/lib/match-event-stream';
import { deriveVisibleMatchClock, formatClock } from '@/lib/match-clock-view';
import {
  becameSubstitutionDue,
  formatNextSubstitution,
  playFairnessAlert,
} from '@/lib/fairness-ui';
import { useServerTime } from '@/lib/server-time';
import { addPendingSwap, plannerName, removePendingSwap } from '@/lib/substitution-flow';

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
  const { matchId } = Route.useParams();
  const isChildRoute = useRouterState({
    select: (state) => state.location.pathname !== `/matches/${matchId}`,
  });

  // Share and summary are children of the active match route. The parent stays
  // invisible there so neither screen opens an unnecessary live SSE connection.
  if (isChildRoute) return <Outlet />;
  return <LiveMatchPage />;
}

function LiveMatchPage() {
  const { matchId } = Route.useParams();
  const queryClient = useQueryClient();
  const [tick, setTick] = useState(0);
  const [optimisticEvents, setOptimisticEvents] = useState<readonly MatchEvent[]>([]);
  const [selectedSlotId, setSelectedSlotId] = useState<string | undefined>();
  const [pendingSwaps, setPendingSwaps] = useState<readonly SubstitutionSwap[]>([]);
  const [undoEvent, setUndoEvent] = useState<MatchEvent | undefined>();
  const [fairnessThresholdMs, setFairnessThresholdMs] = useState(90_000);
  const [fairnessAlertOpen, setFairnessAlertOpen] = useState(false);
  const [suggestedOutPlayerId, setSuggestedOutPlayerId] = useState<string | undefined>();
  const [suggestedInPlayerId, setSuggestedInPlayerId] = useState<string | undefined>();
  const wasSubstitutionDue = useRef(false);
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
    if (undoEvent === undefined) return;
    const timeout = window.setTimeout(() => setUndoEvent(undefined), 5_000);
    return () => window.clearTimeout(timeout);
  }, [undoEvent]);

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
  const serverNow = serverTime.data?.now();
  const clock = deriveVisibleMatchClock(eventLog, serverNow);
  const matchState = useMemo(
    () => deriveMatchState(eventLog, serverNow ?? new Date(0)),
    [eventLog, serverNow, tick],
  );
  const fairness = useMemo(
    () =>
      deriveFairnessState(eventLog, serverNow ?? new Date(0), {
        debtThresholdMs: fairnessThresholdMs,
      }),
    [eventLog, fairnessThresholdMs, serverNow, tick],
  );
  const fairnessDebts = useMemo(
    () => Object.fromEntries(fairness.players.map((player) => [player.playerId, player.debtMs])),
    [fairness.players],
  );
  const formation = FORMATIONS.find((item) => item.id === matchState.formationId);
  const activePeriod = clock?.periodNumber ?? 0;
  const currentPeriodEnded =
    activePeriod > 0 &&
    eventLog.some((event) => event.type === 'period_ended' && event.periodNumber === activePeriod);
  const isFinalPeriod = match.data !== undefined && activePeriod >= match.data.periodCount;
  useScreenWakeLock(clock?.running === true);

  useEffect(() => {
    if (becameSubstitutionDue(wasSubstitutionDue.current, fairness.substitutionDue)) {
      playFairnessAlert();
      setFairnessAlertOpen(true);
    }
    wasSubstitutionDue.current = fairness.substitutionDue;
  }, [fairness.substitutionDue]);

  useEffect(() => {
    const suggestion = fairness.suggestedSubstitution;
    if (suggestion === null) return;
    setSuggestedOutPlayerId(suggestion.outPlayerId);
    setSuggestedInPlayerId(suggestion.inPlayerId);
  }, [fairness.suggestedSubstitution?.inPlayerId, fairness.suggestedSubstitution?.outPlayerId]);

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

  function selectPitchSlot(slotId: string): void {
    if (selectedSlotId === slotId) {
      setSelectedSlotId(undefined);
      return;
    }
    if (matchState.currentSlots[slotId] !== undefined) setSelectedSlotId(slotId);
  }

  function selectBenchPlayer(inPlayerId: string): void {
    if (selectedSlotId === undefined) return;
    const outPlayerId = matchState.currentSlots[selectedSlotId];
    if (outPlayerId === undefined) return;
    setPendingSwaps((current) =>
      addPendingSwap(current, { slotId: selectedSlotId, outPlayerId, inPlayerId }),
    );
    setSelectedSlotId(undefined);
  }

  function planSubstitutions(): void {
    if (pendingSwaps.length === 0) return;
    appendEvent({
      type: 'substitution_planned',
      planId: crypto.randomUUID(),
      swaps: [...pendingSwaps],
    });
    setPendingSwaps([]);
  }

  function addSuggestedSwap(): void {
    if (suggestedOutPlayerId === undefined || suggestedInPlayerId === undefined) return;
    const slotId = Object.entries(matchState.currentSlots).find(
      ([, playerId]) => playerId === suggestedOutPlayerId,
    )?.[0];
    if (slotId === undefined) return;
    setPendingSwaps((current) =>
      addPendingSwap(current, {
        slotId,
        outPlayerId: suggestedOutPlayerId,
        inPlayerId: suggestedInPlayerId,
      }),
    );
  }

  function confirmPlan(planId: string, swaps: readonly SubstitutionSwap[]): void {
    const now = serverTime.data?.nowIso();
    if (now === undefined) return;
    const event: Omit<Extract<MatchEvent, { type: 'substitution_confirmed' }>, 'eventId'> = {
      type: 'substitution_confirmed' as const,
      matchId,
      v: 1 as const,
      at: now,
      by: 'owner' as const,
      planId,
      swaps: [...swaps],
    };
    const confirmed = withClientEventId(event);
    setOptimisticEvents((old) => [...old, confirmed]);
    setUndoEvent(confirmed);
    append.mutate(confirmed);
  }

  function undoConfirmedSubstitution(): void {
    if (undoEvent === undefined) return;
    appendEvent({ type: 'event_undone', targetEventId: undoEvent.eventId });
    setUndoEvent(undefined);
  }

  function changeFormation(formationId: string): void {
    const next = FORMATIONS.find((item) => item.id === formationId);
    if (next === undefined || next.id === matchState.formationId) return;
    const assignments = formationAssignments(next, matchState.currentSlots);
    if (assignments.some((assignment) => assignment.playerId === '')) return;
    appendEvent({ type: 'formation_changed', formationId: next.id, assignments: [...assignments] });
    setSelectedSlotId(undefined);
  }

  const periodLabel =
    clock?.periodNumber === null || clock?.periodNumber === undefined
      ? 'Redo att starta'
      : `Period ${clock.periodNumber}${match.data ? ` av ${match.data.periodCount}` : ''}`;

  return (
    <section className="match-surface dark -mx-4 -my-8 min-h-[calc(100dvh-4.5rem)] bg-background px-4 py-7 text-foreground">
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
          <div className="mt-5 flex items-center justify-center gap-2 text-sm">
            <span className="rounded-full bg-amber-300/15 px-3 py-1 font-semibold text-amber-200">
              Nästa byte om {formatNextSubstitution(fairness.timeToNextSubstitutionMs)}
            </span>
          </div>
        </div>

        {formation === undefined ? null : (
          <div className="space-y-4">
            <div className="flex items-end justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">Planen</h2>
                <p className="text-muted-foreground text-sm">
                  Varmare kort visar vilka som väntat längst på sin rättvisa andel.
                </p>
              </div>
              <label className="text-muted-foreground text-xs font-medium">
                Formation
                <select
                  aria-label="Byt formation"
                  className="bg-secondary mt-1 block min-h-touch rounded-lg px-2 text-sm text-foreground"
                  value={formation.id}
                  disabled={append.isPending || serverTime.data === undefined}
                  onChange={(event) => changeFormation(event.target.value)}
                >
                  {FORMATIONS.filter(
                    (item) => item.format === (match.data?.format ?? formation.format),
                  ).map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <section
              aria-labelledby="fairness-heading"
              className="rounded-2xl border border-amber-200/15 bg-amber-100/5 p-4"
            >
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 id="fairness-heading" className="font-semibold">
                    Rättvist byte
                  </h2>
                  <p className="text-muted-foreground mt-1 text-xs">
                    Avisera när en bänkspelare ligger efter med
                  </p>
                </div>
                <label className="text-muted-foreground text-xs font-medium">
                  Gräns
                  <select
                    aria-label="Gräns för bytesavisering"
                    className="bg-secondary mt-1 block min-h-touch rounded-lg px-2 text-sm text-foreground"
                    value={fairnessThresholdMs}
                    onChange={(event) => setFairnessThresholdMs(Number(event.target.value))}
                  >
                    {[30_000, 60_000, 90_000, 120_000].map((value) => (
                      <option key={value} value={value}>
                        {value / 1_000} sek
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              {fairness.suggestedSubstitution === null ? (
                <p className="text-muted-foreground mt-3 text-sm">
                  Ingen möjlig rättvis rotation ännu.
                </p>
              ) : (
                <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                  <label className="text-muted-foreground text-xs">
                    Ut
                    <select
                      aria-label="Föreslagen spelare ut"
                      className="bg-secondary mt-1 block min-h-touch w-full rounded-lg px-2 text-sm text-foreground"
                      value={suggestedOutPlayerId ?? ''}
                      onChange={(event) => setSuggestedOutPlayerId(event.target.value || undefined)}
                    >
                      {fairness.rotationPlayers
                        .filter((player) =>
                          Object.values(matchState.currentSlots).includes(player.playerId),
                        )
                        .map((player) => (
                          <option key={player.playerId} value={player.playerId}>
                            {player.name}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label className="text-muted-foreground text-xs">
                    In
                    <select
                      aria-label="Föreslagen spelare in"
                      className="bg-secondary mt-1 block min-h-touch w-full rounded-lg px-2 text-sm text-foreground"
                      value={suggestedInPlayerId ?? ''}
                      onChange={(event) => setSuggestedInPlayerId(event.target.value || undefined)}
                    >
                      {fairness.rotationPlayers
                        .filter(
                          (player) =>
                            matchState.bench.includes(player.playerId) && player.available,
                        )
                        .map((player) => (
                          <option key={player.playerId} value={player.playerId}>
                            {player.name}
                          </option>
                        ))}
                    </select>
                  </label>
                  <Button
                    size="lg"
                    variant="secondary"
                    className="self-end"
                    disabled={
                      suggestedOutPlayerId === undefined || suggestedInPlayerId === undefined
                    }
                    onClick={addSuggestedSwap}
                  >
                    Lägg till
                  </Button>
                </div>
              )}
            </section>
            <MatchPitch
              formation={formation}
              state={matchState}
              selectedSlotId={selectedSlotId}
              onSelectSlot={selectPitchSlot}
              fairnessDebts={fairnessDebts}
              fairnessThresholdMs={fairnessThresholdMs}
            />
            <BenchGrid
              state={matchState}
              {...(selectedSlotId === undefined ? {} : { onSelectPlayer: selectBenchPlayer })}
              fairnessDebts={fairnessDebts}
              fairnessThresholdMs={fairnessThresholdMs}
            />
            <p className="text-muted-foreground text-center text-sm">
              {selectedSlotId === undefined
                ? 'Tryck på en spelare på planen som ska gå ut, sedan en spelare på bänken.'
                : 'Välj spelaren på bänken som ska in.'}
            </p>

            {pendingSwaps.length > 0 ? (
              <section
                aria-labelledby="pending-swaps-heading"
                className="rounded-2xl border border-violet-300/30 bg-violet-400/10 p-4"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <h2 id="pending-swaps-heading" className="font-semibold">
                    Nya byten
                  </h2>
                  <span className="text-sm text-violet-100">{pendingSwaps.length} planerade</span>
                </div>
                <ul className="mt-3 space-y-2">
                  {pendingSwaps.map((swap) => (
                    <li
                      key={swap.slotId}
                      className="flex min-h-touch items-center justify-between gap-2 text-sm"
                    >
                      <span>
                        {matchState.players[swap.outPlayerId]?.name ?? swap.outPlayerId} ut ·{' '}
                        {matchState.players[swap.inPlayerId]?.name ?? swap.inPlayerId} in
                      </span>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="min-h-touch"
                        onClick={() =>
                          setPendingSwaps((current) => removePendingSwap(current, swap.slotId))
                        }
                      >
                        Ta bort
                      </Button>
                    </li>
                  ))}
                </ul>
                <Button
                  size="lg"
                  className="mt-4 min-h-touch w-full rounded-xl"
                  disabled={append.isPending || serverTime.data === undefined}
                  onClick={planSubstitutions}
                >
                  Planera {pendingSwaps.length} {pendingSwaps.length === 1 ? 'byte' : 'byten'}
                </Button>
              </section>
            ) : null}

            {matchState.plannedSubstitutions.length > 0 ? (
              <section aria-labelledby="planned-swaps-heading" className="space-y-3">
                <h2 id="planned-swaps-heading" className="text-lg font-semibold">
                  Planerade byten
                </h2>
                {matchState.plannedSubstitutions.map((plan) => (
                  <article
                    key={plan.planId}
                    className="rounded-2xl border border-dashed border-violet-300/55 bg-card p-4"
                  >
                    <p className="text-sm font-semibold">
                      Planerat av {plannerName(plan.plannedBy)}
                    </p>
                    <ul className="text-muted-foreground mt-2 space-y-1 text-sm">
                      {plan.swaps.map((swap) => (
                        <li key={swap.slotId}>
                          {matchState.players[swap.outPlayerId]?.name ?? swap.outPlayerId} ut ·{' '}
                          {matchState.players[swap.inPlayerId]?.name ?? swap.inPlayerId} in
                        </li>
                      ))}
                    </ul>
                    <div className="mt-4 grid grid-cols-2 gap-2">
                      <Button
                        size="lg"
                        className="min-h-touch"
                        disabled={append.isPending || serverTime.data === undefined}
                        onClick={() => confirmPlan(plan.planId, plan.swaps)}
                      >
                        Bekräfta
                      </Button>
                      <Button
                        size="lg"
                        variant="secondary"
                        className="min-h-touch"
                        disabled={append.isPending || serverTime.data === undefined}
                        onClick={() =>
                          appendEvent({ type: 'substitution_cancelled', planId: plan.planId })
                        }
                      >
                        Avbryt
                      </Button>
                    </div>
                  </article>
                ))}
              </section>
            ) : null}
          </div>
        )}

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
      {undoEvent === undefined ? null : (
        <div
          role="status"
          className="fixed right-4 bottom-4 left-4 z-20 mx-auto flex max-w-md items-center justify-between gap-3 rounded-2xl bg-slate-900 px-4 py-3 text-sm text-white shadow-2xl"
        >
          <span>Bytet är genomfört.</span>
          <Button
            size="sm"
            variant="secondary"
            className="min-h-touch"
            onClick={undoConfirmedSubstitution}
          >
            Ångra
          </Button>
        </div>
      )}
      {fairnessAlertOpen ? (
        <div
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="fairness-alert-title"
          className="fixed inset-0 z-30 flex items-center justify-center bg-slate-950/90 p-5"
        >
          <section className="w-full max-w-md rounded-[2rem] border border-rose-200/50 bg-slate-900 p-6 text-center shadow-2xl">
            <p className="text-sm font-bold tracking-[0.16em] text-rose-200 uppercase">
              Rättvist byte
            </p>
            <h2 id="fairness-alert-title" className="mt-2 text-3xl font-semibold">
              Dags att rotera
            </h2>
            <p className="text-muted-foreground mt-3 text-sm">
              En bänkspelare har nått din gräns på {fairnessThresholdMs / 1_000} sekunder.
            </p>
            <p className="text-muted-foreground mt-2 text-xs">
              Ljud och vibration är en bästa-ansträngning. iPhone visar alltid den här visuella
              påminnelsen när vibration saknas.
            </p>
            <Button
              size="lg"
              className="mt-6 w-full rounded-xl"
              onClick={() => setFairnessAlertOpen(false)}
            >
              Visa förslag
            </Button>
          </section>
        </div>
      ) : null}
    </section>
  );
}

export const Route = createFileRoute('/matches_/$matchId')({ component: MatchPage });
