import type { DerivedMatchState, Formation } from '@coach-clock/contracts';
import { formatClock } from '@/lib/match-clock-view';

export type PitchMove = {
  readonly playerId: string;
  readonly fromSlotId: string;
  readonly toSlotId: string;
};

export function playerInitials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .map((part) => part[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

/**
 * Keeps every player on the pitch when a formation changes. The event log,
 * rather than this view, accounts for the time played in the old positions.
 */
export function formationAssignments(
  formation: Formation,
  currentSlots: Readonly<Record<string, string>>,
): readonly { readonly slotId: string; readonly playerId: string }[] {
  const players = Object.values(currentSlots);
  return formation.slots.map((slot, index) => ({
    slotId: slot.id,
    playerId: currentSlots[slot.id] ?? players[index] ?? '',
  }));
}

export function MatchPitch({
  formation,
  state,
  selectedSlotId,
  onSelectSlot,
}: {
  readonly formation: Formation;
  readonly state: DerivedMatchState;
  readonly selectedSlotId: string | undefined;
  readonly onSelectSlot: (slotId: string) => void;
}) {
  return (
    <section aria-label="Planuppställning" className="space-y-3">
      <div className="relative aspect-[3/4] overflow-hidden rounded-[2rem] border border-emerald-200/20 bg-emerald-950 shadow-2xl">
        <div className="pointer-events-none absolute inset-3 rounded-[1.55rem] border border-emerald-100/25" />
        <div className="pointer-events-none absolute top-1/2 right-3 left-3 border-t border-emerald-100/25" />
        <div className="pointer-events-none absolute top-1/2 left-1/2 size-16 -translate-x-1/2 -translate-y-1/2 rounded-full border border-emerald-100/25" />
        <div className="pointer-events-none absolute top-3 right-1/2 left-1/2 h-12 -translate-x-1/2 border-x border-b border-emerald-100/25" />
        <div className="pointer-events-none absolute right-1/2 bottom-3 left-1/2 h-12 -translate-x-1/2 border-x border-t border-emerald-100/25" />
        {formation.slots.map((slot) => {
          const playerId = state.currentSlots[slot.id];
          const player = playerId === undefined ? undefined : state.players[playerId];
          const selected = selectedSlotId === slot.id;
          return (
            <button
              key={slot.id}
              type="button"
              aria-pressed={selected}
              aria-label={
                player === undefined ? `${slot.label}, tom plats` : `${slot.label}, ${player.name}`
              }
              className={
                'absolute flex min-h-touch w-[30%] -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center rounded-2xl border px-2 py-1.5 text-center shadow-lg transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white ' +
                (selected
                  ? 'border-violet-200 bg-violet-400 text-slate-950 ring-4 ring-violet-300/35'
                  : player === undefined
                    ? 'border-dashed border-emerald-100/45 bg-emerald-900/70 text-emerald-100'
                    : 'border-orange-200/65 bg-orange-400 text-slate-950')
              }
              style={{ left: `${slot.x * 100}%`, top: `${slot.y * 100}%` }}
              onClick={() => onSelectSlot(slot.id)}
            >
              <span className="text-[10px] font-bold tracking-wider uppercase opacity-75">
                {slot.label}
              </span>
              {player === undefined ? (
                <span className="text-xs font-semibold">Tom plats</span>
              ) : (
                <>
                  <span className="text-sm font-bold leading-tight">
                    {player.number === null ? '' : `${player.number} · `}
                    {player.name}
                  </span>
                  <span className="text-[11px] font-medium tabular-nums">
                    {formatClock(player.playedMs)}
                  </span>
                </>
              )}
            </button>
          );
        })}
      </div>
      <p className="text-muted-foreground text-center text-xs">
        {selectedSlotId === undefined
          ? 'Välj en spelare på planen.'
          : 'Den här spelaren är vald för byte.'}
      </p>
    </section>
  );
}

export function BenchGrid({
  state,
  selectedPlayerId,
  onSelectPlayer,
}: {
  readonly state: DerivedMatchState;
  readonly selectedPlayerId?: string;
  readonly onSelectPlayer?: (playerId: string) => void;
}) {
  return (
    <section aria-labelledby="bench-heading" className="space-y-3">
      <div className="flex items-baseline justify-between">
        <h2 id="bench-heading" className="text-lg font-semibold">
          Bänken
        </h2>
        <span className="text-muted-foreground text-sm">{state.bench.length} spelare</span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {state.bench.map((playerId) => {
          const player = state.players[playerId];
          if (player === undefined) return null;
          return (
            <button
              key={playerId}
              type="button"
              aria-pressed={selectedPlayerId === playerId}
              aria-label={`Byt in ${player.name}`}
              disabled={onSelectPlayer === undefined}
              className="min-h-touch rounded-xl border border-white/10 bg-card px-3 py-2"
              onClick={() => onSelectPlayer?.(playerId)}
            >
              <p className="truncate text-sm font-semibold">
                {player.number === null ? '' : `${player.number} · `}
                {player.name}
              </p>
              <p className="text-muted-foreground text-xs tabular-nums">
                Speltid {formatClock(player.playedMs)}
              </p>
            </button>
          );
        })}
      </div>
    </section>
  );
}
