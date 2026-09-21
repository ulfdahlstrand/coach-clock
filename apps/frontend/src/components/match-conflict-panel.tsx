import type { DerivedMatchState, PlannedSubstitution } from '@coach-clock/contracts';
import { AlertTriangleIcon, ChevronDownIcon, UsersRoundIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  conflictCount,
  describeIgnoredEvent,
  plannedSwapDescription,
  plannerLabel,
} from '@/lib/match-conflicts';

export interface MatchConflictPanelProps {
  readonly state: Pick<DerivedMatchState, 'ignored' | 'plannedSubstitutions' | 'players'>;
  /** Called only after the planner's identity has been shown in the card. */
  readonly onConfirmPlan?: (plan: PlannedSubstitution) => void;
}

function playerName(state: MatchConflictPanelProps['state'], playerId: string): string {
  return state.players[playerId]?.name ?? 'Okänd spelare';
}

/**
 * A compact live-match notice with the full folded conflict log behind a
 * deliberate disclosure.  It is deliberately fed by `deriveMatchState`, so
 * SSE and catch-up HTTP events naturally update the same source of truth.
 */
export function MatchConflictPanel({ state, onConfirmPlan }: MatchConflictPanelProps) {
  const count = conflictCount(state);

  if (count === 0 && state.plannedSubstitutions.length === 0) return null;

  return (
    <section className="space-y-3" aria-label="Matchhändelser och byten">
      {state.plannedSubstitutions.map((plan) => (
        <article
          key={plan.planId}
          className="rounded-2xl border border-violet-300/50 bg-violet-950/30 p-4 text-violet-50 shadow-sm"
        >
          <div className="flex gap-3">
            <UsersRoundIcon className="mt-0.5 size-5 shrink-0 text-violet-300" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">Planerat byte</p>
              <p className="mt-1 text-sm text-violet-100">
                {plannedSwapDescription(plan, (playerId) => playerName(state, playerId))}
              </p>
              <p className="mt-2 text-xs font-medium tracking-wide text-violet-200">
                Planerat av {plannerLabel(plan.plannedBy)}
              </p>
            </div>
          </div>
          {onConfirmPlan ? (
            <Button
              className="mt-4 min-h-touch w-full bg-violet-100 text-violet-950 hover:bg-white"
              onClick={() => onConfirmPlan(plan)}
            >
              Bekräfta planerat byte
            </Button>
          ) : null}
        </article>
      ))}

      {count > 0 ? (
        <aside
          className="rounded-2xl border border-amber-300/30 bg-amber-950/25 p-4"
          role="status"
          aria-live="polite"
        >
          <div className="flex gap-3">
            <AlertTriangleIcon
              className="mt-0.5 size-5 shrink-0 text-amber-300"
              aria-hidden="true"
            />
            <div>
              <p className="text-sm font-semibold text-amber-50">
                {count === 1
                  ? 'En händelse behöver ses över'
                  : `${count} händelser behöver ses över`}
              </p>
              <p className="mt-1 text-sm text-amber-100/85">
                Matchläget är säkert. De här registreringarna har inte ändrat planen eller klockan.
              </p>
            </div>
          </div>
          <details className="mt-3 group">
            <summary className="flex min-h-touch cursor-pointer list-none items-center justify-between rounded-lg px-1 text-sm font-semibold text-amber-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-200">
              Visa alla händelser
              <ChevronDownIcon
                className="size-4 transition-transform group-open:rotate-180"
                aria-hidden="true"
              />
            </summary>
            <ol className="mt-2 divide-y divide-amber-100/10 border-t border-amber-100/15">
              {state.ignored.map((event) => {
                const presentation = describeIgnoredEvent(event);
                return (
                  <li key={`${event.index}-${event.eventId ?? 'okänd'}`} className="py-3 text-sm">
                    <p className="font-medium text-amber-50">{presentation.title}</p>
                    <p className="mt-1 text-amber-100/80">{presentation.description}</p>
                  </li>
                );
              })}
            </ol>
          </details>
        </aside>
      ) : null}
    </section>
  );
}
