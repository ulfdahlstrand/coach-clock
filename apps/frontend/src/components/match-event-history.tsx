import { useState } from 'react';
import type { MatchEvent } from '@coach-clock/contracts';
import { Button } from '@/components/ui/button';

export function eventLabel(event: MatchEvent): string {
  switch (event.type) {
    case 'match_created':
      return 'Match skapad';
    case 'squad_set':
      return 'Truppen uppdaterad';
    case 'lineup_set':
      return 'Startuppställning sparad';
    case 'period_started':
      return `Period ${event.periodNumber} startad`;
    case 'period_ended':
      return `Period ${event.periodNumber} avslutad`;
    case 'clock_paused':
      return 'Klockan pausad';
    case 'clock_resumed':
      return 'Klockan fortsätter';
    case 'substitution_planned':
      return 'Byte planerat';
    case 'substitution_cancelled':
      return 'Planerat byte avbrutet';
    case 'substitution_confirmed':
      return 'Byte genomfört';
    case 'player_moved':
      return 'Spelare flyttad';
    case 'formation_changed':
      return 'Formation ändrad';
    case 'availability_changed':
      return event.available ? 'Spelare tillgänglig' : 'Spelare otillgänglig';
    case 'match_ended':
      return 'Match avslutad';
    case 'event_undone':
      return 'En händelse ångrad';
    case 'event_time_corrected':
      return 'Tidpunkt korrigerad';
  }
}

function isOriginalEvent(event: MatchEvent): boolean {
  return event.type !== 'event_undone' && event.type !== 'event_time_corrected';
}

/** Matchens grund. Att ångra någon av dem mitt i en match tömmer planen. */
const SETUP_EVENTS: ReadonlySet<MatchEvent['type']> = new Set([
  'match_created',
  'squad_set',
  'lineup_set',
]);

/**
 * Den senaste händelsen som går att ångra med ett tryck i matchvyn (#90):
 * en ursprunglig händelse som inte redan ångrats och inte hör till matchens
 * grund. Allt annat rättas i händelselistan på sammanställningen.
 */
export function latestUndoableEvent(events: readonly MatchEvent[]): MatchEvent | undefined {
  const undone = new Set(
    events.flatMap((event) => (event.type === 'event_undone' ? [event.targetEventId] : [])),
  );
  return [...events]
    .reverse()
    .find(
      (event) =>
        isOriginalEvent(event) && !SETUP_EVENTS.has(event.type) && !undone.has(event.eventId),
    );
}

function localDateTimeValue(iso: string): string {
  const date = new Date(iso);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

/**
 * Matchens händelser med möjlighet att ångra och rätta tid (#33). Visas på
 * sammanställningen; under matchen tog listan plats från klockan och planen.
 */
export function MatchEventHistory({
  events,
  disabled,
  onUndo,
  onCorrectTime,
}: {
  readonly events: readonly MatchEvent[];
  readonly disabled: boolean;
  readonly onUndo: (event: MatchEvent) => void;
  readonly onCorrectTime: (event: MatchEvent, correctedAt: string) => void;
}) {
  const [editingEventId, setEditingEventId] = useState<string | undefined>();
  const [correctedAt, setCorrectedAt] = useState('');

  function save(event: MatchEvent): void {
    const timestamp = new Date(correctedAt);
    if (correctedAt === '' || Number.isNaN(timestamp.getTime())) return;
    onCorrectTime(event, timestamp.toISOString());
    setEditingEventId(undefined);
    setCorrectedAt('');
  }

  return (
    <ul className="space-y-2" aria-label="Matchens händelser">
      {[...events].reverse().map((event) => {
        const canCorrect = isOriginalEvent(event);
        const isEditing = editingEventId === event.eventId;
        return (
          <li key={event.eventId} className="rounded-xl border border-stone-200 p-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-medium text-stone-900">{eventLabel(event)}</p>
                <p className="mt-1 text-xs tabular-nums text-stone-500">
                  {new Date(event.at).toLocaleString('sv-SE', {
                    hour: '2-digit',
                    minute: '2-digit',
                    day: '2-digit',
                    month: '2-digit',
                  })}
                </p>
              </div>
              {canCorrect ? (
                <div className="flex shrink-0 gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="min-h-touch"
                    disabled={disabled}
                    onClick={() => onUndo(event)}
                  >
                    Ångra
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="min-h-touch"
                    disabled={disabled}
                    onClick={() => {
                      setEditingEventId(event.eventId);
                      setCorrectedAt(localDateTimeValue(event.at));
                    }}
                  >
                    Rätta tid
                  </Button>
                </div>
              ) : null}
            </div>
            {isEditing ? (
              <form
                className="mt-3 flex flex-col gap-2 border-t border-stone-200 pt-3"
                onSubmit={(submitEvent) => {
                  submitEvent.preventDefault();
                  save(event);
                }}
              >
                <label className="text-sm text-stone-600" htmlFor={`corrected-at-${event.eventId}`}>
                  Rätt tidpunkt
                </label>
                <input
                  id={`corrected-at-${event.eventId}`}
                  className="min-h-touch rounded-xl border border-stone-300 px-3"
                  type="datetime-local"
                  value={correctedAt}
                  onChange={(inputEvent) => setCorrectedAt(inputEvent.target.value)}
                />
                <div className="grid grid-cols-2 gap-2">
                  <Button size="sm" type="submit" disabled={disabled || correctedAt === ''}>
                    Spara tid
                  </Button>
                  <Button
                    size="sm"
                    type="button"
                    variant="secondary"
                    onClick={() => setEditingEventId(undefined)}
                  >
                    Avbryt
                  </Button>
                </div>
              </form>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
